const db = require('./db');
const config = require('./config');
const settings = require('./settings');

// ---------------------------------------------------------------------------
// The apps that share one sign-in. AkulavBox ("box") is the core: every account
// has it, with the quota in users.quota_bytes. The others can be turned off per
// account and (when they store files) have their own quota, in user_apps.
// A missing user_apps row means the defaults (settings key apps.defaults).
//
// Each app registers hooks once it is loaded (src/apps.js):
//   usage(userId)      bytes stored for that account (null when it stores no files)
//   summary(userId)    a short line for the landing page and the Admin console
//   deleteUser(userId) remove everything of that account (called by delete-user)
//   totals()           { bytes, items } for the whole app
//   close()            on shutdown
// ---------------------------------------------------------------------------

const APPS = [
  { id: 'box', name: 'AkulavBox', path: '/box/', tagline: 'Files, photos, music, videos and books, encrypted on your server.', color: '#E8A33D', core: true, quota: true },
  { id: 'documents', name: 'e-Management', path: '/docs/', tagline: 'Personal and work documents with categories, tags and attachments.', color: '#3b82f6', quota: true },
  { id: 'manga', name: 'Koma Shelf', path: '/manga/', tagline: 'Webtoons made with Koma: a private library and a public shelf.', color: '#f03862', quota: true },
  { id: 'budget', name: 'Florin', path: '/budget/', tagline: 'Expenses and income in any currency, with budgets and charts.', color: '#1baf7a', quota: false },
];
const byId = new Map(APPS.map((a) => [a.id, a]));
const hooks = new Map(); // id -> { usage, summary, deleteUser, totals, close }
const failures = new Map(); // id -> message, for apps that couldn't start

const builtinDefaults = () => ({
  documents: { enabled: true, quota_bytes: config.documentsQuotaBytes },
  manga: { enabled: true, quota_bytes: config.mangaQuotaBytes },
  budget: { enabled: true, quota_bytes: null },
});

/** Defaults for accounts without their own setting: { app: { enabled, quota_bytes } } */
function defaults() {
  const base = builtinDefaults();
  const saved = settings.get('apps.defaults') || {};
  for (const id of Object.keys(base)) {
    const s = saved[id];
    if (!s || typeof s !== 'object') continue;
    if (typeof s.enabled === 'boolean') base[id].enabled = s.enabled;
    if (byId.get(id).quota && Number(s.quota_bytes) > 0) base[id].quota_bytes = Math.floor(Number(s.quota_bytes));
  }
  return base;
}

function setDefaults(next) {
  const cur = defaults();
  for (const id of Object.keys(cur)) {
    const s = next?.[id];
    if (!s) continue;
    if (s.enabled !== undefined) cur[id].enabled = !!s.enabled;
    if (s.quota_bytes !== undefined && byId.get(id).quota) {
      const q = Math.floor(Number(s.quota_bytes));
      if (!(q > 0)) throw new Error('Quotas must be larger than 0.');
      cur[id].quota_bytes = q;
    }
  }
  settings.set('apps.defaults', cur);
  return cur;
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
      if (!(q > 0)) throw new Error('Quotas must be larger than 0.');
    }
  }
  upsert.run(userId, appId, (enabled === undefined ? cur.enabled : !!enabled) ? 1 : 0, app.quota ? q : null);
  return access(userId, appId);
}

const forget = db.prepare('DELETE FROM user_apps WHERE user_id = ?');

/** Delete-user: every app removes that account's data. Never throws (the account is already gone). */
function deleteUser(userId) {
  forget.run(userId);
  for (const [id, h] of hooks) {
    try { h.deleteUser?.(userId); } catch (e) { console.error(`[apps] ${id}: couldn’t remove the data of ${userId}: ${e.message}`); }
  }
}

function usage(userId, appId) {
  if (appId === 'box') return boxRow.get(userId)?.used_bytes ?? 0;
  try { return hooks.get(appId)?.usage?.(userId) ?? null; } catch (e) { return null; }
}

function summary(userId, appId) {
  try { return hooks.get(appId)?.summary?.(userId) ?? null; } catch (e) { return null; }
}

/** Will `extra` more bytes fit in this account's quota for the app? */
function hasRoom(userId, appId, extra = 0) {
  const a = access(userId, appId);
  if (!a.quota_bytes) return true;
  return (usage(userId, appId) || 0) + extra <= a.quota_bytes;
}

/** What the landing page shows: the apps this account can open */
function forUser(user) {
  return APPS.map((a) => {
    const acc = access(user.id, a.id);
    return {
      id: a.id, name: a.name, path: a.path, tagline: a.tagline, color: a.color,
      enabled: acc.enabled, available: a.core || running(a.id), problem: failures.get(a.id) || null,
      quota_bytes: acc.quota_bytes, used_bytes: acc.enabled ? usage(user.id, a.id) : null,
      summary: acc.enabled ? summary(user.id, a.id) : null,
    };
  }).filter((a) => a.enabled);
}

const register = (id, h) => { hooks.set(id, h); failures.delete(id); };
/** An app that couldn't start. Its data hooks (if it has them) still serve usage and delete-user. */
const failed = (id, message, dataHooks) => { failures.set(id, message); if (dataHooks) hooks.set(id, dataHooks); };
const running = (id) => !failures.has(id) && hooks.has(id);
const status = (id) => (byId.get(id)?.core || running(id) ? 'running' : failures.has(id) ? 'failed' : 'off');
function totals(id) { try { return hooks.get(id)?.totals?.() ?? null; } catch (e) { return null; } }
function close() { for (const h of hooks.values()) { try { h.close?.(); } catch (e) { /* shutting down */ } } }

module.exports = { APPS, byId, boxUser, defaults, setDefaults, access, setAccess, deleteUser, usage, summary, hasRoom, forUser, register, failed, failures, status, totals, close };
