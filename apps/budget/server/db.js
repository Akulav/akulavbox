'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { CURRENCIES, DEFAULT_CATEGORIES } = require('./currencies.js');

// Florin's database lives in DATA_DIR/budget of the AkulavBox data folder
const DATA_DIR = require('../../../src/core/config').appDir('budget');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'florin.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS = [
  // v1 — initial schema
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    base_currency TEXT NOT NULL DEFAULT 'EUR',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    icon     TEXT NOT NULL DEFAULT 'tag',
    color    TEXT NOT NULL DEFAULT '#2a78d6',
    kind     TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income')),
    budget   REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_categories_user ON categories(user_id);

  CREATE TABLE transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income')),
    amount      REAL NOT NULL CHECK (amount > 0),
    currency    TEXT NOT NULL,
    amount_eur  REAL NOT NULL,
    date        TEXT NOT NULL,
    payee       TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tx_user_date ON transactions(user_id, date);
  CREATE INDEX idx_tx_category ON transactions(category_id);

  CREATE TABLE rates (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    rate       REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    source     TEXT NOT NULL DEFAULT 'default'
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — one sign-in with AkulavBox: each account here mirrors an AkulavBox account (box_id).
  // Passwords and sessions live there; the old columns stay but are no longer used.
  `
  ALTER TABLE users ADD COLUMN box_id TEXT;
  CREATE UNIQUE INDEX idx_users_box ON users(box_id);
  DELETE FROM sessions;
  `,
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  const insertRate = db.prepare('INSERT OR IGNORE INTO rates (code, name, rate) VALUES (?, ?, ?)');
  for (const c of CURRENCIES) insertRate.run(c.code, c.name, c.rate);
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('allow_registration', 'true');
  insertSetting.run('default_currency', 'EUR');
}

/** Run fn inside a transaction. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value),
  );
}

function getRates() {
  const map = {};
  for (const r of db.prepare('SELECT code, rate FROM rates').all()) map[r.code] = r.rate;
  return map;
}

function rateOf(code) {
  return db.prepare('SELECT rate FROM rates WHERE code = ?').get(code)?.rate ?? null;
}

function toEur(amount, currency) {
  const rate = rateOf(currency);
  if (!rate) throw Object.assign(new Error(`Unknown currency ${currency}`), { status: 400 });
  return amount / rate;
}

function createDefaultCategories(userId) {
  const stmt = db.prepare(
    'INSERT INTO categories (user_id, name, icon, color, kind, budget, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  DEFAULT_CATEGORIES.forEach((c, i) => stmt.run(userId, c.name, c.icon, c.color, c.kind, c.budget, i));
}

migrate();

module.exports = { DB_PATH, db, tx, getSetting, setSetting, getRates, rateOf, toEur, createDefaultCategories };
