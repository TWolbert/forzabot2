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

1. Install dependencies: `bun install`
2. Set environment variables:
   - `TOKEN`: Discord bot token
   - `CLIENT_ID`: Discord application ID
  - `POINTS_ADMIN_PASSWORD`: Password used for the `/points` web management interface
3. Generate the FH6 car dataset: `python3 python/scraper.py output.csv`
4. Register commands: `bun reloadCommands.ts`
5. Start bot: `bun index.ts`

## Docker Deployment

1. Copy `.env.example` to `.env` and set `TOKEN`, `CLIENT_ID`, and `POINTS_ADMIN_PASSWORD`.
2. Set `IMAGE_BASE_URL` to the public origin for the dashboard (for example, `https://forza.example.com` when a reverse proxy handles HTTPS).
3. Build and start the container: `docker compose up --build -d`
4. Point your hostname or reverse proxy at the host's port `8080`.

The container serves the dashboard and API on port `8080` and runs the Discord bot. SQLite data and downloaded car images persist in the `forzabot-data` volume. To register slash commands the first time, run `docker compose run --rm forzabot bun run reloadCommands.ts`.

---

## Notes

- Car searches use fuzzy matching for better results
- Car data (including prices and availability) is imported from the FH6 Forza Wiki car list
- FH6 route names are seeded automatically; add custom routes with `/addrace`
- Images are fetched from the Forza Horizon 6 Forza Wiki pages
- All times are automatically updated if registered again for the same player/car/race combination
- Only the round creator can finish a game and select the winner
- Commands have a 5-minute timeout for interactive selections
