use chrono::{Local, TimeZone};
use rand::seq::SliceRandom;
use rusqlite::{params, Connection, Result};

#[derive(Debug, PartialEq, Eq)]
pub struct PastRace {
    pub class: String,
    pub race_type: String,
    pub winner: Option<String>,
    pub created_at: i64,
}

pub fn past_races(db: &Connection, limit: Option<i64>) -> Result<Vec<PastRace>> {
    // JavaScript's `limit || 10` treats zero as absent.
    let limit = limit.filter(|n| *n != 0).unwrap_or(10).clamp(1, 25);
    let mut statement = db.prepare("SELECT class, race_type, winner_id, created_at FROM rounds WHERE status = 'finished' ORDER BY created_at DESC LIMIT ?")?;
    let races = statement
        .query_map([limit], |row| {
            Ok(PastRace {
                class: row.get(0)?,
                race_type: row.get(1)?,
                winner: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect();
    races
}

pub fn format_past_races(races: &[PastRace]) -> String {
    races
        .iter()
        .enumerate()
        .map(|(i, race)| {
            let date = Local
                .timestamp_millis_opt(race.created_at)
                .single()
                .map(|d| d.format("%-m/%-d/%Y").to_string())
                .unwrap_or_else(|| "Invalid Date".into());
            let winner = race
                .winner
                .as_ref()
                .map(|id| format!("<@{id}>"))
                .unwrap_or_else(|| "No winner".into());
            format!(
                "**{}.** {} | {} | Winner: {} | {}",
                i + 1,
                race.class,
                race.race_type,
                winner,
                date
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Debug, PartialEq, Eq)]
pub struct ResetResult {
    pub class: String,
    pub race_type: String,
    pub winner: String,
}

/// Finish active rounds with a randomly chosen participant, as the old recovery command does.
/// The transaction ensures concurrent reset requests cannot finish the same rounds twice.
pub fn reset_rounds(db: &mut Connection) -> Result<Option<Vec<ResetResult>>> {
    let tx = db.transaction()?;
    let rounds = {
        let mut stmt =
            tx.prepare("SELECT id, class, race_type FROM rounds WHERE status = 'active'")?;
        let results = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;
        results
    };
    if rounds.is_empty() {
        tx.commit()?;
        return Ok(None);
    }
    let mut results = Vec::new();
    for (id, class, race_type) in rounds {
        let players = {
            let mut stmt = tx.prepare("SELECT p.id, p.display_name, p.username FROM players p JOIN round_players rp ON p.id = rp.player_id WHERE rp.round_id = ?")?;
            let results = stmt
                .query_map([&id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>>>()?;
            results
        };
        if let Some((player_id, display, username)) = players.choose(&mut rand::thread_rng()) {
            tx.execute(
                "UPDATE rounds SET status = 'finished', winner_id = ? WHERE id = ?",
                params![player_id, id],
            )?;
            results.push(ResetResult {
                class,
                race_type,
                winner: if display.is_empty() {
                    username.clone()
                } else {
                    display.clone()
                },
            });
        }
    }
    tx.commit()?;
    Ok(Some(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_only_finishes_active_rounds_with_players() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('p','user','Winner',100,0);
            INSERT INTO rounds (id,class,value,race_type,status,created_at) VALUES ('r','A',100,'road','active',1),('empty','B',100,'dirt','active',2),('pending','C',100,'road','pending',3);
            INSERT INTO round_players VALUES ('r','p');").unwrap();
        let result = reset_rounds(&mut db).unwrap().unwrap();
        assert_eq!(
            result,
            [ResetResult {
                class: "A".into(),
                race_type: "road".into(),
                winner: "Winner".into()
            }]
        );
        assert_eq!(
            db.query_row("SELECT winner_id FROM rounds WHERE id='r'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "p"
        );
        assert_eq!(
            db.query_row("SELECT status FROM rounds WHERE id='empty'", [], |r| r
                .get::<_, String>(
                0
            ))
            .unwrap(),
            "active"
        );
        let history = past_races(&db, Some(0)).unwrap();
        assert_eq!(history.len(), 1);
        assert!(format_past_races(&history).contains("Winner: <@p>"));
        assert!(reset_rounds(&mut db).unwrap().unwrap().is_empty());
    }

    #[test]
    fn past_races_limit_defaults_clamps_and_sorts() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        for n in 0..30 {
            db.execute("INSERT INTO rounds (id,class,value,race_type,status,created_at) VALUES (?1,'A',100,'road','finished',?2)", params![format!("r{n}"), n]).unwrap();
        }
        assert_eq!(past_races(&db, None).unwrap().len(), 10);
        assert_eq!(past_races(&db, Some(0)).unwrap().len(), 10);
        assert_eq!(past_races(&db, Some(-1)).unwrap().len(), 1);
        let races = past_races(&db, Some(100)).unwrap();
        assert_eq!(races.len(), 25);
        assert_eq!(races[0].created_at, 29);
    }
}
