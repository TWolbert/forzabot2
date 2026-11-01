use rusqlite::{params, Connection, OptionalExtension, Result};

#[derive(Debug, Clone)]
pub struct Session {
    pub owner: String,
    pub race_id: String,
    pub race_name: String,
    pub milliseconds: u64,
    pub removal: bool,
    pub cars: Vec<String>,
    pub index: usize,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Action {
    Unauthorized,
    Previous,
    Next,
    Accept,
    Cancel,
    Unknown,
}

impl Session {
    pub fn apply(&mut self, user: &str, action: &str) -> Action {
        if user != self.owner {
            return Action::Unauthorized;
        }
        match action {
            "prev" => {
                self.index = self.index.saturating_sub(1);
                Action::Previous
            }
            "next" => {
                self.index = (self.index + 1).min(self.cars.len().saturating_sub(1));
                Action::Next
            }
            "accept" => Action::Accept,
            "cancel" => Action::Cancel,
            _ => Action::Unknown,
        }
    }
}

pub fn race_id(db: &Connection, name: &str) -> Result<Option<String>> {
    db.query_row("SELECT id FROM races WHERE name = ?", [name], |row| {
        row.get(0)
    })
    .optional()
}

pub fn race_suggestions(db: &Connection, query: &str) -> Result<Vec<String>> {
    let mut statement = db.prepare("SELECT name FROM races ORDER BY name ASC")?;
    let lower = query.to_lowercase();
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>>>()?;
    Ok(names
        .into_iter()
        .filter(|name| name.to_lowercase().contains(&lower))
        .take(25)
        .collect())
}

/// Store one current time while retaining prior entries as historic records.
pub fn register(db: &mut Connection, session: &Session, now: i64) -> Result<bool> {
    let tx = db.transaction()?;
    let changed = tx.execute("UPDATE times SET is_historic = 1 WHERE race_id = ?1 AND player_id = ?2 AND car_name = ?3 AND is_historic = 0", params![session.race_id, session.owner, session.cars[session.index]])?;
    tx.execute("INSERT INTO times (race_id,player_id,car_name,laptime,is_historic,created_at) VALUES (?1,?2,?3,?4,0,?5)", params![session.race_id, session.owner, session.cars[session.index], session.milliseconds as i64, now])?;
    tx.commit()?;
    Ok(changed > 0)
}

/// Delete the first matching entry, consistent with the original removal command.
pub fn remove(db: &mut Connection, session: &Session) -> Result<bool> {
    let tx = db.transaction()?;
    let id: Option<i64> = tx
        .query_row(
            "SELECT id FROM times WHERE race_id = ?1 AND player_id = ?2 AND car_name = ?3 LIMIT 1",
            params![session.race_id, session.owner, session.cars[session.index]],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(id) = id {
        tx.execute("DELETE FROM times WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(id.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        Session {
            owner: "p".into(),
            race_id: "fh6-airfield-trail".into(),
            race_name: "Airfield Trail".into(),
            milliseconds: 94860,
            removal: false,
            cars: vec!["F40".into(), "F50".into()],
            index: 0,
        }
    }

    #[test]
    fn navigation_is_bounded_and_restricted_to_owner() {
        let mut s = session();
        assert_eq!(s.apply("other", "next"), Action::Unauthorized);
        assert_eq!(s.index, 0);
        assert_eq!(s.apply("p", "prev"), Action::Previous);
        assert_eq!(s.index, 0);
        assert_eq!(s.apply("p", "next"), Action::Next);
        assert_eq!(s.apply("p", "next"), Action::Next);
        assert_eq!(s.index, 1);
        assert_eq!(s.apply("p", "accept"), Action::Accept);
    }

    #[test]
    fn registration_preserves_history_and_rolls_back_on_failure() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute("INSERT INTO players VALUES ('p','user','User',100,0)", [])
            .unwrap();
        let s = session();
        assert!(!register(&mut db, &s, 1).unwrap());
        assert!(register(&mut db, &s, 2).unwrap());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM times WHERE is_historic=1", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            1
        );
        db.execute_batch("CREATE TRIGGER reject_time BEFORE INSERT ON times BEGIN SELECT RAISE(ABORT, 'no'); END;").unwrap();
        assert!(register(&mut db, &s, 3).is_err());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM times WHERE is_historic=0", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            1
        );
        assert_eq!(
            race_id(&db, "Airfield Trail").unwrap().as_deref(),
            Some("fh6-airfield-trail")
        );
        assert_eq!(
            race_suggestions(&db, "AIRFIELD").unwrap(),
            ["Airfield Trail"]
        );
    }

    #[test]
    fn removal_only_deletes_the_selected_users_matching_time() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch(
            "INSERT INTO players VALUES ('p','user','User',100,0),('other','other','Other',100,0);
            INSERT INTO times (race_id,player_id,car_name,laptime,is_historic,created_at) VALUES
            ('fh6-airfield-trail','p','F40',1000,0,1),('fh6-airfield-trail','other','F40',2000,0,2),
            ('fh6-airfield-trail','p','F50',3000,0,3);",
        )
        .unwrap();
        let mut s = session();
        s.removal = true;
        assert!(remove(&mut db, &s).unwrap());
        assert!(!remove(&mut db, &s).unwrap());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM times", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM times WHERE player_id='other'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
}
