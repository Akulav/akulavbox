const db = require('./db');
const config = require('./config');
const settings = require('./settings');

// ---------------------------------------------------------------------------
// The apps of an AkulavBox account. Trove ("box") is the core: every account has
// it. The others can be turned off per account (user_apps; no row = the defaults,
// settings key apps.defaults).
//
// Storage is ONE space per account, shared by every app that keeps files, like a
// Google account's: users.quota_bytes is the limit, and what Trove, e-Management
// and Koma Shelf hold all counts towards it (space(), room()). An app may also get
// a limit of its own inside that space (user_apps.quota_bytes, or the default):
// none unless the admin sets one.
//
// Each app registers hooks once it is loaded (apps/index.js):
//   usage(userId)      bytes stored for that account (null when it stores no files)
//   summary(userId)    a short line for the landing page and the Admin console
//   deleteUser(userId) remove everything of that account (called by delete-user)
//   totals()           { bytes, items } for the whole app
//   close()            on shutdown
// and, for the AI connector, connector: { tools: [...] } (src/core/connector/).
// ---------------------------------------------------------------------------

const { APPS } = require('./app-list');
const byId = new Map(APPS.map((a) => [a.id, a]));
const hooks = new Map(); // id -> { usage, summary, deleteUser, totals, close }
const failures = new Map(); // id -> message, for apps that couldn't start

// Per-app limits inside the shared space are off by default; DOCUMENTS_QUOTA_MB / MANGA_QUOTA_MB
// still set one when they are in .env.
const builtinDefaults = () => Object.fromEntries(APPS.filter((a) => !a.core).map((a) => [a.id, {
  enabled: true,
  quota_bytes: a.id === 'documents' ? config.documentsQuotaBytes : a.id === 'manga' ? config.mangaQuotaBytes : null,
}]));

let defaultsCache = null; // read on every access() check: kept until setDefaults
/** Defaults for accounts without their own setting: { app: { enabled, quota_bytes } } */
function defaults() {
  if (defaultsCache) return structuredClone(defaultsCache);
  const base = builtinDefaults();
  const saved = settings.get('apps.defaults') || {};
  for (const id of Object.keys(base)) {
    const s = saved[id];
    if (!s || typeof s !== 'object') continue;
    if (typeof s.enabled === 'boolean') base[id].enabled = s.enabled;
    if (byId.get(id).quota && s.quota_bytes !== undefined) base[id].quota_bytes = Number(s.quota_bytes) > 0 ? Math.floor(Number(s.quota_bytes)) : null;
  }
  defaultsCache = base;
  return structuredClone(base);
}

/** quota_bytes: a number of bytes, or null for no limit of its own (the account's space only) */
function setDefaults(next) {
  const cur = defaults();
  for (const id of Object.keys(cur)) {
    const s = next?.[id];
    if (!s) continue;
    if (s.enabled !== undefined) cur[id].enabled = !!s.enabled;
    if (s.quota_bytes !== undefined && byId.get(id).quota) {
      if (s.quota_bytes === null || s.quota_bytes === '') { cur[id].quota_bytes = null; continue; }
      const q = Math.floor(Number(s.quota_bytes));
      if (!(q > 0)) throw new Error('Limits must be larger than 0.');
      cur[id].quota_bytes = q;
    }
  }
  settings.set('apps.defaults', cur);
  defaultsCache = null;
  return defaults();
}

const userRow = db.prepare('SELECT id, username, role, token_version FROM users WHERE id = ?');
/** An account by id (for apps that hold their own tokens, like Koma Shelf's API tokens) */
const boxUser = (id) => userRow.get(id) || null;

const rowOf = db.prepare('SELECT enabled, quota_bytes FROM user_apps WHERE user_id = ? AND app = ?');
const boxRow = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?');

/** { enabled, quota_bytes, custom_quota } of an app for an account */
function access(userId, appId) {
  const app = byId.get(appId);
  if (!app) return { enabled: false, quota_bytes: null };
  if (app.core) {
    const u = boxRow.get(userId);
    return { enabled: !!u, quota_bytes: u ? u.quota_bytes : null, custom_quota: true };
  }
  const d = defaults()[appId];
  const r = rowOf.get(userId, appId);
  return {
    enabled: r ? !!r.enabled : d.enabled,
    quota_bytes: app.quota ? (r && r.quota_bytes > 0 ? r.quota_bytes : d.quota_bytes) : null,
    custom_quota: !!(r && r.quota_bytes > 0),
  };
}

const upsert = db.prepare(`INSERT INTO user_apps (user_id, app, enabled, quota_bytes) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, app) DO UPDATE SET enabled = excluded.enabled, quota_bytes = excluded.quota_bytes`);

/** Change one app for one account. quota_bytes null = back to the default. */
function setAccess(userId, appId, { enabled, quota_bytes } = {}) {
  const app = byId.get(appId);
  if (!app || app.core) throw new Error('Unknown app.');
  const cur = access(userId, appId);
  const r = rowOf.get(userId, appId);
  let q = r ? r.quota_bytes : null;
  if (quota_bytes !== undefined) {
    if (quota_bytes === null) q = null;
    else {
      q = Math.floor(Number(quota_bytes));
      if (!(q > 0)) throw new Error('Limits must be larger than 0.');
    }
  }
  upsert.run(userId, appId, (enabled === undefined ? cur.enabled : !!enabled) ? 1 : 0, app.quota ? q : null);
  return access(userId, appId);
}

const forget = db.prepare('DELETE FROM user_apps WHERE user_id = ?');

/** Delete-user: every app removes that account's data. Never throws (the account is already gone). */
function deleteUser(userId) {
  forget.run(userId);
  for (const a of APPS) usageCache.delete(`${userId}:${a.id}`);
  for (const [id, h] of hooks) {
    try { h.deleteUser?.(userId); } catch (e) { console.error(`[apps] ${id}: couldn’t remove the data of ${userId}: ${e.message}`); }
  }
}

// What the other apps hold changes rarely, but Trove asks on every upload chunk: their answers are
// kept for a minute. An app calls changed() after it stores or removes files, so its own checks
// (and the next look at the space) see the new number at once.
const USAGE_TTL = 60_000;
const usageCache = new Map(); // `${userId}:${appId}` -> { bytes, at }

function usage(userId, appId, { fresh = false } = {}) {
  if (appId === 'box') return boxRow.get(userId)?.used_bytes ?? 0;
  const key = `${userId}:${appId}`;
  const hit = usageCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < USAGE_TTL) return hit.bytes;
  let bytes = null;
  try { bytes = hooks.get(appId)?.usage?.(userId) ?? null; } catch (e) { bytes = hit?.bytes ?? null; }
  if (usageCache.size > 5000) usageCache.clear();
  usageCache.set(key, { bytes, at: Date.now() });
  return bytes;
}

/** An app stored or removed files of this account (or of every account when userId is null) */
function changed(userId, appId) {
  if (userId != null) { usageCache.delete(`${userId}:${appId}`); return; }
  for (const k of usageCache.keys()) if (!appId || k.endsWith(`:${appId}`)) usageCache.delete(k);
}

/**
 * The account's storage space, shared by every app:
 * { quota_bytes, used_bytes, free_bytes, by_app: { box, documents, manga } }.
 * `fresh`: an app id whose usage is read now rather than from the cache (the one asking).
 */
function space(userId, { fresh } = {}) {
  const u = boxRow.get(userId);
  if (!u) return null;
  const by_app = {};
  let used = 0;
  for (const a of APPS) {
    if (!a.quota) continue;
    // an app turned off for the account still holds its files: they count too
    const b = a.core || hooks.has(a.id) ? usage(userId, a.id, { fresh: fresh === a.id }) || 0 : 0;
    by_app[a.id] = b;
    used += b;
  }
  return { quota_bytes: u.quota_bytes, used_bytes: used, free_bytes: Math.max(0, u.quota_bytes - used), by_app };
}

/** A space() for the pages: the totals, and each app's part with its name and colour */
const describeSpace = (s) => s && {
  quota_bytes: s.quota_bytes, used_bytes: s.used_bytes, free_bytes: s.free_bytes,
  apps: APPS.filter((a) => a.id in s.by_app).map((a) => ({ id: a.id, name: a.name, color: a.color, path: a.path, bytes: s.by_app[a.id] })),
};

/** Bytes this app may still store for the account: the free space, and its own limit when it has one */
function room(userId, appId) {
  const s = space(userId, { fresh: appId });
  if (!s) return 0;
  let left = s.quota_bytes - s.used_bytes;
  const app = byId.get(appId);
  if (app && !app.core) {
    const limit = access(userId, appId).quota_bytes;
    if (limit) left = Math.min(left, limit - (s.by_app[appId] || 0));
  }
  return Math.max(0, left);
}

/** Will `extra` more bytes fit in this account's space (and the app's own limit)? */
const hasRoom = (userId, appId, extra = 0) => room(userId, appId) >= extra;

function summary(userId, appId) {
  try { return hooks.get(appId)?.summary?.(userId) ?? null; } catch (e) { return null; }
}

/** What the landing page shows: the apps this account can open, and its storage */
function forUser(user) {
  const list = APPS.map((a) => {
    const acc = access(user.id, a.id);
    return {
      id: a.id, name: a.name, path: a.path, tagline: a.tagline, short: a.short, color: a.color,
      enabled: acc.enabled, available: a.core || running(a.id), problem: failures.get(a.id) || null,
      stores_files: !!a.quota, limit_bytes: a.core ? null : acc.quota_bytes, used_bytes: acc.enabled && a.quota ? usage(user.id, a.id) : null,
      summary: acc.enabled ? summary(user.id, a.id) : null,
    };
  }).filter((a) => a.enabled);
  return list;
}

const register = (id, h) => { hooks.set(id, h); failures.delete(id); };
/** An app that couldn't start. Its data hooks (if it has them) still serve usage and delete-user. */
const failed = (id, message, dataHooks) => { failures.set(id, message); if (dataHooks) hooks.set(id, dataHooks); };
const running = (id) => !failures.has(id) && hooks.has(id);
const status = (id) => (byId.get(id)?.core || running(id) ? 'running' : failures.has(id) ? 'failed' : 'off');
function totals(id) { try { return hooks.get(id)?.totals?.() ?? null; } catch (e) { return null; } }
function close() { for (const h of hooks.values()) { try { h.close?.(); } catch (e) { /* shutting down */ } } }

/** The connector tools an app registered (hooks.connector.tools), for the AI connector */
const connectorOf = (id) => (running(id) || byId.get(id)?.core ? hooks.get(id)?.connector || null : null);

module.exports = { APPS, byId, boxUser, defaults, setDefaults, access, setAccess, deleteUser, usage, changed, space, describeSpace, room, summary, hasRoom, forUser, register, failed, failures, status, totals, close, connectorOf };
