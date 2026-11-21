const crypto = require('crypto');
const config = require('../core/config');
const db = require('../core/db');
const apps = require('../core/apps');
const activity = require('../core/activity');
const { verifyUser } = require('../core/auth');
const tokens = require('../core/connector/tokens');
const tools = require('../core/connector/tools');

// ---------------------------------------------------------------------------
// The AI connector: lets an AI app (Claude, or anything that speaks MCP or plain HTTP) read, and when
// allowed change, the apps of an AkulavBox account.
//
//   POST /mcp                      the Model Context Protocol (Streamable HTTP, stateless, JSON answers)
//   GET  /api/connector/tools      the same tools over plain HTTP, for other AIs and scripts
//   POST /api/connector/tools/:name
//   /api/connector/tokens          the account's connectors (the /connect page, signed in)
//   /oauth/*, /.well-known/*       OAuth 2.1 with PKCE and client registration, so an AI app can be
//                                  connected with only the /mcp address (Claude's "custom connector")
//
// Every call carries `Authorization: Bearer akb_…`: a token made in /connect, or one an AI app got
// through OAuth. Its scopes say, per app, 'read' or 'write'; the tools are in core/connector/tools.js.
// ---------------------------------------------------------------------------

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = 'AkulavBox is a self-hosted personal cloud. Its apps: Trove (files, photos, music, videos, books), e-Management (personal and work documents), Florin (expenses, income, budgets), Tick (to-dos) and the game Ironveil. Call akulavbox_account first to see which apps this connector may use and whether it may change things. Tools are named after their app (trove_, docs_, florin_, tick_, ironveil_). Dates are YYYY-MM-DD. Ask before deleting anything.';

const baseOf = (request) => config.publicUrl || `${request.protocol}://${request.host}`;

// a busy AI makes many calls; this keeps a runaway one from hogging the server
const RATE = { windowMs: 60_000, max: 240 };
const hits = new Map();
function limited(key) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now - h.start > RATE.windowMs) { h = { start: now, n: 0 }; hits.set(key, h); }
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > RATE.windowMs) hits.delete(k);
  return ++h.n > RATE.max;
}

/** The connector token of a request, or null */
function bearer(request) {
  const h = String(request.headers.authorization || '');
  return h.startsWith('Bearer ') ? tokens.verify(h.slice(7).trim()) : null;
}

// ---------- MCP results ----------
function asContent(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const { image, text, ...rest } = result;
    if (image) return { content: [{ type: 'image', data: image.data, mimeType: image.mimeType }, { type: 'text', text: JSON.stringify(rest, null, 2) }] };
    if (typeof text === 'string') return { content: [{ type: 'text', text: JSON.stringify(rest, null, 2) }, { type: 'text', text }] };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result ?? { success: true }, null, 2) }] };
}

async function callTool(t, name, args, log) {
  try {
    return asContent(await tools.run(t, name, args));
  } catch (e) {
    if (!(e instanceof tools.ToolError)) log.error(e, `connector tool ${name} failed`);
    return { content: [{ type: 'text', text: e instanceof tools.ToolError ? e.message : 'Something went wrong on the server. Try again.' }], isError: true };
  }
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function rpc(msg, t, log) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id ?? null, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  if (id === undefined) return null; // a notification (notifications/initialized, cancelled, …): nothing to answer
  switch (method) {
    case 'initialize': return reply(id, {
      protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[1],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'akulavbox', title: 'AkulavBox', version: config.version },
      instructions: INSTRUCTIONS,
    });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: tools.forToken(t).map(tools.describe) });
    case 'tools/call':
      if (typeof params.name !== 'string') return fail(id, -32602, 'params.name is required');
      return reply(id, await callTool(t, params.name, params.arguments, log));
    case 'resources/list': return reply(id, { resources: [] });
    case 'prompts/list': return reply(id, { prompts: [] });
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}

// ---------- OAuth ----------
const clientOf = db.prepare('SELECT * FROM oauth_clients WHERE id = ?');
const BAD_SCHEMES = /^(javascript|data|file|vbscript|blob|about):/i;
function validRedirect(uri) {
  if (typeof uri !== 'string' || uri.length > 500 || BAD_SCHEMES.test(uri)) return false;
  let u;
  try { u = new URL(uri); } catch (e) { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol); // an app's own scheme (claude://…)
}

/** Checks an authorization request; returns { client, scopes } or { error } */
function checkRequest(q) {
  const client = q.client_id ? clientOf.get(String(q.client_id)) : null;
  if (!client) return { error: 'This app isn’t registered with this server. Connect it again from the AI app.' };
  const uris = JSON.parse(client.redirect_uris);
  if (!uris.includes(q.redirect_uri)) return { error: 'The app asked to come back to an address it didn’t register.' };
  if (q.response_type !== 'code') return { error: 'Only the authorization code flow is supported.' };
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return { error: 'The app must use PKCE (S256).' };
  return { client, scopes: tokens.scopesFromString(q.scope) };
}
const withParams = (uri, params) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  return u.toString();
};

module.exports = async function (fastify) {
  tools.bind(fastify);
  const sweep = () => { try { tokens.sweep(); } catch (e) { fastify.log.warn(e, 'connector sweep failed'); } };
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, 3600_000).unref();

  // AI apps may run in a browser (an MCP inspector): the connector's endpoints answer any origin.
  // They take bearer tokens only, never cookies, so this opens nothing else.
  const OPEN = /^\/(mcp|oauth\/(token|register|revoke)|\.well-known\/|api\/connector\/tools)/;
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (!OPEN.test(request.url)) return payload;
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version');
    return payload;
  });
  const preflight = async (request, reply) => reply.code(204)
    .header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID')
    .header('Access-Control-Max-Age', '86400').send();
  for (const p of ['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke', '/api/connector/tools', '/api/connector/tools/:name']) fastify.options(p, preflight);

  const unauthorized = (request, reply, why = 'A connector token is needed: make one at /connect, or connect the AI app with OAuth.') => reply.code(401)
    .header('WWW-Authenticate', `Bearer resource_metadata="${baseOf(request)}/.well-known/oauth-protected-resource"${why.includes('expired') ? ', error="invalid_token"' : ''}`)
    .send({ error: why });

  // ---------- MCP ----------
  // Any origin may call it (browser-based MCP clients): every call needs a bearer token, which a web
  // page can't borrow from the browser the way it could a cookie, so DNS rebinding gains nothing.
  fastify.post('/mcp', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const t = bearer(request);
    if (!t) return unauthorized(request, reply, request.headers.authorization ? 'This connector token is wrong, revoked or expired.' : undefined);
    if (limited(t.id)) return reply.code(429).header('Retry-After', '30').send(fail(null, -32000, 'Too many requests. Slow down a little.'));
    const body = request.body;
    if (Array.isArray(body)) {
      if (body.length > 50) return reply.code(400).send(fail(null, -32600, 'Too many messages in one batch.'));
      const out = (await Promise.all(body.map((m) => rpc(m, t, request.log)))).filter(Boolean);
      return out.length ? reply.type('application/json').send(out) : reply.code(202).send();
    }
    const out = await rpc(body, t, request.log);
    return out ? reply.type('application/json').send(out) : reply.code(202).send();
  });
  // no server-sent stream and no sessions: every answer comes back on its own POST
  fastify.get('/mcp', async (request, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'Use POST: this server answers every message directly, without a stream.' }));
  fastify.delete('/mcp', async (request, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'There are no sessions to end.' }));

  // ---------- the same tools over plain HTTP ----------
  fastify.get('/api/connector/tools', async (request, reply) => {
    const t = bearer(request);
    if (!t) return unauthorized(request, reply);
    return { account: t.user.username, connector: t.name, tools: tools.forToken(t).map(tools.describe) };
  });
  fastify.post('/api/connector/tools/:name', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const t = bearer(request);
    if (!t) return unauthorized(request, reply);
    if (limited(t.id)) return reply.code(429).header('Retry-After', '30').send({ error: 'Too many requests. Slow down a little.' });
    try {
      return { result: await tools.run(t, request.params.name, request.body || {}) };
    } catch (e) {
      if (!(e instanceof tools.ToolError)) { request.log.error(e, 'connector tool failed'); return reply.code(500).send({ error: 'Something went wrong on the server. Try again.' }); }
      return reply.code(400).send({ error: e.message });
    }
  });

  // ---------- the account's connectors (/connect) ----------
  const appsFor = (user) => apps.APPS.map((a) => ({ id: a.id, name: a.name, color: a.color, tagline: a.short || a.tagline, enabled: apps.access(user.id, a.id).enabled && apps.status(a.id) === 'running', tools: tools.all().filter((x) => x.app === a.id).map((x) => ({ name: x.name, title: x.title, write: !!x.write, destructive: !!x.destructive })) }));
  fastify.get('/api/connector/tokens', { preHandler: verifyUser }, async (request) => ({
    tokens: tokens.list(request.user.id),
    apps: appsFor(request.user),
    mcp_url: `${baseOf(request)}/mcp`,
    base_url: baseOf(request),
  }));
  fastify.post('/api/connector/tokens', { preHandler: verifyUser }, async (request, reply) => {
    const b = request.body || {};
    const days = b.days === null || b.days === undefined || b.days === '' ? null : Math.floor(Number(b.days));
    if (days !== null && !(days >= 1 && days <= 3650)) return reply.code(400).send({ error: 'Pick how long it lasts: 1 to 3650 days, or never.' });
    let r;
    try { r = tokens.create(request.user.id, { name: b.name, scopes: b.scopes, days }); } catch (e) { return reply.code(400).send({ error: e.message }); }
    activity.log(request, 'account.connector_created', { target: r.row.name, detail: tokens.scopesToString(r.row.scopes) });
    return { token: r.token, connector: r.row };
  });
  fastify.patch('/api/connector/tokens/:id', { preHandler: verifyUser }, async (request, reply) => {
    let r;
    try { r = tokens.update(request.user.id, request.params.id, request.body || {}); } catch (e) { return reply.code(400).send({ error: e.message }); }
    if (!r) return reply.code(404).send({ error: 'Connector not found' });
    activity.log(request, 'account.connector_changed', { target: r.name, detail: tokens.scopesToString(r.scopes) });
    return { connector: r };
  });
  fastify.delete('/api/connector/tokens/:id', { preHandler: verifyUser }, async (request, reply) => {
    const row = tokens.list(request.user.id).find((x) => x.id === request.params.id);
    if (!row || !tokens.revoke(request.user.id, request.params.id)) return reply.code(404).send({ error: 'Connector not found' });
    activity.log(request, 'account.connector_revoked', { target: row.name });
    return { success: true };
  });

  // ---------- OAuth: discovery ----------
  const resourceMeta = (request) => ({
    resource: `${baseOf(request)}/mcp`,
    authorization_servers: [baseOf(request)],
    scopes_supported: tokens.APP_IDS.flatMap((a) => [`${a}:read`, `${a}:write`]),
    bearer_methods_supported: ['header'],
    resource_name: 'AkulavBox',
    resource_documentation: `${baseOf(request)}/connect`,
  });
  const serverMeta = (request) => {
    const b = baseOf(request);
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: resourceMeta(request).scopes_supported,
      service_documentation: `${b}/connect`,
    };
  };
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) fastify.get(p, async (request) => resourceMeta(request));
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration']) fastify.get(p, async (request) => serverMeta(request));

  // ---------- OAuth: an AI app registers itself (RFC 7591) ----------
  const registered = new Map(); // ip -> { start, n }
  fastify.post('/oauth/register', async (request, reply) => {
    const now = Date.now();
    const r = registered.get(request.ip) || { start: now, n: 0 };
    if (now - r.start > 3600_000) { r.start = now; r.n = 0; }
    registered.set(request.ip, r);
    if (++r.n > 20) return reply.code(429).send({ error: 'too_many_requests', error_description: 'Too many registrations from this address. Try again later.' });
    if (db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get().n >= 1000) return reply.code(400).send({ error: 'invalid_client_metadata', error_description: 'This server has too many registered apps.' });
    const b = request.body || {};
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.slice(0, 10) : [];
    if (!uris.length || !uris.every(validRedirect)) return reply.code(400).send({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https addresses (or http on localhost, or an app’s own scheme).' });
    const name = String(b.client_name || 'AI app').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'AI app';
    const id = `akc_${crypto.randomBytes(16).toString('base64url')}`;
    db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris) VALUES (?, ?, ?)').run(id, name, JSON.stringify(uris));
    return reply.code(201).send({
      client_id: id, client_name: name, redirect_uris: uris, client_id_issued_at: Math.floor(now / 1000),
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    });
  });

  // ---------- OAuth: the person approves (a page of this server, signed in) ----------
  // the page itself, /oauth/authorize, is served by modules/hub.js with the other hub pages
  // what the page shows: the app's name and where it goes back to (public: no account involved)
  fastify.get('/api/oauth/request', async (request, reply) => {
    const c = checkRequest(request.query || {});
    if (c.error) return reply.code(400).send({ error: c.error });
    let host = '';
    try { host = new URL(request.query.redirect_uri).host || new URL(request.query.redirect_uri).protocol; } catch (e) { /* checked above */ }
    return { client: { name: c.client.name, goes_to: host }, scopes: c.scopes };
  });
  fastify.get('/api/oauth/apps', { preHandler: verifyUser }, async (request) => ({ apps: appsFor(request.user) }));
  fastify.post('/api/oauth/approve', { preHandler: verifyUser }, async (request, reply) => {
    const b = request.body || {};
    const c = checkRequest(b);
    if (c.error) return reply.code(400).send({ error: c.error });
    if (b.deny) return { redirect: withParams(b.redirect_uri, { error: 'access_denied', error_description: 'The person declined.', state: b.state }) };
    const scopes = tokens.cleanScopes(b.scopes);
    if (!Object.keys(scopes).length) return reply.code(400).send({ error: 'Give the app access to at least one app, or decline.' });
    const code = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tokens.sha(code), c.client.id, request.user.id, b.redirect_uri, String(b.code_challenge), JSON.stringify(scopes), Date.now() + 10 * 60_000);
    activity.log(request, 'account.connector_authorized', { target: c.client.name, detail: tokens.scopesToString(scopes) });
    return { redirect: withParams(b.redirect_uri, { code, state: b.state, iss: baseOf(request) }) };
  });

  // ---------- OAuth: codes and refresh tokens become access tokens ----------
  const oauthError = (reply, error, description, code = 400) => reply.code(code).header('Cache-Control', 'no-store').send({ error, error_description: description });
  fastify.post('/oauth/token', async (request, reply) => {
    const b = request.body || {};
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    if (b.grant_type === 'authorization_code') {
      const row = b.code ? db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(tokens.sha(b.code)) : null;
      if (row) db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(row.code_hash); // one use only
      if (!row || row.expires_at < Date.now()) return oauthError(reply, 'invalid_grant', 'The code is wrong, used or expired.');
      if ((b.client_id && b.client_id !== row.client_id) || b.redirect_uri !== row.redirect_uri) return oauthError(reply, 'invalid_grant', 'The code was given to another app or address.');
      const verifier = String(b.code_verifier || '');
      if (verifier.length < 43 || verifier.length > 128 || crypto.createHash('sha256').update(verifier).digest('base64url') !== row.challenge) return oauthError(reply, 'invalid_grant', 'The PKCE code verifier doesn’t match.');
      const client = clientOf.get(row.client_id);
      if (!client || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(row.user_id)) return oauthError(reply, 'invalid_grant', 'The app or the account no longer exists.');
      let t;
      try { t = tokens.create(row.user_id, { name: client.name, scopes: JSON.parse(row.scopes), client }); } catch (e) { return oauthError(reply, 'invalid_request', e.message); }
      db.prepare("UPDATE oauth_clients SET last_used_at = datetime('now') WHERE id = ?").run(client.id);
      return { access_token: t.token, token_type: 'Bearer', expires_in: t.expiresIn, refresh_token: t.refresh, scope: tokens.scopesToString(t.row.scopes) };
    }
    if (b.grant_type === 'refresh_token') {
      const t = tokens.refresh(String(b.refresh_token || ''), b.client_id || null);
      if (!t) return oauthError(reply, 'invalid_grant', 'The refresh token is wrong, revoked or expired. Connect the app again.');
      return { access_token: t.token, token_type: 'Bearer', expires_in: t.expiresIn, refresh_token: t.refresh, scope: tokens.scopesToString(t.scopes) };
    }
    return oauthError(reply, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });
  fastify.post('/oauth/revoke', async (request) => {
    const t = request.body?.token;
    if (typeof t === 'string') tokens.revokeToken(t);
    return {}; // RFC 7009: the same answer whether or not the token existed
  });
};
