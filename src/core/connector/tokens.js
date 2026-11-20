// AI connector tokens: what an AI app (Claude, …) may do in each app of an AkulavBox account.
//
// A token is `akb_` + 32 random bytes (base64url). Only its SHA-256 is stored (connector_tokens), with
// its scopes: { box: 'read' | 'write', documents: …, manga: …, budget: …, tasks: … } (a missing app
// means no access). Tokens made by hand (/connect) live until they expire or are revoked; tokens of
// an app that signed in through OAuth (/oauth) expire after a day and come back with their refresh
// token (90 days, a new pair each time).
const crypto = require('crypto');
const db = require('../db');
const { APPS } = require('../app-list');

const LEVELS = ['read', 'write'];
const APP_IDS = APPS.map((a) => a.id);
const MAX_PER_USER = 50;
const ACCESS_TTL = 24 * 3600; // seconds, OAuth access tokens
const REFRESH_TTL = 90 * 24 * 3600;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newSecret = (prefix) => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
const sqlTime = (secondsFromNow) => new Date(Date.now() + secondsFromNow * 1000).toISOString().replace('T', ' ').slice(0, 19);

/** Clean scopes: { app: 'read' | 'write' } for known apps only */
function cleanScopes(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const id of APP_IDS) if (LEVELS.includes(input[id])) out[id] = input[id];
  return out;
}

/** OAuth scope strings ("box:read tasks:write") to scopes, and back. An empty string means read everything. */
function scopesFromString(s) {
  const out = {};
  for (const part of String(s || '').split(/[\s,]+/).filter(Boolean)) {
    const [app, level] = part.split(':');
    if (APP_IDS.includes(app) && LEVELS.includes(level) && out[app] !== 'write') out[app] = level;
  }
  return out;
}
const scopesToString = (scopes) => Object.entries(scopes).map(([a, l]) => `${a}:${l}`).join(' ');

const parseScopes = (json) => { try { return cleanScopes(JSON.parse(json)); } catch (e) { return {}; } };

const shape = (r) => ({
  id: r.id, name: r.name, kind: r.kind, client_id: r.client_id, prefix: r.prefix, scopes: parseScopes(r.scopes),
  created_at: r.created_at, last_used_at: r.last_used_at, expires_at: r.kind === 'oauth' ? r.refresh_expires_at : r.expires_at,
});

const countOf = db.prepare('SELECT COUNT(*) AS n FROM connector_tokens WHERE user_id = ?');
const insert = db.prepare(`INSERT INTO connector_tokens (id, user_id, name, kind, client_id, token_hash, prefix, refresh_hash, scopes, expires_at, refresh_expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

/**
 * A new token. days: null for one that never expires. Returns { token, row } (the token is shown once).
 * OAuth tokens (client) also get a refresh token.
 */
function create(userId, { name, scopes, days = null, client = null }) {
  const clean = cleanScopes(scopes);
  if (!Object.keys(clean).length) throw new Error('Give the connector access to at least one app.');
  if (countOf.get(userId).n >= MAX_PER_USER) throw new Error(`An account can have up to ${MAX_PER_USER} connectors. Revoke one you no longer use.`);
  const id = crypto.randomUUID();
  const token = newSecret('akb_');
  const refresh = client ? newSecret('akbr_') : null;
  const expires = client ? sqlTime(ACCESS_TTL) : days ? sqlTime(days * 86400) : null;
  insert.run(id, userId, String(name || 'Connector').trim().slice(0, 80) || 'Connector', client ? 'oauth' : 'token', client?.id || null,
    sha(token), token.slice(0, 10), refresh ? sha(refresh) : null, JSON.stringify(clean), expires, refresh ? sqlTime(REFRESH_TTL) : null);
  return { token, refresh, expiresIn: client ? ACCESS_TTL : null, row: shape(byId.get(id)) };
}

const byId = db.prepare('SELECT * FROM connector_tokens WHERE id = ?');
const byHash = db.prepare('SELECT * FROM connector_tokens WHERE token_hash = ?');
const byRefresh = db.prepare('SELECT * FROM connector_tokens WHERE refresh_hash = ?');
const touch = db.prepare("UPDATE connector_tokens SET last_used_at = datetime('now') WHERE id = ?");
const rotate = db.prepare("UPDATE connector_tokens SET token_hash = ?, prefix = ?, refresh_hash = ?, expires_at = ?, refresh_expires_at = ?, last_used_at = datetime('now') WHERE id = ?");
const expired = (t) => !!t && t < new Date().toISOString().replace('T', ' ').slice(0, 19);

// last_used_at is written at most once a minute per token: a busy AI makes many calls
const lastTouch = new Map();

/** The token's row and its account, or null: { id, user, scopes, name, kind } */
function verify(token) {
  if (typeof token !== 'string' || !token.startsWith('akb_') || token.length > 200) return null;
  const r = byHash.get(sha(token));
  if (!r || expired(r.expires_at)) return null;
  const user = db.prepare('SELECT id, username, role, token_version FROM users WHERE id = ?').get(r.user_id);
  if (!user) return null;
  const now = Date.now();
  if (now - (lastTouch.get(r.id) || 0) > 60_000) {
    lastTouch.set(r.id, now);
    if (lastTouch.size > 2000) lastTouch.clear();
    touch.run(r.id);
  }
  return { id: r.id, user, scopes: parseScopes(r.scopes), name: r.name, kind: r.kind, clientId: r.client_id };
}

/** A refresh token → a new access + refresh pair for the same grant (the old ones stop working) */
function refresh(refreshToken, clientId) {
  if (typeof refreshToken !== 'string' || !refreshToken.startsWith('akbr_')) return null;
  const r = byRefresh.get(sha(refreshToken));
  if (!r || expired(r.refresh_expires_at) || (clientId && r.client_id !== clientId)) return null;
  const token = newSecret('akb_');
  const next = newSecret('akbr_');
  rotate.run(sha(token), token.slice(0, 10), sha(next), sqlTime(ACCESS_TTL), sqlTime(REFRESH_TTL), r.id);
  return { token, refresh: next, expiresIn: ACCESS_TTL, scopes: parseScopes(r.scopes) };
}

const list = (userId) => db.prepare('SELECT * FROM connector_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(shape);

/** Revoke one of the account's tokens; true when there was one */
const revoke = (userId, id) => db.prepare('DELETE FROM connector_tokens WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;

/** Revoke by the token itself (OAuth revocation endpoint), access or refresh */
function revokeToken(token) {
  const r = byHash.get(sha(token)) || byRefresh.get(sha(token));
  if (r) db.prepare('DELETE FROM connector_tokens WHERE id = ?').run(r.id);
  return !!r;
}

/** Change a token's name or scopes */
function update(userId, id, { name, scopes }) {
  const r = byId.get(id);
  if (!r || r.user_id !== userId) return null;
  const clean = scopes !== undefined ? cleanScopes(scopes) : parseScopes(r.scopes);
  if (!Object.keys(clean).length) throw new Error('Give the connector access to at least one app.');
  const n = name !== undefined ? String(name).trim().slice(0, 80) || r.name : r.name;
  db.prepare('UPDATE connector_tokens SET name = ?, scopes = ? WHERE id = ?').run(n, JSON.stringify(clean), id);
  return shape(byId.get(id));
}

/** Delete-user */
function forgetUser(userId) {
  db.prepare('DELETE FROM connector_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM oauth_codes WHERE user_id = ?').run(userId);
}

/** Expired tokens and codes go (hourly) */
function sweep() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("DELETE FROM connector_tokens WHERE (kind = 'token' AND expires_at IS NOT NULL AND expires_at < ?) OR (kind = 'oauth' AND refresh_expires_at < ?)").run(now, now);
  db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(Date.now());
  // apps that registered but were never used for a month
  db.prepare("DELETE FROM oauth_clients WHERE last_used_at IS NULL AND created_at < datetime('now', '-30 days')").run();
}

module.exports = { create, verify, refresh, list, revoke, revokeToken, update, forgetUser, sweep, cleanScopes, scopesFromString, scopesToString, sha, LEVELS, APP_IDS };
