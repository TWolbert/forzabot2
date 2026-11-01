use rand::{seq::SliceRandom, Rng};
use rusqlite::{params, Connection, Result};
use std::collections::HashSet;

pub const CLASSES: [(&str, i64, i64, u32); 8] = [
    ("D", 50_000, 100_000, 0x3dbaea),
    ("C", 50_000, 200_000, 0xf6bf31),
    ("B", 50_000, 300_000, 0xff6533),
    ("A", 50_000, 400_000, 0xfc355a),
    ("S1", 100_000, 500_000, 0xbd5ee4),
    ("S2", 250_000, 500_000, 0x1567d6),
    ("R", 400_000, 500_000, 0x14b8a6),
    ("X", 450_000, 500_000, 0x111827),
];
pub const RACE_TYPES: [(&str, &str); 10] = [
    ("Road Racing", "road"),
    ("Dirt Racing", "dirt"),
    ("Cross Country", "cross-country"),
    ("Street Racing", "street"),
    ("Touge Battle", "touge"),
    ("Time Attack", "time-attack"),
    ("Goliath", "goliath"),
    ("Drag", "drag"),
    ("Cops And Robbers", "candr"),
    ("All", "all"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Player {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar: String,
}

#[derive(Debug)]
pub struct Round {
    pub id: String,
    pub class: String,
    pub color: u32,
    pub value: i64,
    pub race_type: String,
    pub brand: Option<String>,
    pub year: Option<i64>,
    pub restrict_class: bool,
    pub creator: String,
    pub created_at: i64,
    pub players: Vec<Player>,
}

pub struct RoundRequest<'a> {
    pub id: String,
    pub race_type: Option<&'a str>,
    pub brand: Option<&'a str>,
    pub year: Option<i64>,
    pub restrict_class: bool,
    pub creator: String,
    pub created_at: i64,
    pub players: Vec<Player>,
}

pub fn format_currency(value: i64) -> String {
    let raw = value.to_string();
    let mut output = String::new();
    for (index, c) in raw.chars().enumerate() {
        if index > 0 && (raw.len() - index) % 3 == 0 {
            output.push(',');
        }
        output.push(c);
    }
    format!("{output} CR")
}

pub fn prepare_round(
    request: RoundRequest<'_>,
    cars: &[(String, u64)],
    rng: &mut impl Rng,
) -> std::result::Result<Round, String> {
    let &(class, class_min, class_max, color) = CLASSES.choose(rng).unwrap();
    let race_type = request
        .race_type
        .unwrap_or_else(|| RACE_TYPES.choose(rng).unwrap().1)
        .to_owned();
    let brand = request.brand.map(str::trim).map(str::to_owned);
    let (mut min, mut max) = if request.restrict_class {
        (class_min, class_max)
    } else {
        (50_000, 500_000)
    };
    if let Some(brand) = brand.as_deref().filter(|s| !s.is_empty()) {
        let matches: Vec<_> = cars
            .iter()
            .filter(|(name, _)| forzabot_core::matches_brand_name(name, brand))
            .collect();
        if matches.is_empty() {
            return Err(format!("No cars found for brand \"{brand}\"."));
        }
        let prices: Vec<i64> = matches
            .iter()
            .filter_map(|(_, value)| i64::try_from(*value).ok())
            .filter(|v| *v > 0)
            .collect();
        if prices.is_empty() {
            return Err(format!("No priced cars found for brand \"{brand}\"."));
        }
        min = min.max(prices.iter().min().unwrap().saturating_add(50_000));
        max = max.min(*prices.iter().max().unwrap());
        if min > max {
            return Err(format!(
                "No cars found for brand \"{brand}\" within the 50,000 CR–500,000 CR round budget."
            ));
        }
    }
    let value = min + rng.gen_range(0..=((max - min) / 25_000)) * 25_000;
    let mut ids = HashSet::new();
    let players = request
        .players
        .into_iter()
        .filter(|p| ids.insert(p.id.clone()))
        .collect();
    Ok(Round {
        id: request.id,
        class: class.into(),
        color,
        value,
        race_type,
        brand,
        year: request.year,
        restrict_class: request.restrict_class,
        creator: request.creator,
        created_at: request.created_at,
        players,
    })
}

pub fn save_round(db: &mut Connection, round: &Round) -> Result<()> {
    let tx = db.transaction()?;
    tx.execute("INSERT INTO rounds (id,class,value,race_type,brand,year,status,restrict_class,created_at,created_by) VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9)", params![round.id, round.class, round.value, round.race_type, round.brand, round.year, round.restrict_class, round.created_at, round.creator])?;
    for player in &round.players {
        tx.execute("INSERT OR IGNORE INTO players (id,username,display_name,created_at) VALUES (?1,?2,?3,?4)", params![player.id, player.username, player.display_name, round.created_at])?;
        tx.execute(
            "INSERT OR IGNORE INTO round_players (round_id,player_id) VALUES (?1,?2)",
            params![round.id, player.id],
        )?;
        tx.execute("INSERT INTO discord_avatars (player_id,avatar_url,cached_at) VALUES (?1,?2,?3) ON CONFLICT(player_id) DO UPDATE SET avatar_url=excluded.avatar_url,cached_at=excluded.cached_at", params![player.id, player.avatar, round.created_at])?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::StdRng, SeedableRng};

    fn request() -> RoundRequest<'static> {
        RoundRequest {
            id: "round".into(),
            race_type: Some("road"),
            brand: Some(" Ferrari "),
            year: Some(1990),
            restrict_class: false,
            creator: "creator".into(),
            created_at: 123,
            players: vec![
                Player {
                    id: "1".into(),
                    username: "user".into(),
                    display_name: "Display".into(),
                    avatar: "url".into()
                };
                2
            ],
        }
    }

    #[test]
    fn creates_brand_restricted_round_and_deduplicates_players() {
        let mut rng = StdRng::seed_from_u64(1);
        let cars = vec![
            ("Ferrari F40 1987".into(), 100_000),
            ("Ferrari F50 1995".into(), 220_000),
        ];
        let round = prepare_round(request(), &cars, &mut rng).unwrap();
        assert_eq!(round.brand.as_deref(), Some("Ferrari"));
        assert!((150_000..=220_000).contains(&round.value));
        assert_eq!((round.value - 150_000) % 25_000, 0);
        assert_eq!(round.players.len(), 1);
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        save_round(&mut db, &round).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM round_players", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT avatar_url FROM discord_avatars WHERE player_id='1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "url"
        );
        assert_eq!(
            db.query_row("SELECT status FROM rounds WHERE id='round'", [], |r| r
                .get::<_, String>(
                0
            ))
            .unwrap(),
            "pending"
        );
    }

    #[test]
    fn rejects_missing_unpriced_and_unaffordable_brand() {
        let mut rng = StdRng::seed_from_u64(2);
        assert_eq!(
            prepare_round(request(), &[], &mut rng).unwrap_err(),
            "No cars found for brand \"Ferrari\"."
        );
        assert_eq!(
            prepare_round(request(), &[("Ferrari F40".into(), 0)], &mut rng).unwrap_err(),
            "No priced cars found for brand \"Ferrari\"."
        );
        assert!(
            prepare_round(request(), &[("Ferrari F40".into(), 600_000)], &mut rng)
                .unwrap_err()
                .contains("within the 50,000 CR–500,000 CR")
        );
    }

    #[test]
    fn failed_save_rolls_back_round() {
        let mut rng = StdRng::seed_from_u64(3);
        let round = prepare_round(
            request(),
            &[("Ferrari A".into(), 100_000), ("Ferrari B".into(), 200_000)],
            &mut rng,
        )
        .unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("CREATE TRIGGER reject_player BEFORE INSERT ON players BEGIN SELECT RAISE(ABORT, 'no'); END;").unwrap();
        assert!(save_round(&mut db, &round).is_err());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM rounds", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn class_restrictions_produce_correct_budget_ranges() {
        let mut rng = StdRng::seed_from_u64(9);
        for _ in 0..100 {
            let mut input = request();
            input.brand = None;
            input.restrict_class = true;
            let round = prepare_round(input, &[], &mut rng).unwrap();
            let (_, min, max, _) = CLASSES
                .iter()
                .find(|(class, _, _, _)| *class == round.class)
                .unwrap();
            assert!(((*min)..=(*max)).contains(&round.value));
            assert_eq!((round.value - min) % 25_000, 0);
        }
    }
}
