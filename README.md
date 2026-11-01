# ForzaBot FH6 - Discord Forza Horizon 6 Racing League Bot

A comprehensive Discord bot for managing Forza racing leagues with round management, car selection, statistics tracking, and laptime recording.

## Features

- **Round Management**: Create rounds with specific car classes, values, and race types
- **Interactive Car Selection**: Browse and select cars with an interactive carousel or random selection
- **Game Flow**: Lock in players and cars, select winners, track statistics
- **Leaderboard**: View top players by wins
- **Lap Time Tracking**: Record and track lap times on different tracks
- **Statistics**: View individual player stats with race history

## Commands

### General Commands

#### `/ping`
Test if the bot is alive.
- **Response**: Pong!

#### `/forza`
General test command.
- **Response**: Forza

---

### Car Commands

#### `/searchcar`
Search for cars by name.
- **Parameter**: 
  - `query` (required, string): Car name or partial name to search
- **Description**: Shows up to 20 matching cars
- **Example**: `/searchcar query: Ferrari`

#### `/choosecar`
Choose a car for the current round interactively.
- **Parameters**:
  - `query` (optional, string): Car name to search for
  - `random` (optional, boolean): Randomly select a car within budget
- **Features**:
  - Browse cars with ◀ and ▶ buttons
  - Select with ✓ or cancel with ❌
  - Shows car image from Forza Wiki
  - Random picks are balanced around the first random pick in the round (similar PI class + nearby value)
  - Random picks always stay at or below 80% of round value (minimum 20% budget kept for upgrades)
  - Must have an active round
- **Examples**:
  - `/choosecar query: Lamborghini` - Show Lamborghini cars
  - `/choosecar random: true` - Get a random car

---

### Round Management Commands

#### `/startround`
Create a new Forza round.
- **Parameters**:
  - `player1` (required): First player
  - `player2` (required): Second player
  - `player3-8` (optional): Additional players (up to 8 total)
  - `race_type` (optional): Choose from road, dirt, cross-country, street, touge, time attack, drag, Goliath, cops and robbers, or all
  - `year` (optional, integer): Restrict to a specific model year
  - `brand` (optional, string): Restrict round cars to a brand (e.g. `Audi`, `Aston Martin`)
  - `restrict_class` (optional, boolean): Enforce specific car class restrictions (default: false)
- **Features**:
  - Generates unique Round ID
  - Stores round in database
  - Automatically deduplicates players
  - With `brand`: `/choosecar` search + random only return that brand
  - Round budgets stay between 50,000 and 500,000 CR
  - With `brand`: budget respects the brand's available car values within that limit
  - With `restrict_class`: uses FH6 class-specific value ranges (D, C, B, A, S1, S2, R, X), all within that limit
- **Example**: `/startround player1: @User1 player2: @User2 race_type: road restrict_class: true`

#### `/gamestart`
Start the game with all players locked in.
- **Requirements**: Active pending round must exist
- **Features**:
  - Shows all players and their selected cars
  - Displays player avatars and car images
  - Only round creator can finish the game
  - Button to proceed to winner selection
- **Workflow**: Use after all players have run `/choosecar`

#### `/pastraces`
View recently finished races.
- **Parameters**:
  - `limit` (optional, integer): Number of races to show (1-25, default 10)
- **Features**: Shows winners, race types, and dates
- **Example**: `/pastraces limit: 20`

---

### Statistics Commands

#### `/stats`
View player statistics and leaderboard.
- **Parameters**:
  - `player` (optional): Specific player to view stats for
- **Features**:
  - Without parameter: Shows top 10 players by wins (leaderboard)
  - With player: Shows that player's stats including:
    - Total games played
    - Total wins
    - Win rate percentage
    - Race history with pagination (◀ Previous / Next ▶)
- **Examples**:
  - `/stats` - Show leaderboard
  - `/stats player: @User1` - Show User1's stats

---

### Lap Time Tracking Commands

#### `/addrace`
Create a new race/track for lap time tracking.
- **Parameters**:
  - `name` (required, string): Name of the race/track
  - `description` (optional, string): Description of the race
- **Features**:
  - Race names are unique
  - Generates unique Race ID
  - Returns confirmation with Race ID
- **Example**: `/addrace name: My Japan Sprint description: Custom FH6 route`

#### `/registertime`
Record a lap time for a race.
- **Parameters**:
  - `race` (required, string): Name of the race/track (autocomplete available!)
  - `laptime` (required, string): Time in format `MM:SS.MS` (e.g., `1:34.860`)
  - `car_query` (optional, string): Search for specific car
- **Features**:
  - Autocomplete shows available races as you type
  - Interactive car selection carousel
  - If same player/race/car exists: Updates the time instead of creating duplicate
  - Displays car image
  - Time display in readable format (MM:SS.MS)
- **Examples**:
  - `/registertime race: Shirakawa Circuit laptime: 1:34.860` - Browse all cars
  - `/registertime race: Shirakawa Circuit laptime: 1:34.860 car_query: Ferrari` - Show only Ferrari cars

#### `/times`
View recorded lap times with filtering.
- **Parameters**:
  - `race` (optional, string): Filter by track name
  - `car` (optional, string): Filter by car name (fuzzy search)
- **Features**:
  - Shows fastest 20 times
  - Sorted best to slowest
  - Medal display: 🥇 🥈 🥉 for top 3
  - Shows player, car, race, and time
  - Use together or separately
- **Examples**:
  - `/times` - All times
  - `/times race: Shirakawa Circuit` - All times on Shirakawa Circuit
  - `/times car: Ferrari` - All times with Ferrari cars
  - `/times race: Shirakawa Circuit car: F40` - Ferrari F40 times on Shirakawa Circuit

#### `/listrace`
List all available races/tracks.
- **Features**:
  - Shows race names and descriptions
  - Displays number of times recorded per race
  - Ordered by newest first
- **Example**: `/listrace`

#### `/removetime`
Remove a recorded lap time.
- **Parameters**:
  - `race` (required, string): Name of the race/track (autocomplete available!)
  - `car_query` (optional, string): Search for specific car
- **Features**:
  - Autocomplete shows available races as you type
  - Interactive car selection carousel
  - Confirms deletion with red 🗑️ button
  - Shows car image before deletion
- **Examples**:
  - `/removetime race: Shirakawa Circuit` - Browse all cars to remove
  - `/removetime race: Shirakawa Circuit car_query: Ferrari` - Show only Ferrari cars

---

## Lap Time Format

When registering lap times, use the format: **MM:SS.MS**

Examples:
- `1:34.860` - 1 minute, 34 seconds, 860 milliseconds
- `12:12.398` - 12 minutes, 12 seconds, 398 milliseconds
- `0:45.120` - 45 seconds, 120 milliseconds

---

## Game Flow Example

1. **Create a round**: `/startround player1: @User1 player2: @User2 player3: @User3 race_type: road`
2. **Players choose cars**:
   - User1: `/choosecar query: Ferrari`
   - User2: `/choosecar query: Lamborghini`
   - User3: `/choosecar random: true`
3. **Start the game**: `/gamestart` (round creator only)
4. **Select winner**: Click a player button to mark them as winner
5. **View stats**: `/stats` or `/stats player: @User1`

---

## Lap Time Tracking Example

1. **Create a track**: `/addrace name: Shirakawa Circuit description: FH6 circuit race in Japan`
2. **Register lap times**:
   - `/registertime race: Shirakawa Circuit laptime: 1:34.860` (then select car)
   - `/registertime race: Shirakawa Circuit laptime: 1:35.200 car_query: Ferrari`
3. **View times**: 
   - `/times` - See all times
   - `/times race: Shirakawa Circuit` - See all times on Shirakawa Circuit
   - `/times car: Ferrari` - See all Ferrari times
   - `/times race: Shirakawa Circuit car: Ferrari` - See Ferrari times on the circuit
4. **Remove a time**: `/removetime race: Shirakawa Circuit car_query: Ferrari` (then confirm deletion)
5. **List all tracks**: `/listrace`

---

## Database Schema

### rounds
- `id`: Unique round identifier (UUID)
- `class`: Car class (D, C, B, A, S1, S2, R, X)
- `value`: Budget in credits
- `race_type`: Type of race
- `year`: Model year restriction (optional)
- `status`: pending, active, or finished
- `created_at`: Timestamp
- `created_by`: Discord user ID of round creator
- `winner_id`: Discord user ID of winner (if finished)

### races
- `id`: Unique race identifier (UUID)
- `name`: Race/track name
- `description`: Race description (optional)
- `created_by`: Discord user ID of creator
- `created_at`: Timestamp

### times
- `id`: Auto-increment ID
- `race_id`: Reference to races table
- `player_id`: Discord user ID
- `car_name`: Car driven
- `laptime`: Time in milliseconds
- `created_at`: Timestamp

---

## Setup

### Rust deployment

The Docker image now builds and runs the Rust bot and API and serves the Dioxus
RSX dashboard; Bun, Node, React, and Python are no longer used at runtime. The
original Bun/React/Python implementation is archived under `legacy/` and is not
built or deployed.
`docker compose up --build` builds all three from the `rust/` workspace.

Ported Discord commands: `/ping`, `/forza`, `/searchcar`, `/addrace`,
`/listrace`, `/times`, `/pastraces`, `/resetround`, `/startround`,
`/registertime`, `/removetime`, `/choosecar`, `/gamestart` (single races,
four-race series, and Cops and Robbers), `/stats`, and the DM-only `/linkweb`.
Search, car-selection, lap-time, and game-start embeds resolve car images from
confirmed local images first, then the Forza Wiki and Wikipedia, and game-start
also shows cached Discord avatars. Single-race and series result embeds include
the winner's car image, avatar, and winning car name. Set `IMAGE_BASE_URL` so
relative confirmed image paths are absolute for Discord. The Rust bot's Discord
rendering has only been verified through unit-level embed serialization, not
against a live Discord server. Game controls live in memory and expire after one
hour (12 hours for Cops and Robbers), so a bot restart loses an in-progress
control session.

Ported API routes include game, leaderboard, round, time, race, player, and
seasonal-map reads; registration, login, sessions, logout, points history,
username updates, secure Discord linking, bet placement/current, Cops-and-Robbers
tile updates, car-image lookup and confirmed-image storage/serving, and
password-protected points administration.

The RSX dashboard includes home, leaderboard, player profiles, past games with
detail pages, lap times with detail and car-image handling, the live round with
betting and Cops-and-Robbers tile controls, sign-in/registration, account and
Discord-link management, and points administration. Internal bet settlement, placement-award, and points-history
write routes are not exposed by the Rust API because the Rust bot settles them
inside the transaction that finishes a round, preventing double awards.

Rust game results settle locked bets and award linked-account placement points
transactionally. The legacy Bun API's unverified Discord-link endpoint is not
reproduced; `/linkweb` uses a single-use, hashed, ten-minute challenge.

Run `cargo test --workspace -j 2` to test the Rust code. Generate the car dataset
with `cargo run -p forzabot-tools --bin scrape-cars -- output.csv`, or generate
class icons with `cargo run -p forzabot-tools --bin generate-class-icons --
media/classes`.

Set `TOKEN`, `CLIENT_ID`, and `POINTS_ADMIN_PASSWORD` as described below. The API
listens on `RUST_API_ADDR` (Docker uses `0.0.0.0:8080`). It creates and migrates
`DATABASE_PATH` on first start. `DASHBOARD_DIST` points at the built RSX assets;
the API serves SPA routes from it with an `index.html` fallback. To register the
current command set, run `forzabot-discord --register-ported-commands` once with
`CLIENT_ID` set; this upserts the definitions and does not delete other commands.

For local development, run the API and bot separately against a test database.
Do not run the Rust and Bun bots simultaneously with the same token: they would
compete for Discord gateway events.

### Seasonal FH6 maps

The local images in `media/maps/` are stitched from Map Genie Japan map tiles
and include a 13×7 Cops and Robbers grid. Map imagery: [Map Genie](https://mapgenie.io/forza-horizon-6/maps/japan);
the user reported receiving permission to download the tiles for this hobby
project. The Goliath display uses the Japan map, **not a marked race route**.
The map changes weekly through spring → summer → autumn → winter. The initial
summer transition is approximately 2026-11-05 14:29:52 UTC, calculated from
the supplied countdown; update `SUMMER_START_UNIX_SECONDS` in `rust/core/src/lib.rs`
and `SUMMER_START_SECONDS` in `src/seasons.ts` if the actual transition differs.

The RSX dashboard lives in `rust/dashboard` and is built in Docker with
`cargo build --target wasm32-unknown-unknown` plus the matching `wasm-bindgen`
CLI. It talks to the Rust API at the same origin under `/api`.

## Setup

1. Set `TOKEN`, `CLIENT_ID`, and `POINTS_ADMIN_PASSWORD`.
2. Generate the FH6 car dataset if needed:
   `cargo run -p forzabot-tools --bin scrape-cars -- output.csv`
3. Register the slash commands:
   `cargo run -p forzabot-discord -- --register-ported-commands`
4. Run the API and bot from `target/release` (or use Docker below).

## Docker Deployment

1. Copy `.env.example` to `.env` and set `TOKEN`, `CLIENT_ID`, and `POINTS_ADMIN_PASSWORD`.
2. Set `IMAGE_BASE_URL` to the public origin for the dashboard.
3. Build and start the container: `docker compose up --build -d`
4. Point your hostname or reverse proxy at the host's port `8080`.

### Fedora / SELinux

Docker named volumes work on Fedora without extra labels. If you use a **bind
mount** (for example `./data:/data`), SELinux blocks the container from writing
SQLite journal files and you will see `attempt to write a readonly database`.
Use the provided variant, which adds the private label `:Z`:

```bash
mkdir -p data
docker compose -f docker-compose.fedora.yml up -d --build
```

To migrate existing data from the named volume into `./data`, stop the stack and
copy it before starting the bind-mount variant:

```bash
docker compose down
docker run --rm -v forzabot-data:/from -v "$PWD/data":/to alpine \
  sh -c 'cp -a /from/. /to/'
docker compose -f docker-compose.fedora.yml up -d
```

Diagnose denials with `sudo ausearch -m avc -ts recent` or `sudo dmesg | grep
denied`. On rootless Podman, prefer `./data:/data:Z,U` so the mount is also
chowned to the container user. Do not add `:Z` to a path shared with other
containers; use `:z` for shared labels.

The container runs the Rust API on port `8080` and the Rust Discord bot. It
serves the Dioxus RSX dashboard built to WebAssembly and uses the `forzabot-data`
volume for SQLite and car images. Register commands once from inside the running
container:

`docker compose exec forzabot forzabot-discord --register-ported-commands`

---

## Notes

- Car searches use fuzzy matching for better results
- Car data (including prices and availability) is imported from the FH6 Forza Wiki car list
- FH6 route names are seeded automatically; add custom routes with `/addrace`
- Images are fetched from the Forza Horizon 6 Forza Wiki pages
- All times are automatically updated if registered again for the same player/car/race combination
- Only the round creator can finish a game and select the winner
- Commands have a 5-minute timeout for interactive selections
