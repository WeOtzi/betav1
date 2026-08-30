import Database from 'better-sqlite3';
import { seedDatabase } from './seed.js';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      verified_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('artist', 'client')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      objectives_json TEXT NOT NULL DEFAULT '[]',
      styles_json TEXT NOT NULL DEFAULT '[]',
      avatar_asset TEXT NOT NULL DEFAULT '',
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      image_asset TEXT NOT NULL,
      height INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('work', 'flash', 'merch'))
    );
    CREATE TABLE IF NOT EXISTS favorites (
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      portfolio_item_id TEXT NOT NULL REFERENCES portfolio_items(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, portfolio_item_id)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('flash', 'custom')),
      status TEXT NOT NULL CHECK (status IN ('requested', 'confirmed', 'cancelled', 'completed')),
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      first_tattoo INTEGER NOT NULL,
      placement TEXT NOT NULL,
      medical_notes TEXT NOT NULL,
      preferred_date TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      booking_id TEXT REFERENCES bookings(id),
      participant_name TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      sender TEXT NOT NULL CHECK (sender IN ('user', 'artist')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at, id);
    CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations(updated_at DESC);
  `);
}

export function createDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  createSchema(db);

  const existingProfile = db.prepare('SELECT id FROM profiles LIMIT 1').get();
  if (!existingProfile) {
    seedDatabase(db);
  }

  return db;
}
