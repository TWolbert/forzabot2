# Forza Bot Dashboard

A React + Tailwind CSS web dashboard for browsing Forza racing league statistics, past games, and lap times.

## Features

- **Leaderboard**: View top 10 players by wins with medal rankings
- **Past Games**: Browse finished races with winners and player counts
- **Lap Times**: Searchable table of recorded lap times with filters

## Setup

### Prerequisites

- Bun (already in use for the bot)
- The main Forza bot running on port 3000 (API server)

### Installation

```bash
cd web
bun install
```

### Running

**Terminal 1 - API Server** (serves data from SQLite database):
```bash
cd web
bun api
```

**Terminal 2 - Dashboard Dev Server** (runs on port 34234):
```bash
cd web
bun run dev
```

Then open http://localhost:34234 in your browser.

## Build for Production

```bash
cd web
bun run build
```

Output will be in `dist/` folder.

## Architecture

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend API**: Bun HTTP server with SQLite queries
- **Port 34234**: Development server with proxy to API
- **Port 3000**: API server endpoint

## API Endpoints

- `GET /api/leaderboard` - Top 10 players by wins
- `GET /api/player/:id` - Individual player stats
- `GET /api/games` - Past games/races
- `GET /api/times?race=NAME&car=NAME` - Lap times with optional filters
- `GET /api/races` - All available races

## File Structure

```
web/
├── src/
│   ├── api.ts                 # API client functions
│   ├── apiserver.ts           # Bun HTTP server
│   ├── main.tsx               # React entry point
│   ├── App.tsx                # Main app component
│   ├── index.css              # Tailwind styles
│   ├── components/
│   │   └── Navigation.tsx      # Tab navigation
│   └── pages/
│       ├── Leaderboard.tsx     # Leaderboard page
│       ├── Games.tsx           # Past games page
│       └── LapTimes.tsx        # Lap times page
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── package.json
```
