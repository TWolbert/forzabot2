//! Authenticated bet placement with atomic balance and log updates.
use super::{auth, lock, query, str_arg, ApiError, ApiResult, Database};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetRequest {
    round_id: Option<String>,
    predicted_player_id: Option<String>,
    points: Option<i64>,
}

pub async fn current(State(db): State<Database>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let db = lock(&db)?;
    let user = auth::user(&db, &headers)?;
    let id = user["id"].as_str().unwrap_or_default();
    let round: Option<String> = db
        .query_row(
            "SELECT id FROM rounds WHERE status IN ('pending','active') AND winner_id IS NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let Some(round) = round else {
        return Ok(Json(json!({"bet":Value::Null,"user":user})));
    };
    let bet = query(
        &db,
        "SELECT id,round_id,predicted_player_id,points_wagered,status,payout FROM bets WHERE round_id=?1 AND user_id=?2 LIMIT 1",
        vec![super::str_arg(&round), super::str_arg(id)],
    )?
    .into_iter()
    .next()
    .unwrap_or(Value::Null);
    Ok(Json(json!({"bet":bet,"user":user})))
}

pub async fn place(
    State(db): State<Database>,
    headers: HeaderMap,
    Json(body): Json<BetRequest>,
) -> ApiResult<Json<Value>> {
    let round = body.round_id.unwrap_or_default().trim().to_owned();
    let player = body
        .predicted_player_id
        .unwrap_or_default()
        .trim()
        .to_owned();
    let points = body.points.unwrap_or(0);
    let mut db = lock(&db)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let user = auth::user(&tx, &headers)?;
    let user_id = user["id"].as_str().unwrap_or_default();
    if round.is_empty() || player.is_empty() || points <= 0 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid bet payload"));
    }
    // Bet locking happens when the game starts. Reject active rounds rather than
    // deleting locked bets or allowing a wager after play has started.
    let available: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM rounds WHERE id=?1 AND status='pending' AND winner_id IS NULL)",[&round],|r|r.get(0))?;
    if !available {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Round is not available for betting",
        ));
    }
    let present: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM round_players WHERE round_id=?1 AND player_id=?2)",
        params![round, player],
        |r| r.get(0),
    )?;
    if !present {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Selected player is not in this round",
        ));
    }
    let existing: Option<(i64,String,i64)> = tx.query_row("SELECT id,status,points_wagered FROM bets WHERE round_id=?1 AND user_id=?2 AND predicted_player_id=?3 LIMIT 1",params![round,user_id,player],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    if existing
        .as_ref()
        .is_some_and(|(_, status, _)| status != "pending")
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Round is not available for betting",
        ));
    }
    let before: i64 = tx.query_row("SELECT points FROM web_users WHERE id=?", [user_id], |r| {
        r.get(0)
    })?;
    let refund = existing.as_ref().map_or(0, |(_, _, wager)| *wager);
    let available = before
        .checked_add(refund)
        .ok_or(ApiError(StatusCode::BAD_REQUEST, "Invalid bet payload"))?;
    if points > available {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Not enough points"));
    }
    let now = auth::now_ms();
    if refund > 0 {
        tx.execute("INSERT INTO web_user_points_log(user_id,source,before_points,after_points,delta,metadata,created_at) VALUES (?1,'bet_refunded',?2,?3,?4,?5,?6)",params![user_id,before,available,refund,json!({"round_id":round,"previous_wager":refund}).to_string(),now])?;
    }
    let after = available - points;
    tx.execute(
        "UPDATE web_users SET points=?1 WHERE id=?2",
        params![after, user_id],
    )?;
    tx.execute("INSERT INTO web_user_points_log(user_id,source,before_points,after_points,delta,metadata,created_at) VALUES (?1,'bet_placed',?2,?3,?4,?5,?6)",params![user_id,available,after,-points,json!({"round_id":round,"predicted_player_id":player,"wager_amount":points}).to_string(),now])?;
    if let Some((id, _, _)) = existing {
        tx.execute("DELETE FROM bets WHERE id=?", [id])?;
    }
    tx.execute("INSERT INTO bets(round_id,user_id,predicted_player_id,points_wagered,status,payout,created_at,settled_at) VALUES (?1,?2,?3,?4,'pending',0,?5,NULL)",params![round,user_id,player,points,now])?;
    let bet = query(
        &tx,
        "SELECT id,round_id,predicted_player_id,points_wagered,status,payout FROM bets WHERE id=?",
        vec![tx.last_insert_rowid().into()],
    )?
    .into_iter()
    .next()
    .ok_or(ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to place bet",
    ))?;
    let user = query(
        &tx,
        "SELECT id,username,points FROM web_users WHERE id=?",
        vec![str_arg(user_id)],
    )?
    .into_iter()
    .next()
    .ok_or(ApiError(StatusCode::NOT_FOUND, "User not found"))?;
    tx.commit()?;
    Ok(Json(json!({"user":user,"bet":bet})))
}
