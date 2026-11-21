'use strict';
// Ironveil's saves: one JSON text per key ("profile", the auto-save "run", "quick", "slot1".."slot6" and the
// save list "saves") and account, in
// DATA_DIR/ironveil/<account id>/<key>.json. Files, so full backups take the folder as it is, and the
// account's storage counts them like any other file.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../src/core/config');

/** Bytes of the files in one (flat) folder */
function dirSize(dir) {
  let bytes = 0;
  for (const n of fs.readdirSync(dir)) { try { bytes += fs.statSync(path.join(dir, n)).size; } catch (e) { /* removed meanwhile */ } }
  return bytes;
}

const ROOT = config.appDataDir('ironveil');
const KEY = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_KEYS = 16;

const validKey = (k) => typeof k === 'string' && KEY.test(k);
const dirOf = (userId) => {
  if (!/^[\w-]{1,64}$/.test(String(userId))) throw new Error('Unknown account.');
  return path.join(ROOT, String(userId));
};
const fileOf = (userId, key) => path.join(dirOf(userId), `${key}.json`);

/** Every save of the account: { key: { text, updated_at, bytes } } */
function all(userId) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(dirOf(userId)); } catch (e) { return out; }
  for (const n of names) {
    const key = n.replace(/\.json$/, '');
    if (!n.endsWith('.json') || !validKey(key)) continue;
    try {
      const f = fileOf(userId, key);
      out[key] = { text: fs.readFileSync(f, 'utf-8'), updated_at: fs.statSync(f).mtime.toISOString() };
    } catch (e) { /* removed meanwhile */ }
  }
  return out;
}

const read = (userId, key) => { try { return fs.readFileSync(fileOf(userId, key), 'utf-8'); } catch (e) { return null; } };
const sizeOf = (userId, key) => { try { return fs.statSync(fileOf(userId, key)).size; } catch (e) { return 0; } };
const count = (userId) => { try { return fs.readdirSync(dirOf(userId)).filter((n) => n.endsWith('.json')).length; } catch (e) { return 0; } };

/** Write a save whole (a temporary file renamed over it: a crash never leaves half a save) */
function write(userId, key, text) {
  const dir = dirOf(userId);
  fs.mkdirSync(dir, { recursive: true });
  const f = fileOf(userId, key);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, f);
}

function remove(userId, key) { fs.rmSync(fileOf(userId, key), { force: true }); }

/** Bytes the account's saves take */
const usage = (userId) => { try { return dirSize(dirOf(userId)); } catch (e) { return 0; } };

function deleteUser(userId) { fs.rmSync(dirOf(userId), { recursive: true, force: true }); }

function totals() {
  let bytes = 0;
  let players = 0;
  let names = [];
  try { names = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (e) { return { bytes: 0, items: 0, label: 'players' }; }
  for (const d of names) {
    if (!d.isDirectory()) continue;
    players++;
    try { bytes += dirSize(path.join(ROOT, d.name)); } catch (e) { /* removed meanwhile */ }
  }
  return { bytes, items: players, label: players === 1 ? 'player' : 'players' };
}

/** The profile the game keeps (Legacy shards, achievements, lifetime stats), or null */
function profile(userId) {
  const text = read(userId, 'profile');
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

module.exports = { ROOT, MAX_KEYS, validKey, all, read, sizeOf, count, write, remove, usage, deleteUser, totals, profile };
