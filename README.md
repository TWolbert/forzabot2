# ForzaBot - Discord Forza Racing League Bot

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
  - `race_type` (optional): Choose from rally, goliath, circuit, drag, offroad, all
  - `year` (optional, integer): Restrict to a specific model year
  - `restrict_class` (optional, boolean): Enforce specific car class restrictions (default: false)
- **Features**:
  - Generates unique Round ID
  - Stores round in database
  - Automatically deduplicates players
  - Without `restrict_class`: Full 50K-500K value range
  - With `restrict_class`: Class-specific value ranges
- **Example**: `/startround player1: @User1 player2: @User2 race_type: circuit restrict_class: true`

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
- **Example**: `/addrace name: Silverstone description: Silverstone circuit`

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
  - `/registertime race: Silverstone laptime: 1:34.860` - Browse all cars
  - `/registertime race: Silverstone laptime: 1:34.860 car_query: Ferrari` - Show only Ferrari cars

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
  - `/times race: Silverstone` - All times on Silverstone
  - `/times car: Ferrari` - All times with Ferrari cars
  - `/times race: Silverstone car: F40` - Ferrari F40 times on Silverstone

#### `/listrace`
List all available races/tracks.
- **Features**:
  - Shows race names and descriptions
  - Displays number of times recorded per race
  - Ordered by newest first
- **Example**: `/listrace`

---

## Lap Time Format

When registering lap times, use the format: **MM:SS.MS**

Examples:
- `1:34.860` - 1 minute, 34 seconds, 860 milliseconds
- `12:12.398` - 12 minutes, 12 seconds, 398 milliseconds
- `0:45.120` - 45 seconds, 120 milliseconds

---

## Game Flow Example

1. **Create a round**: `/startround player1: @User1 player2: @User2 player3: @User3 race_type: circuit`
2. **Players choose cars**:
   - User1: `/choosecar query: Ferrari`
   - User2: `/choosecar query: Lamborghini`
   - User3: `/choosecar random: true`
3. **Start the game**: `/gamestart` (round creator only)
4. **Select winner**: Click a player button to mark them as winner
5. **View stats**: `/stats` or `/stats player: @User1`

---

## Lap Time Tracking Example

1. **Create a track**: `/addrace name: Silverstone description: British GP circuit`
2. **Register lap times**:
   - `/registertime race: Silverstone laptime: 1:34.860` (then select car)
   - `/registertime race: Silverstone laptime: 1:35.200 car_query: Ferrari`
3. **View times**: 
   - `/times` - See all times
   - `/times race: Silverstone` - See all times on Silverstone
   - `/times car: Ferrari` - See all Ferrari times
   - `/times race: Silverstone car: Ferrari` - See Ferrari times on Silverstone
4. **List all tracks**: `/listrace`

---

## Database Schema

### rounds
- `id`: Unique round identifier (UUID)
- `class`: Car class (D, C, B, A, S1, S2)
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
3. Load car data: Place `output.csv` in root directory
4. Register commands: `bun reloadCommands.ts`
5. Start bot: `bun index.ts`

---

## Notes

- Car searches use fuzzy matching for better results
- Images are fetched from the Forza Fandom Wiki
- All times are automatically updated if registered again for the same player/car/race combination
- Only the round creator can finish a game and select the winner
- Commands have a 5-minute timeout for interactive selections
