//! Car-selection rules shared by Discord interaction handlers.
use rand::{seq::SliceRandom, Rng};
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::{collections::HashSet, error::Error, path::Path};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Car {
    pub name: String,
    pub value: u64,
    pub pi: String,
    pub year: Option<i64>,
    pub availability: String,
}

pub fn load_catalog(path: impl AsRef<Path>) -> std::result::Result<Vec<Car>, Box<dyn Error>> {
    let mut reader = csv::Reader::from_path(path)?;
    let headers = reader.headers()?.clone();
    let index = |name| headers.iter().position(|header| header == name);
    let vehicle = index("Vehicle").ok_or("missing Vehicle column")?;
    let value = index("Value").ok_or("missing Value column")?;
    let pi = index("PI");
    let availability = index("Availability");
    let mut cars = Vec::new();
    for row in reader.records() {
        let row = row?;
        let name = row.get(vehicle).unwrap_or("").trim();
        let price: String = row
            .get(value)
            .unwrap_or("")
            .chars()
            .filter(char::is_ascii_digit)
            .collect();
        let Ok(value) = price.parse() else { continue };
        if name.is_empty() {
            continue;
        }
        let year = name
            .get(name.len().saturating_sub(4)..)
            .and_then(|year| year.parse().ok());
        cars.push(Car {
            name: name.into(),
            value,
            pi: pi.and_then(|i| row.get(i)).unwrap_or("").trim().into(),
            year,
            availability: availability
                .and_then(|i| row.get(i))
                .unwrap_or("")
                .trim()
                .into(),
        });
    }
    Ok(cars)
}

#[derive(Debug, Clone)]
pub struct Round {
    pub id: String,
    pub value: u64,
    pub year: Option<i64>,
    pub brand: Option<String>,
    pub class: String,
    pub restrict_class: bool,
}

pub fn current_round(db: &Connection) -> Result<Option<Round>> {
    db.query_row("SELECT id,value,year,brand,class,restrict_class FROM rounds WHERE status IN ('pending','active') ORDER BY created_at DESC LIMIT 1", [], |row| Ok(Round { id: row.get(0)?, value: row.get(1)?, year: row.get(2)?, brand: row.get(3)?, class: row.get(4)?, restrict_class: row.get(5)? })).optional()
}

fn parse_pi(pi: &str) -> Option<(String, u32)> {
    let pi: String = pi
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_uppercase)
        .collect();
    if pi.len() < 4 || !pi.is_ascii() {
        return None;
    }
    let (class, digits) = pi.split_at(pi.len() - 3);
    if !matches!(class, "D" | "C" | "B" | "A" | "S1" | "S2" | "R" | "X")
        || !digits.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    Some((class.to_owned(), digits.parse().ok()?))
}

fn matches_round(car: &Car, round: &Round, max_value: u64, check_year: bool) -> bool {
    car.value > 0
        && car.value <= max_value
        && (!round.restrict_class
            || parse_pi(&car.pi).is_some_and(|(class, _)| class == round.class))
        && round
            .brand
            .as_deref()
            .is_none_or(|brand| forzabot_core::matches_brand_name(&car.name, brand))
        && (!check_year
            || round.year.is_none_or(|year| {
                car.year
                    .is_some_and(|car_year| (year - 10..=year + 10).contains(&car_year))
            }))
}

pub fn manual_candidates<'a>(cars: &'a [Car], query: &str, round: Option<&Round>) -> Vec<&'a Car> {
    let names = forzabot_core::search_cars(
        cars.iter().map(|car| (car.name.as_str(), car.value)),
        query,
        round.map(|r| r.value),
    );
    names
        .into_iter()
        .filter_map(|name| cars.iter().find(|car| car.name == name))
        .filter(|car| {
            round.is_none_or(|r| {
                (!r.restrict_class || parse_pi(&car.pi).is_some_and(|(class, _)| class == r.class))
                    && r.brand
                        .as_deref()
                        .is_none_or(|brand| forzabot_core::matches_brand_name(&car.name, brand))
            })
        })
        .collect()
}

pub fn selected_cars(db: &Connection, round: &str) -> Result<HashSet<String>> {
    let mut stmt = db.prepare("SELECT DISTINCT car_name FROM car_choices WHERE round_id = ?")?;
    let names = stmt.query_map([round], |row| row.get(0))?.collect();
    names
}

pub fn random_anchor(db: &Connection, round: &str) -> Result<Option<String>> {
    db.query_row("SELECT car_name FROM car_choices WHERE round_id = ? AND selection_method = 'random' ORDER BY chosen_at ASC LIMIT 1", [round], |r| r.get(0)).optional()
}

pub fn random_candidates<'a>(
    cars: &'a [Car],
    round: &Round,
    chosen: &HashSet<String>,
    anchor: Option<&str>,
) -> (Vec<&'a Car>, bool) {
    let cap = round.value.saturating_mul(8) / 10;
    let mut valid: Vec<_> = cars
        .iter()
        .filter(|car| matches_round(car, round, cap, true) && !chosen.contains(&car.name))
        .collect();
    let widened = valid.is_empty();
    if widened {
        valid = cars
            .iter()
            .filter(|car| matches_round(car, round, cap, false) && !chosen.contains(&car.name))
            .collect();
    }
    if let Some(anchor) = anchor.and_then(|name| cars.iter().find(|car| car.name == name)) {
        let anchor_pi = parse_pi(&anchor.pi);
        let filter = |tolerance: u64, mode: u8| -> Vec<&'a Car> {
            valid
                .iter()
                .copied()
                .filter(|car| {
                    if car.value.abs_diff(anchor.value) > tolerance {
                        return false;
                    }
                    if mode == 0 || anchor_pi.is_none() {
                        return true;
                    }
                    let Some((class, pi)) = parse_pi(&car.pi) else {
                        return false;
                    };
                    let (anchor_class, anchor_score) = anchor_pi.as_ref().unwrap();
                    if mode == 1 {
                        class == *anchor_class && pi.abs_diff(*anchor_score) <= 75
                    } else {
                        let order = ["D", "C", "B", "A", "S1", "S2", "R", "X"];
                        match (
                            order.iter().position(|x| *x == class),
                            order.iter().position(|x| *x == anchor_class),
                        ) {
                            (Some(a), Some(b)) => a.abs_diff(b) <= 1,
                            _ => class == *anchor_class,
                        }
                    }
                })
                .collect()
        };
        let balanced = if widened {
            filter(anchor.value.max(100_000), 0)
        } else {
            let strict = filter(((anchor.value as f64 * 0.45).round() as u64).max(25_000), 1);
            if strict.is_empty() {
                filter(((anchor.value as f64 * 0.75).round() as u64).max(50_000), 2)
            } else {
                strict
            }
        };
        if !balanced.is_empty() {
            valid = balanced;
        }
    }
    (valid, widened)
}

pub fn preset_candidates<'a>(
    cars: &'a [Car],
    round: &Round,
    chosen: &HashSet<String>,
    rng: &mut impl Rng,
) -> Vec<&'a Car> {
    let chosen: HashSet<_> = chosen.iter().map(|c| c.to_lowercase()).collect();
    let mut available: Vec<_> = cars
        .iter()
        .filter(|car| {
            matches_round(car, round, round.value, true)
                && !chosen.contains(&car.name.to_lowercase())
        })
        .collect();
    let mut result = Vec::new();
    for name in [
        "Nissan Silvia K's 1989",
        "Toyota Celica GT-Four ST205 1994",
        "GMC Jimmy 1970",
    ] {
        if let Some(index) = available
            .iter()
            .position(|car| car.name.eq_ignore_ascii_case(name))
        {
            result.push(available.remove(index));
        }
    }
    available.shuffle(rng);
    result.extend(
        available
            .into_iter()
            .take(8_usize.saturating_sub(result.len())),
    );
    result
}

pub fn save_choice(
    db: &mut Connection,
    round: &Round,
    player: &str,
    car: &Car,
    method: &str,
    now: i64,
) -> Result<bool> {
    let tx = db.transaction()?;
    let current: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM rounds WHERE id = ? AND status IN ('pending','active'))",
        [&round.id],
        |row| row.get(0),
    )?;
    if !current {
        tx.commit()?;
        return Ok(false);
    }
    tx.execute(
        "DELETE FROM car_choices WHERE round_id = ?1 AND player_id = ?2",
        params![round.id, player],
    )?;
    tx.execute("INSERT INTO car_choices (round_id,player_id,car_name,selection_method,chosen_at) VALUES (?1,?2,?3,?4,?5)", params![round.id, player, car.name, method, now])?;
    tx.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::StdRng, SeedableRng};
    fn car(name: &str, value: u64, pi: &str, year: i64) -> Car {
        Car {
            name: name.into(),
            value,
            pi: pi.into(),
            year: Some(year),
            availability: String::new(),
        }
    }
    fn round() -> Round {
        Round {
            id: "r".into(),
            value: 200_000,
            year: Some(2000),
            brand: Some("Ford".into()),
            class: "A".into(),
            restrict_class: true,
        }
    }
    #[test]
    fn constraints_balancing_and_fallback() {
        let cars = vec![
            car("Ford Alpha 2000", 100_000, "A700", 2000),
            car("Ford Beta 2002", 110_000, "A730", 2002),
            car("Ford Expensive 2000", 180_000, "A710", 2000),
            car("Ford WrongClass 2000", 100_000, "B700", 2000),
            car("Audi A 2000", 100_000, "A700", 2000),
            car("Ford Old 1970", 100_000, "A700", 1970),
        ];
        let selected = HashSet::from(["Ford Alpha 2000".to_owned()]);
        let (valid, widened) =
            random_candidates(&cars, &round(), &selected, Some("Ford Alpha 2000"));
        assert!(!widened);
        assert_eq!(
            valid.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["Ford Beta 2002"]
        );
        let chosen = HashSet::from(["Ford Alpha 2000".to_owned(), "Ford Beta 2002".to_owned()]);
        let (valid, widened) = random_candidates(&cars, &round(), &chosen, None);
        assert!(widened);
        assert_eq!(valid[0].name, "Ford Old 1970");
        assert_eq!(manual_candidates(&cars, "ford", Some(&round())).len(), 4);
        assert_eq!(
            preset_candidates(&cars, &round(), &selected, &mut StdRng::seed_from_u64(1)).len(),
            2
        );
    }
    #[test]
    fn choice_replaces_previous_and_rejects_finished_round() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch("INSERT INTO players VALUES ('p','p','p',100,0); INSERT INTO rounds(id,class,value,race_type,status,created_at) VALUES ('r','A',200000,'road','pending',1);").unwrap();
        let round = round();
        assert!(save_choice(
            &mut db,
            &round,
            "p",
            &car("Ford One", 10, "A700", 2000),
            "manual",
            1
        )
        .unwrap());
        assert!(save_choice(
            &mut db,
            &round,
            "p",
            &car("Ford Two", 20, "A700", 2000),
            "random",
            2
        )
        .unwrap());
        assert_eq!(
            db.query_row("SELECT car_name FROM car_choices", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Ford Two"
        );
        db.execute("UPDATE rounds SET status='finished' WHERE id='r'", [])
            .unwrap();
        assert!(!save_choice(
            &mut db,
            &round,
            "p",
            &car("Ford Three", 30, "A700", 2000),
            "manual",
            3
        )
        .unwrap());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM car_choices", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
