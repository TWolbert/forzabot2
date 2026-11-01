use super::{lock, query, str_arg, ApiError, ApiResult, Database};
use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const SESSION_TTL: i64 = 30 * 24 * 60 * 60 * 1000;
const BCRYPT_COST: u32 = 10;

#[derive(Deserialize)]
pub struct Credentials {
    username: Option<String>,
    password: Option<String>,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn token() -> String {
    format!("{}-{}", Uuid::new_v4(), Uuid::new_v4())
}
fn bearer(headers: &HeaderMap) -> Option<&str> {
    let (scheme, token) = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}
pub(crate) fn user(db: &rusqlite::Connection, headers: &HeaderMap) -> ApiResult<Value> {
    let token = bearer(headers).ok_or(ApiError(StatusCode::UNAUTHORIZED, "Unauthorized"))?;
    let rows = query(db,"SELECT u.id,u.username,u.points FROM auth_sessions s JOIN web_users u ON u.id=s.user_id WHERE s.token=?1 AND s.expires_at>?2 LIMIT 1",vec![str_arg(token),now_ms().into()])?;
    rows.into_iter()
        .next()
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "Unauthorized"))
}
fn invalid_credentials() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Invalid credentials")
}

pub async fn register(
    State(db): State<Database>,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    let username = body.username.unwrap_or_default().trim().to_lowercase();
    let password = body.password.unwrap_or_default();
    if username.is_empty() || password.is_empty() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Missing username or password",
        ));
    }
    if username.encode_utf16().count() < 3 || password.encode_utf16().count() < 6 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Username must be 3+ chars and password must be 6+ chars",
        ));
    }
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(password, BCRYPT_COST))
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Password hashing failed"))?
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Password hashing failed"))?;
    let mut db = lock(&db)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM web_users WHERE lower(username)=lower(?))",
        [&username],
        |r| r.get(0),
    )?;
    if exists {
        return Err(ApiError(StatusCode::CONFLICT, "Username already exists"));
    }
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let token = token();
    tx.execute("INSERT INTO web_users(id,username,password_hash,points,created_at) VALUES (?1,?2,?3,100,?4)",params![id,username,hash,now])?;
    tx.execute(
        "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)",
        params![token, id, now, now + SESSION_TTL],
    )?;
    tx.commit()?;
    Ok(Json(
        json!({"token":token,"user":{"id":id,"username":username,"points":100}}),
    ))
}

pub async fn login(
    State(db): State<Database>,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    let username = body.username.unwrap_or_default().trim().to_lowercase();
    let password = body.password.unwrap_or_default();
    if username.is_empty() || password.is_empty() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Missing username or password",
        ));
    }
    let account: Option<(String, String, String, i64)> = {
        let db = lock(&db)?;
        db.query_row(
            "SELECT id,username,password_hash,points FROM web_users WHERE lower(username)=lower(?)",
            [username],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
    };
    let Some((id, username, hash, points)) = account else {
        return Err(invalid_credentials());
    };
    let verified = tokio::task::spawn_blocking(move || bcrypt::verify(password, &hash))
        .await
        .map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Password verification failed",
            )
        })?
        .unwrap_or(false);
    if !verified {
        return Err(invalid_credentials());
    }
    let token = token();
    let now = now_ms();
    let db = lock(&db)?;
    db.execute(
        "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)",
        params![token, id, now, now + SESSION_TTL],
    )?;
    Ok(Json(
        json!({"token":token,"user":{"id":id,"username":username,"points":points}}),
    ))
}

pub async fn me(State(db): State<Database>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    Ok(Json(json!({"user":user(&db,&headers)?})))
}
pub async fn logout(State(db): State<Database>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    if let Some(token) = bearer(&headers) {
        lock(&db)?.execute("DELETE FROM auth_sessions WHERE token=?", [token])?;
    }
    Ok(Json(json!({"ok":true})))
}
pub async fn points_history(
    State(db): State<Database>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let user = user(&db, &headers)?;
    let id = user["id"].as_str().unwrap_or_default();
    let history = query(&db,"SELECT id,source,before_points,after_points,delta,created_at FROM web_user_points_log WHERE user_id=? AND source IN ('bet_payout','bet_placed','bet_refunded','race_placement_1st','race_placement_2nd') ORDER BY created_at ASC",vec![str_arg(id)])?;
    Ok(Json(json!({"history":history})))
}

#[derive(Deserialize)]
pub struct Username {
    username: Option<String>,
}

pub async fn update_username(
    State(db): State<Database>,
    headers: HeaderMap,
    Json(body): Json<Username>,
) -> ApiResult<Json<Value>> {
    let mut db = lock(&db)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = user(&tx, &headers)?;
    let id = current["id"].as_str().unwrap_or_default();
    let name = body.username.unwrap_or_default().trim().to_owned();
    let size = name.encode_utf16().count();
    if size == 0 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Username cannot be empty",
        ));
    }
    if size < 3 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Username must be at least 3 characters",
        ));
    }
    if size > 32 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Username must be 32 characters or less",
        ));
    }
    // Login and registration are case-insensitive. Prevent ambiguous logins,
    // including databases whose legacy UNIQUE constraint is case-sensitive.
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM web_users WHERE lower(username)=lower(?1) AND id!=?2)",
        params![name, id],
        |r| r.get(0),
    )?;
    if exists {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Username is already taken",
        ));
    }
    tx.execute(
        "UPDATE web_users SET username=?1 WHERE id=?2",
        params![name, id],
    )?;
    let updated = query(
        &tx,
        "SELECT id,username,points FROM web_users WHERE id=?",
        vec![str_arg(id)],
    )?
    .into_iter()
    .next()
    .ok_or(ApiError(StatusCode::NOT_FOUND, "User not found"))?;
    tx.commit()?;
    Ok(Json(json!({"user":updated})))
}

pub async fn discord_link(
    State(db): State<Database>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let current = user(&db, &headers)?;
    let id = current["id"].as_str().unwrap_or_default();
    let linked = query(&db,"SELECT w.discord_username,w.discord_user_id,da.avatar_url FROM web_users_discord w LEFT JOIN discord_avatars da ON da.player_id=w.discord_user_id WHERE w.web_user_id=? LIMIT 1",vec![str_arg(id)])?.into_iter().next().unwrap_or(json!({"discord_username":null,"discord_user_id":null,"avatar_url":null}));
    Ok(Json(linked))
}

pub async fn unlink_discord(
    State(db): State<Database>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let mut db = lock(&db)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = user(&tx, &headers)?;
    tx.execute(
        "DELETE FROM discord_link_challenges WHERE user_id=?",
        [current["id"].as_str().unwrap_or_default()],
    )?;
    tx.execute(
        "DELETE FROM web_users_discord WHERE web_user_id=?",
        [current["id"].as_str().unwrap_or_default()],
    )?;
    tx.commit()?;
    Ok(Json(json!({"ok":true})))
}

/// Issue a one-time code for the authenticated user. Redemption requires a
/// Discord gateway interaction and is never accepted from an HTTP caller.
pub async fn start_discord_link(
    State(db): State<Database>,
    headers: HeaderMap,
) -> ApiResult<([(header::HeaderName, &'static str); 1], Json<Value>)> {
    let mut db = lock(&db)?;
    let current = user(&db, &headers)?;
    let now = now_ms();
    let code = Uuid::new_v4().to_string();
    forzabot_database::discord_link::create(
        &mut db,
        current["id"].as_str().unwrap_or_default(),
        &code,
        now,
    )?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(
            json!({"code":code,"expires_at":now + forzabot_database::discord_link::CHALLENGE_TTL_MS}),
        ),
    ))
}
