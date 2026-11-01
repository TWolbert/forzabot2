//! Shared domain behavior for the Rust implementation of ForzaBot.

/// Summer transition inferred from the supplied spring countdown at
/// 2026-11-01 16:03:52 UTC. Seasons rotate once a week.
pub const SUMMER_START_UNIX_SECONDS: i64 = 1_793_888_992;
pub const SEASON_SECONDS: i64 = 7 * 24 * 60 * 60;

pub fn season_at(unix_seconds: i64) -> &'static str {
    let index = (unix_seconds - SUMMER_START_UNIX_SECONDS)
        .div_euclid(SEASON_SECONDS)
        .rem_euclid(4);
    ["summer", "autumn", "winter", "spring"][index as usize]
}

pub fn seasonal_map_path(unix_seconds: i64) -> String {
    format!("media/maps/fh6-japan-{}.jpg", season_at(unix_seconds))
}

/// Parse the existing `minutes:seconds.milliseconds` lap-time format.
/// One or two fractional digits are padded to milliseconds.
pub fn parse_time(value: &str) -> Option<u64> {
    let (minutes, rest) = value.split_once(':')?;
    let (seconds, fraction) = rest.split_once('.')?;
    if minutes.is_empty()
        || seconds.is_empty()
        || seconds.len() > 2
        || fraction.is_empty()
        || fraction.len() > 3
        || !minutes.bytes().all(|c| c.is_ascii_digit())
        || !seconds.bytes().all(|c| c.is_ascii_digit())
        || !fraction.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let minutes: u64 = minutes.parse().ok()?;
    let seconds: u64 = seconds.parse().ok()?;
    if seconds > 59 {
        return None;
    }
    let fraction: u64 = fraction.parse().ok()?;
    let milliseconds = fraction * 10_u64.pow(3 - rest.split_once('.')?.1.len() as u32);
    minutes
        .checked_mul(60_000)?
        .checked_add(seconds * 1_000)?
        .checked_add(milliseconds)
}

/// Normalize names using the same ASCII tokenization as the existing bot.
pub fn normalize_search_text(value: &str) -> String {
    let mut result = String::new();
    let mut space = false;
    for c in value.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            if space && !result.is_empty() {
                result.push(' ');
            }
            result.push(c);
            space = false;
        } else {
            space = true;
        }
    }
    result
}

pub fn matches_brand_name(car_name: &str, brand: &str) -> bool {
    let car = normalize_search_text(car_name);
    let brand = normalize_search_text(brand);
    brand.is_empty()
        || car == brand
        || car
            .strip_prefix(&brand)
            .is_some_and(|rest| rest.starts_with(' '))
}

/// Score a normalized name against a normalized search query as the bot does.
pub fn fuzzy_score(name: &str, query: &str) -> usize {
    if query.is_empty() {
        return 0;
    }
    if name.contains(query) {
        return 1000 + 50_usize.saturating_sub(name.len().abs_diff(query.len()));
    }
    let name_tokens: Vec<_> = name.split_whitespace().collect();
    let query_tokens: Vec<_> = query.split_whitespace().collect();
    if !query_tokens
        .iter()
        .all(|token| name_tokens.iter().any(|name| name.contains(token)))
    {
        return 0;
    }
    let prefixes = query_tokens
        .iter()
        .filter(|token| name_tokens.iter().any(|name| name.starts_with(**token)))
        .count();
    10 + prefixes + 5_usize.saturating_sub(name_tokens.len().abs_diff(query_tokens.len()))
}

/// Return the best twenty matching names, preserving input order for ties.
pub fn search_cars<'a>(
    cars: impl IntoIterator<Item = (&'a str, u64)>,
    query: &str,
    max_value: Option<u64>,
) -> Vec<&'a str> {
    let query = normalize_search_text(query);
    if query.is_empty() {
        return Vec::new();
    }
    let mut results: Vec<_> = cars
        .into_iter()
        .filter(|(_, value)| max_value.is_none_or(|maximum| *value > 0 && *value <= maximum))
        .filter_map(|(name, _)| {
            let score = fuzzy_score(&normalize_search_text(name), &query);
            (score > 0).then_some((name, score))
        })
        .collect();
    results.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    results.into_iter().take(20).map(|(name, _)| name).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seasons_rotate_at_weekly_boundaries() {
        let t = SUMMER_START_UNIX_SECONDS;
        assert_eq!(season_at(t - 1), "spring");
        assert_eq!(season_at(t), "summer");
        assert_eq!(season_at(t + SEASON_SECONDS), "autumn");
        assert_eq!(season_at(t + 2 * SEASON_SECONDS), "winter");
        assert_eq!(season_at(t + 3 * SEASON_SECONDS), "spring");
        assert_eq!(season_at(t + 4 * SEASON_SECONDS), "summer");
    }

    #[test]
    fn parses_lap_times() {
        assert_eq!(parse_time("1:34.860"), Some(94_860));
        assert_eq!(parse_time("0:5.1"), Some(5_100));
        assert_eq!(parse_time("12:12.39"), Some(732_390));
        for invalid in [
            "1:60.000",
            "1:00",
            "-1:00.0",
            "1:000.1",
            "1:00.1234",
            "1:00.1\n",
        ] {
            assert_eq!(parse_time(invalid), None, "{invalid:?}");
        }
    }

    #[test]
    fn brand_matching_respects_word_boundaries() {
        assert!(matches_brand_name("Aston-Martin DB5 1964", "aston martin"));
        assert!(!matches_brand_name("Audisport 2020", "Audi"));
        assert!(matches_brand_name("Anything", "!!!"));
    }

    #[test]
    fn search_orders_matches_and_observes_budget() {
        let cars = [
            ("Ferrari F40 1987", 400_000),
            ("Ferrari F50 1995", 0),
            ("Ford 1940", 50_000),
            ("F40 Ferrari 1987", 100_000),
        ];
        assert_eq!(
            search_cars(cars, "ferrari f40", None),
            ["Ferrari F40 1987", "F40 Ferrari 1987"]
        );
        assert_eq!(
            search_cars(cars, "ferrari", Some(200_000)),
            ["F40 Ferrari 1987"]
        );
        assert!(search_cars(cars, "!!!", None).is_empty());
    }
}
