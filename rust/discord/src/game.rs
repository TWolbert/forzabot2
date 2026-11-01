//! Transactional round-start and scoring operations for Discord game workflows.
use rand::seq::SliceRandom;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashSet;

pub const SERIES_RACES: [&str; 4] = ["drag", "road", "dirt", "cross-country"];

#[derive(Debug, PartialEq)]
pub enum GameError {
    Database(rusqlite::Error),
    NoPendingRound,
    NoPlayers,
    NotActive,
    NotCreator,
    InvalidPlayer,
    InvalidPlacements,
    InvalidRace,
    IncompleteSeries,
    PointsOverflow,
}
impl From<rusqlite::Error> for GameError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value)
    }
}
impl std::fmt::Display for GameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for GameError {}
type Result<T> = std::result::Result<T, GameError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Player {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub car: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Game {
    pub id: String,
    pub class: String,
    pub value: i64,
    pub race_type: String,
    pub year: Option<i64>,
    pub creator: Option<String>,
    pub restrict_class: bool,
    pub players: Vec<Player>,
}

/// Atomically start the latest pending round, lock bets, and initialize mode state.
pub fn start(db: &mut Connection) -> Result<Game> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let round = tx.query_row("SELECT id,class,value,race_type,year,created_by,restrict_class FROM rounds WHERE status='pending' ORDER BY created_at DESC LIMIT 1", [], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, i64>(2)?,r.get::<_, String>(3)?,r.get::<_, Option<i64>>(4)?,r.get::<_, Option<String>>(5)?,r.get::<_, bool>(6)?))).optional()?.ok_or(GameError::NoPendingRound)?;
    let players = {
        let mut stmt = tx.prepare("SELECT p.id,p.username,p.display_name,(SELECT cc.car_name FROM car_choices cc WHERE cc.round_id=rp.round_id AND cc.player_id=p.id ORDER BY cc.id DESC LIMIT 1) FROM players p JOIN round_players rp ON p.id=rp.player_id WHERE rp.round_id=?")?;
        let rows = stmt
            .query_map([&round.0], |r| {
                Ok(Player {
                    id: r.get(0)?,
                    username: r.get(1)?,
                    display_name: r.get(2)?,
                    car: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    if players.is_empty() {
        return Err(GameError::NoPlayers);
    }
    tx.execute(
        "UPDATE rounds SET status='active' WHERE id=? AND status='pending'",
        [&round.0],
    )?;
    tx.execute(
        "UPDATE bets SET status='locked' WHERE round_id=? AND status='pending'",
        [&round.0],
    )?;
    if round.3.eq_ignore_ascii_case("all") {
        for player in &players {
            tx.execute(
                "INSERT OR IGNORE INTO round_scores (round_id,player_id,points) VALUES (?1,?2,0)",
                params![round.0, player.id],
            )?;
        }
    }
    if round.3.eq_ignore_ascii_case("candr") {
        let robber = players
            .choose(&mut rand::thread_rng())
            .expect("players are nonempty");
        let now = now_ms();
        tx.execute(
            "DELETE FROM candr_player_roles WHERE round_id=?",
            [&round.0],
        )?;
        tx.execute("DELETE FROM candr_state WHERE round_id=?", [&round.0])?;
        for player in &players {
            tx.execute("INSERT INTO candr_player_roles(round_id,player_id,role,assigned_at) VALUES (?1,?2,?3,?4)", params![round.0,player.id,if player.id == robber.id {"robber"} else {"cop"},now])?;
        }
        tx.execute("INSERT INTO candr_state(round_id,robber_player_id,started_at,next_tile_due_at) VALUES (?1,?2,?3,?3)", params![round.0,robber.id,now])?;
    }
    tx.commit()?;
    Ok(Game {
        id: round.0,
        class: round.1,
        value: round.2,
        race_type: round.3,
        year: round.4,
        creator: round.5,
        restrict_class: round.6,
        players,
    })
}

fn authorize(db: &Connection, game: &Game, actor: &str) -> Result<()> {
    if game.creator.as_deref() != Some(actor) {
        return Err(GameError::NotCreator);
    }
    let active: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM rounds WHERE id=? AND status='active')",
        [&game.id],
        |r| r.get(0),
    )?;
    if !active {
        return Err(GameError::NotActive);
    }
    Ok(())
}

/// Finish a single race, setting the winner's score and leaving other scores at zero.
pub fn finish_single(db: &mut Connection, game: &Game, actor: &str, winner: &str) -> Result<()> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    authorize(&tx, game, actor)?;
    if game.race_type.eq_ignore_ascii_case("all") || game.race_type.eq_ignore_ascii_case("candr") {
        return Err(GameError::InvalidRace);
    }
    if !game.players.iter().any(|p| p.id == winner) {
        return Err(GameError::InvalidPlayer);
    }
    for player in &game.players {
        tx.execute("INSERT INTO round_scores (round_id,player_id,points) VALUES (?1,?2,?3) ON CONFLICT(round_id,player_id) DO UPDATE SET points=excluded.points", params![game.id,player.id, i64::from(player.id == winner)])?;
    }
    tx.execute(
        "UPDATE rounds SET status='finished',winner_id=?1 WHERE id=?2",
        params![winner, game.id],
    )?;
    settle(&tx, game, winner, None, now_ms())?;
    tx.commit()?;
    Ok(())
}

/// Persist or replace a series result and recompute scores from the race results.
pub fn record_race(
    db: &mut Connection,
    game: &Game,
    actor: &str,
    race_index: usize,
    placements: &[String],
    now: i64,
) -> Result<()> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    authorize(&tx, game, actor)?;
    if !game.race_type.eq_ignore_ascii_case("all") || race_index >= SERIES_RACES.len() {
        return Err(GameError::InvalidRace);
    }
    let expected: HashSet<&str> = game.players.iter().map(|p| p.id.as_str()).collect();
    let actual: HashSet<&str> = placements.iter().map(String::as_str).collect();
    if placements.len() != game.players.len() || expected != actual {
        return Err(GameError::InvalidPlacements);
    }
    // Earlier races must be complete; the latest race may be replaced for redo.
    for index in 0..race_index {
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM round_race_results WHERE round_id=?1 AND race_index=?2",
            params![game.id, index as i64],
            |r| r.get(0),
        )?;
        if count != game.players.len() as i64 {
            return Err(GameError::IncompleteSeries);
        }
    }
    let later: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM round_race_results WHERE round_id=?1 AND race_index>?2)",
        params![game.id, race_index as i64],
        |r| r.get(0),
    )?;
    if later {
        return Err(GameError::InvalidRace);
    }
    tx.execute(
        "DELETE FROM round_race_results WHERE round_id=?1 AND race_index=?2",
        params![game.id, race_index as i64],
    )?;
    for (index, player) in placements.iter().enumerate() {
        let points = (placements.len() - index).max(1) as i64;
        tx.execute("INSERT INTO round_race_results (round_id,race_index,race_type,player_id,position,points,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![game.id,race_index as i64,SERIES_RACES[race_index],player,(index+1) as i64,points,now])?;
    }
    for player in &game.players {
        tx.execute("INSERT INTO round_scores (round_id,player_id,points) VALUES (?1,?2,(SELECT COALESCE(SUM(points),0) FROM round_race_results WHERE round_id=?1 AND player_id=?2)) ON CONFLICT(round_id,player_id) DO UPDATE SET points=excluded.points", params![game.id,player.id])?;
    }
    tx.commit()?;
    Ok(())
}

/// Finish a complete series; ties are resolved by last-race finishing position.
pub fn finish_series(db: &mut Connection, game: &Game, actor: &str) -> Result<String> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    authorize(&tx, game, actor)?;
    if !game.race_type.eq_ignore_ascii_case("all") {
        return Err(GameError::InvalidRace);
    }
    for index in 0..SERIES_RACES.len() {
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM round_race_results WHERE round_id=?1 AND race_index=?2",
            params![game.id, index as i64],
            |r| r.get(0),
        )?;
        if count != game.players.len() as i64 {
            return Err(GameError::IncompleteSeries);
        }
    }
    let winner: String = tx.query_row("SELECT s.player_id FROM round_scores s JOIN round_race_results rr ON rr.round_id=s.round_id AND rr.player_id=s.player_id AND rr.race_index=?2 WHERE s.round_id=?1 ORDER BY s.points DESC,rr.position ASC LIMIT 1", params![game.id,(SERIES_RACES.len()-1) as i64], |r| r.get(0))?;
    tx.execute(
        "UPDATE rounds SET status='finished',winner_id=?1 WHERE id=?2",
        params![winner, game.id],
    )?;
    let second: Option<String> = tx.query_row("SELECT s.player_id FROM round_scores s JOIN round_race_results rr ON rr.round_id=s.round_id AND rr.player_id=s.player_id AND rr.race_index=?2 WHERE s.round_id=?1 ORDER BY s.points DESC,rr.position ASC LIMIT 1 OFFSET 1", params![game.id,(SERIES_RACES.len()-1) as i64], |r| r.get(0)).optional()?;
    settle(&tx, game, &winner, second.as_deref(), now_ms())?;
    tx.commit()?;
    Ok(winner)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn award(
    db: &Connection,
    user: &str,
    amount: i64,
    source: &str,
    metadata: serde_json::Value,
    now: i64,
) -> Result<()> {
    let before: i64 = db.query_row("SELECT points FROM web_users WHERE id=?", [user], |r| {
        r.get(0)
    })?;
    let after = before
        .checked_add(amount)
        .ok_or(GameError::PointsOverflow)?;
    db.execute(
        "UPDATE web_users SET points=?1 WHERE id=?2",
        params![after, user],
    )?;
    db.execute("INSERT INTO web_user_points_log(user_id,source,before_points,after_points,delta,metadata,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![user,source,before,after,amount,metadata.to_string(),now])?;
    Ok(())
}

/// Called inside the same transaction that finishes the round. Failures roll back
/// scoring, winner, payouts, awards, and history together.
fn settle(
    db: &Connection,
    game: &Game,
    winner: &str,
    second: Option<&str>,
    now: i64,
) -> Result<()> {
    let bets = {
        let mut stmt = db.prepare("SELECT id,user_id,predicted_player_id,points_wagered FROM bets WHERE round_id=? AND status='locked'")?;
        let rows = stmt
            .query_map([&game.id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for (id, user, predicted, wager) in bets {
        let won = predicted == winner;
        let payout = if won {
            wager.checked_mul(2).ok_or(GameError::PointsOverflow)?
        } else {
            0
        };
        if payout > 0 {
            award(
                db,
                &user,
                payout,
                "bet_payout",
                serde_json::json!({"bet_id":id,"round_id":game.id,"wagered":wager}),
                now,
            )?;
        }
        db.execute(
            "UPDATE bets SET status=?1,payout=?2,settled_at=?3 WHERE id=?4 AND status='locked'",
            params![if won { "won" } else { "lost" }, payout, now, id],
        )?;
    }
    for (player, points, source) in [
        (Some(winner), 50, "race_placement_1st"),
        (second, 25, "race_placement_2nd"),
    ] {
        if let Some(player) = player {
            let user: Option<String> = db
                .query_row(
                    "SELECT web_user_id FROM web_users_discord WHERE discord_user_id=? LIMIT 1",
                    [player],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(user) = user {
                award(
                    db,
                    &user,
                    points,
                    source,
                    serde_json::json!({"round_id":game.id,"race_type":game.race_type,"discord_user_id":player}),
                    now,
                )?;
            }
        }
    }
    for player in &game.players {
        let earned: i64 = db.query_row("SELECT COALESCE((SELECT points FROM round_scores WHERE round_id=?1 AND player_id=?2),0)", params![game.id,player.id], |r| r.get(0))?;
        let total: i64 = db.query_row("SELECT COALESCE(SUM(rs.points),0) FROM round_scores rs JOIN rounds r ON r.id=rs.round_id WHERE rs.player_id=?1 AND r.created_at <= (SELECT created_at FROM rounds WHERE id=?2) AND r.status='finished'", params![player.id,game.id], |r| r.get(0))?;
        db.execute("INSERT INTO player_points_history(player_id,round_id,points_earned,total_points,created_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(player_id,round_id) DO UPDATE SET points_earned=excluded.points_earned,total_points=excluded.total_points,created_at=excluded.created_at", params![player.id,game.id,earned,total,now / 1000])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup(kind: &str) -> (Connection, Game) {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('a','a','Alice',100,0),('b','b','Bob',100,0); INSERT INTO rounds(id,class,value,race_type,status,created_at,created_by) VALUES ('r','A',100000,'road','pending',1,'owner'); INSERT INTO round_players VALUES ('r','a'),('r','b');").unwrap();
        db.execute("UPDATE rounds SET race_type=? WHERE id='r'", [kind])
            .unwrap();
        let game = start(&mut db).unwrap();
        (db, game)
    }
    #[test]
    fn starts_single_and_only_creator_can_finish() {
        let (mut db, game) = setup("road");
        assert!(matches!(
            finish_single(&mut db, &game, "other", "a"),
            Err(GameError::NotCreator)
        ));
        assert!(matches!(
            finish_single(&mut db, &game, "owner", "outsider"),
            Err(GameError::InvalidPlayer)
        ));
        finish_single(&mut db, &game, "owner", "a").unwrap();
        assert_eq!(
            db.query_row("SELECT winner_id FROM rounds WHERE id='r'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "a"
        );
        assert_eq!(
            db.query_row(
                "SELECT points FROM round_scores WHERE player_id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert!(matches!(
            finish_single(&mut db, &game, "owner", "b"),
            Err(GameError::NotActive)
        ));
    }
    #[test]
    fn series_redo_recalculates_scores_and_final_tie_uses_last_race() {
        let (mut db, game) = setup("all");
        let ab = vec!["a".into(), "b".into()];
        let ba = vec!["b".into(), "a".into()];
        assert!(matches!(
            record_race(&mut db, &game, "owner", 1, &ab, 1),
            Err(GameError::IncompleteSeries)
        ));
        assert!(matches!(
            record_race(&mut db, &game, "owner", 0, &["a".into(), "a".into()], 1),
            Err(GameError::InvalidPlacements)
        ));
        record_race(&mut db, &game, "owner", 0, &ab, 1).unwrap();
        record_race(&mut db, &game, "owner", 0, &ba, 2).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT points FROM round_scores WHERE player_id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        record_race(&mut db, &game, "owner", 1, &ab, 3).unwrap();
        record_race(&mut db, &game, "owner", 2, &ab, 4).unwrap();
        assert!(matches!(
            finish_series(&mut db, &game, "owner"),
            Err(GameError::IncompleteSeries)
        ));
        record_race(&mut db, &game, "owner", 3, &ba, 5).unwrap();
        assert_eq!(finish_series(&mut db, &game, "owner").unwrap(), "b");
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM round_race_results", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            8
        );
    }
    #[test]
    fn candr_requires_players_without_changing_round() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute("INSERT INTO rounds(id,class,value,race_type,status,created_at) VALUES ('r','A',100,'candr','pending',1)", []).unwrap();
        assert!(matches!(start(&mut db), Err(GameError::NoPlayers)));
        assert_eq!(
            db.query_row("SELECT status FROM rounds WHERE id='r'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "pending"
        );
    }

    #[test]
    fn start_locks_bets_only_after_validating_players() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('a','a','Alice',100,0); INSERT INTO web_users VALUES ('u','user','hash',100,0); INSERT INTO rounds(id,class,value,race_type,status,created_at,created_by) VALUES ('r','A',100000,'road','pending',1,'owner'); INSERT INTO bets(round_id,user_id,predicted_player_id,points_wagered,status,created_at) VALUES ('r','u','a',10,'pending',1);").unwrap();
        assert!(matches!(start(&mut db), Err(GameError::NoPlayers)));
        assert_eq!(
            db.query_row("SELECT status FROM bets", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "pending"
        );
        db.execute("INSERT INTO round_players VALUES ('r','a')", [])
            .unwrap();
        start(&mut db).unwrap();
        assert_eq!(
            db.query_row("SELECT status FROM bets", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "locked"
        );
    }

    #[test]
    fn settlement_awards_once_and_rolls_back_on_failure() {
        let (mut db, game) = setup("road");
        db.execute_batch("INSERT INTO web_users VALUES ('u1','one','hash',100,0),('u2','two','hash',100,0);
          INSERT INTO web_users_discord VALUES ('u1','alice','a',0);
          INSERT INTO bets(round_id,user_id,predicted_player_id,points_wagered,status,created_at) VALUES ('r','u1','a',10,'locked',0),('r','u2','b',10,'locked',0);
          CREATE TRIGGER reject_log BEFORE INSERT ON web_user_points_log BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
        assert!(finish_single(&mut db, &game, "owner", "a").is_err());
        assert_eq!(
            db.query_row("SELECT status FROM rounds WHERE id='r'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "active"
        );
        assert_eq!(
            db.query_row("SELECT points FROM web_users WHERE id='u1'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            100
        );
        db.execute_batch("DROP TRIGGER reject_log").unwrap();
        finish_single(&mut db, &game, "owner", "a").unwrap();
        assert_eq!(
            db.query_row("SELECT points FROM web_users WHERE id='u1'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            170
        );
        assert_eq!(
            db.query_row("SELECT status FROM bets WHERE user_id='u2'", [], |r| r
                .get::<_, String>(
                0
            ))
            .unwrap(),
            "lost"
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM player_points_history", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert!(matches!(
            finish_single(&mut db, &game, "owner", "a"),
            Err(GameError::NotActive)
        ));
        assert_eq!(
            db.query_row("SELECT points FROM web_users WHERE id='u1'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            170
        );
    }

    #[test]
    fn series_awards_both_linked_placements() {
        let (mut db, game) = setup("all");
        db.execute_batch("INSERT INTO web_users VALUES ('u1','one','hash',100,0),('u2','two','hash',100,0); INSERT INTO web_users_discord VALUES ('u1','alice','a',0),('u2','bob','b',0);").unwrap();
        let placements = vec!["a".into(), "b".into()];
        for index in 0..4 {
            record_race(&mut db, &game, "owner", index, &placements, index as i64).unwrap();
        }
        assert_eq!(finish_series(&mut db, &game, "owner").unwrap(), "a");
        assert_eq!(
            db.query_row("SELECT points FROM web_users WHERE id='u1'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            150
        );
        assert_eq!(
            db.query_row("SELECT points FROM web_users WHERE id='u2'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            125
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM web_user_points_log", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}
