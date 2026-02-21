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
    )
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

  // Add car_images table for confirmed car images if it doesn't exist
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS car_images (car_name TEXT PRIMARY KEY, image_url TEXT NOT NULL, confirmed_at INTEGER NOT NULL)`);
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
