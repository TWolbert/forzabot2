use dioxus::prelude::*;
use gloo_storage::{LocalStorage, Storage};
use serde::Deserialize;

const CSS: &str = include_str!("style.css");

#[derive(Clone, Routable, Debug, PartialEq)]
enum Route {
    #[layout(Shell)]
    #[route("/")]
    Home {},
    #[route("/leaderboard")]
    Leaderboard {},
    #[route("/games")]
    Games {},
    #[route("/times")]
    LapTimes {},
    #[route("/active-round")]
    ActiveRound {},
    #[route("/points")]
    PointsManagement {},
    #[route("/players/:id")]
    PlayerDetail { id: String },
    #[route("/signin")]
    SignIn {},
    #[route("/profile")]
    Profile {},
    #[route("/games/:id")]
    GameDetail { id: String },
    #[route("/times/:id")]
    TimeDetail { id: String },
}

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! { style { "{CSS}" } Router::<Route> {} }
}

#[component]
fn Shell() -> Element {
    rsx! {
        nav { class: "nav",
            div { class: "nav-inner",
                Link { class: "brand", to: Route::Home {}, "FORZABOT" }
                div { class: "links",
                    Link { to: Route::Home {}, "HOME" }
                    Link { to: Route::Leaderboard {}, "BOARD" }
                    Link { to: Route::Games {}, "GAMES" }
                    Link { to: Route::LapTimes {}, "TIMES" }
                    Link { to: Route::ActiveRound {}, "LIVE" }
                    Link { to: Route::PointsManagement {}, "POINTS" }
                    Link { to: Route::SignIn {}, "SIGN IN" }
                    Link { to: Route::Profile {}, "PROFILE" }
                }
            }
        }
        main { class: "container", Outlet::<Route> {} }
    }
}

const ADMIN_TOKEN_KEY: &str = "forzabot-admin-token";

async fn admin_request(
    path: &str,
    method: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let mut request = if method == "POST" {
        gloo_net::http::Request::post(path)
    } else {
        gloo_net::http::Request::get(path)
    };
    if let Some(token) = token {
        request = request.header("Authorization", &format!("Bearer {token}"));
    }
    let request = if let Some(body) = body {
        request.json(&body).map_err(|e| e.to_string())?
    } else {
        request.build().map_err(|e| e.to_string())?
    };
    let response = request.send().await.map_err(|e| e.to_string())?;
    let ok = response.ok();
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(data["error"]
            .as_str()
            .unwrap_or("Request failed")
            .to_owned());
    }
    Ok(data)
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct ManagedUser {
    id: String,
    username: String,
    points: i64,
}
#[derive(Clone, Debug, Deserialize)]
struct ManagedUsers {
    users: Vec<ManagedUser>,
}
#[derive(Clone, Debug, Deserialize)]
struct AdminLog {
    id: i64,
    username: String,
    source: String,
    before_points: i64,
    after_points: i64,
    delta: i64,
}
#[derive(Clone, Debug, Deserialize)]
struct AdminLogs {
    logs: Vec<AdminLog>,
}

#[component]
fn PointsManagement() -> Element {
    let mut token = use_signal(|| LocalStorage::get::<String>(ADMIN_TOKEN_KEY).ok());
    let mut password = use_signal(String::new);
    let mut message = use_signal(String::new);
    let mut refresh = use_signal(|| 0_u64);
    let users = use_resource(move || {
        let token = token();
        let _version = refresh();
        async move {
            match token {
                Some(token) => admin_request("/api/admin/users", "GET", Some(&token), None)
                    .await
                    .and_then(|v| {
                        serde_json::from_value::<ManagedUsers>(v).map_err(|e| e.to_string())
                    }),
                None => Ok(ManagedUsers { users: vec![] }),
            }
        }
    });
    let logs = use_resource(move || {
        let token = token();
        let _version = refresh();
        async move {
            match token {
                Some(token) => admin_request("/api/admin/points-log", "GET", Some(&token), None)
                    .await
                    .and_then(|v| {
                        serde_json::from_value::<AdminLogs>(v).map_err(|e| e.to_string())
                    }),
                None => Ok(AdminLogs { logs: vec![] }),
            }
        }
    });
    rsx! { section { class: "panel orange-border", h1 { "🛡 POINTS MANAGEMENT" }
        if !message().is_empty() { p { class: "error", "{message}" } }
        if token().is_none() {
            form { onsubmit: move |event| {
                event.prevent_default();
                let supplied = password();
                spawn(async move {
                    match admin_request("/api/admin/login","POST",None,Some(serde_json::json!({"password":supplied}))).await {
                        Ok(data) => if let Some(value) = data["token"].as_str() {
                            let value = value.to_owned();
                            if let Err(error) = LocalStorage::set(ADMIN_TOKEN_KEY,&value) { message.set(format!("Could not save admin session: {error}")); return; }
                            token.set(Some(value)); password.set(String::new()); message.set(String::new());
                        },
                        Err(error) => message.set(error),
                    }
                });
            },
                label { r#for: "admin-password", "Admin password" }
                input { id:"admin-password", class:"filter", r#type:"password", autocomplete:"current-password", value:"{password}", oninput: move |event| password.set(event.value()) }
                button { class:"action", r#type:"submit", "Sign in" }
            }
        } else {
            button { class:"action", onclick: move |_| { let old = token(); spawn(async move {
                if let Some(old) = old { let _ = admin_request("/api/admin/logout","POST",Some(&old),Some(serde_json::json!({}))).await; }
                LocalStorage::delete(ADMIN_TOKEN_KEY); token.set(None); message.set(String::new());
            }); }, "Sign out" }
            h2 { "Users" }
            match &*users.read() {
                None => rsx! { p { class:"muted", "Loading users…" } },
                Some(Err(error)) => rsx! { p { class:"error", "Could not load users: {error}" } },
                Some(Ok(data)) => rsx! { div { class:"list", for user in data.users.iter() {
                    ManagedUserRow { key:"{user.id}", user:user.clone(), token:token().unwrap_or_default(), on_saved: move |_| { refresh += 1; } }
                } } },
            }
            h2 { "Points history" }
            match &*logs.read() {
                None => rsx! { p { class:"muted", "Loading history…" } },
                Some(Err(error)) => rsx! { p { class:"error", "Could not load history: {error}" } },
                Some(Ok(data)) if data.logs.is_empty() => rsx! { p { class:"muted", "No points changes yet." } },
                Some(Ok(data)) => rsx! { div { class:"list", for log in data.logs.iter() {
                    div { key:"{log.id}", class:"row", div { class:"grow", strong { "{log.username}" } p { class:"muted", "{log.source} · {log.before_points} → {log.after_points}" } } strong { "{log.delta:+}" } }
                } } },
            }
        }
    } }
}

#[component]
fn ManagedUserRow(user: ManagedUser, token: String, on_saved: EventHandler<()>) -> Element {
    let mut draft = use_signal(|| user.points.to_string());
    let mut error = use_signal(String::new);
    let id = user.id.clone();
    rsx! { div { class:"row", div { class:"grow", strong { "{user.username}" } p { class:"muted", "Current: {user.points}" } }
        input { class:"points-input", r#type:"number", min:"0", value:"{draft}", oninput: move |event| draft.set(event.value()) }
        button { class:"action", onclick: move |_| {
            let Ok(points) = draft().parse::<i64>() else { error.set("Enter a non-negative integer.".into()); return; };
            if points < 0 { error.set("Enter a non-negative integer.".into()); return; }
            let token = token.clone(); let id = id.clone();
            spawn(async move {
                match admin_request(&format!("/api/admin/users/{id}/points"),"POST",Some(&token),Some(serde_json::json!({"points":points}))).await {
                    Ok(_) => { error.set(String::new()); on_saved.call(()); },
                    Err(reason) => error.set(reason),
                }
            });
        }, "Save" }
        if !error().is_empty() { span { class:"error", "{error}" } }
    } }
}

#[component]
fn Home() -> Element {
    rsx! {
        section { class: "hero", p { class: "eyebrow", "FORZA HORIZON RACING LEAGUE" } h1 { "FORZABOT" } p { "The home of your racing league." } }
        div { class: "grid",
            Link { class: "tile green", to: Route::Leaderboard {}, span { "🏆" } h2 { "LEADERBOARD" } p { "See who's leading the pack." } }
            Link { class: "tile yellow", to: Route::Games {}, span { "🏁" } h2 { "PAST GAMES" } p { "Relive the latest races." } }
            Link { class: "tile blue", to: Route::LapTimes {}, span { "⏱" } h2 { "LAP TIMES" } p { "Find the fastest laps." } }
            Link { class: "tile orange", to: Route::ActiveRound {}, span { "⚡" } h2 { "ACTIVE ROUND" } p { "See what's happening now." } }
        }
    }
}

async fn get<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    let response = gloo_net::http::Request::get(path)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.ok() {
        return Err(format!("Request failed ({})", response.status()));
    }
    response.json().await.map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Deserialize)]
struct LeaderboardEntry {
    id: String,
    username: String,
    points: i64,
    #[serde(default)]
    total_bets: i64,
    #[serde(default)]
    won_bets: i64,
    #[serde(default)]
    linked_player_id: Option<String>,
}

#[component]
fn Leaderboard() -> Element {
    let entries = use_resource(|| async { get::<Vec<LeaderboardEntry>>("/api/leaderboard").await });
    rsx! {
        section { class: "panel green-border", h1 { "🏆 LEADERBOARD" }
            match &*entries.read() {
                None => rsx! { p { class: "muted", "Loading leaderboard…" } },
                Some(Err(error)) => rsx! { p { class: "error", "Could not load leaderboard: {error}" } },
                Some(Ok(entries)) if entries.is_empty() => rsx! { p { class: "muted", "No players yet." } },
                Some(Ok(entries)) => rsx! { div { class: "list",
                    for (index, player) in entries.iter().enumerate() {
                        div { key: "{player.id}", class: "row",
                            strong { class: "rank", "#{index + 1}" }
                            div { class: "grow", strong { "{player.username}" } p { class: "muted", "{player.won_bets} wins · {player.total_bets} bets" } }
                            strong { class: "points", "{player.points} pts" }
                            if let Some(linked) = player.linked_player_id.as_deref() { Link { class: "button-link", to: Route::PlayerDetail { id: linked.to_owned() }, "Profile" } }
                        }
                    }
                } },
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct PlayerInfo {
    id: String,
    display_name: String,
    avatar_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
struct PlayerStats {
    games_played: i64,
    wins: i64,
    times_recorded: i64,
    fastest_time: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
struct PlayerGame {
    id: String,
    race_type: String,
    winner_name: Option<String>,
    num_players: i64,
    car_name: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
struct PlayerTime {
    id: i64,
    car_name: String,
    race_name: String,
    time_ms: i64,
}
#[derive(Clone, Debug, Deserialize)]
struct PlayerResponse {
    player: PlayerInfo,
    stats: PlayerStats,
    games: Vec<PlayerGame>,
    times: Vec<PlayerTime>,
}

#[component]
fn PlayerDetail(id: String) -> Element {
    let data = use_resource(move || {
        let id = id.clone();
        async move { get::<PlayerResponse>(&format!("/api/player/{id}")).await }
    });
    rsx! { section { class: "panel green-border",
        Link { to: Route::Leaderboard {}, class: "muted", "← Back to leaderboard" }
        match &*data.read() {
            None => rsx! { p { class: "muted", "Loading player…" } },
            Some(Err(error)) => rsx! { p { class: "error", "Could not load player: {error}" } },
            Some(Ok(data)) => rsx! {
                div { class: "player-heading",
                    if let Some(avatar) = data.player.avatar_url.as_deref() { img { class: "avatar", src: "{avatar}", alt: "" } }
                    h1 { "{data.player.display_name}" }
                }
                div { class: "grid",
                    div { class: "stat", strong { "{data.stats.games_played}" } span { "Games" } }
                    div { class: "stat", strong { "{data.stats.wins}" } span { "Wins" } }
                    div { class: "stat", strong { "{data.stats.times_recorded}" } span { "Lap times" } }
                    div { class: "stat", strong { "{data.stats.fastest_time.map(format_time).unwrap_or_else(|| \"—\".into())}" } span { "Fastest lap" } }
                }
                h2 { "Recent games" }
                div { class: "list", for game in data.games.iter() {
                    div { key: "{game.id}", class: "row", div { class: "grow", strong { "{game.race_type}" } p { class: "muted", "{game.car_name.as_deref().unwrap_or(\"No car recorded\")} · {game.num_players} players" } } span { class: "muted", "Winner: {game.winner_name.as_deref().unwrap_or(\"None\")}" } }
                } }
                h2 { "Lap times" }
                div { class: "list", for time in data.times.iter() {
                    div { key: "{time.id}", class: "row", div { class: "grow", strong { "{time.race_name}" } p { class: "muted", "{time.car_name}" } } strong { class: "points", "{format_time(time.time_ms)}" } }
                } }
            },
        }
    } }
}

const AUTH_TOKEN_KEY: &str = "forzabot-auth-token";

fn auth_token() -> Option<String> {
    LocalStorage::get(AUTH_TOKEN_KEY).ok()
}

async fn auth_request(
    path: &str,
    method: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let token = auth_token().ok_or("Please sign in.")?;
    admin_request(path, method, Some(&token), body).await
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct AuthUser {
    id: String,
    username: String,
    points: i64,
}
#[derive(Clone, Debug, Deserialize)]
struct MeResponse {
    user: AuthUser,
}
#[derive(Clone, Debug, Deserialize)]
struct AuthResponse {
    token: String,
    user: AuthUser,
}

#[component]
fn SignIn() -> Element {
    let mut username = use_signal(String::new);
    let mut password = use_signal(String::new);
    let mut register = use_signal(|| false);
    let mut error = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let navigator = use_navigator();
    rsx! { section { class: "panel orange-border auth-panel",
        h1 { "FORZABOT ACCOUNT" }
        p { class: "muted", "Sign in to place bets and manage your profile." }
        form { onsubmit: move |event| {
            event.prevent_default();
            error.set(String::new());
            busy.set(true);
            let path = if register() { "/api/auth/register" } else { "/api/auth/login" };
            let body = serde_json::json!({"username": username(), "password": password()});
            spawn(async move {
                match admin_request(path, "POST", None, Some(body)).await {
                    Ok(data) => match serde_json::from_value::<AuthResponse>(data) {
                        Ok(auth) => {
                            let _ = LocalStorage::set(AUTH_TOKEN_KEY, &auth.token);
                            username.set(String::new());
                            password.set(String::new());
                            navigator.push(Route::Profile {});
                        }
                        Err(reason) => error.set(reason.to_string()),
                    },
                    Err(reason) => error.set(reason),
                }
                busy.set(false);
            });
        },
            label { class: "field-label", r#for: "username", "Username" }
            input { id: "username", class: "filter", autocomplete: "username", value: "{username}", oninput: move |event| username.set(event.value()) }
            label { class: "field-label", r#for: "password", "Password" }
            input { id: "password", class: "filter", r#type: "password", autocomplete: if register() { "new-password" } else { "current-password" }, value: "{password}", oninput: move |event| password.set(event.value()) }
            if !error().is_empty() { p { class: "error", "{error}" } }
            button { class: "action", r#type: "submit", disabled: busy(), if busy() { "Please wait…" } else if register() { "Create account" } else { "Sign in" } }
        }
        button { class: "text-button", r#type: "button", onclick: move |_| register.toggle(), if register() { "Already have an account? Sign in" } else { "Need an account? Register" } }
    } }
}

#[derive(Clone, Debug, Deserialize)]
struct LinkInfo {
    discord_username: Option<String>,
    discord_user_id: Option<String>,
    avatar_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
struct PointsEntry {
    id: i64,
    source: String,
    before_points: i64,
    after_points: i64,
    delta: i64,
}
#[derive(Clone, Debug, Deserialize)]
struct HistoryResponse {
    history: Vec<PointsEntry>,
}

#[component]
fn Profile() -> Element {
    let mut version = use_signal(|| 0_u64);
    let mut message = use_signal(String::new);
    let me = use_resource(move || {
        let _v = version();
        async move {
            auth_request("/api/auth/me", "GET", None)
                .await
                .and_then(|v| serde_json::from_value::<MeResponse>(v).map_err(|e| e.to_string()))
        }
    });
    let history = use_resource(move || {
        let _v = version();
        async move {
            auth_request("/api/auth/points-history", "GET", None)
                .await
                .and_then(|v| {
                    serde_json::from_value::<HistoryResponse>(v).map_err(|e| e.to_string())
                })
        }
    });
    let link = use_resource(move || {
        let _v = version();
        async move {
            auth_request("/api/auth/discord-link", "GET", None)
                .await
                .and_then(|v| serde_json::from_value::<LinkInfo>(v).map_err(|e| e.to_string()))
        }
    });
    let mut new_name = use_signal(String::new);
    let mut link_code = use_signal(|| Option::<String>::None);
    let navigator = use_navigator();
    rsx! { section { class: "panel orange-border", h1 { "👤 ACCOUNT" }
        if auth_token().is_none() { p { class: "muted", "You are signed out." } Link { class: "button-link", to: Route::SignIn {}, "Sign in" } }
        else {
            if !message().is_empty() { p { class: "error", "{message}" } }
            match &*me.read() {
                None => rsx! { p { class: "muted", "Loading account…" } },
                Some(Err(error)) => rsx! { p { class: "error", "{error}" } },
                Some(Ok(data)) => rsx! {
                    div { class: "player-heading", h1 { "{data.user.username}" } strong { class: "points", "{data.user.points} pts" } }
                    h2 { "Change username" }
                    div { class: "inline-form",
                        input { class: "filter", value: "{new_name}", placeholder: "{data.user.username}", oninput: move |e| new_name.set(e.value()) }
                        button { class: "action", onclick: move |_| { let name = new_name(); spawn(async move {
                            match auth_request("/api/auth/update-username","POST",Some(serde_json::json!({"username":name}))).await {
                                Ok(_) => { message.set("Username updated".into()); version += 1; }
                                Err(reason) => message.set(reason),
                            }
                        }); }, "Save" }
                    }
                },
            }
            h2 { "Discord account" }
            match &*link.read() {
                None => rsx! { p { class: "muted", "Loading Discord link…" } },
                Some(Err(error)) => rsx! { p { class: "error", "{error}" } },
                Some(Ok(info)) => rsx! {
                    if let Some(id) = info.discord_user_id.as_deref() {
                        p { "Linked to **{info.discord_username.as_deref().unwrap_or(id)}** ({id})" }
                        button { class: "action danger", onclick: move |_| { spawn(async move {
                            match auth_request("/api/auth/unlink-discord","POST",Some(serde_json::json!({}))).await {
                                Ok(_) => { link_code.set(None); version += 1; }
                                Err(reason) => message.set(reason),
                            }
                        }); }, "Unlink Discord" }
                    } else {
                        p { class: "muted", "No Discord account linked." }
                        button { class: "action", onclick: move |_| { spawn(async move {
                            match auth_request("/api/auth/discord-link/start","POST",None).await {
                                Ok(data) => link_code.set(data["code"].as_str().map(str::to_owned)),
                                Err(reason) => message.set(reason),
                            }
                        }); }, "Create link code" }
                        if let Some(code) = link_code() {
                            div { class: "code-box",
                                p { "Send this one-time code to the bot in a direct message:" }
                                code { "/linkweb code:{code}" }
                                p { class: "muted", "Expires in 10 minutes and works once." }
                            }
                        }
                    }
                },
            }
            h2 { "Points history" }
            match &*history.read() {
                None => rsx! { p { class: "muted", "Loading history…" } },
                Some(Err(error)) => rsx! { p { class: "error", "{error}" } },
                Some(Ok(data)) if data.history.is_empty() => rsx! { p { class: "muted", "No points changes yet." } },
                Some(Ok(data)) => rsx! { div { class: "list", for entry in data.history.iter().rev() {
                    div { key: "{entry.id}", class: "row", div { class: "grow", strong { "{entry.source}" } p { class: "muted", "{entry.before_points} → {entry.after_points}" } } strong { class: if entry.delta < 0 { "error" } else { "points" }, "{entry.delta:+}" } }
                } } },
            }
            button { class: "action danger", onclick: move |_| { spawn(async move {
                let _ = auth_request("/api/auth/logout","POST",Some(serde_json::json!({}))).await;
                LocalStorage::delete(AUTH_TOKEN_KEY);
                navigator.push(Route::Home {});
            }); }, "Sign out" }
        }
    } }
}

#[derive(Clone, Debug, Deserialize)]
struct DetailPlayer {
    id: String,
    display_name: String,
    car_name: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
struct Score {
    player_id: String,
    display_name: String,
    points: i64,
}
#[derive(Clone, Debug, Deserialize)]
struct GameDetailData {
    id: String,
    class: Option<String>,
    #[serde(default)]
    restrict_class: Option<i64>,
    value: i64,
    race_type: String,
    winner_id: Option<String>,
    winner_name: Option<String>,
    created_at: i64,
    players: Vec<DetailPlayer>,
    #[serde(default)]
    scores: Vec<Score>,
}

fn format_date(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%b %-d, %H:%M").to_string())
        .unwrap_or_else(|| "—".into())
}

#[component]
fn GameDetail(id: String) -> Element {
    let data = use_resource(move || {
        let id = id.clone();
        async move { get::<GameDetailData>(&format!("/api/games/{id}")).await }
    });
    rsx! { section { class: "panel yellow-border",
        Link { class: "muted", to: Route::Games {}, "← Back to games" }
        match &*data.read() {
            None => rsx! { p { class: "muted", "Loading game…" } },
            Some(Err(error)) => rsx! { p { class: "error", "Could not load game: {error}" } },
            Some(Ok(game)) => rsx! {
                div { class: "player-heading", h1 { "{game.race_type}" } span { class: "muted", "{format_date(game.created_at)}" } }
                div { class: "grid",
                    div { class: "stat", strong { "{game.value / 1000}k CR" } span { "Budget" } }
                    if let Some(class) = game.class.as_deref() { div { class: "stat", strong { "{class}" } span { "Class" } } }
                    div { class: "stat", strong { "{game.players.len()}" } span { "Players" } }
                }
                h2 { "Winner" }
                if let (Some(winner), Some(name)) = (game.winner_id.as_deref(), game.winner_name.as_deref()) {
                    Link { class: "button-link", to: Route::PlayerDetail { id: winner.to_owned() }, "{name}" }
                } else { p { class: "muted", "No winner recorded" } }
                h2 { "Players" }
                div { class: "list", for player in game.players.iter() {
                    div { key: "{player.id}", class: "row",
                        Link { class: "grow", to: Route::PlayerDetail { id: player.id.clone() }, strong { "{player.display_name}" } }
                        span { class: "muted", "{player.car_name.as_deref().unwrap_or(\"No car recorded\")}" }
                    }
                } }
                if !game.scores.is_empty() {
                    h2 { "Final scores" }
                    div { class: "list", for (index, score) in game.scores.iter().enumerate() {
                        div { key: "{score.player_id}", class: "row", strong { class: "rank", "#{index + 1}" } div { class: "grow", "{score.display_name}" } strong { class: "points", "{score.points}" } }
                    } }
                }
            },
        }
    } }
}

#[derive(Clone, Debug, Deserialize)]
struct TimeDetailData {
    id: i64,
    player_id: String,
    player_name: String,
    car_name: String,
    race_name: String,
    time_ms: i64,
    created_at: i64,
}

#[component]
fn TimeDetail(id: String) -> Element {
    let mut attempt = use_signal(|| 0_u64);
    let mut car_image = use_signal(|| Option::<String>::None);
    let mut image_error = use_signal(String::new);
    let data = use_resource(move || {
        let id = id.clone();
        async move { get::<TimeDetailData>(&format!("/api/times/{id}")).await }
    });
    let fetch_image = move |car: String, index: u64| {
        spawn(async move {
            let path = format!("/api/car-image/{}?index={index}", urlencoding::encode(&car));
            match get::<serde_json::Value>(&path).await {
                Ok(data) => car_image.set(data["imageUrl"].as_str().map(str::to_owned)),
                Err(error) => image_error.set(error),
            }
        });
    };
    rsx! { section { class: "panel blue-border",
        Link { class: "muted", to: Route::LapTimes {}, "← Back to lap times" }
        match &*data.read() {
            None => rsx! { p { class: "muted", "Loading lap time…" } },
            Some(Err(error)) => rsx! { p { class: "error", "Could not load lap time: {error}" } },
            Some(Ok(time)) => rsx! {
                h1 { "{time.race_name}" }
                p { class: "muted", "{time.player_name} · {time.car_name} · {format_date(time.created_at)}" }
                strong { class: "points", "{format_time(time.time_ms)}" }
                if let Some(image) = car_image() { img { class: "car-image", src: "{image}", alt: "{time.car_name}" } }
                if !image_error().is_empty() { p { class: "error", "{image_error}" } }
                div { class: "inline-form",
                    button { class: "action", onclick: { let car = time.car_name.clone(); move |_| fetch_image(car.clone(), attempt()) }, "Fetch car image" }
                    button { class: "action", onclick: { let car = time.car_name.clone(); move |_| { attempt += 1; fetch_image(car.clone(), attempt()); } }, "Try another image" }
                    button { class: "action", onclick: { let car = time.car_name.clone(); let image = car_image(); move |_| { let car = car.clone(); let image = image.clone(); spawn(async move {
                        let Some(image) = image else { return };
                        match admin_request("/api/car-image/confirm","POST",None,Some(serde_json::json!({"carName":car,"imageUrl":image}))).await {
                            Ok(_) => image_error.set("Image confirmed".into()),
                            Err(reason) => image_error.set(reason),
                        }
                    }); } }, "Confirm image" }
                }
            },
        }
    } }
}

#[derive(Clone, Debug, Deserialize)]
struct Game {
    id: String,
    race_type: String,
    winner_name: Option<String>,
    num_players: i64,
}

#[component]
fn Games() -> Element {
    let games = use_resource(|| async { get::<Vec<Game>>("/api/games").await });
    rsx! { section { class: "panel yellow-border", h1 { "🏁 PAST GAMES" }
        match &*games.read() {
            None => rsx! { p { class: "muted", "Loading games…" } },
            Some(Err(error)) => rsx! { p { class: "error", "Could not load games: {error}" } },
            Some(Ok(games)) if games.is_empty() => rsx! { p { class: "muted", "No games played yet." } },
            Some(Ok(games)) => rsx! { div { class: "list",
                for game in games.iter() {
                    Link { key: "{game.id}", class: "row", to: Route::GameDetail { id: game.id.clone() },
                        div { class: "grow", strong { "{game.race_type}" } p { class: "muted", "{game.num_players} players" } }
                        span { "Winner: {game.winner_name.as_deref().unwrap_or(\"No winner\")}" } }
                }
            } },
        }
    } }
}

#[derive(Clone, Debug, Deserialize)]
struct Lap {
    id: i64,
    player_name: String,
    car_name: String,
    race_name: String,
    time_ms: i64,
}

fn format_time(ms: i64) -> String {
    format!("{}:{:02}.{:03}", ms / 60_000, (ms / 1000) % 60, ms % 1000)
}

#[component]
fn LapTimes() -> Element {
    let laps = use_resource(|| async { get::<Vec<Lap>>("/api/times").await });
    let mut filter = use_signal(String::new);
    rsx! { section { class: "panel blue-border", h1 { "⏱ LAP TIMES" }
        input { class: "filter", placeholder: "Filter by track or car", value: "{filter}", oninput: move |event| filter.set(event.value()) }
        match &*laps.read() {
            None => rsx! { p { class: "muted", "Loading lap times…" } },
            Some(Err(error)) => rsx! { p { class: "error", "Could not load lap times: {error}" } },
            Some(Ok(laps)) => {
                let query = filter().to_lowercase();
                let filtered: Vec<_> = laps.iter().filter(|lap| lap.race_name.to_lowercase().contains(&query) || lap.car_name.to_lowercase().contains(&query)).collect();
                if filtered.is_empty() { rsx! { p { class: "muted", "No matching lap times." } } }
                else { rsx! { div { class: "list",
                    for lap in filtered {
                        Link { key: "{lap.id}", class: "row", to: Route::TimeDetail { id: lap.id.to_string() },
                            div { class: "grow", strong { "{lap.race_name}" } p { class: "muted", "{lap.player_name} · {lap.car_name}" } }
                            strong { class: "points", "{format_time(lap.time_ms)}" } }
                    }
                } } }
            },
        }
    } }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct RoundPlayer {
    id: String,
    display_name: String,
    car_name: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
struct Round {
    id: String,
    race_type: String,
    value: i64,
    status: String,
    #[serde(default)]
    class: Option<String>,
    #[serde(default)]
    year: Option<i64>,
    #[serde(default)]
    series_race: Option<String>,
    #[serde(default)]
    players: Vec<RoundPlayer>,
    #[serde(default)]
    scores: Vec<Score>,
    #[serde(default)]
    user_bets: Vec<Bet>,
    #[serde(default)]
    all_bets: Vec<Bet>,
    #[serde(default)]
    candr: Option<Candr>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct Bet {
    id: i64,
    #[serde(default)]
    predicted_player_id: String,
    #[serde(default)]
    points_wagered: i64,
    #[serde(default)]
    status: String,
    #[serde(default)]
    payout: i64,
    #[serde(default)]
    username: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct Candr {
    #[serde(default)]
    current_tile: Option<String>,
    #[serde(default)]
    previous_tile: Option<String>,
    #[serde(default)]
    robber_name: Option<String>,
    #[serde(default)]
    robber_player_id: Option<String>,
    #[serde(default)]
    started_at: Option<i64>,
    #[serde(default)]
    next_tile_due_at: Option<i64>,
    #[serde(default)]
    elapsed_ms: Option<i64>,
    #[serde(default)]
    total_time_ms: Option<i64>,
}

fn tile_style(tile: &str) -> Option<String> {
    let bytes = tile.as_bytes();
    if !(2..=3).contains(&bytes.len()) || !(b'A'..=b'G').contains(&bytes[0]) {
        return None;
    }
    let col: u8 = tile.get(1..)?.parse().ok()?;
    if !(1..=13).contains(&col) {
        return None;
    }
    let margin = 64.0 / 2112.0 * 100.0;
    let width = 2048.0 / 2112.0 * 100.0 / 13.0;
    let height = 2048.0 / 2112.0 * 100.0 / 7.0;
    let left = margin + (col - 1) as f64 * width;
    let top = margin + (bytes[0] - b'A') as f64 * height;
    Some(format!(
        "left:{left}%;top:{top}%;width:{width}%;height:{height}%"
    ))
}

#[component]
fn CandrPanel(
    round: Round,
    linked_discord: Option<String>,
    on_changed: EventHandler<()>,
) -> Element {
    let mut tile = use_signal(String::new);
    let mut error = use_signal(String::new);
    let mut notice = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let candr = round.candr.clone();
    let is_robber = linked_discord.is_some()
        && candr.as_ref().and_then(|c| c.robber_player_id.as_deref()) == linked_discord.as_deref();
    let can_change = is_robber && round.status == "active";
    let round_id = round.id.clone();
    let cooldown = candr
        .as_ref()
        .and_then(|c| c.next_tile_due_at)
        .map(|due| due - chrono::Utc::now().timestamp_millis())
        .filter(|remaining| *remaining > 0)
        .map(|remaining| format!("Next tile allowed in {}", format_duration(remaining)))
        .unwrap_or_else(|| "Tile changes sync with the shared C&R state.".to_owned());
    let player_names = round
        .players
        .iter()
        .map(|p| (p.id.clone(), p.display_name.clone()))
        .collect::<Vec<_>>();
    let name_of = move |id: &str| {
        player_names
            .iter()
            .find(|(pid, _)| pid == id)
            .map(|(_, name)| name.clone())
            .unwrap_or_else(|| id.to_owned())
    };
    rsx! {
        div { class: "map-wrap",
            img { src: "/api/candr-map", alt: "Forza Horizon 6 Japan Cops and Robbers grid map" }
            if let Some(style) = candr.as_ref().and_then(|c| c.current_tile.as_deref()).and_then(tile_style) {
                div { class: "map-tile", style: "{style}" }
            }
        }
        div { class: "grid",
            div { class: "stat", strong { "{candr.as_ref().and_then(|c| c.current_tile.as_deref()).unwrap_or(\"---\")}" } span { "Current tile" } }
            div { class: "stat", strong { "{candr.as_ref().and_then(|c| c.previous_tile.as_deref()).unwrap_or(\"---\")}" } span { "Previous tile" } }
            div { class: "stat", strong { "{candr.as_ref().and_then(|c| c.robber_name.as_deref()).unwrap_or(\"Unassigned\")}" } span { "Robber" } }
            div { class: "stat", strong { "{format_duration(candr.as_ref().and_then(|c| c.elapsed_ms).unwrap_or(0))}" } span { "Elapsed" } }
        }
        if is_robber {
            h2 { "Set target tile" }
            div { class: "inline-form",
                input { class: "filter tile-input", value: "{tile}", maxlength: "3", placeholder: "A1", disabled: !can_change || busy(), oninput: move |e| tile.set(e.value().to_uppercase()) }
                button { class: "action", disabled: !can_change || busy() || tile().is_empty(), onclick: move |_| {
                    let round_id = round_id.clone();
                    let selected = tile();
                    busy.set(true);
                    error.set(String::new());
                    notice.set(String::new());
                    spawn(async move {
                        match auth_request("/api/candr/tile","POST",Some(serde_json::json!({"roundId":round_id,"tile":selected}))).await {
                            Ok(_) => { notice.set("Tile updated".into()); tile.set(String::new()); on_changed.call(()); }
                            Err(reason) => error.set(reason),
                        }
                        busy.set(false);
                    });
                }, if busy() { "Updating…" } else { "Update tile" } }
            }
            p { class: "muted", "{cooldown}" }
            if !error().is_empty() { p { class: "error", "{error}" } }
            if !notice().is_empty() { p { class: "muted", "{notice}" } }
        }
        p { class: "muted", "Cops: " for player in round.players.iter().filter(|p| Some(p.id.as_str()) != candr.as_ref().and_then(|c| c.robber_player_id.as_deref())) { span { "{name_of(&player.id)} " } } }
        p { class: "muted", "Map imagery: " a { href: "https://mapgenie.io/forza-horizon-6/maps/japan", target: "_blank", rel: "noreferrer", "Map Genie" } }
    }
}

fn format_duration(ms: i64) -> String {
    let seconds = ms.max(0) / 1000;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

#[component]
fn BettingPanel(round: Round, me: Option<AuthUser>, on_changed: EventHandler<()>) -> Element {
    let mut player = use_signal(|| {
        round
            .players
            .first()
            .map(|p| p.id.clone())
            .unwrap_or_default()
    });
    let mut points = use_signal(|| "10".to_owned());
    let mut error = use_signal(String::new);
    let mut notice = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let round_id = round.id.clone();
    let round_status = round.status.clone();
    rsx! {
        h2 { "Betting" }
        if let Some(me) = me {
            p { class: "muted", "You have {me.points} points." }
            if round_status == "pending" {
                div { class: "inline-form",
                    select { class: "filter", value: "{player}", onchange: move |e| player.set(e.value()),
                        for p in round.players.iter() { option { value: "{p.id}", "{p.display_name}" } }
                    }
                    input { class: "filter points-input", r#type: "number", min: "1", value: "{points}", oninput: move |e| points.set(e.value()) }
                    button { class: "action", disabled: busy(), onclick: move |_| {
                        let round_id = round_id.clone();
                        let predicted = player();
                        let Ok(wager) = points().parse::<i64>() else { error.set("Enter a positive number of points".into()); return; };
                        busy.set(true); error.set(String::new()); notice.set(String::new());
                        spawn(async move {
                            match auth_request("/api/bets/place","POST",Some(serde_json::json!({"roundId":round_id,"predictedPlayerId":predicted,"points":wager}))).await {
                                Ok(_) => { notice.set("Bet placed".into()); on_changed.call(()); }
                                Err(reason) => error.set(reason),
                            }
                            busy.set(false);
                        });
                    }, if busy() { "Placing…" } else { "Place bet" } }
                }
            } else {
                p { class: "muted", "Betting is locked once the round starts." }
            }
            if !error().is_empty() { p { class: "error", "{error}" } }
            if !notice().is_empty() { p { class: "muted", "{notice}" } }
        } else {
            p { class: "muted", "Sign in to place a bet." }
            Link { class: "button-link", to: Route::SignIn {}, "Sign in" }
        }
        if !round.all_bets.is_empty() {
            div { class: "list", for bet in round.all_bets.iter() {
                div { key: "{bet.id}", class: "row",
                    div { class: "grow", strong { "{bet.username.as_deref().unwrap_or(\"Unknown\")}" } p { class: "muted", "on {bet.predicted_player_id} · {bet.status}" } }
                    span { class: "points", "{bet.points_wagered} pts" }
                }
            } }
        }
    }
}

#[component]
fn ActiveRound() -> Element {
    let mut version = use_signal(|| 0_u64);
    let round = use_resource(move || {
        let _v = version();
        async move { get::<Round>("/api/current-round").await }
    });
    let me = use_resource(move || {
        let _v = version();
        async move {
            if auth_token().is_none() {
                return Ok::<Option<AuthUser>, String>(None);
            }
            auth_request("/api/auth/me", "GET", None)
                .await
                .and_then(|v| {
                    serde_json::from_value::<MeResponse>(v)
                        .map(|r| Some(r.user))
                        .map_err(|e| e.to_string())
                })
        }
    });
    let link = use_resource(move || {
        let _v = version();
        async move {
            if auth_token().is_none() {
                return Ok::<Option<String>, String>(None);
            }
            auth_request("/api/auth/discord-link", "GET", None)
                .await
                .and_then(|v| {
                    Ok(serde_json::from_value::<LinkInfo>(v)
                        .map_err(|e| e.to_string())?
                        .discord_user_id)
                })
        }
    });
    rsx! { section { class: "panel orange-border", h1 { "⚡ ACTIVE ROUND" }
        match &*round.read() {
            None => rsx! { p { class: "muted", "Loading round…" } },
            Some(Err(error)) if error == "Request failed (404)" => rsx! { p { class: "muted", "No active round available." } },
            Some(Err(error)) => rsx! { p { class: "error", "Could not load active round: {error}" } },
            Some(Ok(round)) => rsx! {
                div { class: "grid",
                    div { class: "stat", strong { "{round.race_type}" } span { "Race type" } }
                    div { class: "stat", strong { "{round.value} CR" } span { "Budget" } }
                    if let Some(class) = round.class.as_deref() { div { class: "stat", strong { "{class}" } span { "Class" } } }
                    if let Some(series) = round.series_race.as_deref() { div { class: "stat", strong { "{series}" } span { "Series race" } } }
                }
                p { class: "muted", "Round ID: {round.id} · {round.status}" }
                if round.race_type.eq_ignore_ascii_case("candr") {
                    CandrPanel { round: round.clone(), linked_discord: link.read().as_ref().and_then(|r| r.as_ref().ok().cloned()).flatten(), on_changed: move |_| version += 1 }
                } else if round.race_type.eq_ignore_ascii_case("goliath") {
                    div { class: "map-wrap", img { src: "/api/candr-map", alt: "Forza Horizon 6 Japan map, Goliath route not marked" } }
                    p { class: "muted", "Japan map (Goliath route not marked). Map imagery: " a { href: "https://mapgenie.io/forza-horizon-6/maps/japan", target: "_blank", rel: "noreferrer", "Map Genie" } }
                }
                div { class: "list", for player in round.players.iter() { div { key: "{player.id}", class: "row", strong { "{player.display_name}" } span { class: "muted", "{player.car_name.as_deref().unwrap_or(\"No car selected\")}" } } } }
                if !round.scores.is_empty() {
                    h2 { "Scores" }
                    div { class: "list", for score in round.scores.iter() { div { key: "{score.player_id}", class: "row", div { class: "grow", "{score.display_name}" } strong { class: "points", "{score.points}" } } } }
                }
                BettingPanel { round: round.clone(), me: me.read().as_ref().and_then(|r| r.as_ref().ok().cloned()).flatten(), on_changed: move |_| version += 1 }
            },
        }
    } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn api_shapes_and_lap_format() {
        let laps: Vec<Lap> = serde_json::from_str(r#"[{"id":1,"player_name":"Driver","car_name":"F40","race_name":"Track","time_ms":94860}]"#).unwrap();
        assert_eq!(format_time(laps[0].time_ms), "1:34.860");
        let games: Vec<Game> = serde_json::from_str(
            r#"[{"id":"a","race_type":"road","winner_name":null,"num_players":2}]"#,
        )
        .unwrap();
        assert_eq!(games[0].num_players, 2);
    }

    #[test]
    fn active_round_shape_with_bets_and_candr_deserializes() {
        let round: Round = serde_json::from_value(serde_json::json!({
            "id":"r","race_type":"candr","value":100000,"status":"active","class":"A",
            "players":[{"id":"p","display_name":"Driver","car_name":"F40"}],
            "scores":[{"player_id":"p","display_name":"Driver","points":1}],
            "user_bets":[{"id":1,"predicted_player_id":"p","points_wagered":10,"status":"pending","payout":0}],
            "all_bets":[{"id":1,"user_id":"u","predicted_player_id":"p","points_wagered":10,"status":"pending","payout":0,"username":"bettor"}],
            "candr":{"robber_player_id":"p","robber_name":"Driver","current_tile":"A1","previous_tile":null,"started_at":1,"next_tile_due_at":121001,"elapsed_ms":5,"total_time_ms":null,"roles":[]}
        })).unwrap();
        assert_eq!(
            round.candr.as_ref().unwrap().current_tile.as_deref(),
            Some("A1")
        );
        assert_eq!(round.all_bets[0].username.as_deref(), Some("bettor"));
        assert!(tile_style("A1").unwrap().contains("left:3.030"));
        assert!(tile_style("G13").is_some());
        assert!(tile_style("H1").is_none());
        let detail: GameDetailData = serde_json::from_value(serde_json::json!({
            "id":"r","class":"A","restrict_class":1,"value":100000,"race_type":"road","winner_id":"p","winner_name":"Driver","created_at":1,
            "players":[{"id":"p","display_name":"Driver","car_name":null}],
            "scores":[{"player_id":"p","display_name":"Driver","points":1}],"candr":null
        })).unwrap();
        assert_eq!(detail.players.len(), 1);
    }

    #[test]
    fn player_api_shape_matches_rsx_types() {
        let data: PlayerResponse = serde_json::from_value(serde_json::json!({
            "player":{"id":"p","display_name":"Driver","avatar_url":null},
            "stats":{"games_played":2,"wins":1,"times_recorded":3,"fastest_time":94860},
            "games":[{"id":"r","race_type":"road","winner_name":null,"num_players":2,"car_name":null}],
            "times":[{"id":1,"car_name":"F40","race_name":"Track","time_ms":94860}],
            "confirmed_images":[],
            "points_progression":[]
        })).unwrap();
        assert_eq!(data.player.display_name, "Driver");
        assert_eq!(format_time(data.times[0].time_ms), "1:34.860");
    }

    #[test]
    fn map_tile_geometry_is_bounded() {
        assert!(tile_style("A1").unwrap().contains("left:3.030"));
        assert!(tile_style("G13").is_some());
        assert!(tile_style("H1").is_none());
        assert!(tile_style("A14").is_none());
    }
}
