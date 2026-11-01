use rusqlite::{params, Connection, Result};
use std::{error::Error, path::Path};

pub mod candr;
pub mod car_selection;
pub mod game;
pub mod races;
pub mod registration;
pub mod rounds;
pub mod stats;
pub mod times;

#[derive(Debug, PartialEq, Eq)]
pub enum AddRace {
    Added,
    Exists,
}

/// Insert atomically using the existing case-sensitive race name constraint.
pub fn race_add(
    db: &Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    creator: &str,
    now: i64,
) -> Result<AddRace> {
    let changed = db.execute("INSERT INTO races (id, name, description, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(name) DO NOTHING", params![id, name, description, creator, now])?;
    Ok(if changed == 0 {
        AddRace::Exists
    } else {
        AddRace::Added
    })
}

#[derive(Debug, PartialEq, Eq)]
pub struct Race {
    pub name: String,
    pub description: Option<String>,
    pub time_count: i64,
}

pub fn race_list(db: &Connection) -> Result<Vec<Race>> {
    let mut statement = db.prepare("SELECT r.name, r.description, COUNT(t.id) FROM races r LEFT JOIN times t ON r.id = t.race_id GROUP BY r.id, r.name, r.description ORDER BY r.created_at DESC")?;
    let races = statement
        .query_map([], |row| {
            Ok(Race {
                name: row.get(0)?,
                description: row.get(1)?,
                time_count: row.get(2)?,
            })
        })?
        .collect();
    races
}

pub fn load_cars(
    path: impl AsRef<Path>,
) -> std::result::Result<Vec<(String, u64)>, Box<dyn Error>> {
    let mut reader = csv::Reader::from_path(path)?;
    let headers = reader.headers()?.clone();
    let vehicle = headers
        .iter()
        .position(|s| s == "Vehicle")
        .ok_or("missing Vehicle column")?;
    let value = headers
        .iter()
        .position(|s| s == "Value")
        .ok_or("missing Value column")?;
    let mut cars = Vec::new();
    for record in reader.records() {
        let record = record?;
        let name = record.get(vehicle).unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let raw_value: String = record
            .get(value)
            .unwrap_or("")
            .chars()
            .filter(char::is_ascii_digit)
            .collect();
        if let Ok(value) = raw_value.parse() {
            cars.push((name.to_owned(), value));
        }
    }
    Ok(cars)
}

pub struct SearchResponse {
    pub title: String,
    pub description: String,
    pub footer: Option<String>,
}

pub fn search_response(cars: &[(String, u64)], query: &str) -> SearchResponse {
    let results = forzabot_core::search_cars(
        cars.iter().map(|(name, value)| (name.as_str(), *value)),
        query,
        None,
    );
    if results.is_empty() {
        return SearchResponse {
            title: "No cars found".into(),
            description: format!("No cars found for \"{query}\"."),
            footer: None,
        };
    }
    let mut lines = String::new();
    let mut count = 0;
    for car in &results {
        let line = format!("- {car}\n");
        // Discord.js measures UTF-16 code units.
        if lines.encode_utf16().count() + line.encode_utf16().count() > 1800 {
            break;
        }
        lines.push_str(&line);
        count += 1;
    }
    SearchResponse {
        title: format!("Search results for \"{query}\""),
        description: lines.trim_end().into(),
        footer: Some(format!("Showing {count} of {} results.", results.len())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn races_match_existing_creation_and_listing() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        assert_eq!(
            race_add(&db, "id1", "My Track", Some("Custom"), "123", i64::MAX).unwrap(),
            AddRace::Added
        );
        assert_eq!(
            race_add(&db, "id2", "My Track", None, "456", 0).unwrap(),
            AddRace::Exists
        );
        let races = race_list(&db).unwrap();
        assert_eq!(
            races[0],
            Race {
                name: "My Track".into(),
                description: Some("Custom".into()),
                time_count: 0
            }
        );
        assert_eq!(races.len(), 5);
    }

    #[test]
    fn car_search_text_and_footer_match() {
        let cars = vec![
            ("Ferrari F40 1987".into(), 100),
            ("Ferrari F50 1995".into(), 200),
        ];
        let found = search_response(&cars, "F40");
        assert_eq!(found.title, "Search results for \"F40\"");
        assert_eq!(found.description, "- Ferrari F40 1987");
        assert_eq!(found.footer.as_deref(), Some("Showing 1 of 1 results."));
        let missing = search_response(&cars, "none");
        assert_eq!(missing.title, "No cars found");
        assert_eq!(missing.description, "No cars found for \"none\".");
        assert_eq!(missing.footer, None);
    }
}
