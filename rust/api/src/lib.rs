//! Experimental API routes compatible with the existing SQLite database.
mod admin;
mod auth;
mod bets;
mod media;
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{
    params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Database = Arc<Mutex<Connection>>;

pub fn router(db: Database) -> Router {
    router_with_admin(db, None)
}

pub fn router_with_admin(db: Database, password: Option<String>) -> Router {
    let admin = admin::router(db.clone(), password);
    let media = media::router(db.clone());
    let app = Router::new()
        .route("/api/games", get(games))
        .route("/api/games/{id}", get(game_detail))
        .route("/api/leaderboard", get(leaderboard))
        .route("/api/current-round", get(current_round))
        .route("/api/times", get(times))
        .route("/api/times/{id}", get(time_detail))
        .route("/api/fastest-time", get(fastest_time))
        .route("/api/races", get(races))
        .route("/api/player/{id}", get(player_detail))
        .route("/api/candr-map", get(season_map))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/points-history", get(auth::points_history))
        .route("/api/auth/update-username", post(auth::update_username))
        .route("/api/auth/discord-link", get(auth::discord_link))
        .route(
            "/api/auth/discord-link/start",
            post(auth::start_discord_link),
        )
        .route("/api/auth/unlink-discord", post(auth::unlink_discord))
        .route("/api/bets/place", post(bets::place))
        .route("/api/bets/current", get(bets::current))
        .route("/api/candr/tile", post(candr_tile))
        .with_state(db.clone())
        .merge(admin)
        .merge(media);
    // Serve the built RSX dashboard when present. SPA routes fall back to
    // index.html; API routes above take precedence.
    let dist = std::env::var("DASHBOARD_DIST").unwrap_or_else(|_| "dashboard-dist".into());
    if std::path::Path::new(&dist).is_dir() {
        app.fallback_service(tower_http::services::ServeDir::new(&dist).fallback(
            tower_http::services::ServeFile::new(format!("{dist}/index.html")),
        ))
    } else {
        app
    }
}

#[derive(Deserialize)]
struct TileRequest {
    #[serde(rename = "roundId")]
    round_id: Option<String>,
    tile: Option<String>,
}

async fn candr_tile(
    State(db): State<Database>,
    headers: HeaderMap,
    Json(body): Json<TileRequest>,
) -> Response {
    let round = body.round_id.unwrap_or_default().trim().to_owned();
    let tile = body.tile.unwrap_or_default();
    if round.is_empty() || tile.trim().is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "Invalid tile selection");
    }
    let mut db = match lock(&db) {
        Ok(db) => db,
        Err(error) => return error.into_response(),
    };
    let user = match auth::user(&db, &headers) {
        Ok(user) => user,
        Err(error) => return error.into_response(),
    };
    let user_id = user["id"].as_str().unwrap_or_default();
    let discord_id: Option<String> = {
        use rusqlite::OptionalExtension;
        match db
            .query_row(
                "SELECT discord_user_id FROM web_users_discord WHERE web_user_id=? LIMIT 1",
                [user_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
        {
            Ok(value) => value.flatten(),
            Err(error) => return ApiError::from(error).into_response(),
        }
    };
    let Some(discord_id) = discord_id else {
        return error_response(
            StatusCode::FORBIDDEN,
            "Link your Discord account before setting a tile",
        );
    };
    let race_type: Option<String> = {
        use rusqlite::OptionalExtension;
        match db
            .query_row("SELECT race_type FROM rounds WHERE id=?", [&round], |r| {
                r.get(0)
            })
            .optional()
        {
            Ok(value) => value,
            Err(error) => return ApiError::from(error).into_response(),
        }
    };
    if race_type.as_deref() != Some("candr")
        && !race_type
            .as_deref()
            .is_some_and(|v| v.eq_ignore_ascii_case("candr"))
    {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Round is not a cops and robbers round",
        );
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    use forzabot_database::candr::Error as TileError;
    if let Err(error) = forzabot_database::candr::set_tile(&mut db, &round, &discord_id, &tile, now)
    {
        return match error {
            TileError::NotRobber => error_response(
                StatusCode::FORBIDDEN,
                "Only the robber can set the target tile.",
            ),
            TileError::InvalidTile => {
                error_response(StatusCode::BAD_REQUEST, "Invalid tile selection")
            }
            TileError::Wait(milliseconds) => {
                let seconds = milliseconds.max(0) / 1000;
                error_response(
                    StatusCode::BAD_REQUEST,
                    format!(
                        "You must wait {}:{:02} before selecting a new tile.",
                        seconds / 60,
                        seconds % 60
                    ),
                )
            }
            TileError::NotActive => {
                error_response(StatusCode::BAD_REQUEST, "Cops and robbers is not active")
            }
            TileError::NoState => error_response(
                StatusCode::NOT_FOUND,
                "CANDR state not found for this round",
            ),
            TileError::NotCreator => error_response(
                StatusCode::FORBIDDEN,
                "Only the person who started this round can finish it!",
            ),
            TileError::Database(error) => ApiError::from(error).into_response(),
        };
    }
    let total: Value = db
        .query_row(
            "SELECT candr_total_time_ms FROM rounds WHERE id=?",
            [&round],
            |r| r.get::<_, Option<i64>>(0),
        )
        .ok()
        .flatten()
        .map_or(Value::Null, |value| json!(value));
    match candr(&db, &round, true, total) {
        Ok(state) => Json(json!({"ok":true,"candr":state})).into_response(),
        Err(error) => error.into_response(),
    }
}

fn error_response(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({"error": message.into()}))).into_response()
}

async fn season_map() -> Response {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let image: &'static [u8] = match forzabot_core::season_at(now) {
        "summer" => include_bytes!("../../../media/maps/fh6-japan-summer.jpg"),
        "autumn" => include_bytes!("../../../media/maps/fh6-japan-autumn.jpg"),
        "winter" => include_bytes!("../../../media/maps/fh6-japan-winter.jpg"),
        _ => include_bytes!("../../../media/maps/fh6-japan-spring.jpg"),
    };
    (
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        image,
    )
        .into_response()
}

struct ApiError(StatusCode, &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        eprintln!("API database error: {error}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
    }
}
type ApiResult<T> = Result<T, ApiError>;
fn lock(db: &Database) -> ApiResult<std::sync::MutexGuard<'_, Connection>> {
    db.lock()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))
}
fn query(db: &Connection, sql: &str, args: Vec<SqlValue>) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = db.prepare(sql)?;
    let names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let rows = stmt.query_map(params_from_iter(args), |row| {
        let mut object = Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(v) => json!(v),
                ValueRef::Real(v) => json!(v),
                ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                ValueRef::Blob(_) => Value::Null,
            };
            object.insert(name.clone(), value);
        }
        Ok(Value::Object(object))
    })?;
    rows.collect()
}
fn one(db: &Connection, sql: &str, args: Vec<SqlValue>, missing: &'static str) -> ApiResult<Value> {
    query(db, sql, args)?
        .into_iter()
        .next()
        .ok_or(ApiError(StatusCode::NOT_FOUND, missing))
}
fn str_arg(s: &str) -> SqlValue {
    SqlValue::Text(s.to_owned())
}

async fn games(State(db): State<Database>) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    Ok(Json(json!(query(&db,"SELECT r.id,r.race_type,r.winner_id,p.display_name AS winner_name,COUNT(rp.player_id) AS num_players,r.created_at FROM rounds r LEFT JOIN players p ON r.winner_id=p.id LEFT JOIN round_players rp ON r.id=rp.round_id WHERE r.status='finished' GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50",vec![])?)))
}

fn players(db: &Connection, id: &str, current: bool) -> rusqlite::Result<Vec<Value>> {
    let fields = if current {
        ",da.avatar_url,ci.image_url AS confirmed_image_url"
    } else {
        ""
    };
    let joins = if current {
        "LEFT JOIN discord_avatars da ON p.id=da.player_id LEFT JOIN car_images ci ON lower(cc.car_name)=lower(ci.car_name)"
    } else {
        ""
    };
    query(db,&format!("SELECT p.id,p.display_name,cc.car_name{fields} FROM round_players rp JOIN players p ON rp.player_id=p.id LEFT JOIN car_choices cc ON rp.round_id=cc.round_id AND rp.player_id=cc.player_id {joins} WHERE rp.round_id=? ORDER BY p.display_name ASC"),vec![str_arg(id)])
}
fn scores(db: &Connection, id: &str) -> rusqlite::Result<Vec<Value>> {
    query(db,"SELECT rs.player_id,p.display_name,rs.points FROM round_scores rs JOIN players p ON rs.player_id=p.id WHERE rs.round_id=? ORDER BY rs.points DESC,p.display_name ASC",vec![str_arg(id)])
}
fn candr(db: &Connection, id: &str, current: bool, total: Value) -> ApiResult<Value> {
    let mut states = query(db,"SELECT cs.robber_player_id,rp.display_name AS robber_name,cs.current_tile,cs.previous_tile,cs.started_at,cs.last_tile_at,cs.next_tile_due_at,cs.finished_at FROM candr_state cs LEFT JOIN players rp ON cs.robber_player_id=rp.id WHERE cs.round_id=? LIMIT 1",vec![str_arg(id)])?;
    let Some(mut state) = states.pop() else {
        return Ok(Value::Null);
    };
    state["roles"] = json!(query(db,"SELECT cpr.player_id,p.display_name,cpr.role FROM candr_player_roles cpr JOIN players p ON p.id=cpr.player_id WHERE cpr.round_id=? ORDER BY p.display_name ASC",vec![str_arg(id)])?);
    state["map_url"] = json!("/api/candr-map");
    if current {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        state["elapsed_ms"] = json!(state["started_at"]
            .as_i64()
            .filter(|n| *n != 0)
            .map(|n| now.saturating_sub(n).max(0))
            .unwrap_or(0));
        state["total_time_ms"] = total;
    }
    Ok(state)
}

async fn game_detail(State(db): State<Database>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let mut game = one(&db,"SELECT r.id,r.class,r.restrict_class,r.value,r.race_type,r.year,r.winner_id,p.display_name AS winner_name,r.candr_total_time_ms,r.created_at FROM rounds r LEFT JOIN players p ON r.winner_id=p.id WHERE r.id=?",vec![str_arg(&id)],"Game not found")?;
    game["players"] = json!(players(&db, &id, false)?);
    game["scores"] = json!(scores(&db, &id)?);
    game["candr"] = if game["race_type"]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case("candr"))
    {
        candr(&db, &id, false, Value::Null)?
    } else {
        Value::Null
    };
    Ok(Json(game))
}

async fn current_round(State(db): State<Database>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let mut round = one(&db,"SELECT id,class,restrict_class,value,race_type,year,status,candr_total_time_ms,created_at FROM rounds WHERE status IN ('pending','active') AND winner_id IS NULL LIMIT 1",vec![],"No active round")?;
    let id = round["id"].as_str().unwrap_or_default().to_owned();
    round["players"] = json!(players(&db, &id, true)?);
    round["scores"] = json!(scores(&db, &id)?);
    round["candr"] = if round["race_type"]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case("candr"))
    {
        candr(&db, &id, true, round["candr_total_time_ms"].clone())?
    } else {
        Value::Null
    };
    let mut series = Value::Null;
    if round["race_type"]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case("all"))
    {
        let completed: i64 = db.query_row(
            "SELECT COUNT(DISTINCT race_index) FROM round_race_results WHERE round_id=?",
            [&id],
            |r| r.get(0),
        )?;
        series = ["drag", "road", "dirt", "cross-country"]
            .get(completed as usize)
            .map_or(Value::Null, |s| json!(s));
        if completed == 4 {
            let tied: i64 = db.query_row("SELECT COUNT(*) FROM round_scores WHERE round_id=?1 AND points=(SELECT MAX(points) FROM round_scores WHERE round_id=?1)",[&id],|r|r.get(0))?;
            if tied > 1 {
                series = json!("cross-country");
            }
        }
    }
    round["series_race"] = series;
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
        .map(|(_, token)| token.trim());
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let user: Option<String> = if let Some(token) = token {
        use rusqlite::OptionalExtension;
        db.query_row(
            "SELECT s.user_id FROM auth_sessions s JOIN web_users u ON u.id=s.user_id WHERE s.token=?1 AND s.expires_at>?2",
            params![token, now],
            |r| r.get(0),
        )
        .optional()?
    } else {
        None
    };
    round["user_bets"] = json!(if let Some(user) = user {
        query(&db,"SELECT id,predicted_player_id,points_wagered,status,payout FROM bets WHERE round_id=?1 AND user_id=?2 ORDER BY created_at DESC",vec![str_arg(&id),str_arg(&user)])?
    } else {
        vec![]
    });
    round["all_bets"] = json!(query(&db,"SELECT b.id,b.user_id,b.predicted_player_id,b.points_wagered,b.status,b.payout,wu.username FROM bets b JOIN web_users wu ON b.user_id=wu.id WHERE b.round_id=? ORDER BY b.created_at DESC",vec![str_arg(&id)])?);
    Ok(Json(round))
}

#[derive(Deserialize)]
struct Filters {
    race: Option<String>,
    car: Option<String>,
}
async fn times(
    State(db): State<Database>,
    Query(filters): Query<Filters>,
) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let mut sql = String::from("SELECT t.id,t.player_id,p.display_name AS player_name,t.car_name,r.name AS race_name,t.laptime AS time_ms,t.created_at,ci.image_url AS confirmed_image_url FROM times t JOIN players p ON t.player_id=p.id JOIN races r ON t.race_id=r.id LEFT JOIN car_images ci ON lower(t.car_name)=lower(ci.car_name) WHERE 1=1");
    let mut args = Vec::new();
    if let Some(race) = filters.race.filter(|s| !s.is_empty()) {
        sql.push_str(" AND r.name LIKE ? COLLATE NOCASE");
        args.push(str_arg(&format!("%{race}%")));
    }
    if let Some(car) = filters.car.filter(|s| !s.is_empty()) {
        sql.push_str(" AND t.car_name LIKE ? COLLATE NOCASE");
        args.push(str_arg(&format!("%{car}%")));
    }
    sql.push_str(" ORDER BY t.created_at DESC LIMIT 100");
    Ok(Json(json!(query(&db, &sql, args)?)))
}
async fn time_detail(State(db): State<Database>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    Ok(Json(one(&db,"SELECT t.id,t.player_id,p.display_name AS player_name,t.car_name,r.name AS race_name,t.laptime AS time_ms,t.created_at FROM times t JOIN players p ON t.player_id=p.id JOIN races r ON t.race_id=r.id WHERE t.id=?",vec![str_arg(&id)],"Time not found")?))
}
async fn player_detail(
    State(db): State<Database>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let player = one(&db,"SELECT p.*,da.avatar_url FROM players p LEFT JOIN discord_avatars da ON da.player_id=p.id WHERE p.id=? LIMIT 1",vec![str_arg(&id)],"Player not found")?;
    let stats = query(&db,"SELECT COUNT(DISTINCT r.id) AS games_played,COUNT(CASE WHEN r.winner_id=?1 THEN 1 END) AS wins,COUNT(DISTINCT t.id) AS times_recorded,MIN(t.laptime) AS fastest_time FROM rounds r LEFT JOIN round_players rp ON r.id=rp.round_id AND rp.player_id=?1 LEFT JOIN times t ON t.player_id=?1 WHERE rp.player_id=?1 OR r.winner_id=?1",vec![str_arg(&id)])?;
    let games = query(&db,"SELECT r.id,r.race_type,r.winner_id,p.display_name AS winner_name,COUNT(rp.player_id) AS num_players,r.created_at,cc.car_name FROM rounds r LEFT JOIN players p ON r.winner_id=p.id LEFT JOIN round_players rp ON r.id=rp.round_id LEFT JOIN car_choices cc ON r.id=cc.round_id AND cc.player_id=?1 WHERE r.status='finished' AND rp.player_id=?1 GROUP BY r.id ORDER BY r.created_at DESC",vec![str_arg(&id)])?;
    let times = query(&db,"SELECT t.id,t.car_name,r.name AS race_name,t.laptime AS time_ms,t.created_at,ci.image_url AS confirmed_image_url FROM times t JOIN races r ON t.race_id=r.id LEFT JOIN car_images ci ON lower(t.car_name)=lower(ci.car_name) WHERE t.player_id=? ORDER BY t.created_at DESC",vec![str_arg(&id)])?;
    let mut names: Vec<String> = games
        .iter()
        .chain(times.iter())
        .filter_map(|row| row["car_name"].as_str())
        .map(str::to_owned)
        .collect();
    names.sort();
    names.dedup();
    let images = if names.is_empty() {
        vec![]
    } else {
        let placeholders = vec!["lower(?)"; names.len()].join(",");
        query(&db,&format!("SELECT car_name,image_url FROM car_images WHERE lower(car_name) IN ({placeholders})"),names.into_iter().map(SqlValue::Text).collect())?
    };
    let mut progression: Vec<Value> = Vec::new();
    if let Some(user) = query(
        &db,
        "SELECT web_user_id FROM web_users_discord WHERE discord_user_id=? LIMIT 1",
        vec![str_arg(&id)],
    )?
    .first()
    .and_then(|row| row["web_user_id"].as_str())
    {
        let logs = query(&db,"SELECT before_points,delta,created_at FROM web_user_points_log WHERE user_id=? AND source IN ('bet_payout','bet_placed','bet_refunded','race_placement_1st','race_placement_2nd') ORDER BY created_at ASC",vec![str_arg(user)])?;
        if let Some(first) = logs.first() {
            let mut points = first["before_points"].as_i64().unwrap_or(0);
            progression.push(
                json!({"date":first["created_at"],"cumulative_points":points,"round_points":0}),
            );
            for log in logs {
                let delta = log["delta"].as_i64().unwrap_or(0);
                points += delta;
                progression.push(json!({"date":log["created_at"],"cumulative_points":points,"round_points":delta}));
            }
        }
    }
    Ok(Json(
        json!({"player":player,"stats":stats.into_iter().next().unwrap_or(Value::Null),"games":games,"times":times,"confirmed_images":images,"points_progression":progression}),
    ))
}

async fn fastest_time(State(db): State<Database>) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    Ok(Json(one(&db,"SELECT t.id,t.car_name,t.laptime AS time_ms,r.name AS race_name FROM times t JOIN races r ON t.race_id=r.id WHERE t.is_historic=0 ORDER BY t.laptime ASC LIMIT 1",vec![],"No times found")?))
}
async fn races(State(db): State<Database>) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    Ok(Json(json!(query(&db,"SELECT r.id,r.name,r.created_by,COUNT(t.id) AS num_times FROM races r LEFT JOIN times t ON r.id=t.race_id GROUP BY r.id ORDER BY r.name ASC",vec![])?)))
}

async fn leaderboard(State(db): State<Database>) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let mut rows = query(&db,"SELECT wu.id,wu.username,wu.points,wu.created_at AS user_created_at,wud.discord_user_id AS linked_player_id,da.avatar_url,COUNT(b.id) AS total_bets,SUM(CASE WHEN b.status='won' THEN 1 ELSE 0 END) AS won_bets FROM web_users wu LEFT JOIN bets b ON b.user_id=wu.id LEFT JOIN web_users_discord wud ON wud.web_user_id=wu.id LEFT JOIN discord_avatars da ON da.player_id=wud.discord_user_id GROUP BY wu.id ORDER BY wu.points DESC,wu.username ASC LIMIT 50",vec![])?;
    for row in rows.iter_mut().take(3) {
        let id = row["id"].as_str().unwrap_or_default();
        let logs = query(&db,"SELECT before_points,delta,created_at FROM web_user_points_log WHERE user_id=? AND source IN ('bet_payout','bet_placed','bet_refunded','race_placement_1st','race_placement_2nd') ORDER BY created_at ASC",vec![str_arg(id)])?;
        let mut progression = Vec::new();
        if let Some(first) = logs.first() {
            let mut points = first["before_points"].as_i64().unwrap_or(0);
            progression
                .push(json!({"date":first["created_at"],"cumulative_points":points,"delta":0}));
            for log in logs {
                let delta = log["delta"].as_i64().unwrap_or(0);
                points += delta;
                progression.push(
                    json!({"date":log["created_at"],"cumulative_points":points,"delta":delta}),
                );
            }
        } else {
            progression.push(
                json!({"date":row["user_created_at"],"cumulative_points":row["points"],"delta":0}),
            );
        }
        row["points_progression"] = json!(progression);
    }
    Ok(Json(json!(rows)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn fixture() -> Database {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('p','player','Driver',100,1),('q','q','Other',100,1);
          INSERT INTO web_users VALUES ('u','bettor','hash',120,1),('v','other','hash',100,1);
          INSERT INTO auth_sessions VALUES ('secret','u',1,9223372036854775807);
          INSERT INTO rounds (id,class,value,race_type,status,created_at,winner_id) VALUES ('done','A',100000,'road','finished',1,'p'),('active','B',200000,'all','active',2,NULL);
          INSERT INTO round_players VALUES ('done','p'),('active','p'),('active','q');
          INSERT INTO car_choices (round_id,player_id,car_name,chosen_at) VALUES ('active','p','Ferrari F40',3);
          INSERT INTO bets(round_id,user_id,predicted_player_id,points_wagered,status,created_at) VALUES ('active','u','p',10,'pending',1),('active','v','q',5,'pending',2);
          INSERT INTO times(race_id,player_id,car_name,laptime,is_historic,created_at) VALUES ('fh6-airfield-trail','p','Ferrari F40',90000,0,3),('fh6-airfield-trail','p','Ferrari F40',1000,1,2);").unwrap();
        Arc::new(Mutex::new(db))
    }
    async fn request(db: Database, path: &str, token: Option<&str>) -> (StatusCode, Value) {
        let mut req = Request::builder().uri(path);
        if let Some(token) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = router(db)
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }
    #[tokio::test]
    async fn lists_and_filters_existing_data() {
        let db = fixture();
        let (_, games) = request(db.clone(), "/api/games", None).await;
        assert_eq!(games[0]["id"], "done");
        assert_eq!(games[0]["num_players"], 1);
        let (_, laps) = request(db.clone(), "/api/times?race=airfield&car=f40", None).await;
        assert_eq!(laps.as_array().unwrap().len(), 2);
        let (_, fastest) = request(db.clone(), "/api/fastest-time", None).await;
        assert_eq!(fastest["time_ms"], 90000);
        let (_, board) = request(db.clone(), "/api/leaderboard", None).await;
        assert_eq!(board[0]["username"], "bettor");
        assert_eq!(board[0]["points_progression"][0]["cumulative_points"], 120);
        let (status, missing) = request(db, "/api/games/missing", None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(missing["error"], "Game not found");
    }
    #[tokio::test]
    async fn current_round_exposes_only_authenticated_users_bets() {
        let db = fixture();
        let (_, anonymous) = request(db.clone(), "/api/current-round", None).await;
        assert_eq!(anonymous["user_bets"].as_array().unwrap().len(), 0);
        assert_eq!(anonymous["all_bets"].as_array().unwrap().len(), 2);
        assert_eq!(anonymous["series_race"], "drag");
        let (_, user) = request(db.clone(), "/api/current-round", Some("secret")).await;
        assert_eq!(user["user_bets"].as_array().unwrap().len(), 1);
        assert_eq!(user["user_bets"][0]["predicted_player_id"], "p");
        let (_, invalid) = request(db, "/api/current-round", Some("invalid")).await;
        assert_eq!(invalid["user_bets"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn current_round_returns_candr_roles_and_timing() {
        let db = fixture();
        {
            let conn = db.lock().unwrap();
            conn.execute_batch("UPDATE rounds SET race_type='candr' WHERE id='active'; INSERT INTO candr_state(round_id,robber_player_id,current_tile,started_at,next_tile_due_at) VALUES ('active','p','A1',1000,121000); INSERT INTO candr_player_roles VALUES ('active','p','robber',1000),('active','q','cop',1000);").unwrap();
        }
        let (_, result) = request(db, "/api/current-round", None).await;
        assert_eq!(result["candr"]["robber_player_id"], "p");
        assert_eq!(result["candr"]["current_tile"], "A1");
        assert_eq!(result["candr"]["roles"].as_array().unwrap().len(), 2);
        assert_eq!(result["candr"]["map_url"], "/api/candr-map");
        assert!(result["candr"]["elapsed_ms"].as_i64().unwrap() > 0);
    }

    #[tokio::test]
    async fn map_endpoint_serves_bundled_jpeg() {
        let response = router(fixture())
            .oneshot(
                Request::builder()
                    .uri("/api/candr-map")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        let body = to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap();
        assert!(body.starts_with(&[0xff, 0xd8, 0xff]));
    }

    async fn auth_request(
        db: Database,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Value,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = router(db)
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn registration_sessions_logout_and_history() {
        let db = fixture();
        let (status, registered) = auth_request(
            db.clone(),
            "POST",
            "/api/auth/register",
            None,
            json!({"username":"  NewUser ","password":"secret1"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(registered["user"]["username"], "newuser");
        let token = registered["token"].as_str().unwrap();
        let id = registered["user"]["id"].as_str().unwrap();
        {
            let conn = db.lock().unwrap();
            let hash: String = conn
                .query_row(
                    "SELECT password_hash FROM web_users WHERE id=?",
                    [id],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(hash.starts_with("$2b$10$"));
            conn.execute("INSERT INTO web_user_points_log(user_id,source,before_points,after_points,delta,created_at) VALUES (?1,'bet_payout',100,120,20,2)",[id]).unwrap();
        }
        let (status, me) =
            auth_request(db.clone(), "GET", "/api/auth/me", Some(token), json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(me["user"]["id"], id);
        let (_, history) = auth_request(
            db.clone(),
            "GET",
            "/api/auth/points-history",
            Some(token),
            json!({}),
        )
        .await;
        assert_eq!(history["history"][0]["delta"], 20);
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/register",
                None,
                json!({"username":"NEWUSER","password":"secret1"})
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/logout",
                Some(token),
                json!({})
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            auth_request(db.clone(), "GET", "/api/auth/me", Some(token), json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/login",
                None,
                json!({"username":"NewUser","password":"wrong-password"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, logged_in) = auth_request(
            db.clone(),
            "POST",
            "/api/auth/login",
            None,
            json!({"username":" NewUser ","password":"secret1"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_ne!(logged_in["token"], token);
        let new_token = logged_in["token"].as_str().unwrap();
        db.lock()
            .unwrap()
            .execute(
                "UPDATE auth_sessions SET expires_at=0 WHERE token=?",
                [new_token],
            )
            .unwrap();
        assert_eq!(
            auth_request(db, "GET", "/api/auth/me", Some(new_token), json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn accepts_existing_standard_bcrypt_hash() {
        let db = fixture();
        // Standard $2b$ hash generated by Python bcrypt, independent of this implementation.
        db.lock()
            .unwrap()
            .execute(
                "UPDATE web_users SET password_hash=? WHERE id='u'",
                ["$2b$04$EGdrhbKUv8Oc9vGiXX0HQOxSg445d458Muh7DAHskb6QbtCvdxcie"],
            )
            .unwrap();
        let (status, body) = auth_request(
            db,
            "POST",
            "/api/auth/login",
            None,
            json!({"username":"BETTOR","password":"correctbatteryhorsestapler"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["user"]["id"], "u");
        assert!(body.get("password_hash").is_none());
    }

    #[tokio::test]
    async fn account_edits_require_session_and_keep_names_unique() {
        let db = fixture();
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/update-username",
                None,
                json!({"username":"newname"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/update-username",
                Some("secret"),
                json!({"username":"OTHER"})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        let (status, body) = auth_request(
            db.clone(),
            "POST",
            "/api/auth/update-username",
            Some("secret"),
            json!({"username":"  DriverName  "}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["user"]["username"], "DriverName");
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO web_users_discord VALUES ('u','Driver','p',1)",
                [],
            )
            .unwrap();
        let (_, link) = auth_request(
            db.clone(),
            "GET",
            "/api/auth/discord-link",
            Some("secret"),
            json!({}),
        )
        .await;
        assert_eq!(link["discord_user_id"], "p");
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/unlink-discord",
                Some("secret"),
                json!({})
            )
            .await
            .0,
            StatusCode::OK
        );
        let (_, link) = auth_request(
            db,
            "GET",
            "/api/auth/discord-link",
            Some("secret"),
            json!({}),
        )
        .await;
        assert!(link["discord_user_id"].is_null());
    }

    #[tokio::test]
    async fn discord_link_requires_web_session_and_discord_redemption() {
        let db = fixture();
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/discord-link/start",
                None,
                json!({})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let response = router(db.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/discord-link/start")
                    .header(header::AUTHORIZATION, "Bearer secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap()).unwrap();
        let code = body["code"].as_str().unwrap();
        let (_, unlinked) = auth_request(
            db.clone(),
            "GET",
            "/api/auth/discord-link",
            Some("secret"),
            json!({}),
        )
        .await;
        assert!(unlinked["discord_user_id"].is_null());
        {
            let mut conn = db.lock().unwrap();
            let result =
                forzabot_database::discord_link::complete(&mut conn, code, "p", 1).unwrap();
            assert_eq!(result, forzabot_database::discord_link::Completion::Linked);
        }
        let (_, linked) = auth_request(
            db.clone(),
            "GET",
            "/api/auth/discord-link",
            Some("secret"),
            json!({}),
        )
        .await;
        assert_eq!(linked["discord_user_id"], "p");
        let (_, next) = auth_request(
            db.clone(),
            "POST",
            "/api/auth/discord-link/start",
            Some("secret"),
            json!({}),
        )
        .await;
        let next_code = next["code"].as_str().unwrap();
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/auth/unlink-discord",
                Some("secret"),
                json!({})
            )
            .await
            .0,
            StatusCode::OK
        );
        let result =
            forzabot_database::discord_link::complete(&mut db.lock().unwrap(), next_code, "p", 1)
                .unwrap();
        assert_eq!(
            result,
            forzabot_database::discord_link::Completion::InvalidOrExpired
        );
    }

    #[tokio::test]
    async fn bet_placement_is_atomic_and_rejects_locked_rounds() {
        let db = fixture();
        db.lock()
            .unwrap()
            .execute_batch(
                "UPDATE rounds SET status='pending' WHERE id='active'; DELETE FROM bets;",
            )
            .unwrap();
        let bet = |points| json!({"roundId":"active","predictedPlayerId":"p","points":points});
        assert_eq!(
            auth_request(db.clone(), "POST", "/api/bets/place", None, bet(20))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, first) = auth_request(
            db.clone(),
            "POST",
            "/api/bets/place",
            Some("secret"),
            bet(20),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["user"]["points"], 100);
        let (_, second) = auth_request(
            db.clone(),
            "POST",
            "/api/bets/place",
            Some("secret"),
            bet(30),
        )
        .await;
        assert_eq!(second["user"]["points"], 90);
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/bets/place",
                Some("secret"),
                bet(121)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        {
            let conn = db.lock().unwrap();
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM web_user_points_log WHERE user_id='u'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                3
            );
            conn.execute_batch("UPDATE rounds SET status='active' WHERE id='active'; UPDATE bets SET status='locked' WHERE round_id='active';").unwrap();
        }
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/bets/place",
                Some("secret"),
                bet(10)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        let conn = db.lock().unwrap();
        assert_eq!(
            conn.query_row("SELECT points FROM web_users WHERE id='u'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            90
        );
        assert_eq!(
            conn.query_row("SELECT status FROM bets WHERE user_id='u'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "locked"
        );
    }

    #[tokio::test]
    async fn car_image_confirmation_rejects_unsafe_input_and_clear_is_scoped() {
        let db = fixture();
        for (method, body) in [
            (
                "POST",
                json!({"carName":"F40","imageUrl":"file:///etc/passwd"}),
            ),
            (
                "POST",
                json!({"carName":"F40","imageUrl":"http://127.0.0.1/private"}),
            ),
            (
                "POST",
                json!({"carName":"","imageUrl":"https://example.com/car.jpg"}),
            ),
            ("POST", json!({"carName":"  "})),
        ] {
            let (status, response) =
                auth_request(db.clone(), method, "/api/car-image/confirm", None, body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        }
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO car_images VALUES ('F40','/car-images/f40.jpg',1)",
                [],
            )
            .unwrap();
        }
        let (status, _) = auth_request(
            db.clone(),
            "POST",
            "/api/car-image/confirm/delete",
            None,
            json!({"carName":"f40"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            db.lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM car_images", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn stored_car_image_route_serves_only_safe_files() {
        let dir = std::env::temp_dir().join(format!("forzabot-media-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("f40.jpg"), [0xff, 0xd8, 0xff, 0xd9]).unwrap();
        std::env::set_var("CAR_IMAGES_PATH", &dir);
        let response = router(fixture())
            .oneshot(
                Request::builder()
                    .uri("/car-images/f40.jpg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(
            to_bytes(response.into_body(), 100).await.unwrap().as_ref(),
            [0xff, 0xd8, 0xff, 0xd9]
        );
        let response = router(fixture())
            .oneshot(
                Request::builder()
                    .uri("/car-images/..%2Fsecret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        std::env::remove_var("CAR_IMAGES_PATH");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn candr_tile_requires_linked_robber_and_valid_tile() {
        let db = fixture();
        {
            let conn = db.lock().unwrap();
            conn.execute_batch("UPDATE rounds SET race_type='candr',status='active' WHERE id='active';
              INSERT INTO candr_state(round_id,robber_player_id,started_at,next_tile_due_at) VALUES ('active','p',0,0);
              INSERT INTO candr_player_roles VALUES ('active','p','robber',0),('active','q','cop',0);
              INSERT INTO auth_sessions VALUES ('secret2','u',1,9223372036854775807);").unwrap();
        }
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/candr/tile",
                None,
                json!({"roundId":"active","tile":"A1"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/candr/tile",
                Some("secret2"),
                json!({"roundId":"active","tile":"A1"})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO web_users_discord VALUES ('u','bettor','p',1)",
                [],
            )
            .unwrap();
        }
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/candr/tile",
                Some("secret"),
                json!({"roundId":"active","tile":"Z99"})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        let (status, body) = auth_request(
            db.clone(),
            "POST",
            "/api/candr/tile",
            Some("secret"),
            json!({"roundId":"active","tile":"a1"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["candr"]["current_tile"], "A1");
        assert_eq!(body["candr"]["robber_player_id"], "p");
        assert_eq!(
            auth_request(
                db.clone(),
                "POST",
                "/api/candr/tile",
                Some("secret"),
                json!({"roundId":"missing","tile":"A1"})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn player_detail_and_current_bet_match_existing_shapes() {
        let db = fixture();
        db.lock().unwrap().execute_batch("UPDATE rounds SET status='pending' WHERE id='active'; DELETE FROM bets; INSERT INTO bets(round_id,user_id,predicted_player_id,points_wagered,status,created_at) VALUES ('active','u','p',10,'pending',1);").unwrap();
        let (status, player) = request(db.clone(), "/api/player/p", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(player["player"]["id"], "p");
        assert_eq!(player["games"].as_array().unwrap().len(), 1);
        assert_eq!(player["times"].as_array().unwrap().len(), 2);
        assert_eq!(player["stats"]["times_recorded"], 2);
        let (status, current) = auth_request(
            db.clone(),
            "GET",
            "/api/bets/current",
            Some("secret"),
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(current["bet"]["points_wagered"], 10);
        assert_eq!(current["user"]["id"], "u");
        assert_eq!(
            auth_request(db.clone(), "GET", "/api/bets/current", None, json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(db, "/api/player/missing", None).await.0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn admin_auth_updates_and_logs_atomically() {
        let db = fixture();
        let app = router_with_admin(db.clone(), Some("strong-admin-password".into()));
        async fn call(
            app: &Router,
            method: &str,
            path: &str,
            token: Option<&str>,
            body: Value,
        ) -> (StatusCode, Value) {
            let mut req = Request::builder()
                .method(method)
                .uri(path)
                .header(header::CONTENT_TYPE, "application/json");
            if let Some(token) = token {
                req = req.header(header::AUTHORIZATION, format!("Bearer {token}"));
            }
            let resp = app
                .clone()
                .oneshot(req.body(Body::from(body.to_string())).unwrap())
                .await
                .unwrap();
            let status = resp.status();
            (
                status,
                serde_json::from_slice(&to_bytes(resp.into_body(), 1024 * 1024).await.unwrap())
                    .unwrap(),
            )
        }
        assert_eq!(
            call(&app, "GET", "/api/admin/users", Some("secret"), json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/admin/login",
                None,
                json!({"password":"wrong"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, login) = call(
            &app,
            "POST",
            "/api/admin/login",
            None,
            json!({"password":"strong-admin-password"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let token = login["token"].as_str().unwrap();
        assert_eq!(
            call(&app, "GET", "/api/admin/verify", Some(token), json!({}))
                .await
                .0,
            StatusCode::OK
        );
        db.lock().unwrap().execute_batch("CREATE TRIGGER reject_admin_log BEFORE INSERT ON web_user_points_log BEGIN SELECT RAISE(ABORT, 'failure'); END;").unwrap();
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/admin/users/u/points",
                Some(token),
                json!({"points":777})
            )
            .await
            .0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            db.lock()
                .unwrap()
                .query_row("SELECT points FROM web_users WHERE id='u'", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            120
        );
        db.lock()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_admin_log")
            .unwrap();
        let (status, updated) = call(
            &app,
            "POST",
            "/api/admin/users/u/points",
            Some(token),
            json!({"points":777}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["user"]["points"], 777);
        let (_, logs) = call(&app, "GET", "/api/admin/points-log", Some(token), json!({})).await;
        assert_eq!(logs["logs"][0]["delta"], 657);
        assert!(!logs["logs"][0]["metadata"]
            .as_str()
            .unwrap()
            .contains(&token[..8]));
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/admin/users/u/points",
                Some(token),
                json!({"points":-1})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            call(&app, "POST", "/api/admin/logout", Some(token), json!({}))
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            call(&app, "GET", "/api/admin/users", Some(token), json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        let disabled = router(db);
        assert_eq!(
            call(
                &disabled,
                "POST",
                "/api/admin/login",
                None,
                json!({"password":"test"})
            )
            .await
            .0,
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
