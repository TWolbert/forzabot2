use rusqlite::{params_from_iter, types::Value, Connection, Result};

#[derive(Debug, PartialEq, Eq)]
pub struct EmbedResult {
    pub title: String,
    pub description: String,
    pub footer: Option<String>,
    pub color: u32,
    pub ephemeral: bool,
}

/// Implements the existing `/times` query and presentation.
pub fn best_times(
    db: &Connection,
    cars: &[(String, u64)],
    race: Option<&str>,
    car: Option<&str>,
) -> Result<EmbedResult> {
    let race = race.filter(|s| !s.is_empty());
    let car = car.filter(|s| !s.is_empty());
    let matches = car
        .map(|query| {
            forzabot_core::search_cars(cars.iter().map(|(n, v)| (n.as_str(), *v)), query, None)
        })
        .unwrap_or_default();
    if let Some(query) = car.filter(|_| matches.is_empty()) {
        return Ok(EmbedResult {
            title: "No Cars Found".into(),
            description: format!("No cars found matching \"**{query}**\""),
            footer: None,
            color: 0xff9900,
            ephemeral: true,
        });
    }
    let mut sql = String::from("SELECT r.name, p.display_name, p.username, t.car_name, t.laptime FROM times t JOIN races r ON t.race_id=r.id JOIN players p ON t.player_id=p.id WHERE t.is_historic = 0");
    let mut params: Vec<Value> = Vec::new();
    if let Some(race) = race {
        sql.push_str(" AND r.name = ?");
        params.push(Value::Text(race.to_owned()));
    }
    if !matches.is_empty() {
        sql.push_str(" AND t.car_name IN (");
        sql.push_str(&vec!["?"; matches.len()].join(","));
        sql.push(')');
        params.extend(matches.iter().map(|name| Value::Text((*name).into())));
    }
    sql.push_str(" ORDER BY t.laptime ASC LIMIT 20");
    let mut statement = db.prepare(&sql)?;
    let rows = statement
        .query_map(params_from_iter(params.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>>>()?;
    if rows.is_empty() {
        let suffix = match (race, car) {
            (Some(r), Some(c)) => format!(" for **{c}** on **{r}**"),
            (Some(r), None) => format!(" on **{r}**"),
            (None, Some(c)) => format!(" with **{c}**"),
            _ => String::new(),
        };
        return Ok(EmbedResult {
            title: "No Times Found".into(),
            description: format!("No times found{suffix}."),
            footer: None,
            color: 0xff9900,
            ephemeral: true,
        });
    }
    let title = match (race, car) {
        (Some(r), Some(_)) => format!("⏱️ Best Times - {} on {r}", matches[0]),
        (Some(r), None) => format!("⏱️ Best Times - {r}"),
        (None, Some(_)) => format!("⏱️ Best Times - {}", matches[0]),
        _ => "⏱️ Best Times".into(),
    };
    let lines = rows
        .iter()
        .enumerate()
        .map(|(index, (race, display, username, car, ms))| {
            let medal = match index {
                0 => "🥇".into(),
                1 => "🥈".into(),
                2 => "🥉".into(),
                _ => format!("{}.", index + 1),
            };
            let player = if display.is_empty() {
                username
            } else {
                display
            };
            format!(
                "{medal} **{}:{:02}.{:03}** - {player} - {car} - {race}",
                ms / 60_000,
                (ms % 60_000) / 1_000,
                ms % 1_000
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let suffix = if rows.len() == 1 { "" } else { "s" };
    Ok(EmbedResult {
        title,
        description: lines,
        footer: Some(format!("Showing {} time{suffix}", rows.len())),
        color: 0x3498db,
        ephemeral: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_formats_and_excludes_historic_times() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute_batch(
            "INSERT INTO players VALUES ('p','User','Driver',100,0);
          INSERT INTO races VALUES ('custom','Custom',NULL,'p',1);
          INSERT INTO times (race_id,player_id,car_name,laptime,is_historic,created_at) VALUES
          ('custom','p','Ferrari F40 1987',94860,0,0),
          ('custom','p','Ferrari F40 1987',1000,1,0),
          ('custom','p','Ford GT 2005',100000,0,0);",
        )
        .unwrap();
        let cars = vec![
            ("Ferrari F40 1987".into(), 100),
            ("Ford GT 2005".into(), 100),
        ];
        let all = best_times(&db, &cars, None, None).unwrap();
        assert_eq!(all.description, "🥇 **1:34.860** - Driver - Ferrari F40 1987 - Custom\n🥈 **1:40.000** - Driver - Ford GT 2005 - Custom");
        let filtered = best_times(&db, &cars, Some("Custom"), Some("f40")).unwrap();
        assert_eq!(filtered.title, "⏱️ Best Times - Ferrari F40 1987 on Custom");
        assert_eq!(filtered.footer.as_deref(), Some("Showing 1 time"));
        assert!(
            best_times(&db, &cars, None, Some("nonexistent"))
                .unwrap()
                .ephemeral
        );
        assert_eq!(
            best_times(&db, &cars, Some("Other"), Some("f40"))
                .unwrap()
                .description,
            "No times found for **f40** on **Other**."
        );
    }
}
