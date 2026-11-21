'use strict';
// Tasks' database: DATA_DIR/tasks/tasks.db. Rows belong to AkulavBox accounts directly (user_id is
// the AkulavBox account id), so there is no account table of its own; prefs holds each account's
// settings. Schema changes are numbered steps (src/core/sqlite.js runSteps): append, never edit.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('../../../src/core/sqlite');

const DATA_DIR = require('../../../src/core/config').appDataDir('tasks');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'tasks.db');

const STEPS = [
  // 1: lists, tasks with tags and a checklist, per-account preferences
  `
  CREATE TABLE lists (
    id         INTEGER PRIMARY KEY,
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#8b5cf6',
    icon       TEXT NOT NULL DEFAULT 'list',
    position   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX lists_user ON lists(user_id, position);

  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    user_id      TEXT NOT NULL,
    list_id      INTEGER REFERENCES lists(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    priority     INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    flagged      INTEGER NOT NULL DEFAULT 0,
    due_date     TEXT,
    due_time     TEXT,
    repeat       TEXT,
    position     REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX tasks_user_status ON tasks(user_id, status);
  CREATE INDEX tasks_user_due ON tasks(user_id, due_date);
  CREATE INDEX tasks_list ON tasks(list_id);

  CREATE TABLE task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (task_id, tag)
  );
  CREATE INDEX task_tags_tag ON task_tags(tag);

  CREATE TABLE checklist (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text     TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX checklist_task ON checklist(task_id, position);

  CREATE TABLE prefs (
    user_id TEXT PRIMARY KEY,
    value   TEXT NOT NULL
  );
  `,
  // 2: Tick 1.1 has no "in progress" any more: a task is to do or done ('doing' stays allowed by the
  // CHECK above, and the API reads it as 'todo')
  `UPDATE tasks SET status = 'todo' WHERE status = 'doing';`,
];

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
sqlite.runSteps(db, STEPS, { describe: (n) => `Tasks database migration ${n}` });

/** Run fn inside a transaction */
const tx = (fn) => sqlite.tx(db, fn);

// prepared statements are cached per SQL text (node:sqlite prepares synchronously)
const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
};
const get = (sql, ...a) => stmt(sql).get(...a);
const all = (sql, ...a) => stmt(sql).all(...a);
const run = (sql, ...a) => stmt(sql).run(...a);

module.exports = { db, DB_PATH, tx, get, all, run };
