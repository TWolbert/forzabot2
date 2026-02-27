import { Database } from "bun:sqlite";

export const db = new Database("forzabot.db");

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY,
      class TEXT NOT NULL,
      value INTEGER NOT NULL,
      race_type TEXT NOT NULL,
      year INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      restrict_class INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 100,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS round_players (
      round_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      PRIMARY KEY (round_id, player_id),
      FOREIGN KEY (round_id) REFERENCES rounds (id),
      FOREIGN KEY (player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS car_choices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      car_name TEXT NOT NULL,
      chosen_at INTEGER NOT NULL,
      FOREIGN KEY (round_id) REFERENCES rounds (id),
      FOREIGN KEY (player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS races (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      car_name TEXT NOT NULL,
      laptime INTEGER NOT NULL,
      is_historic INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (race_id) REFERENCES races (id),
      FOREIGN KEY (player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS discord_avatars (
      player_id TEXT PRIMARY KEY,
      avatar_url TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS car_images (
      car_name TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      confirmed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS round_scores (
      round_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (round_id, player_id),
      FOREIGN KEY (round_id) REFERENCES rounds (id),
      FOREIGN KEY (player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS round_race_results (
      round_id TEXT NOT NULL,
      race_index INTEGER NOT NULL,
      race_type TEXT NOT NULL,
      player_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      points INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (round_id, race_index, player_id),
      FOREIGN KEY (round_id) REFERENCES rounds (id),
      FOREIGN KEY (player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS web_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 100,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES web_users (id)
    );
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      predicted_player_id TEXT NOT NULL,
      points_wagered INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payout INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      settled_at INTEGER,
      UNIQUE (round_id, user_id, predicted_player_id),
      FOREIGN KEY (round_id) REFERENCES rounds (id),
      FOREIGN KEY (user_id) REFERENCES web_users (id),
      FOREIGN KEY (predicted_player_id) REFERENCES players (id)
    );
    CREATE TABLE IF NOT EXISTS web_users_discord (
      web_user_id TEXT PRIMARY KEY,
      discord_username TEXT NOT NULL UNIQUE,
      discord_user_id TEXT,
      linked_at INTEGER NOT NULL,
      FOREIGN KEY (web_user_id) REFERENCES web_users (id)
    );
  `);

  // Add status column to existing rounds table if it doesn't exist
  try {
    db.exec(`ALTER TABLE rounds ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Add winner_id column to existing rounds table if it doesn't exist
  try {
    db.exec(`ALTER TABLE rounds ADD COLUMN winner_id TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Add restrict_class column to existing rounds table if it doesn't exist
  try {
    db.exec(`ALTER TABLE rounds ADD COLUMN restrict_class INTEGER NOT NULL DEFAULT 1`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Add is_historic column to existing times table if it doesn't exist
  try {
    db.exec(`ALTER TABLE times ADD COLUMN is_historic INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Add points column to existing players table if it doesn't exist
  try {
    db.exec(`ALTER TABLE players ADD COLUMN points INTEGER NOT NULL DEFAULT 100`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Backfill points if missing
  try {
    db.exec(`UPDATE players SET points = 100 WHERE points IS NULL`);
  } catch (e) {
    // Ignore if column does not exist yet
  }

  // Add car_images table for confirmed car images if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS car_images (car_name TEXT PRIMARY KEY, image_url TEXT NOT NULL, confirmed_at INTEGER NOT NULL)`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add round_scores table if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS round_scores (round_id TEXT NOT NULL, player_id TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (round_id, player_id))`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add round_race_results table if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS round_race_results (round_id TEXT NOT NULL, race_index INTEGER NOT NULL, race_type TEXT NOT NULL, player_id TEXT NOT NULL, position INTEGER NOT NULL, points INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (round_id, race_index, player_id))`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add web_users table if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS web_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 100, created_at INTEGER NOT NULL)`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add auth_sessions table if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add bets table if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT NOT NULL, user_id TEXT NOT NULL, predicted_player_id TEXT NOT NULL, points_wagered INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payout INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE (round_id, user_id, predicted_player_id))`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add web_users_discord table if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS web_users_discord (web_user_id TEXT PRIMARY KEY, discord_username TEXT NOT NULL UNIQUE, discord_user_id TEXT, linked_at INTEGER NOT NULL)`);
  } catch (e) {
    // Table already exists, ignore
  }

  // Add created_by column to existing rounds table if it doesn't exist
  try {
    db.exec(`ALTER TABLE rounds ADD COLUMN created_by TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
}
