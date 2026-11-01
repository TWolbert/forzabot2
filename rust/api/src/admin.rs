//! Separate, short-lived admin authentication and transactional point changes.
use super::{auth, lock, query, str_arg, ApiError, ApiResult, Database};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;
use uuid::Uuid;

const TTL_MS: i64 = 12 * 60 * 60 * 1000;

#[derive(Clone)]
struct AdminState {
    db: Database,
    password_hash: Option<[u8; 32]>,
    sessions: Arc<Mutex<HashMap<[u8; 32], i64>>>,
}

fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
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
fn authorize(state: &AdminState, headers: &HeaderMap) -> ApiResult<[u8; 32]> {
    if state.password_hash.is_none() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Points management is not configured on the server",
        ));
    }
    let token = bearer(headers).ok_or(ApiError(StatusCode::UNAUTHORIZED, "Unauthorized"))?;
    let hash = digest(token);
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Admin session error"))?;
    let now = auth::now_ms();
    sessions.retain(|_, expires| *expires > now);
    if !sessions.contains_key(&hash) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Unauthorized"));
    }
    Ok(hash)
}

pub fn router(db: Database, password: Option<String>) -> Router {
    let password_hash = password
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .map(|s| digest(&s));
    let state = AdminState {
        db,
        password_hash,
        sessions: Arc::new(Mutex::new(HashMap::new())),
    };
    Router::new()
        .route("/api/admin/login", post(login))
        .route("/api/admin/logout", post(logout))
        .route("/api/admin/verify", get(verify))
        .route("/api/admin/users", get(users))
        .route("/api/admin/users/{id}/points", post(update_points))
        .route("/api/admin/points-log", get(points_log))
        .with_state(state)
}

#[derive(Deserialize)]
struct Login {
    password: Option<String>,
}
async fn login(
    State(state): State<AdminState>,
    Json(body): Json<Login>,
) -> ApiResult<([(header::HeaderName, &'static str); 1], Json<Value>)> {
    let expected = state.password_hash.ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Points management is not configured on the server",
    ))?;
    let password = body.password.unwrap_or_default();
    let password = password.trim();
    if password.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Missing password"));
    }
    if !bool::from(expected.ct_eq(&digest(password))) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Invalid password"));
    }
    let token = format!("{}-{}", Uuid::new_v4(), Uuid::new_v4());
    let now = auth::now_ms();
    let expiry = now + TTL_MS;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Admin session error"))?;
    sessions.retain(|_, expires| *expires > now);
    sessions.insert(digest(&token), expiry);
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({"token":token,"expires_at":expiry})),
    ))
}

async fn logout(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    if let Some(token) = bearer(&headers) {
        state
            .sessions
            .lock()
            .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Admin session error"))?
            .remove(&digest(token));
    }
    Ok(Json(json!({"ok":true})))
}
async fn verify(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    authorize(&state, &headers)?;
    Ok(Json(json!({"ok":true})))
}
async fn users(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    authorize(&state, &headers)?;
    let db = lock(&state.db)?;
    Ok(Json(
        json!({"users":query(&db,"SELECT id,username,points,created_at FROM web_users ORDER BY points DESC,username ASC",vec![])?}),
    ))
}
#[derive(Deserialize)]
struct Points {
    points: Option<i64>,
}
async fn update_points(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Points>,
) -> ApiResult<Json<Value>> {
    let session = authorize(&state, &headers)?;
    let points = body.points.filter(|p| *p >= 0).ok_or(ApiError(
        StatusCode::BAD_REQUEST,
        "Points must be a non-negative integer",
    ))?;
    let mut db = lock(&state.db)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let before: Option<i64> = tx
        .query_row("SELECT points FROM web_users WHERE id=?", [&id], |r| {
            r.get(0)
        })
        .optional()?;
    let before = before.ok_or(ApiError(StatusCode::NOT_FOUND, "User not found"))?;
    let delta = points.checked_sub(before).ok_or(ApiError(
        StatusCode::BAD_REQUEST,
        "Points must be a non-negative integer",
    ))?;
    tx.execute(
        "UPDATE web_users SET points=?1 WHERE id=?2",
        params![points, id],
    )?;
    // Log a hash-derived session fingerprint rather than any bearer-token bytes.
    let fingerprint = format!(
        "{:02x}{:02x}{:02x}{:02x}",
        session[0], session[1], session[2], session[3]
    );
    tx.execute("INSERT INTO web_user_points_log(user_id,source,before_points,after_points,delta,metadata,created_at) VALUES (?1,'admin_panel_set',?2,?3,?4,?5,?6)",params![id,before,points,delta,json!({"admin_session":fingerprint}).to_string(),auth::now_ms()])?;
    let user = query(
        &tx,
        "SELECT id,username,points,created_at FROM web_users WHERE id=?",
        vec![str_arg(&id)],
    )?
    .into_iter()
    .next()
    .ok_or(ApiError(StatusCode::NOT_FOUND, "User not found"))?;
    tx.commit()?;
    Ok(Json(json!({"user":user})))
}
async fn points_log(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    authorize(&state, &headers)?;
    let db = lock(&state.db)?;
    Ok(Json(
        json!({"logs":query(&db,"SELECT l.id,l.user_id,wu.username,l.source,l.before_points,l.after_points,l.delta,l.metadata,l.created_at FROM web_user_points_log l JOIN web_users wu ON wu.id=l.user_id ORDER BY l.created_at DESC LIMIT 200",vec![])?}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_admin_sessions_are_rejected() {
        let db = Arc::new(Mutex::new(rusqlite::Connection::open_in_memory().unwrap()));
        let state = AdminState {
            db,
            password_hash: Some(digest("password")),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        };
        state
            .sessions
            .lock()
            .unwrap()
            .insert(digest("expired"), auth::now_ms() - 1);
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, "Bearer expired".parse().unwrap());
        assert!(authorize(&state, &headers).is_err());
        assert!(state.sessions.lock().unwrap().is_empty());
    }
}
