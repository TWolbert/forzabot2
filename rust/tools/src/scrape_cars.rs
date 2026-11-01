use regex::Regex;
use scraper::{Html, Selector};
use std::{collections::HashMap, error::Error, path::Path};

const SOURCE_URL: &str = "https://forza.fandom.com/wiki/Forza_Horizon_6/Cars";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, PartialEq, Eq)]
struct Car {
    name: String,
    value: String,
    pi: String,
    availability: String,
}

fn clean(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_car_rows(html: &str) -> Vec<Car> {
    let document = Html::parse_document(html);
    let rows = Selector::parse("tr").unwrap();
    let cells = Selector::parse("td, th").unwrap();
    let years = Regex::new(r"(?:19|20)\d{2}").unwrap();
    let prices = Regex::new(r"(?i)([\d,]+)\s*(?:CR|credits?)").unwrap();
    let pis = Regex::new(r"(?i)\b(D|C|B|A|S[12]|R|X)\s*(\d{3})\b").unwrap();
    let mut cars = HashMap::new();

    for row in document.select(&rows) {
        let values: Vec<String> = row
            .select(&cells)
            .map(|cell| clean(&cell.text().collect::<String>()))
            .collect();
        if values.len() < 8 {
            continue;
        }
        let first = &values[0];
        let Some(year) = years.find_iter(first).last() else {
            continue;
        };
        let vehicle = clean(&first[..year.start()]);
        let Some(pi) = values.iter().rev().find_map(|cell| pis.captures(cell)) else {
            continue;
        };
        if vehicle.is_empty() {
            continue;
        }
        let name = format!("{} {}", vehicle, year.as_str());
        let availability = clean(&first[year.end()..])
            .trim_matches([' ', '\'', '"'])
            .to_owned();
        let value = values
            .iter()
            .find_map(|cell| prices.captures(cell))
            .map(|price| price[1].replace(',', ""))
            .unwrap_or_else(|| "0".to_owned());
        cars.insert(
            name.clone(),
            Car {
                name,
                value,
                pi: format!("{}{}", pi[1].to_uppercase(), &pi[2]),
                availability: if availability.is_empty() {
                    "unknown".to_owned()
                } else {
                    availability
                },
            },
        );
    }
    let mut cars: Vec<_> = cars.into_values().collect();
    cars.sort_by_key(|car| car.name.to_lowercase());
    cars
}

fn write_csv(cars: &[Car], path: &Path) -> Result<(), Box<dyn Error>> {
    if cars.is_empty() {
        return Err("No FH6 cars with a year and PI were found on Forza Wiki.".into());
    }
    let mut writer = csv::Writer::from_path(path)?;
    writer.write_record(["Vehicle", "Value", "PI", "Availability"])?;
    for car in cars {
        writer.write_record([&car.name, &car.value, &car.pi, &car.availability])?;
    }
    writer.flush()?;
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let output = args.next().unwrap_or_else(|| "output.csv".into());
    if args.next().is_some() {
        return Err("Usage: scrape-cars [output.csv]".into());
    }
    let response = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .get(SOURCE_URL)
        .set("User-Agent", USER_AGENT)
        .set(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        )
        .set("Accept-Language", "en-US,en;q=0.9")
        .set("Referer", "https://www.google.com/")
        .set("DNT", "1")
        .set("Upgrade-Insecure-Requests", "1")
        .call()?;
    let html = response.into_string()?;
    let cars = parse_car_rows(&html);
    write_csv(&cars, Path::new(&output))?;
    println!(
        "Wrote {} FH6 cars to {}",
        cars.len(),
        Path::new(&output).display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rows_and_last_year() {
        let html = r#"<table><tr><td>BMW 2002 1973 Autoshow</td><td>12,000 CR</td><td></td><td></td><td></td><td></td><td></td><td>B 650</td></tr>
        <tr><td>Ford Test 2020</td><td></td><td></td><td></td><td></td><td></td><td></td><td>S1 850</td></tr></table>"#;
        assert_eq!(
            parse_car_rows(html),
            vec![
                Car {
                    name: "BMW 2002 1973".into(),
                    value: "12000".into(),
                    pi: "B650".into(),
                    availability: "Autoshow".into()
                },
                Car {
                    name: "Ford Test 2020".into(),
                    value: "0".into(),
                    pi: "S1850".into(),
                    availability: "unknown".into()
                },
            ]
        );
    }

    #[test]
    fn empty_results_do_not_overwrite_output() {
        let path = std::env::temp_dir().join(format!("forzabot-empty-{}", std::process::id()));
        std::fs::write(&path, "keep").unwrap();
        assert!(write_csv(&[], &path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "keep");
        std::fs::remove_file(path).unwrap();
    }
}
