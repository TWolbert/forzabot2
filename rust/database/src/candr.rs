//! Cops and Robbers role, tile and timing rules.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

pub const GRACE_MS: i64 = 60_000;
pub const INTERVAL_MS: i64 = 120_000;

#[derive(Debug, PartialEq)]
pub enum Error {
    Database(rusqlite::Error),
    NoState,
    NotActive,
    NotRobber,
    NotCreator,
    InvalidTile,
    Wait(i64),
}
impl From<rusqlite::Error> for Error {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value)
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for Error {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub robber: String,
    pub current_tile: Option<String>,
    pub previous_tile: Option<String>,
    pub started_at: i64,
    pub next_due: Option<i64>,
    pub finished_at: Option<i64>,
}

pub fn load(db: &Connection, round: &str) -> std::result::Result<Option<State>, rusqlite::Error> {
    db.query_row("SELECT robber_player_id,current_tile,previous_tile,started_at,next_tile_due_at,finished_at FROM candr_state WHERE round_id=?", [round], |r| Ok(State { robber:r.get(0)?,current_tile:r.get(1)?,previous_tile:r.get(2)?,started_at:r.get(3)?,next_due:r.get(4)?,finished_at:r.get(5)? })).optional()
}

pub fn normalize_tile(tile: &str) -> Option<String> {
    let tile = tile.trim().to_ascii_uppercase();
    let bytes = tile.as_bytes();
    if !(2..=3).contains(&bytes.len())
        || !(b'A'..=b'G').contains(&bytes[0])
        || !bytes[1..].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    let column: u8 = tile[1..].parse().ok()?;
    if !(1..=13).contains(&column) {
        return None;
    }
    Some(format!("{}{column}", bytes[0] as char))
}

pub fn set_tile(
    db: &mut Connection,
    round: &str,
    actor: &str,
    tile: &str,
    now: i64,
) -> std::result::Result<State, Error> {
    let tile = normalize_tile(tile).ok_or(Error::InvalidTile)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let state = load(&tx, round)?.ok_or(Error::NoState)?;
    let active: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM rounds WHERE id=? AND status='active')",
        [round],
        |r| r.get(0),
    )?;
    if !active || state.finished_at.is_some() {
        return Err(Error::NotActive);
    }
    if state.robber != actor {
        return Err(Error::NotRobber);
    }
    let grace_end = state.started_at.saturating_add(GRACE_MS);
    if now < grace_end {
        return Err(Error::Wait(grace_end - now));
    }
    if state.current_tile.is_some() && now < state.next_due.unwrap_or(now) {
        return Err(Error::Wait(state.next_due.unwrap() - now));
    }
    tx.execute("UPDATE candr_state SET previous_tile=current_tile,current_tile=?1,last_tile_at=?2,next_tile_due_at=?3 WHERE round_id=?4", params![tile,now,now.saturating_add(INTERVAL_MS),round])?;
    let state = load(&tx, round)?.ok_or(Error::NoState)?;
    tx.commit()?;
    Ok(state)
}

pub fn finish(
    db: &mut Connection,
    round: &str,
    actor: &str,
    now: i64,
) -> std::result::Result<(i64, Option<String>), Error> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let state = load(&tx, round)?.ok_or(Error::NoState)?;
    let info: Option<(Option<String>, String)> = tx
        .query_row(
            "SELECT created_by,status FROM rounds WHERE id=?",
            [round],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (creator, status) = info.ok_or(Error::NoState)?;
    if creator.as_deref() != Some(actor) {
        return Err(Error::NotCreator);
    }
    if status != "active" || state.finished_at.is_some() {
        return Err(Error::NotActive);
    }
    let elapsed = now.saturating_sub(state.started_at).max(0);
    tx.execute(
        "UPDATE rounds SET status='finished',candr_total_time_ms=?1 WHERE id=?2",
        params![elapsed, round],
    )?;
    tx.execute(
        "UPDATE candr_state SET finished_at=?1,next_tile_due_at=NULL WHERE round_id=?2",
        params![now, round],
    )?;
    tx.commit()?;
    Ok((elapsed, state.current_tile))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assigns_roles_enforces_timing_and_finishes_once() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('a','a','Alice',100,0),('b','b','Bob',100,0); INSERT INTO rounds(id,class,value,race_type,status,created_at,created_by) VALUES ('r','A',100000,'candr','pending',1,'owner'); INSERT INTO round_players VALUES ('r','a'),('r','b');").unwrap();
        db.execute_batch("UPDATE rounds SET status='active' WHERE id='r';
            INSERT INTO candr_player_roles VALUES ('r','a','robber',1),('r','b','cop',1);
            INSERT INTO candr_state(round_id,robber_player_id,started_at,next_tile_due_at) VALUES ('r','a',1,1);").unwrap();
        let state = load(&db, "r").unwrap().unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM candr_player_roles WHERE role='robber'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM candr_player_roles WHERE role='cop'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert!(matches!(
            set_tile(&mut db, "r", "other", "A1", state.started_at),
            Err(Error::NotRobber)
        ));
        assert!(matches!(
            set_tile(&mut db, "r", &state.robber, "A1", state.started_at + 59_999),
            Err(Error::Wait(1))
        ));
        let updated = set_tile(
            &mut db,
            "r",
            &state.robber,
            "a01",
            state.started_at + 60_000,
        )
        .unwrap();
        assert_eq!(updated.current_tile.as_deref(), Some("A1"));
        assert!(matches!(
            set_tile(
                &mut db,
                "r",
                &state.robber,
                "G13",
                state.started_at + 179_999
            ),
            Err(Error::Wait(1))
        ));
        let updated = set_tile(
            &mut db,
            "r",
            &state.robber,
            "G13",
            state.started_at + 180_000,
        )
        .unwrap();
        assert_eq!(updated.previous_tile.as_deref(), Some("A1"));
        assert!(matches!(
            finish(&mut db, "r", "other", state.started_at + 200_000),
            Err(Error::NotCreator)
        ));
        assert_eq!(
            finish(&mut db, "r", "owner", state.started_at + 200_000).unwrap(),
            (200_000, Some("G13".into()))
        );
        assert!(matches!(
            finish(&mut db, "r", "owner", state.started_at + 200_001),
            Err(Error::NotActive)
        ));
        assert_eq!(
            db.query_row(
                "SELECT candr_total_time_ms FROM rounds WHERE id='r'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            200_000
        );
    }
    #[test]
    fn tile_validation_rejects_out_of_bounds() {
        for tile in ["H1", "A0", "A14", "A001", "A-1", "", "Å1"] {
            assert_eq!(normalize_tile(tile), None);
        }
        assert_eq!(normalize_tile(" g13 ").as_deref(), Some("G13"));
    }
}
