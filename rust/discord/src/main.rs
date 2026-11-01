use forzabot_carmedia as carmedia;
use forzabot_discord::candr;
use forzabot_discord::car_selection::{self as cars, Car, Round as CarRound};
use forzabot_discord::game::{self, Game, GameError, SERIES_RACES};
use forzabot_discord::races::{format_past_races, past_races, reset_rounds};
use forzabot_discord::registration::{
    race_id, race_suggestions, register, remove, Action, Session,
};
use forzabot_discord::rounds::{
    format_currency, prepare_round, save_round, Player, RoundRequest, RACE_TYPES,
};
use forzabot_discord::stats as player_stats;
use forzabot_discord::times::best_times;
use forzabot_discord::{load_cars, race_add, race_list, search_response, AddRace};
use rand::seq::SliceRandom;
use rusqlite::{Connection, OptionalExtension};
use serenity::all::{
    ButtonStyle, Command, CommandDataOptionValue, CommandInteraction, CommandOptionType,
    ComponentInteractionDataKind, Context, CreateActionRow, CreateAttachment,
    CreateAutocompleteResponse, CreateButton, CreateCommand, CreateCommandOption, CreateEmbed,
    CreateEmbedFooter, CreateInteractionResponse, CreateInteractionResponseMessage,
    CreateSelectMenu, CreateSelectMenuKind, CreateSelectMenuOption, EditInteractionResponse,
    EventHandler, GatewayIntents, Interaction, Ready,
};
use serenity::async_trait;
use serenity::builder::CreateEmbedAuthor;
use std::{
    collections::HashMap,
    env,
    error::Error,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

struct Handler {
    database: Mutex<Connection>,
    cars: Vec<(String, u64)>,
    registrations: Arc<Mutex<HashMap<String, Session>>>,
    catalog: Vec<Car>,
    selections: Arc<Mutex<HashMap<String, CarSession>>>,
    games: Arc<Mutex<HashMap<String, GameSession>>>,
    stats: Arc<Mutex<HashMap<String, StatsSession>>>,
    car_images: Arc<Mutex<HashMap<String, Option<String>>>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GamePhase {
    Candr,
    Start,
    Winner,
    Picking,
    Summary,
}
struct StatsSession {
    owner: String,
    player: String,
    page: usize,
    data: player_stats::PlayerStats,
}

fn stats_buttons(key: &str, session: &StatsSession) -> Vec<CreateActionRow> {
    vec![CreateActionRow::Buttons(vec![
        CreateButton::new(format!("stats:{key}:prev"))
            .label("◀ Previous")
            .style(ButtonStyle::Secondary)
            .disabled(session.page == 0 || session.data.history.is_empty()),
        CreateButton::new(format!("stats:{key}:next"))
            .label("Next ▶")
            .style(ButtonStyle::Secondary)
            .disabled(
                session.data.history.is_empty() || session.page + 1 >= session.data.history.len(),
            ),
    ])]
}

fn stats_embed(session: &StatsSession, name: &str) -> CreateEmbed {
    let stats = &session.data;
    let mut embed = CreateEmbed::new()
        .title(format!("📊 Stats for {name}"))
        .color(0x3498db)
        .field("Games Played", stats.games.to_string(), true)
        .field("Wins", stats.wins.to_string(), true)
        .field(
            "Win Rate",
            format!("{}%", player_stats::win_rate(stats)),
            true,
        );
    if let Some(race) = stats.history.get(session.page) {
        let date = chrono::DateTime::from_timestamp_millis(race.created_at)
            .map(|d| d.format("%-m/%-d/%Y").to_string())
            .unwrap_or_else(|| "Invalid Date".into());
        embed = embed
            .field(
                "\u{200b}",
                format!("**Race {} of {}**", session.page + 1, stats.history.len()),
                false,
            )
            .field("Class", &race.class, true)
            .field("Value", format_currency(race.value), true)
            .field("Race Type", &race.race_type, true);
        if let Some(year) = race.year {
            embed = embed.field("Year", year.to_string(), true);
        }
        embed = embed
            .field(
                "Car",
                race.car
                    .as_deref()
                    .filter(|c| !c.is_empty())
                    .unwrap_or("No car selected"),
                true,
            )
            .field("Result", if race.won { "🏆 Won" } else { "Lost" }, true)
            .field("Date", date, true)
            .footer(CreateEmbedFooter::new(format!("Round ID: {}", race.id)));
    }
    embed
}

struct GameSession {
    game: Game,
    phase: GamePhase,
    race_index: usize,
    placements: Vec<String>,
    candr: Option<candr::State>,
    candr_map: bool,
}

fn duration(ms: i64) -> String {
    let seconds = ms.max(0) / 1000;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

fn player_name(player: &game::Player) -> &str {
    if player.display_name.is_empty() {
        &player.username
    } else {
        &player.display_name
    }
}

fn game_controls(key: &str, session: &GameSession) -> Vec<CreateActionRow> {
    let game = &session.game;
    if session.phase == GamePhase::Candr {
        let mut rows = vec![CreateActionRow::Buttons(vec![CreateButton::new(format!(
            "game:{key}:cfinish"
        ))
        .label("🏁 Finish Cops and Robbers")
        .style(ButtonStyle::Danger)])];
        let tiles: Vec<String> = ('A'..='G')
            .flat_map(|row| (1..=13).map(move |column| format!("{row}{column}")))
            .collect();
        for (index, chunk) in tiles.chunks(25).enumerate() {
            let options = chunk
                .iter()
                .map(|tile| {
                    CreateSelectMenuOption::new(tile, tile)
                        .description(format!("Set current target to {tile}"))
                })
                .collect();
            rows.push(CreateActionRow::SelectMenu(
                CreateSelectMenu::new(
                    format!("game:{key}:tile~{index}"),
                    CreateSelectMenuKind::String { options },
                )
                .placeholder(format!(
                    "Select target tile ({}-{})",
                    index * 25 + 1,
                    (index * 25 + chunk.len()).min(91)
                )),
            ));
        }
        return rows;
    }
    let buttons = match session.phase {
        GamePhase::Candr => unreachable!(),
        GamePhase::Start => vec![CreateButton::new(format!("game:{key}:finish"))
            .label("🏁 Finish Game")
            .style(ButtonStyle::Primary)],
        GamePhase::Winner | GamePhase::Picking => game
            .players
            .iter()
            .filter(|p| !session.placements.contains(&p.id))
            .map(|p| {
                CreateButton::new(format!("game:{key}:pick~{}", p.id))
                    .label(player_name(p).chars().take(80).collect::<String>())
                    .style(if session.phase == GamePhase::Winner {
                        ButtonStyle::Success
                    } else {
                        ButtonStyle::Primary
                    })
            })
            .collect(),
        GamePhase::Summary => vec![
            CreateButton::new(format!("game:{key}:next"))
                .label("Next Race")
                .style(ButtonStyle::Success),
            CreateButton::new(format!("game:{key}:redo"))
                .label("Redo Race")
                .style(ButtonStyle::Secondary),
        ],
    };
    buttons
        .chunks(5)
        .map(|chunk| CreateActionRow::Buttons(chunk.to_vec()))
        .collect()
}

fn game_embed(session: &GameSession) -> CreateEmbed {
    let game = &session.game;
    match session.phase {
        GamePhase::Candr => {
            let state = session.candr.as_ref().expect("candr session has state");
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let cops = game
                .players
                .iter()
                .filter(|p| p.id != state.robber)
                .map(|p| format!("<@{}>", p.id))
                .collect::<Vec<_>>()
                .join("\n");
            let mut embed = CreateEmbed::new().title("🚨 Cops and Robbers Live").color(0xcc2b2b)
                .description("Robber has a 1 minute grace period before setting the first tile, then must update every 2 minutes. The active tile is highlighted red on the live page.")
                .field("Robber",format!("<@{}>",state.robber),true)
                .field("Current Target Tile",state.current_tile.as_deref().unwrap_or("Not selected yet"),true)
                .field("Next Tile In",state.next_due.map(|due| duration(due-now)).unwrap_or_else(|| "Ready now".into()),true)
                .field("Elapsed Time",duration(now-state.started_at),true)
                .field("Cops",if cops.is_empty() { "None".to_owned() } else { cops },false)
                .footer(CreateEmbedFooter::new(format!("Round ID: {} • Map imagery: Map Genie",game.id)));
            if session.candr_map {
                embed = embed.image("attachment://candr-map.jpg");
            }
            embed
        }
        GamePhase::Start => {
            let all = game.players.iter().all(|p| p.car.is_some());
            let list = game
                .players
                .iter()
                .map(|p| match &p.car {
                    Some(car) => format!("<@{}> - **{car}**", p.id),
                    None => format!("<@{}> - ⚠️ No car selected", p.id),
                })
                .collect::<Vec<_>>()
                .join("\n");
            let mut embed = CreateEmbed::new().title("🏁 Game Starting!").color(if all {
                0x00ff00
            } else {
                0xffaa00
            });
            if game.restrict_class {
                embed = embed.field("Class", &game.class, true);
            }
            embed = embed
                .field("Value", format_currency(game.value), true)
                .field("Race Type", &game.race_type, true);
            if game.race_type.eq_ignore_ascii_case("all") {
                embed = embed.field("Series Race", "DRAG", true);
            }
            if let Some(year) = game.year.filter(|n| *n != 0) {
                embed = embed.field("Year", year.to_string(), true);
            }
            if !all {
                embed = embed.description("⚠️ Warning: Not all players have selected a car!");
            }
            embed
                .field("Players & Cars", list, false)
                .footer(CreateEmbedFooter::new(format!("Round ID: {}", game.id)))
        }
        GamePhase::Winner => CreateEmbed::new()
            .title("🏆 Select the Winner")
            .description("Choose which player won this round:")
            .color(0xffd700),
        GamePhase::Picking => CreateEmbed::new()
            .title(format!(
                "Select place {} - {}",
                session.placements.len() + 1,
                SERIES_RACES[session.race_index].to_uppercase()
            ))
            .description("Pick the next finishing position.")
            .color(0xff8c00),
        GamePhase::Summary => CreateEmbed::new()
            .title(format!(
                "Race Complete: {}",
                SERIES_RACES[session.race_index].to_uppercase()
            ))
            .description("Race results recorded. Continue or redo the race.")
            .color(0x00ff99),
    }
}

fn winner_embed(
    game: &Game,
    winner: &str,
    car: &str,
    avatar: Option<&str>,
    image: Option<&str>,
) -> CreateEmbed {
    let mut embed = CreateEmbed::new()
        .title("🏆 Game Finished!")
        .description(format!("**Winner: <@{winner}>**"))
        .color(0xffd700)
        .field("Winning Car", format!("**{car}**"), false)
        .field("Value", format_currency(game.value), true)
        .field("Race Type", &game.race_type, true)
        .footer(CreateEmbedFooter::new(format!("Round ID: {}", game.id)));
    if let Some(avatar) = avatar {
        embed = embed.thumbnail(avatar);
    }
    if let Some(image) = image {
        embed = embed.image(image);
    }
    embed
}

fn series_embed(
    round_id: &str,
    name: &str,
    car: &str,
    avatar: Option<&str>,
    image: Option<&str>,
) -> CreateEmbed {
    let mut embed = CreateEmbed::new()
        .title("🏆 Series Complete")
        .description(format!("Winner: **{name}**"))
        .color(0xffd700)
        .field("Winning Car", format!("**{car}**"), false)
        .footer(CreateEmbedFooter::new(format!("Round ID: {round_id}")));
    if let Some(avatar) = avatar {
        embed = embed.thumbnail(avatar);
    }
    if let Some(image) = image {
        embed = embed.image(image);
    }
    embed
}

#[derive(Clone)]
struct CarSession {
    owner: String,
    round: CarRound,
    cars: Vec<Car>,
    index: usize,
    preset: bool,
}

fn car_embed(session: &CarSession, image: Option<&str>) -> CreateEmbed {
    let car = &session.cars[session.index];
    let mut embed = CreateEmbed::new()
        .title(&car.name)
        .description(format!(
            "Car {} of {} (Max: {})",
            session.index + 1,
            session.cars.len(),
            format_currency(session.round.value as i64)
        ))
        .field(
            "Performance Index",
            if car.pi.is_empty() { "N/A" } else { &car.pi },
            true,
        )
        .field("Car Price", format_currency(car.value as i64), true)
        .field(
            "Remaining Upgrades",
            format_currency(session.round.value as i64 - car.value as i64),
            true,
        );
    if let Some(image) = image {
        embed = embed.image(image);
    }
    embed
}

fn car_buttons(id: &str, session: &CarSession) -> Vec<CreateActionRow> {
    if session.preset {
        let options = session
            .cars
            .iter()
            .enumerate()
            .map(|(i, car)| {
                CreateSelectMenuOption::new(
                    car.name.chars().take(100).collect::<String>(),
                    i.to_string(),
                )
                .description(format!(
                    "{} • {}",
                    if car.pi.is_empty() { "N/A" } else { &car.pi },
                    format_currency(car.value as i64)
                ))
            })
            .collect();
        return vec![CreateActionRow::SelectMenu(
            CreateSelectMenu::new(
                format!("car:{id}:select"),
                CreateSelectMenuKind::String { options },
            )
            .placeholder("Select a preset car"),
        )];
    }
    vec![CreateActionRow::Buttons(vec![
        CreateButton::new(format!("car:{id}:cancel"))
            .label("❌")
            .style(ButtonStyle::Danger),
        CreateButton::new(format!("car:{id}:accept"))
            .label("✓")
            .style(ButtonStyle::Success),
        CreateButton::new(format!("car:{id}:prev"))
            .label("◀")
            .style(ButtonStyle::Secondary)
            .disabled(session.index == 0),
        CreateButton::new(format!("car:{id}:next"))
            .label("▶")
            .style(ButtonStyle::Secondary)
            .disabled(session.index + 1 >= session.cars.len()),
    ])]
}

fn chosen_car_embed(car: &Car, round: &CarRound, method: &str, image: Option<&str>) -> CreateEmbed {
    let title = match method {
        "random" => "🎲 Random Car Selected",
        "preset" => "Preset Car Selected",
        _ => "Car Selected",
    };
    let mut embed = CreateEmbed::new()
        .title(title)
        .description(format!(
            "{} **{}**\nRound ID: {}",
            if method == "random" {
                "You got:"
            } else {
                "You selected:"
            },
            car.name,
            round.id
        ))
        .color(match method {
            "random" => 0x9b59b6,
            "preset" => 0x00c853,
            _ => 0x00ff00,
        })
        .field(
            "Performance Index",
            if car.pi.is_empty() { "N/A" } else { &car.pi },
            true,
        )
        .field("Car Price", format_currency(car.value as i64), true)
        .field(
            "Remaining Upgrades",
            format_currency(round.value as i64 - car.value as i64),
            true,
        );
    if method == "random" && car.availability.to_lowercase().contains("dlc") {
        embed = embed.field(
            "⚠ DLC Warning",
            "this car is dlc, you might not be able to use it",
            false,
        );
    }
    if let Some(image) = image {
        embed = embed.image(image);
    }
    embed
}

fn string_option<'a>(command: &'a CommandInteraction, name: &str) -> Option<&'a str> {
    command
        .data
        .options
        .iter()
        .find_map(|option| match (&*option.name, &option.value) {
            (option_name, CommandDataOptionValue::String(value)) if option_name == name => {
                Some(value.as_str())
            }
            _ => None,
        })
}

fn integer_option(command: &CommandInteraction, name: &str) -> Option<i64> {
    command
        .data
        .options
        .iter()
        .find_map(|option| match (&*option.name, &option.value) {
            (option_name, CommandDataOptionValue::Integer(value)) if option_name == name => {
                Some(*value)
            }
            _ => None,
        })
}

fn bool_option(command: &CommandInteraction, name: &str) -> Option<bool> {
    command
        .data
        .options
        .iter()
        .find_map(|option| match (&*option.name, &option.value) {
            (option_name, CommandDataOptionValue::Boolean(value)) if option_name == name => {
                Some(*value)
            }
            _ => None,
        })
}

fn private_link_context(context: Option<serenity::all::InteractionContext>) -> bool {
    context == Some(serenity::all::InteractionContext::BotDm)
}

fn race_icon(race: &str) -> Option<(String, Vec<u8>)> {
    if race.eq_ignore_ascii_case("goliath") {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
        let path = forzabot_core::seasonal_map_path(now);
        return std::fs::read(path)
            .ok()
            .map(|data| ("race-fh6-japan.jpg".to_owned(), data));
    }
    let alias = match race {
        "road" | "street" | "time-attack" => "circuit",
        "dirt" | "touge" => "rally",
        "cross-country" => "offroad",
        other => other,
    };
    let entries: Vec<_> = std::fs::read_dir("media/races").ok()?.flatten().collect();
    for key in [race, alias] {
        for entry in &entries {
            let path = entry.path();
            if path.is_file()
                && path
                    .file_stem()
                    .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(key))
            {
                let name = format!("race-{}", path.file_name()?.to_string_lossy());
                return Some((name, std::fs::read(path).ok()?));
            }
        }
    }
    None
}

fn response(message: &str, ephemeral: bool) -> CreateInteractionResponseMessage {
    CreateInteractionResponseMessage::new()
        .content(message)
        .ephemeral(ephemeral)
}

fn registration_embed(session: &Session, image: Option<&str>) -> CreateEmbed {
    let detail = if session.removal {
        "Select to remove your time".to_owned()
    } else {
        format!("Laptime: {}ms", session.milliseconds)
    };
    let mut embed = CreateEmbed::new()
        .title(&session.cars[session.index])
        .description(format!(
            "Car {} of {}\n{}",
            session.index + 1,
            session.cars.len(),
            detail
        ));
    if let Some(image) = image {
        embed = embed.image(image);
    }
    embed
}

fn registration_buttons(id: &str, session: &Session) -> Vec<CreateActionRow> {
    vec![CreateActionRow::Buttons(vec![
        CreateButton::new(format!("reg:{id}:cancel"))
            .label("❌")
            .style(ButtonStyle::Danger),
        CreateButton::new(format!("reg:{id}:accept"))
            .label(if session.removal {
                "🗑️ Delete"
            } else {
                "✓"
            })
            .style(if session.removal {
                ButtonStyle::Danger
            } else {
                ButtonStyle::Success
            }),
        CreateButton::new(format!("reg:{id}:prev"))
            .label("◀")
            .style(ButtonStyle::Secondary)
            .disabled(session.index == 0),
        CreateButton::new(format!("reg:{id}:next"))
            .label("▶")
            .style(ButtonStyle::Secondary)
            .disabled(session.index + 1 >= session.cars.len()),
    ])]
}

impl Handler {
    async fn car_image(&self, car: &str) -> Option<String> {
        if let Some(cached) = self
            .car_images
            .lock()
            .ok()
            .and_then(|cache| cache.get(car).cloned())
        {
            return cached;
        }
        let base = env::var("IMAGE_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".into());
        let confirmed = self
            .database
            .lock()
            .ok()
            .and_then(|db| carmedia::confirmed(&db, car, &base).ok().flatten());
        let image = match confirmed {
            Some(image) => Some(image),
            None => carmedia::remote(car, 0).await,
        };
        if let Ok(mut cache) = self.car_images.lock() {
            cache.insert(car.to_owned(), image.clone());
        }
        image
    }

    async fn handle(
        &self,
        command: &CommandInteraction,
    ) -> Result<CreateInteractionResponseMessage, Box<dyn Error>> {
        match command.data.name.as_str() {
            "linkweb" => {
                if !private_link_context(command.context) {
                    return Ok(response(
                        "For your security, redeem the code in a direct message with the bot.",
                        true,
                    ));
                }
                let code = string_option(command, "code").ok_or("missing link code")?;
                let mut database = self.database.lock().map_err(|_| "database lock poisoned")?;
                let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
                let result = forzabot_database::discord_link::complete(
                    &mut database,
                    code,
                    &command.user.id.to_string(),
                    now,
                )?;
                use forzabot_database::discord_link::Completion;
                let message = match result {
                    Completion::Linked => "Discord account linked successfully. You can return to the dashboard.",
                    Completion::InvalidOrExpired => "That code is invalid, expired, or already used. Request a new code on the dashboard.",
                    Completion::PlayerNotFound => "Your Discord account must participate in a round before it can be linked.",
                    Completion::DiscordAlreadyLinked => "This Discord account is already linked to another web account.",
                    Completion::DisplayNameTaken => "Another linked player has the same display name; an administrator must resolve the existing conflict.",
                };
                Ok(response(message, true))
            }
            "ping" => Ok(response("Pong!", false)),
            "forza" => Ok(response("Forza", false)),
            "searchcar" => {
                let query = string_option(command, "query").ok_or("missing query")?;
                let result = search_response(&self.cars, query);
                let mut embed = CreateEmbed::new()
                    .title(result.title)
                    .description(result.description);
                if let Some(footer) = result.footer {
                    embed = embed.footer(CreateEmbedFooter::new(footer));
                }
                if let Some(top) = forzabot_core::search_cars(
                    self.cars
                        .iter()
                        .map(|(name, value)| (name.as_str(), *value)),
                    query,
                    None,
                )
                .first()
                {
                    if let Some(image) = self.car_image(top).await {
                        embed = embed.image(image);
                    }
                }
                Ok(CreateInteractionResponseMessage::new().embed(embed))
            }
            "addrace" => {
                let name = string_option(command, "name").ok_or("missing race name")?;
                let description = string_option(command, "description").filter(|s| !s.is_empty());
                let id = uuid::Uuid::new_v4().to_string();
                let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
                let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                match race_add(
                    &database,
                    &id,
                    name,
                    description,
                    &command.user.id.to_string(),
                    now,
                )? {
                    AddRace::Exists => Ok(CreateInteractionResponseMessage::new()
                        .ephemeral(true)
                        .embed(
                            CreateEmbed::new()
                                .title("Race Already Exists")
                                .description(format!("A race named **{name}** already exists!"))
                                .color(0xff0000),
                        )),
                    AddRace::Added => {
                        let mut embed = CreateEmbed::new()
                            .title("✅ Race Added")
                            .color(0x00ff00)
                            .field("Race Name", name, true)
                            .field("Race ID", id, true);
                        if let Some(description) = description {
                            embed = embed.field("Description", description, false);
                        }
                        Ok(CreateInteractionResponseMessage::new().embed(embed))
                    }
                }
            }
            "listrace" => {
                let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                let races = race_list(&database)?;
                if races.is_empty() {
                    return Ok(CreateInteractionResponseMessage::new()
                        .ephemeral(true)
                        .embed(
                            CreateEmbed::new()
                                .title("No Races Found")
                                .description(
                                    "No races have been created yet. Use `/addrace` to create one!",
                                )
                                .color(0xff9900),
                        ));
                }
                let list = races
                    .iter()
                    .enumerate()
                    .map(|(i, race)| {
                        let description = race
                            .description
                            .as_ref()
                            .filter(|s| !s.is_empty())
                            .map(|s| format!("\n{s}"))
                            .unwrap_or_default();
                        format!(
                            "**{}. {}**{}\n📊 Times recorded: {}",
                            i + 1,
                            race.name,
                            description,
                            race.time_count
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                Ok(CreateInteractionResponseMessage::new().embed(
                    CreateEmbed::new()
                        .title("🏁 Available Races")
                        .description(list)
                        .color(0x3498db)
                        .footer(CreateEmbedFooter::new(format!(
                            "Total races: {}",
                            races.len()
                        ))),
                ))
            }
            "times" => {
                let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                let result = best_times(
                    &database,
                    &self.cars,
                    string_option(command, "race"),
                    string_option(command, "car"),
                )?;
                let mut embed = CreateEmbed::new()
                    .title(result.title)
                    .description(result.description)
                    .color(result.color);
                if let Some(footer) = result.footer {
                    embed = embed.footer(CreateEmbedFooter::new(footer));
                }
                Ok(CreateInteractionResponseMessage::new()
                    .ephemeral(result.ephemeral)
                    .embed(embed))
            }
            "pastraces" => {
                let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                let races = past_races(&database, integer_option(command, "limit"))?;
                if races.is_empty() {
                    return Ok(response("No finished races yet!", true));
                }
                let suffix = if races.len() == 1 { "" } else { "s" };
                Ok(CreateInteractionResponseMessage::new().embed(
                    CreateEmbed::new()
                        .title("🏁 Past Races")
                        .description(format_past_races(&races))
                        .color(0x9b59b6)
                        .footer(CreateEmbedFooter::new(format!(
                            "Showing {} most recent race{suffix}",
                            races.len()
                        ))),
                ))
            }
            "resetround" => {
                let mut database = self.database.lock().map_err(|_| "database lock poisoned")?;
                let Some(results) = reset_rounds(&mut database)? else {
                    return Ok(response("No active rounds to reset.", true));
                };
                let mut embed = CreateEmbed::new()
                    .title("⚡ Rounds Reset")
                    .color(0xff6b6b)
                    .description(format!(
                        "Finished **{}** active round(s) with random winners:",
                        results.len()
                    ))
                    .footer(CreateEmbedFooter::new(
                        "Server has been recovered from reboot",
                    ));
                for result in results {
                    embed = embed.field(
                        format!("**{}** • {}", result.class, result.race_type),
                        format!("Winner: {}", result.winner),
                        false,
                    );
                }
                Ok(CreateInteractionResponseMessage::new().embed(embed))
            }
            "startround" => {
                let mut players = Vec::new();
                for index in 1..=8 {
                    let name = format!("player{index}");
                    if let Some(id) = command.data.options.iter().find_map(|option| {
                        match (&*option.name, &option.value) {
                            (option_name, CommandDataOptionValue::User(id))
                                if option_name == name =>
                            {
                                Some(id)
                            }
                            _ => None,
                        }
                    }) {
                        let user = command
                            .data
                            .resolved
                            .users
                            .get(id)
                            .ok_or("player information missing")?;
                        players.push(Player {
                            id: id.to_string(),
                            username: user.name.clone(),
                            display_name: user.display_name().to_owned(),
                            avatar: format!("{}?size=256", user.face()),
                        });
                    }
                }
                let request = RoundRequest {
                    id: uuid::Uuid::new_v4().to_string(),
                    race_type: string_option(command, "race_type"),
                    brand: string_option(command, "brand"),
                    year: integer_option(command, "year"),
                    restrict_class: bool_option(command, "restrict_class").unwrap_or(false),
                    creator: command.user.id.to_string(),
                    created_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64,
                    players,
                };
                let round = match prepare_round(request, &self.cars, &mut rand::thread_rng()) {
                    Ok(round) => round,
                    Err(error) => return Ok(response(&error, true)),
                };
                let mut database = self.database.lock().map_err(|_| "database lock poisoned")?;
                save_round(&mut database, &round)?;
                let mut embed = CreateEmbed::new().title("Forza Round").color(round.color);
                if round.restrict_class {
                    embed = embed.field("Class", &round.class, true);
                }
                embed = embed
                    .field("Value", format_currency(round.value), true)
                    .field("Race Type", &round.race_type, true);
                if let Some(brand) = round.brand.as_ref().filter(|s| !s.is_empty()) {
                    embed = embed.field("Brand", brand, true);
                }
                if let Some(year) = round.year.filter(|year| *year != 0) {
                    embed = embed.field("Year", year.to_string(), true);
                }
                embed = embed
                    .field(
                        "Players",
                        round
                            .players
                            .iter()
                            .map(|p| format!("<@{}>", p.id))
                            .collect::<Vec<_>>()
                            .join("\n"),
                        false,
                    )
                    .footer(CreateEmbedFooter::new(format!("Round ID: {}", round.id)));
                if round.race_type.eq_ignore_ascii_case("goliath") {
                    embed = embed.field("Map", "Forza Horizon 6 Japan map; Goliath route not marked. Map imagery: Map Genie.", false);
                }
                let mut reply = CreateInteractionResponseMessage::new();
                if let Some((name, bytes)) = race_icon(&round.race_type) {
                    embed = embed.image(format!("attachment://{name}"));
                    reply = reply.add_file(CreateAttachment::bytes(bytes, name));
                }
                Ok(reply.embed(embed))
            }
            "registertime" => {
                let name = string_option(command, "race").ok_or("missing race")?;
                let time = string_option(command, "laptime").ok_or("missing laptime")?;
                let Some(milliseconds) =
                    forzabot_core::parse_time(time).filter(|n| *n <= i64::MAX as u64)
                else {
                    return Ok(CreateInteractionResponseMessage::new().ephemeral(true).embed(CreateEmbed::new()
                        .title("Invalid Laptime Format").description(format!("Invalid time format: **{time}**\n\nUse format: **MM:SS.MS**\nExamples: `1:34.860`, `12:12.398`, `0:45.120`"))
                        .color(0xff0000)));
                };
                let id = {
                    let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                    let Some(id) = race_id(&database, name)? else {
                        return Ok(CreateInteractionResponseMessage::new()
                            .ephemeral(true)
                            .embed(
                                CreateEmbed::new()
                                    .title("Race Not Found")
                                    .description(format!(
                                        "No race named **{name}** exists. Use /addrace first!"
                                    ))
                                    .color(0xff0000),
                            ));
                    };
                    id
                };
                let query = string_option(command, "car_query").filter(|s| !s.is_empty());
                let cars: Vec<String> = if let Some(query) = query {
                    forzabot_core::search_cars(
                        self.cars
                            .iter()
                            .map(|(name, value)| (name.as_str(), *value)),
                        query,
                        None,
                    )
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
                } else {
                    self.cars.iter().map(|(name, _)| name.clone()).collect()
                };
                if cars.is_empty() {
                    if let Some(query) = query {
                        return Ok(CreateInteractionResponseMessage::new()
                            .ephemeral(true)
                            .embed(
                                CreateEmbed::new()
                                    .title("No Cars Found")
                                    .description(format!("No cars found matching \"**{query}**\""))
                                    .color(0xff9900),
                            ));
                    }
                    return Ok(response("No cars available!", true));
                }
                let session = Session {
                    owner: command.user.id.to_string(),
                    race_id: id,
                    race_name: name.into(),
                    milliseconds,
                    removal: false,
                    cars,
                    index: 0,
                };
                let image = self.car_image(&session.cars[0]).await;
                let key = command.id.to_string();
                let reply = CreateInteractionResponseMessage::new()
                    .embed(registration_embed(&session, image.as_deref()))
                    .components(registration_buttons(&key, &session));
                self.registrations
                    .lock()
                    .map_err(|_| "registration lock poisoned")?
                    .insert(key, session);
                Ok(reply)
            }
            "removetime" => {
                let name = string_option(command, "race").ok_or("missing race")?;
                let id = {
                    let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                    let Some(id) = race_id(&database, name)? else {
                        return Ok(CreateInteractionResponseMessage::new()
                            .ephemeral(true)
                            .embed(
                                CreateEmbed::new()
                                    .title("Race Not Found")
                                    .description(format!("No race named **{name}** exists."))
                                    .color(0xff0000),
                            ));
                    };
                    id
                };
                let query = string_option(command, "car_query").filter(|s| !s.is_empty());
                let cars: Vec<String> = if let Some(query) = query {
                    forzabot_core::search_cars(
                        self.cars
                            .iter()
                            .map(|(name, value)| (name.as_str(), *value)),
                        query,
                        None,
                    )
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
                } else {
                    self.cars.iter().map(|(name, _)| name.clone()).collect()
                };
                if cars.is_empty() {
                    if let Some(query) = query {
                        return Ok(CreateInteractionResponseMessage::new()
                            .ephemeral(true)
                            .embed(
                                CreateEmbed::new()
                                    .title("No Cars Found")
                                    .description(format!("No cars found matching \"**{query}**\""))
                                    .color(0xff9900),
                            ));
                    }
                    return Ok(response("No cars available!", true));
                }
                let session = Session {
                    owner: command.user.id.to_string(),
                    race_id: id,
                    race_name: name.into(),
                    milliseconds: 0,
                    removal: true,
                    cars,
                    index: 0,
                };
                let image = self.car_image(&session.cars[0]).await;
                let key = command.id.to_string();
                let reply = CreateInteractionResponseMessage::new()
                    .embed(registration_embed(&session, image.as_deref()))
                    .components(registration_buttons(&key, &session));
                self.registrations
                    .lock()
                    .map_err(|_| "registration lock poisoned")?
                    .insert(key, session);
                Ok(reply)
            }
            "choosecar" => {
                let query = string_option(command, "query").filter(|s| !s.is_empty());
                let random = bool_option(command, "random").unwrap_or(false);
                let preset = bool_option(command, "preset").unwrap_or(false);
                if query.is_none() && !random && !preset {
                    return Ok(response(
                        "Please provide a car query, enable random, or enable preset selection.",
                        true,
                    ));
                }
                let (round, chosen) = {
                    let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                    let Some(round) = cars::current_round(&database)? else {
                        return Ok(response(
                            "No active round found. Please start a round first.",
                            true,
                        ));
                    };
                    let chosen = cars::selected_cars(&database, &round.id)?;
                    (round, chosen)
                };
                if random && !preset {
                    let anchor = {
                        let database =
                            self.database.lock().map_err(|_| "database lock poisoned")?;
                        cars::random_anchor(&database, &round.id)?
                    };
                    let (valid, _) =
                        cars::random_candidates(&self.catalog, &round, &chosen, anchor.as_deref());
                    let Some(car) = valid.choose(&mut rand::thread_rng()) else {
                        return Ok(CreateInteractionResponseMessage::new()
                            .ephemeral(true)
                            .embed(
                                CreateEmbed::new()
                                    .title("No cars available")
                                    .description("No cars found within the round constraints."),
                            ));
                    };
                    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
                    let saved = {
                        let mut database =
                            self.database.lock().map_err(|_| "database lock poisoned")?;
                        cars::save_choice(
                            &mut database,
                            &round,
                            &command.user.id.to_string(),
                            car,
                            "random",
                            now,
                        )?
                    };
                    if !saved {
                        return Ok(response(
                            "No active round found. Please start a round first.",
                            true,
                        ));
                    }
                    let image = self.car_image(&car.name).await;
                    let mut embed = chosen_car_embed(car, &round, "random", image.as_deref());
                    if let Some(anchor) =
                        anchor.and_then(|name| self.catalog.iter().find(|car| car.name == name))
                    {
                        embed = embed.field(
                            "Balance Anchor",
                            format!(
                                "{} ({}, {})",
                                anchor.name,
                                if anchor.pi.is_empty() {
                                    "N/A"
                                } else {
                                    &anchor.pi
                                },
                                format_currency(anchor.value as i64)
                            ),
                            false,
                        );
                    }
                    return Ok(CreateInteractionResponseMessage::new().embed(embed));
                }
                let candidates = if preset {
                    cars::preset_candidates(&self.catalog, &round, &chosen, &mut rand::thread_rng())
                } else {
                    cars::manual_candidates(&self.catalog, query.unwrap_or(""), Some(&round))
                };
                if candidates.is_empty() {
                    return Ok(CreateInteractionResponseMessage::new()
                        .ephemeral(true)
                        .embed(
                            CreateEmbed::new()
                                .title("No cars available")
                                .description("No cars found within the round constraints."),
                        ));
                }
                let session = CarSession {
                    owner: command.user.id.to_string(),
                    round,
                    cars: candidates.into_iter().cloned().collect(),
                    index: 0,
                    preset,
                };
                let key = command.id.to_string();
                let embed = if preset {
                    CreateEmbed::new()
                        .title("Preset Car Selection")
                        .description(format!(
                            "Choose one preset car for round {}.",
                            session.round.id
                        ))
                        .color(0x5865f2)
                        .field(
                            "Round Budget",
                            format_currency(session.round.value as i64),
                            true,
                        )
                        .field("Available Presets", session.cars.len().to_string(), true)
                } else {
                    let image = self.car_image(&session.cars[0].name).await;
                    car_embed(&session, image.as_deref())
                };
                let reply = CreateInteractionResponseMessage::new()
                    .embed(embed)
                    .components(car_buttons(&key, &session));
                self.selections
                    .lock()
                    .map_err(|_| "selection lock poisoned")?
                    .insert(key, session);
                Ok(reply)
            }
            "gamestart" => {
                let (game, avatars, candr_state, map) = {
                    let mut db = self.database.lock().map_err(|_| "database lock poisoned")?;
                    let game = match game::start(&mut db) {
                        Ok(game) => game,
                        Err(GameError::NoPendingRound) => return Ok(response(
                            "No pending round found. Please start a round first with `/startround`.",
                            true,
                        )),
                        Err(GameError::NoPlayers) => {
                            return Ok(response("No players found for this round.", true))
                        }
                        Err(error) => return Err(error.into()),
                    };
                    let avatars: HashMap<String, String> = game
                        .players
                        .iter()
                        .filter_map(|player| {
                            db.query_row(
                                "SELECT avatar_url FROM discord_avatars WHERE player_id=?",
                                [&player.id],
                                |row| row.get::<_, String>(0),
                            )
                            .optional()
                            .ok()
                            .flatten()
                            .map(|url| (player.id.clone(), url))
                        })
                        .collect();
                    let candr_state = if game.race_type.eq_ignore_ascii_case("candr") {
                        candr::load(&db, &game.id)?
                    } else {
                        None
                    };
                    let map = if candr_state.is_some() {
                        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
                        std::fs::read(forzabot_core::seasonal_map_path(now)).ok()
                    } else {
                        None
                    };
                    (game, avatars, candr_state, map)
                };
                let session = GameSession {
                    game,
                    phase: if candr_state.is_some() {
                        GamePhase::Candr
                    } else {
                        GamePhase::Start
                    },
                    race_index: 0,
                    placements: Vec::new(),
                    candr: candr_state,
                    candr_map: map.is_some(),
                };
                let mut player_embeds = Vec::new();
                for player in &session.game.players {
                    let mut embed = CreateEmbed::new()
                        .author(
                            CreateEmbedAuthor::new(player_name(player))
                                .icon_url(avatars.get(&player.id).cloned().unwrap_or_default()),
                        )
                        .color(0x3498db);
                    if let Some(car) = player.car.as_deref() {
                        embed = embed.title(car);
                        if let Some(image) = self.car_image(car).await {
                            embed = embed.thumbnail(image);
                        }
                    } else {
                        embed = embed.title("⚠️ No car selected");
                    }
                    player_embeds.push(embed);
                }
                let key = command.id.to_string();
                let mut reply = CreateInteractionResponseMessage::new()
                    .embed(game_embed(&session))
                    .components(game_controls(&key, &session));
                for embed in player_embeds {
                    reply = reply.add_embed(embed);
                }
                if let Some(map) = map {
                    reply = reply.add_file(CreateAttachment::bytes(map, "candr-map.jpg"));
                }
                self.games
                    .lock()
                    .map_err(|_| "game lock poisoned")?
                    .insert(key, session);
                Ok(reply)
            }
            "stats" => {
                let database = self.database.lock().map_err(|_| "database lock poisoned")?;
                let Some(user) = command.data.options.iter().find_map(|option| {
                    match (&*option.name, &option.value) {
                        (name, CommandDataOptionValue::User(id)) if name == "player" => Some(*id),
                        _ => None,
                    }
                }) else {
                    let rows = player_stats::leaderboard(&database)?;
                    if rows.is_empty() {
                        return Ok(response("No finished games yet!", true));
                    }
                    let text = rows
                        .iter()
                        .enumerate()
                        .map(|(i, row)| {
                            let medal = match i {
                                0 => "🥇".into(),
                                1 => "🥈".into(),
                                2 => "🥉".into(),
                                _ => format!("{}.", i + 1),
                            };
                            format!(
                                "{medal} <@{}> - **{} win{}**",
                                row.id,
                                row.wins,
                                if row.wins == 1 { "" } else { "s" }
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    return Ok(CreateInteractionResponseMessage::new().embed(
                        CreateEmbed::new()
                            .title("🏆 Leaderboard")
                            .description(text)
                            .color(0xffd700),
                    ));
                };
                let id = user.to_string();
                let name =
                    player_stats::display_name(&database, &id)?.unwrap_or_else(|| id.clone());
                let Some(data) = player_stats::player(&database, &id)? else {
                    return Ok(response(
                        &format!("<@{id}> hasn't played any games yet!"),
                        true,
                    ));
                };
                drop(database);
                let key = command.id.to_string();
                let session = StatsSession {
                    owner: command.user.id.to_string(),
                    player: id.clone(),
                    page: 0,
                    data,
                };
                let reply =
                    CreateInteractionResponseMessage::new().embed(stats_embed(&session, &name));
                let reply = if session.data.history.is_empty() {
                    reply
                } else {
                    reply.components(stats_buttons(&key, &session))
                };
                self.stats
                    .lock()
                    .map_err(|_| "stats lock poisoned")?
                    .insert(key, session);
                Ok(reply)
            }
            _ => Ok(response(
                "This command has not yet been ported to the Rust bot.",
                true,
            )),
        }
    }
}

#[async_trait]
impl EventHandler for Handler {
    async fn ready(&self, _: Context, ready: Ready) {
        println!("Logged in as {}!", ready.user.name);
    }

    async fn interaction_create(&self, ctx: Context, interaction: Interaction) {
        let command = match interaction {
            Interaction::Autocomplete(command) => {
                let focused = command
                    .data
                    .autocomplete()
                    .map(|option| option.value)
                    .unwrap_or("");
                let choices = self
                    .database
                    .lock()
                    .ok()
                    .and_then(|db| race_suggestions(&db, focused).ok())
                    .unwrap_or_default();
                let mut reply = CreateAutocompleteResponse::new();
                for choice in choices {
                    reply = reply.add_string_choice(&choice, &choice);
                }
                if let Err(error) = command
                    .create_response(&ctx.http, CreateInteractionResponse::Autocomplete(reply))
                    .await
                {
                    eprintln!("Autocomplete error: {error}");
                }
                return;
            }
            Interaction::Component(component) => {
                let parts: Vec<_> = component.data.custom_id.split(':').collect();
                if parts.len() == 3 && parts[0] == "game" {
                    // Prefetch game-result imagery outside the synchronous handler.
                    // Single-race finishes need the chosen winner; the final race
                    // pick needs every player because the series winner is only
                    // determined after the last placement is recorded.
                    let mut prefetched_images: HashMap<String, (Option<String>, Option<String>)> =
                        HashMap::new();
                    if parts[2].starts_with("pick~") {
                        let plan = self.games.lock().ok().and_then(|sessions| {
                            sessions.get(parts[1]).and_then(|session| {
                                let players = session.game.players.clone();
                                match session.phase {
                                    GamePhase::Winner => players
                                        .iter()
                                        .find(|player| format!("pick~{}", player.id) == parts[2])
                                        .map(|player| vec![player.clone()]),
                                    GamePhase::Picking
                                        if session.race_index + 1 == SERIES_RACES.len()
                                            && session.placements.len() + 1 == players.len() =>
                                    {
                                        Some(players)
                                    }
                                    _ => None,
                                }
                            })
                        });
                        if let Some(players) = plan {
                            for player in players {
                                let avatar = self.database.lock().ok().and_then(|db| {
                                    db.query_row(
                                        "SELECT avatar_url FROM discord_avatars WHERE player_id=?",
                                        [&player.id],
                                        |row| row.get::<_, String>(0),
                                    )
                                    .optional()
                                    .ok()
                                    .flatten()
                                });
                                let image = match player.car.as_deref() {
                                    Some(car) => self.car_image(car).await,
                                    None => None,
                                };
                                prefetched_images.insert(player.id, (image, avatar));
                            }
                        }
                    }
                    let result = (|| -> Result<CreateInteractionResponse, Box<dyn Error>> {
                        let mut sessions = self.games.lock().map_err(|_| "game lock poisoned")?;
                        let Some(session) = sessions.get_mut(parts[1]) else {
                            return Ok(CreateInteractionResponse::Message(response(
                                "This game control has expired.",
                                true,
                            )));
                        };
                        let actor = component.user.id.to_string();
                        if session.phase == GamePhase::Candr && parts[2].starts_with("tile~") {
                            let ComponentInteractionDataKind::StringSelect { values } =
                                &component.data.kind
                            else {
                                return Ok(CreateInteractionResponse::Message(response(
                                    "Invalid tile selected.",
                                    true,
                                )));
                            };
                            let Some(tile) = values.first() else {
                                return Ok(CreateInteractionResponse::Message(response(
                                    "Invalid tile selected.",
                                    true,
                                )));
                            };
                            let mut db =
                                self.database.lock().map_err(|_| "database lock poisoned")?;
                            let now =
                                SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
                            match candr::set_tile(&mut db, &session.game.id, &actor, tile, now) {
                                Ok(state) => session.candr = Some(state),
                                Err(candr::Error::NotRobber) => {
                                    return Ok(CreateInteractionResponse::Message(response(
                                        "Only the robber can set the target tile.",
                                        true,
                                    )))
                                }
                                Err(candr::Error::InvalidTile) => {
                                    return Ok(CreateInteractionResponse::Message(response(
                                        "Invalid tile selected.",
                                        true,
                                    )))
                                }
                                Err(candr::Error::Wait(wait)) => {
                                    return Ok(CreateInteractionResponse::Message(response(
                                        &format!(
                                            "You must wait {} before selecting a tile.",
                                            duration(wait)
                                        ),
                                        true,
                                    )))
                                }
                                Err(error) => return Err(error.into()),
                            }
                            return Ok(CreateInteractionResponse::UpdateMessage(
                                CreateInteractionResponseMessage::new()
                                    .embed(game_embed(session))
                                    .components(game_controls(parts[1], session)),
                            ));
                        }
                        if session.phase == GamePhase::Candr && parts[2] == "cfinish" {
                            let mut db =
                                self.database.lock().map_err(|_| "database lock poisoned")?;
                            let now =
                                SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
                            let (elapsed, tile) =
                                match candr::finish(&mut db, &session.game.id, &actor, now) {
                                    Ok(result) => result,
                                    Err(candr::Error::NotCreator) => {
                                        return Ok(CreateInteractionResponse::Message(response(
                                            "Only the person who started this round can finish it!",
                                            true,
                                        )))
                                    }
                                    Err(error) => return Err(error.into()),
                                };
                            let embed = CreateEmbed::new()
                                .title("🚓 Cops and Robbers Finished")
                                .color(0x2ecc71)
                                .description("Round complete. Total C&R time has been registered.")
                                .field("Total Time", duration(elapsed), true)
                                .field("Last Target Tile", tile.as_deref().unwrap_or("None"), true)
                                .footer(CreateEmbedFooter::new(format!(
                                    "Round ID: {}",
                                    session.game.id
                                )));
                            sessions.remove(parts[1]);
                            return Ok(CreateInteractionResponse::UpdateMessage(
                                CreateInteractionResponseMessage::new()
                                    .embed(embed)
                                    .components(vec![]),
                            ));
                        }
                        if session.game.creator.as_deref() != Some(&actor) {
                            return Ok(CreateInteractionResponse::Message(response(
                                "Only the person who started this round can record results!",
                                true,
                            )));
                        }
                        match (session.phase, parts[2]) {
                            (GamePhase::Start, "finish") => {
                                session.phase =
                                    if session.game.race_type.eq_ignore_ascii_case("all") {
                                        GamePhase::Picking
                                    } else {
                                        GamePhase::Winner
                                    };
                            }
                            (GamePhase::Summary, "next") => {
                                session.race_index += 1;
                                session.placements.clear();
                                session.phase = GamePhase::Picking;
                            }
                            (GamePhase::Summary, "redo") => {
                                session.placements.clear();
                                session.phase = GamePhase::Picking;
                            }
                            (GamePhase::Winner, action) if action.starts_with("pick~") => {
                                let winner = &action[5..];
                                let car = session
                                    .game
                                    .players
                                    .iter()
                                    .find(|p| p.id == winner)
                                    .and_then(|p| p.car.as_deref())
                                    .unwrap_or("No car selected")
                                    .to_owned();
                                let avatar = {
                                    let mut db = self
                                        .database
                                        .lock()
                                        .map_err(|_| "database lock poisoned")?;
                                    game::finish_single(&mut db, &session.game, &actor, winner)?;
                                    db.query_row(
                                        "SELECT avatar_url FROM discord_avatars WHERE player_id=?",
                                        [winner],
                                        |row| row.get::<_, String>(0),
                                    )
                                    .optional()
                                    .ok()
                                    .flatten()
                                };
                                let (image, prefetched_avatar) = prefetched_images
                                    .get(winner)
                                    .cloned()
                                    .unwrap_or((None, None));
                                let embed = winner_embed(
                                    &session.game,
                                    winner,
                                    &car,
                                    avatar.as_deref().or(prefetched_avatar.as_deref()),
                                    image.as_deref(),
                                );
                                sessions.remove(parts[1]);
                                return Ok(CreateInteractionResponse::UpdateMessage(
                                    CreateInteractionResponseMessage::new()
                                        .embed(embed)
                                        .components(vec![]),
                                ));
                            }
                            (GamePhase::Picking, action) if action.starts_with("pick~") => {
                                let player = &action[5..];
                                if !session.game.players.iter().any(|p| p.id == player)
                                    || session.placements.iter().any(|p| p == player)
                                {
                                    return Ok(CreateInteractionResponse::Message(response(
                                        "Invalid player selection.",
                                        true,
                                    )));
                                }
                                let mut placements = session.placements.clone();
                                placements.push(player.to_owned());
                                if placements.len() == session.game.players.len() {
                                    let mut db = self
                                        .database
                                        .lock()
                                        .map_err(|_| "database lock poisoned")?;
                                    let now =
                                        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()
                                            as i64;
                                    game::record_race(
                                        &mut db,
                                        &session.game,
                                        &actor,
                                        session.race_index,
                                        &placements,
                                        now,
                                    )?;
                                    if session.race_index + 1 == SERIES_RACES.len() {
                                        let winner =
                                            game::finish_series(&mut db, &session.game, &actor)?;
                                        let name = session
                                            .game
                                            .players
                                            .iter()
                                            .find(|p| p.id == winner)
                                            .map(player_name)
                                            .unwrap_or(&winner);
                                        let winner_car = session
                                            .game
                                            .players
                                            .iter()
                                            .find(|p| p.id == winner)
                                            .and_then(|p| p.car.as_deref())
                                            .unwrap_or("No car selected")
                                            .to_owned();
                                        let (image, avatar) = prefetched_images
                                            .get(&winner)
                                            .cloned()
                                            .unwrap_or((None, None));
                                        let embed = series_embed(
                                            &session.game.id,
                                            name,
                                            &winner_car,
                                            avatar.as_deref(),
                                            image.as_deref(),
                                        );
                                        sessions.remove(parts[1]);
                                        return Ok(CreateInteractionResponse::UpdateMessage(
                                            CreateInteractionResponseMessage::new()
                                                .embed(embed)
                                                .components(vec![]),
                                        ));
                                    }
                                    session.phase = GamePhase::Summary;
                                }
                                session.placements = placements;
                            }
                            _ => {
                                return Ok(CreateInteractionResponse::Message(response(
                                    "This game action is no longer available.",
                                    true,
                                )))
                            }
                        }
                        Ok(CreateInteractionResponse::UpdateMessage(
                            CreateInteractionResponseMessage::new()
                                .embed(game_embed(session))
                                .components(game_controls(parts[1], session)),
                        ))
                    })();
                    let reply = result.unwrap_or_else(|error| {
                        eprintln!("Game interaction error: {error}");
                        CreateInteractionResponse::Message(response(
                            "Could not record the game result. Please try again.",
                            true,
                        ))
                    });
                    if let Err(error) = component.create_response(&ctx.http, reply).await {
                        eprintln!("Game response error: {error}");
                    }
                    return;
                }
                if parts.len() == 3 && parts[0] == "stats" {
                    let result = (|| -> Result<CreateInteractionResponse, Box<dyn Error>> {
                        let mut sessions = self.stats.lock().map_err(|_| "stats lock poisoned")?;
                        let Some(session) = sessions.get_mut(parts[1]) else {
                            return Ok(CreateInteractionResponse::Message(response(
                                "This stats view has expired.",
                                true,
                            )));
                        };
                        if session.owner != component.user.id.to_string() {
                            return Ok(CreateInteractionResponse::Message(response(
                                "This isn't your stats view!",
                                true,
                            )));
                        }
                        match parts[2] {
                            "prev" => session.page = session.page.saturating_sub(1),
                            "next" => {
                                session.page = (session.page + 1)
                                    .min(session.data.history.len().saturating_sub(1))
                            }
                            _ => {
                                return Ok(CreateInteractionResponse::Message(response(
                                    "Unknown stats action.",
                                    true,
                                )))
                            }
                        }
                        let name = self
                            .database
                            .lock()
                            .ok()
                            .and_then(|db| {
                                player_stats::display_name(&db, &session.player)
                                    .ok()
                                    .flatten()
                            })
                            .unwrap_or_else(|| session.player.clone());
                        Ok(CreateInteractionResponse::UpdateMessage(
                            CreateInteractionResponseMessage::new()
                                .embed(stats_embed(session, &name))
                                .components(stats_buttons(parts[1], session)),
                        ))
                    })();
                    let reply = result.unwrap_or_else(|error| {
                        eprintln!("Stats interaction error: {error}");
                        CreateInteractionResponse::Message(response(
                            "An error occurred while executing this command.",
                            true,
                        ))
                    });
                    if let Err(error) = component.create_response(&ctx.http, reply).await {
                        eprintln!("Stats response error: {error}");
                    }
                    return;
                }
                if parts.len() == 3 && parts[0] == "car" {
                    let result: Result<CreateInteractionResponse, Box<dyn Error>> = async {
                        let session = {
                            let mut sessions = self
                                .selections
                                .lock()
                                .map_err(|_| "selection lock poisoned")?;
                            let Some(session) = sessions.get_mut(parts[1]) else {
                                return Ok(CreateInteractionResponse::Message(response(
                                    "This car selection has expired.",
                                    true,
                                )));
                            };
                            if session.owner != component.user.id.to_string() {
                                return Ok(CreateInteractionResponse::Message(response(
                                    "This isn't your car selection!",
                                    true,
                                )));
                            }
                            match parts[2] {
                                "prev" if !session.preset => {
                                    session.index = session.index.saturating_sub(1);
                                }
                                "next" if !session.preset => {
                                    session.index = (session.index + 1).min(session.cars.len() - 1);
                                }
                                "cancel" if !session.preset => {
                                    sessions.remove(parts[1]);
                                    return Ok(CreateInteractionResponse::UpdateMessage(
                                        CreateInteractionResponseMessage::new()
                                            .embed(
                                                CreateEmbed::new()
                                                    .title("Selection Cancelled")
                                                    .description("You didn't select a car.")
                                                    .color(0xff0000),
                                            )
                                            .components(vec![]),
                                    ));
                                }
                                "accept" if !session.preset => {}
                                "select" if session.preset => {
                                    let ComponentInteractionDataKind::StringSelect { values } =
                                        &component.data.kind
                                    else {
                                        return Ok(CreateInteractionResponse::Message(response(
                                            "Invalid selection.",
                                            true,
                                        )));
                                    };
                                    let index = values
                                        .first()
                                        .and_then(|value| value.parse::<usize>().ok())
                                        .filter(|index| *index < session.cars.len());
                                    let Some(index) = index else {
                                        return Ok(CreateInteractionResponse::Message(response(
                                            "Selected car is no longer available.",
                                            true,
                                        )));
                                    };
                                    session.index = index;
                                }
                                _ => {
                                    return Ok(CreateInteractionResponse::Message(response(
                                        "Unknown action.",
                                        true,
                                    )))
                                }
                            }
                            session.clone()
                        };
                        let image = self.car_image(&session.cars[session.index].name).await;
                        if matches!(parts[2], "accept" | "select") {
                            let car = session.cars[session.index].clone();
                            let method = if session.preset { "preset" } else { "manual" };
                            let now =
                                SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
                            let saved = {
                                let mut db =
                                    self.database.lock().map_err(|_| "database lock poisoned")?;
                                cars::save_choice(
                                    &mut db,
                                    &session.round,
                                    &session.owner,
                                    &car,
                                    method,
                                    now,
                                )?
                            };
                            if let Ok(mut sessions) = self.selections.lock() {
                                sessions.remove(parts[1]);
                            }
                            if !saved {
                                return Ok(CreateInteractionResponse::UpdateMessage(
                                    CreateInteractionResponseMessage::new()
                                        .content(
                                            "No active round found. Please start a round first.",
                                        )
                                        .embeds(vec![])
                                        .components(vec![]),
                                ));
                            }
                            let embed =
                                chosen_car_embed(&car, &session.round, method, image.as_deref());
                            return Ok(CreateInteractionResponse::UpdateMessage(
                                CreateInteractionResponseMessage::new()
                                    .embed(embed)
                                    .components(vec![]),
                            ));
                        }
                        Ok(CreateInteractionResponse::UpdateMessage(
                            CreateInteractionResponseMessage::new()
                                .embed(car_embed(&session, image.as_deref()))
                                .components(car_buttons(parts[1], &session)),
                        ))
                    }
                    .await;
                    let reply = result.unwrap_or_else(|error| {
                        eprintln!("Car selection error: {error}");
                        CreateInteractionResponse::Message(response(
                            "An error occurred while executing this command.",
                            true,
                        ))
                    });
                    if let Err(error) = component.create_response(&ctx.http, reply).await {
                        eprintln!("Car selection response error: {error}");
                    }
                    return;
                }
                if parts.len() != 3 || parts[0] != "reg" {
                    return;
                }
                let result: Result<CreateInteractionResponse, Box<dyn Error>> = async {
                    let (action, session) = {
                        let mut sessions = self
                            .registrations
                            .lock()
                            .map_err(|_| "registration lock poisoned")?;
                        let Some(session) = sessions.get_mut(parts[1]) else {
                            return Ok(CreateInteractionResponse::Message(response(
                                "This time registration has expired.",
                                true,
                            )));
                        };
                        let action = session.apply(&component.user.id.to_string(), parts[2]);
                        let snapshot = session.clone();
                        (action, snapshot)
                    };
                    if action == Action::Cancel {
                        if let Ok(mut sessions) = self.registrations.lock() {
                            sessions.remove(parts[1]);
                        }
                    }
                    let image = self.car_image(&session.cars[session.index]).await;
                    let update = match action {
                        Action::Unauthorized => {
                            return Ok(CreateInteractionResponse::Message(response(
                                if session.removal {
                                    "This isn't your time removal!"
                                } else {
                                    "This isn't your time registration!"
                                },
                                true,
                            )))
                        }
                        Action::Previous | Action::Next => CreateInteractionResponseMessage::new()
                            .embed(registration_embed(&session, image.as_deref()))
                            .components(registration_buttons(parts[1], &session)),
                        Action::Cancel => {
                            let removal = session.removal;
                            CreateInteractionResponseMessage::new()
                                .embed(
                                    CreateEmbed::new()
                                        .title(if removal {
                                            "Cancelled"
                                        } else {
                                            "Registration Cancelled"
                                        })
                                        .description(if removal {
                                            "Time removal cancelled."
                                        } else {
                                            "You didn't register a time."
                                        })
                                        .color(if removal { 0x3498db } else { 0xff0000 }),
                                )
                                .components(vec![])
                        }
                        Action::Accept => {
                            let mut database =
                                self.database.lock().map_err(|_| "database lock poisoned")?;
                            let embed = if session.removal {
                                let deleted = remove(&mut database, &session)?;
                                if deleted {
                                    CreateEmbed::new()
                                        .title("🗑️ Time Deleted")
                                        .description(format!(
                                            "Your time for **{}** on **{}** has been removed.",
                                            session.cars[session.index], session.race_name
                                        ))
                                        .color(0xff0000)
                                } else {
                                    CreateEmbed::new()
                                        .title("No Time Found")
                                        .description(format!(
                                            "You don't have a recorded time for **{}** on **{}**",
                                            session.cars[session.index], session.race_name
                                        ))
                                        .color(0xff9900)
                                }
                            } else {
                                let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis()
                                    as i64;
                                let updated = register(&mut database, &session, now)?;
                                let ms = session.milliseconds;
                                let mut embed = CreateEmbed::new()
                                    .title(if updated {
                                        "⏱️ Time Updated"
                                    } else {
                                        "⏱️ Time Registered"
                                    })
                                    .description(format!(
                                        "**{}** on **{}**",
                                        session.cars[session.index], session.race_name
                                    ))
                                    .field(
                                        "Laptime",
                                        format!(
                                            "{}:{:02}.{:03}",
                                            ms / 60000,
                                            (ms % 60000) / 1000,
                                            ms % 1000
                                        ),
                                        true,
                                    )
                                    .field("Player", format!("<@{}>", session.owner), true)
                                    .color(if updated { 0x3498db } else { 0x00ff00 });
                                if let Some(image) = image.as_deref() {
                                    embed = embed.image(image);
                                }
                                embed
                            };
                            drop(database);
                            if let Ok(mut sessions) = self.registrations.lock() {
                                sessions.remove(parts[1]);
                            }
                            CreateInteractionResponseMessage::new()
                                .embed(embed)
                                .components(vec![])
                        }
                        Action::Unknown => {
                            return Ok(CreateInteractionResponse::Message(response(
                                "Unknown action.",
                                true,
                            )))
                        }
                    };
                    Ok(CreateInteractionResponse::UpdateMessage(update))
                }
                .await;
                let reply = result.unwrap_or_else(|error| {
                    eprintln!("Registration error: {error}");
                    CreateInteractionResponse::Message(response(
                        "An error occurred while executing this command.",
                        true,
                    ))
                });
                if let Err(error) = component.create_response(&ctx.http, reply).await {
                    eprintln!("Component response error: {error}");
                }
                return;
            }
            Interaction::Command(command) => command,
            _ => return,
        };
        let reply = match self.handle(&command).await {
            Ok(reply) => reply,
            Err(error) => {
                eprintln!("Error handling {}: {error}", command.data.name);
                response("An error occurred while executing this command.", true)
            }
        };
        if let Err(error) = command
            .create_response(&ctx.http, CreateInteractionResponse::Message(reply))
            .await
        {
            eprintln!("Error responding to {}: {error}", command.data.name);
            if let Ok(mut sessions) = self.registrations.lock() {
                sessions.remove(&command.id.to_string());
            }
            if let Ok(mut sessions) = self.selections.lock() {
                sessions.remove(&command.id.to_string());
            }
            if let Ok(mut sessions) = self.games.lock() {
                sessions.remove(&command.id.to_string());
            }
        } else if command.data.name == "gamestart" {
            let sessions = Arc::clone(&self.games);
            let http = ctx.http.clone();
            let timeout = sessions
                .lock()
                .ok()
                .and_then(|s| {
                    s.get(&command.id.to_string()).map(|game| {
                        if game.phase == GamePhase::Candr {
                            12 * 3600
                        } else {
                            3600
                        }
                    })
                })
                .unwrap_or(3600);
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(timeout)).await;
                let expired = sessions
                    .lock()
                    .ok()
                    .and_then(|mut sessions| sessions.remove(&command.id.to_string()))
                    .is_some();
                if expired {
                    let edit = EditInteractionResponse::new()
                        .embed(
                            CreateEmbed::new()
                                .title("Game controls expired")
                                .description("The round remains active.")
                                .color(0xff9900),
                        )
                        .components(vec![]);
                    if let Err(error) = command.edit_response(&http, edit).await {
                        eprintln!("Game timeout error: {error}");
                    }
                }
            });
        } else if command.data.name == "choosecar" {
            let sessions = Arc::clone(&self.selections);
            let http = ctx.http.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                let expired = sessions
                    .lock()
                    .ok()
                    .and_then(|mut sessions| sessions.remove(&command.id.to_string()));
                if let Some(session) = expired {
                    let edit = EditInteractionResponse::new()
                        .embed(
                            CreateEmbed::new()
                                .title("Selection Timed Out")
                                .description(if session.preset {
                                    "You took too long to select a preset car."
                                } else {
                                    "You took too long to select a car."
                                })
                                .color(0xff9900),
                        )
                        .components(vec![]);
                    if let Err(error) = command.edit_response(&http, edit).await {
                        eprintln!("Car selection timeout error: {error}");
                    }
                }
            });
        } else if command.data.name == "registertime" || command.data.name == "removetime" {
            let sessions = Arc::clone(&self.registrations);
            let http = ctx.http.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                let expired = sessions
                    .lock()
                    .ok()
                    .and_then(|mut s| s.remove(&command.id.to_string()));
                if let Some(session) = expired {
                    let edit = EditInteractionResponse::new()
                        .embed(
                            CreateEmbed::new()
                                .title(if session.removal {
                                    "Removal Timed Out"
                                } else {
                                    "Registration Timed Out"
                                })
                                .description(if session.removal {
                                    "You took too long to remove a time."
                                } else {
                                    "You took too long to register a time."
                                })
                                .color(0xff9900),
                        )
                        .components(vec![]);
                    if let Err(error) = command.edit_response(&http, edit).await {
                        eprintln!("Registration timeout error: {error}");
                    }
                }
            });
        }
    }
}

fn commands() -> Vec<CreateCommand> {
    use serenity::all::{InstallationContext, InteractionContext};
    let common = |name, description| {
        CreateCommand::new(name)
            .description(description)
            .integration_types(vec![InstallationContext::Guild, InstallationContext::User])
            .contexts(vec![
                InteractionContext::Guild,
                InteractionContext::BotDm,
                InteractionContext::PrivateChannel,
            ])
    };
    let mut start = common("startround", "Start a new Forza round")
        .add_option(
            CreateCommandOption::new(CommandOptionType::User, "player1", "Player 1").required(true),
        )
        .add_option(
            CreateCommandOption::new(CommandOptionType::User, "player2", "Player 2").required(true),
        );
    let mut race_type =
        CreateCommandOption::new(CommandOptionType::String, "race_type", "Choose a race type");
    for (name, value) in RACE_TYPES {
        race_type = race_type.add_string_choice(name, value);
    }
    start = start
        .add_option(race_type)
        .add_option(CreateCommandOption::new(
            CommandOptionType::Integer,
            "year",
            "Restrict to a specific model year",
        ))
        .add_option(CreateCommandOption::new(
            CommandOptionType::String,
            "brand",
            "Restrict to a brand (e.g. Aston Martin, Audi)",
        ));
    for index in 3..=8 {
        start = start.add_option(CreateCommandOption::new(
            CommandOptionType::User,
            format!("player{index}"),
            format!("Player {index}"),
        ));
    }
    start = start.add_option(CreateCommandOption::new(
        CommandOptionType::Boolean,
        "restrict_class",
        "Restrict to a specific car class (default: true)",
    ));
    vec![
        common("ping", "Replies with Pong!"),
        common("forza", "tests forzabot"),
        common("searchcar", "Search cars by name").add_option(
            CreateCommandOption::new(CommandOptionType::String, "query", "Search text")
                .required(true),
        ),
        common("addrace", "Add a new race/track")
            .add_option(
                CreateCommandOption::new(
                    CommandOptionType::String,
                    "name",
                    "Name of the race/track",
                )
                .required(true),
            )
            .add_option(CreateCommandOption::new(
                CommandOptionType::String,
                "description",
                "Description of the race",
            )),
        common("listrace", "List all available races/tracks"),
        common("times", "View recorded times")
            .add_option(CreateCommandOption::new(
                CommandOptionType::String,
                "race",
                "Filter by race name",
            ))
            .add_option(CreateCommandOption::new(
                CommandOptionType::String,
                "car",
                "Filter by car name",
            )),
        common("pastraces", "View past races").add_option(CreateCommandOption::new(
            CommandOptionType::Integer,
            "limit",
            "Number of races to show",
        )),
        common(
            "resetround",
            "Reset active rounds (Server recovery after reboot)",
        ),
        start,
        common("registertime", "Register a laptime for a race")
            .add_option(
                CreateCommandOption::new(
                    CommandOptionType::String,
                    "race",
                    "Name of the race/track",
                )
                .required(true)
                .set_autocomplete(true),
            )
            .add_option(
                CreateCommandOption::new(
                    CommandOptionType::String,
                    "laptime",
                    "Laptime in format MM:SS.MS (e.g., 1:34.860 or 12:12.398)",
                )
                .required(true),
            )
            .add_option(CreateCommandOption::new(
                CommandOptionType::String,
                "car_query",
                "Search for a specific car (optional)",
            )),
        common("removetime", "Remove a recorded lap time")
            .add_option(
                CreateCommandOption::new(
                    CommandOptionType::String,
                    "race",
                    "Name of the race/track",
                )
                .required(true)
                .set_autocomplete(true),
            )
            .add_option(CreateCommandOption::new(
                CommandOptionType::String,
                "car_query",
                "Search for a specific car (optional)",
            )),
        common("choosecar", "Search and choose a car interactively")
            .add_option(CreateCommandOption::new(
                CommandOptionType::String,
                "query",
                "Search text",
            ))
            .add_option(CreateCommandOption::new(
                CommandOptionType::Boolean,
                "random",
                "Select a random car within budget",
            ))
            .add_option(CreateCommandOption::new(
                CommandOptionType::Boolean,
                "preset",
                "Select from a preset list of budget cars",
            )),
        common("gamestart", "Start the game with all players locked in"),
        common("stats", "View player statistics and leaderboard").add_option(
            CreateCommandOption::new(
                CommandOptionType::User,
                "player",
                "Player to view stats for (or 'all' for leaderboard)",
            ),
        ),
        common("linkweb", "Link your Discord account to the dashboard")
            .contexts(vec![InteractionContext::BotDm])
            .add_option(
                CreateCommandOption::new(
                    CommandOptionType::String,
                    "code",
                    "One-time dashboard link code",
                )
                .required(true),
            ),
    ]
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let token = env::var("TOKEN").map_err(|_| "TOKEN must be set")?;
    let args: Vec<_> = env::args().skip(1).collect();
    if args == ["--register-ported-commands"] {
        let client_id = env::var("CLIENT_ID")?.parse::<u64>()?;
        let http = serenity::http::Http::new(&token);
        http.set_application_id(client_id.into());
        // Individual upserts do not remove commands that have not yet been ported.
        for command in commands() {
            Command::create_global_command(&http, command).await?;
        }
        println!("Registered ported Discord commands.");
        return Ok(());
    }
    if !args.is_empty() {
        return Err("Usage: forzabot-discord [--register-ported-commands]".into());
    }
    let mut database =
        Connection::open(env::var("DATABASE_PATH").unwrap_or_else(|_| "forzabot.db".into()))?;
    forzabot_database::initialize(&mut database).map_err(|error| {
        format!(
            "Failed to initialize database at {}: {error}. \
             Ensure the database and its directory are writable by the bot user (UID 999).",
            env::var("DATABASE_PATH").unwrap_or_else(|_| "forzabot.db".into())
        )
    })?;
    let cars = load_cars("output.csv")?;
    let catalog = cars::load_catalog("output.csv")?;
    let mut client = serenity::Client::builder(&token, GatewayIntents::GUILDS)
        .event_handler(Handler {
            database: Mutex::new(database),
            cars,
            registrations: Arc::new(Mutex::new(HashMap::new())),
            catalog,
            selections: Arc::new(Mutex::new(HashMap::new())),
            games: Arc::new(Mutex::new(HashMap::new())),
            stats: Arc::new(Mutex::new(HashMap::new())),
            car_images: Arc::new(Mutex::new(HashMap::new())),
        })
        .await?;
    let shard_manager = client.shard_manager.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            shard_manager.shutdown_all().await;
        }
    });
    client.start().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_commands_preserve_existing_shapes() {
        let commands: Vec<serde_json::Value> = commands()
            .iter()
            .map(|command| serde_json::to_value(command).unwrap())
            .collect();
        let names: Vec<_> = commands
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "ping",
                "forza",
                "searchcar",
                "addrace",
                "listrace",
                "times",
                "pastraces",
                "resetround",
                "startround",
                "registertime",
                "removetime",
                "choosecar",
                "gamestart",
                "stats",
                "linkweb"
            ]
        );
        for command in &commands[..14] {
            assert_eq!(command["integration_types"], serde_json::json!([0, 1]));
            assert_eq!(command["contexts"], serde_json::json!([0, 1, 2]));
        }
        assert_eq!(commands[2]["options"][0]["name"], "query");
        assert_eq!(commands[2]["options"][0]["type"], 3);
        assert_eq!(commands[2]["options"][0]["required"], true);
        assert_eq!(commands[3]["options"][0]["name"], "name");
        assert_eq!(commands[3]["options"][1]["name"], "description");
        assert_eq!(commands[5]["options"][0]["name"], "race");
        assert_eq!(commands[5]["options"][1]["name"], "car");
        assert_eq!(commands[6]["options"][0]["type"], 4);
        assert_eq!(commands[8]["options"].as_array().unwrap().len(), 12);
        assert_eq!(commands[8]["options"][0]["name"], "player1");
        assert_eq!(
            commands[8]["options"][2]["choices"]
                .as_array()
                .unwrap()
                .len(),
            10
        );
        assert_eq!(commands[8]["options"][11]["name"], "restrict_class");
        assert_eq!(commands[9]["options"][0]["autocomplete"], true);
        assert_eq!(commands[10]["options"][0]["autocomplete"], true);
        assert_eq!(commands[11]["options"][2]["name"], "preset");
        assert_eq!(commands[14]["contexts"], serde_json::json!([1]));
        assert_eq!(commands[14]["options"][0]["required"], true);
        assert_eq!(commands[13]["options"][0]["name"], "player");
        assert!(private_link_context(Some(
            serenity::all::InteractionContext::BotDm
        )));
        assert!(!private_link_context(Some(
            serenity::all::InteractionContext::Guild
        )));
        assert!(!private_link_context(Some(
            serenity::all::InteractionContext::PrivateChannel
        )));
        assert!(!private_link_context(None));
    }

    #[test]
    fn registration_buttons_have_session_ids_and_boundaries() {
        let session = Session {
            owner: "user".into(),
            race_id: "race".into(),
            race_name: "Track".into(),
            milliseconds: 1234,
            removal: false,
            cars: vec!["one".into(), "two".into()],
            index: 0,
        };
        let json = serde_json::to_value(registration_buttons("123", &session)).unwrap();
        let buttons = json[0]["components"].as_array().unwrap();
        assert_eq!(buttons[0]["custom_id"], "reg:123:cancel");
        assert_eq!(buttons[1]["custom_id"], "reg:123:accept");
        assert_eq!(buttons[2]["disabled"], true);
        assert_eq!(buttons[3]["disabled"], false);
        let mut removal = session;
        removal.removal = true;
        let json = serde_json::to_value(registration_buttons("123", &removal)).unwrap();
        assert_eq!(json[0]["components"][1]["label"], "🗑️ Delete");
        assert_eq!(json[0]["components"][1]["style"], 4);
    }

    #[test]
    fn winner_and_series_embeds_include_car_and_avatar_images() {
        let game = Game {
            id: "round".into(),
            class: "A".into(),
            value: 100_000,
            race_type: "all".into(),
            year: None,
            creator: Some("owner".into()),
            restrict_class: true,
            players: vec![game::Player {
                id: "p".into(),
                username: "driver".into(),
                display_name: "Driver".into(),
                car: Some("Ferrari F40 1987".into()),
            }],
        };
        let win = serde_json::to_value(winner_embed(
            &game,
            "p",
            "Ferrari F40 1987",
            Some("https://cdn.example.com/avatar.png"),
            Some("https://cdn.example.com/f40.jpg"),
        ))
        .unwrap();
        assert_eq!(
            win["thumbnail"]["url"],
            "https://cdn.example.com/avatar.png"
        );
        assert_eq!(win["image"]["url"], "https://cdn.example.com/f40.jpg");
        assert!(win["description"].as_str().unwrap().contains("<@p>"));
        assert_eq!(win["fields"][0]["name"], "Winning Car");

        let series = serde_json::to_value(series_embed(
            "round",
            "Driver",
            "Ferrari F40 1987",
            Some("https://cdn.example.com/avatar.png"),
            Some("https://cdn.example.com/f40.jpg"),
        ))
        .unwrap();
        assert_eq!(
            series["thumbnail"]["url"],
            "https://cdn.example.com/avatar.png"
        );
        assert_eq!(series["image"]["url"], "https://cdn.example.com/f40.jpg");
        assert_eq!(series["fields"][0]["value"], "**Ferrari F40 1987**");
        assert!(series["description"].as_str().unwrap().contains("Driver"));

        let plain = serde_json::to_value(series_embed(
            "round",
            "Driver",
            "No car selected",
            None,
            None,
        ))
        .unwrap();
        assert!(plain.get("image").is_none());
        assert!(plain.get("thumbnail").is_none());
    }

    #[test]
    fn car_and_registration_embeds_include_resolved_images() {
        let round = CarRound {
            id: "round".into(),
            value: 200_000,
            year: None,
            brand: None,
            class: "A".into(),
            restrict_class: false,
        };
        let car = Car {
            name: "Ferrari F40 1987".into(),
            value: 100_000,
            pi: "A700".into(),
            year: Some(1987),
            availability: String::new(),
        };
        let session = CarSession {
            owner: "owner".into(),
            round: round.clone(),
            cars: vec![car.clone()],
            index: 0,
            preset: false,
        };
        let embed =
            serde_json::to_value(car_embed(&session, Some("https://example.com/f40.jpg"))).unwrap();
        assert_eq!(embed["image"]["url"], "https://example.com/f40.jpg");
        let embed = serde_json::to_value(chosen_car_embed(
            &car,
            &round,
            "manual",
            Some("https://example.com/f40.jpg"),
        ))
        .unwrap();
        assert_eq!(embed["image"]["url"], "https://example.com/f40.jpg");
        let registration = Session {
            owner: "p".into(),
            race_id: "r".into(),
            race_name: "Track".into(),
            milliseconds: 1000,
            removal: false,
            cars: vec!["Ferrari F40 1987".into()],
            index: 0,
        };
        let embed = serde_json::to_value(registration_embed(
            &registration,
            Some("https://example.com/f40.jpg"),
        ))
        .unwrap();
        assert_eq!(embed["image"]["url"], "https://example.com/f40.jpg");
    }

    #[test]
    fn car_selection_controls_have_boundaries_and_preset_options() {
        let round = CarRound {
            id: "round".into(),
            value: 200_000,
            year: None,
            brand: None,
            class: "A".into(),
            restrict_class: false,
        };
        let car = Car {
            name: "Test Car".into(),
            value: 100_000,
            pi: "A700".into(),
            year: None,
            availability: String::new(),
        };
        let mut session = CarSession {
            owner: "owner".into(),
            round,
            cars: vec![car],
            index: 0,
            preset: false,
        };
        let json = serde_json::to_value(car_buttons("123", &session)).unwrap();
        assert_eq!(json[0]["components"][1]["custom_id"], "car:123:accept");
        assert_eq!(json[0]["components"][2]["disabled"], true);
        assert_eq!(json[0]["components"][3]["disabled"], true);
        session.preset = true;
        let json = serde_json::to_value(car_buttons("123", &session)).unwrap();
        assert_eq!(json[0]["components"][0]["custom_id"], "car:123:select");
        assert_eq!(json[0]["components"][0]["options"][0]["label"], "Test Car");
    }

    #[test]
    fn game_controls_follow_phase_and_hide_selected_players() {
        let game = Game {
            id: "r".into(),
            class: "A".into(),
            value: 100000,
            race_type: "all".into(),
            year: None,
            creator: Some("owner".into()),
            restrict_class: true,
            players: vec![
                game::Player {
                    id: "1".into(),
                    username: "one".into(),
                    display_name: "One".into(),
                    car: None,
                },
                game::Player {
                    id: "2".into(),
                    username: "two".into(),
                    display_name: "Two".into(),
                    car: None,
                },
            ],
        };
        let mut session = GameSession {
            game,
            phase: GamePhase::Start,
            race_index: 0,
            placements: vec![],
            candr: None,
            candr_map: false,
        };
        let json = serde_json::to_value(game_controls("123", &session)).unwrap();
        assert_eq!(json[0]["components"][0]["custom_id"], "game:123:finish");
        session.phase = GamePhase::Picking;
        session.placements.push("1".into());
        let json = serde_json::to_value(game_controls("123", &session)).unwrap();
        assert_eq!(json[0]["components"].as_array().unwrap().len(), 1);
        assert_eq!(json[0]["components"][0]["custom_id"], "game:123:pick~2");
        session.phase = GamePhase::Summary;
        let json = serde_json::to_value(game_controls("123", &session)).unwrap();
        assert_eq!(json[0]["components"][1]["custom_id"], "game:123:redo");
        session.phase = GamePhase::Candr;
        session.candr = Some(candr::State {
            robber: "1".into(),
            current_tile: None,
            previous_tile: None,
            started_at: 0,
            next_due: Some(0),
            finished_at: None,
        });
        let json = serde_json::to_value(game_controls("123", &session)).unwrap();
        assert_eq!(json.as_array().unwrap().len(), 5);
        assert_eq!(json[0]["components"][0]["custom_id"], "game:123:cfinish");
        let counts: Vec<_> = (1..5)
            .map(|i| {
                json[i]["components"][0]["options"]
                    .as_array()
                    .unwrap()
                    .len()
            })
            .collect();
        assert_eq!(counts, [25, 25, 25, 16]);
        assert_eq!(json[4]["components"][0]["options"][15]["value"], "G13");
    }
}
