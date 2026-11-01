//! Car image discovery and local confirmed-image storage.
use super::{ApiError, ApiResult, Database};
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    env,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone)]
struct MediaState {
    db: Database,
    dir: PathBuf,
}

pub fn router(db: Database) -> Router {
    let dir = env::var("CAR_IMAGES_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("web/car-images"));
    Router::new()
        .route("/api/car-image/{car_name}", get(fetch_image))
        .route("/api/car-image/confirm", post(confirm))
        .route("/api/car-image/confirm/delete", post(delete_image))
        .route("/car-images/{name}", get(serve_local))
        .with_state(MediaState { db, dir })
}

fn valid_url(url: &str) -> bool {
    // Confirmation only downloads images from the existing allowlisted image
    // sources. This blocks loopback, metadata, and arbitrary-Internet fetches.
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    matches!(
        host.as_str(),
        "forza.fandom.com"
            | "static.wikia.nocookie.net"
            | "upload.wikimedia.org"
            | "en.wikipedia.org"
    )
}

fn extension(content_type: &str) -> Option<&'static str> {
    match content_type
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn slug(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for c in value.to_ascii_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            if separator && !result.is_empty() {
                result.push('-');
            }
            result.push(c);
            separator = false;
        } else {
            separator = true;
        }
    }
    result
}

fn local_filename(url: &str) -> Option<&str> {
    // Only URLs written by the confirm endpoint qualify for cleanup.
    let name = url.strip_prefix("/car-images/")?;
    (!name.is_empty() && !name.contains('/') && !name.contains('\\') && name != "." && name != "..")
        .then_some(name)
}

async fn resolve_remote(car: &str, index: usize) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("forzabot/1.0 (contact: discord bot)")
        .build()
        .ok()?;
    for (base, query) in [
        (
            "https://forza.fandom.com/api.php",
            format!("{car} Forza Horizon 6"),
        ),
        ("https://en.wikipedia.org/w/api.php", car.to_owned()),
    ] {
        let search = client
            .get(base)
            .query(&[
                ("action", "query"),
                ("list", "search"),
                ("srsearch", query.as_str()),
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
        let Some(title) = search["query"]["search"][index]["title"].as_str() else {
            continue;
        };
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
        if let Some(url) = images["query"]["pages"]
            .as_object()
            .and_then(|pages| pages.values().next())
            .and_then(|page| page["thumbnail"]["source"].as_str())
            .filter(|url| valid_url(url))
        {
            return Some(url.to_owned());
        }
    }
    None
}

#[derive(Deserialize)]
struct Lookup {
    index: Option<usize>,
}

async fn fetch_image(
    State(state): State<MediaState>,
    Path(car): Path<String>,
    Query(lookup): Query<Lookup>,
) -> Json<Value> {
    let confirmed = state.db.lock().ok().and_then(|db| {
        db.query_row(
            "SELECT image_url FROM car_images WHERE lower(car_name)=lower(?)",
            [&car],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    });
    let image = match confirmed {
        Some(image) => Some(image),
        None => resolve_remote(&car, lookup.index.unwrap_or(0)).await,
    };
    Json(json!({ "imageUrl": image }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Confirm {
    car_name: Option<String>,
    image_url: Option<String>,
}

async fn confirm_impl(state: MediaState, body: Confirm) -> ApiResult<Json<Value>> {
    let car = body.car_name.unwrap_or_default().trim().to_owned();
    let Some(source) = body.image_url else {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Missing carName or imageUrl",
        ));
    };
    if car.is_empty() || !valid_url(&source) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid image URL"));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(4))
        .user_agent("forzabot/1.0 (contact: discord bot)")
        .build()
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Failed to download image"))?
        .get(&source)
        .send()
        .await
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Failed to download image"))?
        .error_for_status()
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Failed to download image"))?;
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some(extension) = extension(content_type) else {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Unsupported image type"));
    };
    if response
        .content_length()
        .is_some_and(|n| n > MAX_IMAGE_BYTES as u64)
    {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Image is too large"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Failed to download image"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid image size"));
    }
    if extension == "jpg" && !(bytes.starts_with(&[0xff, 0xd8]) && bytes.ends_with(&[0xff, 0xd9])) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid JPEG data"));
    }
    if extension == "png" && !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid PNG data"));
    }
    if extension == "webp" && !(bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid WebP data"));
    }
    tokio::fs::create_dir_all(&state.dir)
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Failed to store image"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let base = slug(&car);
    let filename = format!(
        "{}-{stamp}.{extension}",
        if base.is_empty() { "car" } else { &base }
    );
    let path = state.dir.join(&filename);
    let temporary = state.dir.join(format!(".{filename}.tmp"));
    tokio::fs::write(&temporary, &bytes)
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Failed to store image"))?;
    if tokio::fs::rename(&temporary, &path).await.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to store image",
        ));
    }
    let url = format!("/car-images/{filename}");
    let (previous, write_error) = {
        // The guard is deliberately scoped: std::sync guards are not Send and
        // must never be held across tokio file operations.
        let db = state
            .db
            .lock()
            .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
        let previous: Option<String> = db
            .query_row(
                "SELECT image_url FROM car_images WHERE lower(car_name)=lower(?)",
                [&car],
                |r| r.get(0),
            )
            .optional()?;
        let write_error = db.execute(
            "INSERT INTO car_images(car_name,image_url,confirmed_at) VALUES (?1,?2,?3) ON CONFLICT(car_name) DO UPDATE SET image_url=excluded.image_url,confirmed_at=excluded.confirmed_at",
            params![car, url, stamp as i64],
        ).err();
        (previous, write_error)
    };
    if let Some(error) = write_error {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(error.into());
    }
    if let Some(name) = previous
        .as_deref()
        .and_then(local_filename)
        .filter(|name| *name != filename)
    {
        let _ = tokio::fs::remove_file(state.dir.join(name)).await;
    }
    Ok(Json(json!({"ok":true,"imageUrl":url})))
}

async fn confirm(State(state): State<MediaState>, Json(body): Json<Confirm>) -> Response {
    confirm_impl(state, body).await.into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Clear {
    car_name: Option<String>,
}

async fn delete_image(
    State(state): State<MediaState>,
    Json(body): Json<Clear>,
) -> ApiResult<Json<Value>> {
    let car = body.car_name.unwrap_or_default().trim().to_owned();
    if car.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Missing carName"));
    }
    let db = state
        .db
        .lock()
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;
    db.execute(
        "DELETE FROM car_images WHERE lower(car_name)=lower(?)",
        [car],
    )?;
    Ok(Json(json!({"ok":true})))
}

async fn serve_local(State(state): State<MediaState>, Path(name): Path<String>) -> Response {
    serve(state.db, &name).await
}

/// Serve stored images with an unguessable-filename check and safe MIME type.
pub async fn serve(db: Database, name: &str) -> Response {
    let local = format!("/car-images/{name}");
    let Some(name) = local_filename(&local) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let dir = env::var("CAR_IMAGES_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("web/car-images"));
    let path = dir.join(name);
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let _ = db;
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slugs_and_local_paths_are_safe() {
        assert_eq!(slug(" Ferrari F40 1987 "), "ferrari-f40-1987");
        assert_eq!(slug("!!!"), "");
        assert_eq!(local_filename("/car-images/f40-1.jpg"), Some("f40-1.jpg"));
        assert_eq!(local_filename("/car-images/../secret"), None);
        assert_eq!(local_filename("https://example.com/x.jpg"), None);
        assert_eq!(extension("image/jpeg; charset=binary"), Some("jpg"));
        assert_eq!(extension("text/html"), None);
    }
}
