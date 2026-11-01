//! One-time, short-lived web-to-Discord identity challenges.
use rusqlite::{params, Connection, OptionalExtension, Result, TransactionBehavior};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const CHALLENGE_TTL_MS: i64 = 10 * 60 * 1000;

/// A narrow, idempotent schema addition suitable for existing databases.
pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS discord_link_challenges (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES web_users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)")
}

fn hash(code: &str) -> Option<String> {
    let uuid = Uuid::parse_str(code.trim()).ok()?;
    if uuid.get_version_num() != 4 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(uuid.as_bytes())))
}

/// Caller generates the UUID using a cryptographically secure random generator.
/// Revokes any previous code belonging to this web user.
pub fn create(db: &mut Connection, user: &str, code: &str, now: i64) -> Result<()> {
    let code_hash = hash(code).ok_or(rusqlite::Error::InvalidParameterName(
        "invalid challenge".into(),
    ))?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(
        "DELETE FROM discord_link_challenges WHERE user_id=?1 OR expires_at<=?2",
        params![user, now],
    )?;
    tx.execute("INSERT INTO discord_link_challenges(code_hash,user_id,created_at,expires_at) VALUES (?1,?2,?3,?4)",params![code_hash,user,now,now.saturating_add(CHALLENGE_TTL_MS)])?;
    tx.commit()
}

#[derive(Debug, PartialEq, Eq)]
pub enum Completion {
    Linked,
    InvalidOrExpired,
    PlayerNotFound,
    DiscordAlreadyLinked,
    DisplayNameTaken,
}

/// Complete only with the Discord ID authenticated by the gateway interaction.
/// A transaction serializes conflict checks, link writes, and challenge consumption.
pub fn complete(db: &mut Connection, code: &str, discord_id: &str, now: i64) -> Result<Completion> {
    let Some(code_hash) = hash(code) else {
        return Ok(Completion::InvalidOrExpired);
    };
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let user: Option<String> = tx
        .query_row(
            "SELECT user_id FROM discord_link_challenges WHERE code_hash=?1 AND expires_at>?2",
            params![code_hash, now],
            |r| r.get(0),
        )
        .optional()?;
    let Some(user) = user else {
        return Ok(Completion::InvalidOrExpired);
    };
    let name: Option<String> = tx
        .query_row(
            "SELECT display_name FROM players WHERE id=?",
            [discord_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(name) = name else {
        return Ok(Completion::PlayerNotFound);
    };
    let other_link: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM web_users_discord WHERE discord_user_id=?1 AND web_user_id!=?2)",params![discord_id,user],|r|r.get(0))?;
    if other_link {
        return Ok(Completion::DiscordAlreadyLinked);
    }
    let other_name: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM web_users_discord WHERE discord_username=?1 AND web_user_id!=?2)",params![name,user],|r|r.get(0))?;
    if other_name {
        return Ok(Completion::DisplayNameTaken);
    }
    tx.execute("INSERT INTO web_users_discord(web_user_id,discord_username,discord_user_id,linked_at) VALUES (?1,?2,?3,?4) ON CONFLICT(web_user_id) DO UPDATE SET discord_username=excluded.discord_username,discord_user_id=excluded.discord_user_id,linked_at=excluded.linked_at",params![user,name,discord_id,now])?;
    tx.execute(
        "DELETE FROM discord_link_challenges WHERE user_id=?",
        [user],
    )?;
    tx.commit()?;
    Ok(Completion::Linked)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        crate::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO web_users VALUES ('u1','one','hash',100,0),('u2','two','hash',100,0); INSERT INTO players VALUES ('p','p','Driver',100,0),('q','q','Other',100,0);").unwrap();
        db
    }
    const FIRST: &str = "2b4b6815-bcc4-4f9e-84da-9f35d9b95e57";
    const SECOND: &str = "e186b8c7-ff34-4710-a70d-de0082c563b1";
    #[test]
    fn challenge_is_hashed_single_use_and_prevents_identity_theft() {
        let mut db = fixture();
        create(&mut db, "u1", FIRST, 1).unwrap();
        let stored: String = db
            .query_row("SELECT code_hash FROM discord_link_challenges", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_ne!(stored, FIRST);
        assert_eq!(
            complete(&mut db, FIRST, "p", 2).unwrap(),
            Completion::Linked
        );
        assert_eq!(
            complete(&mut db, FIRST, "q", 3).unwrap(),
            Completion::InvalidOrExpired
        );
        create(&mut db, "u2", SECOND, 4).unwrap();
        assert_eq!(
            complete(&mut db, SECOND, "p", 5).unwrap(),
            Completion::DiscordAlreadyLinked
        );
        assert_eq!(
            db.query_row(
                "SELECT web_user_id FROM web_users_discord WHERE discord_user_id='p'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "u1"
        );
        assert_eq!(
            complete(&mut db, SECOND, "q", 6).unwrap(),
            Completion::Linked
        );
    }
    #[test]
    fn expired_replaced_and_unknown_codes_cannot_link() {
        let mut db = fixture();
        create(&mut db, "u1", FIRST, 100).unwrap();
        create(&mut db, "u1", SECOND, 200).unwrap();
        assert_eq!(
            complete(&mut db, FIRST, "p", 201).unwrap(),
            Completion::InvalidOrExpired
        );
        assert_eq!(
            complete(&mut db, SECOND, "p", 200 + CHALLENGE_TTL_MS).unwrap(),
            Completion::InvalidOrExpired
        );
        assert_eq!(
            complete(&mut db, "not-a-code", "p", 201).unwrap(),
            Completion::InvalidOrExpired
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM web_users_discord", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
