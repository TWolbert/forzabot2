CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, class TEXT NOT NULL, value INTEGER NOT NULL,
  race_type TEXT NOT NULL, brand TEXT, year INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', restrict_class INTEGER NOT NULL DEFAULT 1,
  candr_total_time_ms INTEGER, created_at INTEGER NOT NULL,
  winner_id TEXT, created_by TEXT
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 100, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS round_players (
  round_id TEXT NOT NULL REFERENCES rounds(id), player_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY (round_id, player_id)
);
CREATE TABLE IF NOT EXISTS car_choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL REFERENCES players(id), car_name TEXT NOT NULL,
  selection_method TEXT NOT NULL DEFAULT 'manual', chosen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS times (
  id INTEGER PRIMARY KEY AUTOINCREMENT, race_id TEXT NOT NULL REFERENCES races(id),
  player_id TEXT NOT NULL REFERENCES players(id), car_name TEXT NOT NULL,
  laptime INTEGER NOT NULL, is_historic INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS discord_avatars (
  player_id TEXT PRIMARY KEY REFERENCES players(id), avatar_url TEXT NOT NULL, cached_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS car_images (
  car_name TEXT PRIMARY KEY, image_url TEXT NOT NULL, confirmed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS round_scores (
  round_id TEXT NOT NULL REFERENCES rounds(id), player_id TEXT NOT NULL REFERENCES players(id),
  points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (round_id, player_id)
);
CREATE TABLE IF NOT EXISTS round_race_results (
  round_id TEXT NOT NULL REFERENCES rounds(id), race_index INTEGER NOT NULL,
  race_type TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(id),
  position INTEGER NOT NULL, points INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, race_index, player_id)
);
CREATE TABLE IF NOT EXISTS web_users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 100, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES web_users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL REFERENCES web_users(id), predicted_player_id TEXT NOT NULL REFERENCES players(id),
  points_wagered INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE (round_id, user_id, predicted_player_id)
);
CREATE TABLE IF NOT EXISTS web_users_discord (
  web_user_id TEXT PRIMARY KEY REFERENCES web_users(id), discord_username TEXT NOT NULL UNIQUE,
  discord_user_id TEXT, linked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS candr_state (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id), robber_player_id TEXT NOT NULL REFERENCES players(id),
  current_tile TEXT, previous_tile TEXT, started_at INTEGER NOT NULL, last_tile_at INTEGER,
  next_tile_due_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS candr_player_roles (
  round_id TEXT NOT NULL REFERENCES rounds(id), player_id TEXT NOT NULL REFERENCES players(id),
  role TEXT NOT NULL, assigned_at INTEGER NOT NULL, PRIMARY KEY (round_id, player_id)
);
CREATE TABLE IF NOT EXISTS player_points_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL REFERENCES players(id),
  round_id TEXT NOT NULL REFERENCES rounds(id), points_earned INTEGER NOT NULL,
  total_points INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE (player_id, round_id)
);
CREATE TABLE IF NOT EXISTS web_user_points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES web_users(id),
  source TEXT NOT NULL, before_points INTEGER NOT NULL, after_points INTEGER NOT NULL,
  delta INTEGER NOT NULL, metadata TEXT, created_at INTEGER NOT NULL
);
