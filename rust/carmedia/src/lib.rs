//! Car-image lookup shared by the Discord bot and API.
//!
//! Confirmed images in SQLite take precedence. Otherwise the same Forza Wiki
//! search, then Wikipedia fallback, is used as before.
use reqwest::Client;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::time::Duration;

const USER_AGENT: &str = "forzabot/1.0 (contact: discord bot)";

/// Read a confirmed image and make local `/car-images/...` paths absolute.
pub fn confirmed(
    db: &Connection,
    car_name: &str,
    base_url: &str,
) -> rusqlite::Result<Option<String>> {
    let image: Option<String> = db
        .query_row(
            "SELECT image_url FROM car_images WHERE lower(car_name)=lower(?)",
            [car_name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(image.map(|value| {
        let base = base_url.trim_end_matches('/');
        if let Some(path) = value.strip_prefix('/') {
            format!("{base}/{path}")
        } else {
            value
        }
    }))
}

fn search_title(data: &Value, index: usize) -> Option<&str> {
    data.get("query")?
        .get("search")?
        .as_array()?
        .get(index)?
        .get("title")?
        .as_str()
}

fn thumbnail(data: &Value) -> Option<&str> {
    data.get("query")?
        .get("pages")?
        .as_object()?
        .values()
        .next()?
        .get("thumbnail")?
        .get("source")?
        .as_str()
}

/// Search one wiki API and return the page image for the selected result.
async fn wiki_image(client: &Client, base: &str, search: &str, index: usize) -> Option<String> {
    let results = client
        .get(base)
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", search),
            ("srlimit", "10"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let title = search_title(&results, index)?;
    let images = client
        .get(base)
        .query(&[
            ("action", "query"),
            ("prop", "pageimages"),
            ("pithumbsize", "800"),
            ("titles", title),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    thumbnail(&images).map(str::to_owned)
}

/// Resolve an image from the Forza Wiki, falling back to Wikipedia.
pub async fn remote(car_name: &str, index: usize) -> Option<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(USER_AGENT)
        .build()
        .ok()?;
    if let Some(image) = wiki_image(
        &client,
        "https://forza.fandom.com/api.php",
        &format!("{car_name} Forza Horizon 6"),
        index,
    )
    .await
    {
        return Some(image);
    }
    wiki_image(
        &client,
        "https://en.wikipedia.org/w/api.php",
        car_name,
        index,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_and_thumbnail_shapes() {
        let search =
            serde_json::json!({"query":{"search":[{"title":"Ferrari F40"},{"title":"Other"}]}});
        assert_eq!(search_title(&search, 0), Some("Ferrari F40"));
        assert_eq!(search_title(&search, 5), None);
        let images = serde_json::json!({"query":{"pages":{"1":{"thumbnail":{"source":"https://img/f40.jpg"}}}}});
        assert_eq!(thumbnail(&images), Some("https://img/f40.jpg"));
    }

    #[test]
    fn confirmed_images_become_absolute() {
        let mut db = Connection::open_in_memory().unwrap();
        forzabot_database::initialize(&mut db).unwrap();
        db.execute(
            "INSERT INTO car_images VALUES ('Ferrari F40 1987','/car-images/f40.jpg',1)",
            [],
        )
        .unwrap();
        assert_eq!(
            confirmed(&db, "ferrari f40 1987", "https://example.com/")
                .unwrap()
                .as_deref(),
            Some("https://example.com/car-images/f40.jpg")
        );
        assert_eq!(
            confirmed(&db, "Ferrari F40 1987", "https://example.com")
                .unwrap()
                .as_deref(),
            Some("https://example.com/car-images/f40.jpg")
        );
        assert_eq!(
            confirmed(&db, "Missing", "https://example.com").unwrap(),
            None
        );
    }
}
