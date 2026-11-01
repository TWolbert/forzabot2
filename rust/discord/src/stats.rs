//! Player statistics and win leaderboard queries for `/stats`.
use rusqlite::{Connection, OptionalExtension, Result};

#[derive(Debug, PartialEq, Eq)]
pub struct Leader {
    pub id: String,
    pub wins: i64,
}

pub fn leaderboard(db: &Connection) -> Result<Vec<Leader>> {
    let mut stmt = db.prepare("SELECT p.id,COUNT(*) AS wins FROM rounds r JOIN players p ON r.winner_id=p.id WHERE r.status='finished' GROUP BY p.id ORDER BY wins DESC LIMIT 10")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Leader {
                id: r.get(0)?,
                wins: r.get(1)?,
            })
        })?
        .collect();
    rows
}

#[derive(Debug, PartialEq, Eq)]
pub struct History {
    pub id: String,
    pub class: String,
    pub value: i64,
    pub race_type: String,
    pub year: Option<i64>,
    pub won: bool,
    pub created_at: i64,
    pub car: Option<String>,
}
#[derive(Debug, PartialEq, Eq)]
pub struct PlayerStats {
    pub games: i64,
    pub wins: i64,
    pub history: Vec<History>,
}

pub fn player(db: &Connection, id: &str) -> Result<Option<PlayerStats>> {
    let games: i64 = db.query_row(
        "SELECT COUNT(*) FROM round_players WHERE player_id=?",
        [id],
        |r| r.get(0),
    )?;
    if games == 0 {
        return Ok(None);
    }
    let wins: i64 = db.query_row(
        "SELECT COUNT(*) FROM rounds WHERE winner_id=? AND status='finished'",
        [id],
        |r| r.get(0),
    )?;
    let mut stmt = db.prepare("SELECT r.id,r.class,r.value,r.race_type,r.year,r.winner_id,r.created_at,cc.car_name FROM rounds r JOIN round_players rp ON r.id=rp.round_id LEFT JOIN car_choices cc ON r.id=cc.round_id AND cc.player_id=?1 WHERE rp.player_id=?1 AND r.status='finished' ORDER BY r.created_at DESC")?;
    let history = stmt
        .query_map([id], |r| {
            let winner: Option<String> = r.get(5)?;
            Ok(History {
                id: r.get(0)?,
                class: r.get(1)?,
                value: r.get(2)?,
                race_type: r.get(3)?,
                year: r.get(4)?,
                won: winner.as_deref() == Some(id),
                created_at: r.get(6)?,
                car: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(PlayerStats {
        games,
        wins,
        history,
    }))
}

pub fn game(db: &Connection, id: &str) -> Result<Option<PlayerStats>> {
    player(db, id)
}

pub fn display_name(db: &Connection, id: &str) -> Result<Option<String>> {
    db.query_row(
        "SELECT COALESCE(NULLIF(display_name,''),username) FROM players WHERE id=?",
        [id],
        |r| r.get(0),
    )
    .optional()
}

pub fn win_rate(stats: &PlayerStats) -> String {
    format!(
        "{:.1}",
        if stats.games == 0 {
            0.0
        } else {
            stats.wins as f64 / stats.games as f64 * 100.0
        }
    )
}

pub fn ordinal(n: usize) -> &'static str {
    match n {
        1 => "st",
        2 => "nd",
        3 => "rd",
        _ => "th",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leaderboard_player_history_and_missing_player() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('a','a','Alice',100,0),('b','b','Bob',100,0),('c','c','Carol',100,0);
          INSERT INTO rounds(id,class,value,race_type,status,created_at,winner_id) VALUES ('r1','A',100000,'road','finished',10,'a'),('r2','B',200000,'dirt','finished',20,'a'),('pending','C',1,'road','pending',30,NULL);
          INSERT INTO round_players VALUES ('r1','a'),('r1','b'),('r2','a'),('r2','c'),('pending','a');
          INSERT INTO car_choices(round_id,player_id,car_name,chosen_at) VALUES ('r1','a','F40',1);").unwrap();
        assert_eq!(
            leaderboard(&db).unwrap()[0],
            Leader {
                id: "a".into(),
                wins: 2
            }
        );
        let stats = player(&db, "a").unwrap().unwrap();
        assert_eq!(
            (stats.games, stats.wins, win_rate(&stats)),
            (3, 2, "66.7".into())
        );
        assert_eq!(stats.history.len(), 2);
        assert!(stats.history[0].won);
        assert_eq!(stats.history[1].car.as_deref(), Some("F40"));
        assert!(player(&db, "missing").unwrap().is_none());
        assert_eq!(display_name(&db, "a").unwrap().as_deref(), Some("Alice"));
        assert_eq!(
            [ordinal(1), ordinal(2), ordinal(3), ordinal(4)],
            ["st", "nd", "rd", "th"]
        );
    }
}
