'use strict';
// SQLite through Node's built-in driver (no native addon to compile).
// Schema changes are numbered migrations; `PRAGMA user_version` remembers how far a database got.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id        INTEGER PRIMARY KEY,
    username  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass      TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'user',
    bio       TEXT NOT NULL DEFAULT '',
    created   INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token     TEXT PRIMARY KEY,           -- sha256 of the cookie value
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf      TEXT NOT NULL,
    created   INTEGER NOT NULL,
    expires   INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE works (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility  TEXT NOT NULL DEFAULT 'private',   -- private | unlisted | public
    status      TEXT NOT NULL DEFAULT 'processing', -- processing | ready | failed
    progress    REAL NOT NULL DEFAULT 0,
    error       TEXT,
    pages       INTEGER NOT NULL DEFAULT 0,
    chapters    INTEGER NOT NULL DEFAULT 0,
    bg          TEXT NOT NULL DEFAULT '#0e0d12',   -- strip background, so the reader matches it
    cover_rev   INTEGER NOT NULL DEFAULT 0,
    views       INTEGER NOT NULL DEFAULT 0,
    likes       INTEGER NOT NULL DEFAULT 0,
    created     INTEGER NOT NULL,
    updated     INTEGER NOT NULL,
    published   INTEGER
  );
  CREATE INDEX works_user ON works(user_id, created DESC);
  CREATE INDEX works_public ON works(visibility, status, published DESC);
  CREATE TABLE chapters (
    work_id   TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    idx       INTEGER NOT NULL,
    title     TEXT NOT NULL,
    pages     TEXT NOT NULL,                -- JSON: [[width, height, hasSmall], ...]
    PRIMARY KEY (work_id, idx)
  );
  CREATE TABLE likes (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id   TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    created   INTEGER NOT NULL,
    PRIMARY KEY (user_id, work_id)
  );
  CREATE INDEX likes_work ON likes(work_id);
  `,
  // 2: API tokens, so Koma (or a script) can upload on a user's behalf
  `
  CREATE TABLE api_tokens (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    token     TEXT NOT NULL UNIQUE,         -- sha256 of the token
    prefix    TEXT NOT NULL,                -- first characters, to recognise it in the list
    created   INTEGER NOT NULL,
    last_used INTEGER
  );
  CREATE INDEX api_tokens_user ON api_tokens(user_id);
  `,
  // 3: one sign-in with AkulavBox. Each account here mirrors an AkulavBox account (box_id);
  // passwords and sessions live there now. bytes: what a work takes on disk (quotas).
  `
  ALTER TABLE users ADD COLUMN box_id TEXT;
  CREATE UNIQUE INDEX users_box ON users(box_id);
  ALTER TABLE works ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
  DELETE FROM sessions;
  `,
];

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'koma-shelf.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: at } = db.prepare('PRAGMA user_version').get();
  for (let i = at; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  // prepared statements are cached per SQL text
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  return {
    raw: db,
    get: (sql, ...a) => stmt(sql).get(...a),
    all: (sql, ...a) => stmt(sql).all(...a),
    run: (sql, ...a) => stmt(sql).run(...a),
    tx(fn) {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}

module.exports = { openDb };
