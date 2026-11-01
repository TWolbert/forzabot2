//! SQLite schema and migrations compatible with existing ForzaBot databases.
use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};
pub mod candr;
pub mod discord_link;

/// Initialize or upgrade an existing database atomically. Existing history is retained.
pub fn initialize(connection: &mut Connection) -> Result<()> {
    // Foreign key enforcement cannot be toggled inside a transaction. The old
    // application may contain rows created while enforcement was disabled.
    connection.pragma_update(None, "foreign_keys", false)?;
    let result = initialize_inner(connection);
    let enable_result = connection.pragma_update(None, "foreign_keys", true);
    result.and(enable_result)
}

fn initialize_inner(connection: &mut Connection) -> Result<()> {
    let tx = connection.transaction()?;
    tx.execute_batch(include_str!("schema.sql"))?;
    discord_link::initialize(&tx)?;
    for (table, name, definition) in [
        ("rounds", "status", "TEXT NOT NULL DEFAULT 'pending'"),
        ("rounds", "winner_id", "TEXT"),
        ("rounds", "restrict_class", "INTEGER NOT NULL DEFAULT 1"),
        ("rounds", "brand", "TEXT"),
        ("rounds", "candr_total_time_ms", "INTEGER"),
        ("rounds", "created_by", "TEXT"),
        (
            "car_choices",
            "selection_method",
            "TEXT NOT NULL DEFAULT 'manual'",
        ),
        ("times", "is_historic", "INTEGER NOT NULL DEFAULT 0"),
        ("players", "points", "INTEGER NOT NULL DEFAULT 100"),
    ] {
        if !has_column(&tx, table, name)? {
            tx.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {name} {definition}"
            ))?;
        }
    }
    tx.execute("UPDATE players SET points = 100 WHERE points IS NULL", [])?;
    if !has_bet_constraint(&tx)? {
        tx.execute_batch(
            "CREATE TABLE bets_migrated (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                round_id TEXT NOT NULL REFERENCES rounds(id),
                user_id TEXT NOT NULL REFERENCES web_users(id),
                predicted_player_id TEXT NOT NULL REFERENCES players(id),
                points_wagered INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                payout INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, settled_at INTEGER,
                UNIQUE (round_id, user_id, predicted_player_id)
             );
             INSERT INTO bets_migrated (id, round_id, user_id, predicted_player_id, points_wagered, status, payout, created_at, settled_at)
               SELECT id, round_id, user_id, predicted_player_id, points_wagered, status, payout, created_at, settled_at FROM bets;
             DROP TABLE bets;
             ALTER TABLE bets_migrated RENAME TO bets;"
        )?;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    for (id, name, description) in [
        (
            "fh6-shirakawa-circuit",
            "Shirakawa Circuit",
            "FH6 circuit race in Japan.",
        ),
        ("fh6-airfield-trail", "Airfield Trail", "FH6 trail race."),
        (
            "fh6-wind-farm-cross-country",
            "Wind Farm Cross Country",
            "FH6 cross-country race.",
        ),
        (
            "fh6-hokubu-time-attack",
            "Hokubu Time Attack",
            "FH6 time attack event.",
        ),
    ] {
        tx.execute("INSERT OR IGNORE INTO races (id, name, description, created_by, created_at) VALUES (?1, ?2, ?3, 'system', ?4)", params![id, name, description, now])?;
    }
    tx.commit()
}

fn has_column(connection: &Connection, table: &str, name: &str) -> Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement.query_map([], |row| row.get::<_, String>(1))?;
    for column in names {
        if column? == name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn has_bet_constraint(connection: &Connection) -> Result<bool> {
    let mut statement = connection.prepare("PRAGMA index_list(bets)")?;
    let indexes = statement.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, bool>(2)?))
    })?;
    for index in indexes {
        let (name, unique) = index?;
        if !unique {
            continue;
        }
        let escaped = name.replace('"', "\"\"");
        let mut columns = connection.prepare(&format!("PRAGMA index_info(\"{escaped}\")"))?;
        let names = columns
            .query_map([], |row| row.get::<_, String>(2))?
            .collect::<Result<Vec<_>>>()?;
        if names == ["round_id", "user_id", "predicted_player_id"] {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_database_initialization_is_idempotent() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&mut db).unwrap();
        initialize(&mut db).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM races", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert!(has_bet_constraint(&db).unwrap());
        assert!(db
            .pragma_query_value(None, "foreign_keys", |r| r.get::<_, bool>(0))
            .unwrap());
    }

    #[test]
    fn upgrades_old_bets_without_losing_data() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE bets (id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT NOT NULL, user_id TEXT NOT NULL, predicted_player_id TEXT NOT NULL, points_wagered INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE (round_id, user_id));
            INSERT INTO bets VALUES (7, 'r', 'u', 'p', 12, 'pending', 0, 123, NULL);").unwrap();
        initialize(&mut db).unwrap();
        assert!(has_bet_constraint(&db).unwrap());
        assert_eq!(
            db.query_row("SELECT points_wagered FROM bets WHERE id = 7", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            12
        );
        db.pragma_update(None, "foreign_keys", false).unwrap();
        db.execute("INSERT INTO bets (round_id,user_id,predicted_player_id,points_wagered,created_at) VALUES ('r','u','p2',10,123)", []).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM bets", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn preserves_existing_points_history() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE player_points_history (id INTEGER PRIMARY KEY, player_id TEXT, round_id TEXT, points_earned INTEGER, total_points INTEGER, created_at INTEGER); INSERT INTO player_points_history VALUES (1, 'p', 'r', 5, 105, 1000);").unwrap();
        initialize(&mut db).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM player_points_history", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
