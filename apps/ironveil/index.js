'use strict';
// Ironveil (/ironveil): Akulav's automation and tower-defense game (github.com/Akulav/strategy-game) in
// its browser build, behind the AkulavBox sign-in, with its saves kept for the account (saves.js).
//
// public/game/ is the game's own web build (gl.js, audio.js, storage.js, ironveil.wasm), copied by
// `npm run ironveil` (scripts/ironveil.js); public/play.js connects the game's storage bridge
// (web/storage.js in the game) to /ironveil/api/saves, so the game reads its saves from memory and
// they are written to the server in the background.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const apps = require('../../src/core/apps');
const assets = require('../../src/core/assets');
const session = require('../../src/core/session');
const bus = require('../../src/core/bus');
const saves = require('./saves');

const PUBLIC = path.join(__dirname, 'public');
const WASM = path.join(PUBLIC, 'game', 'ironveil.wasm');
const MAX_SAVE = 32 * 1024 * 1024;

// WebAssembly needs 'wasm-unsafe-eval'; nothing else runs but this server's own scripts
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "connect-src 'self'", "media-src 'self' blob:", "object-src 'none'",
  "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
].join('; ');

const hooks = {
  usage: (userId) => saves.usage(userId),
  summary: (userId) => {
    const p = saves.profile(userId);
    if (!p || !p.runs) return 'No games yet';
    return `Best wave ${p.best_wave || 0} · ${p.runs} run${p.runs === 1 ? '' : 's'}`;
  },
  totals: () => saves.totals(),
  deleteUser: (userId) => saves.deleteUser(userId),
  connector: require('./connector'),
};

/** The game's .wasm, read and gzipped once per build (the file's date and size), with an ETag */
let wasm = null;
function wasmFile() {
  const st = fs.statSync(WASM);
  const sig = `${st.size}:${st.mtimeMs}`;
  if (!wasm || wasm.sig !== sig) {
    const body = fs.readFileSync(WASM);
    wasm = { sig, body, gz: zlib.gzipSync(body, { level: 9 }), etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"` };
  }
  return wasm;
}

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

module.exports = async function ironveil(app) {
  apps.register('ironveil', hooks);

  // the account, from the shared sign-in cookie
  app.addHook('onRequest', async (req, reply) => {
    req.user = null;
    req.noAccess = false;
    const s = session.userOf(req, reply);
    if (!s) return;
    if (apps.access(s.user.id, 'ironveil').enabled) req.user = { id: s.user.id, username: s.user.username, role: s.user.role };
    else req.noAccess = true;
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('Content-Security-Policy', CSP).header('X-Content-Type-Options', 'nosniff').header('Cross-Origin-Resource-Policy', 'same-origin');
  });

  // ---------- the page ----------
  const page = async (req, reply) => {
    if (req.noAccess) {
      return reply.code(403).type('text/html; charset=utf-8').header('Cache-Control', 'no-store')
        .send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ironveil</title><body style="font-family:system-ui,sans-serif;background:#06080e;color:#e3ebe9;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><div style="max-width:480px"><h1 style="font-size:22px">Ironveil isn’t turned on for your account</h1><p style="color:#8ea1a4">Ask the admin of this server to turn it on.</p><p><a style="color:#f0732e" href="/">Back to all apps</a></p></div>');
    }
    if (!req.user) return reply.redirect(session.loginUrl('/ironveil/'));
    return assets.sendPage(req, reply, path.join(PUBLIC, 'index.html'));
  };
  app.get('/', page);

  app.get('/game/ironveil.wasm', async (req, reply) => {
    let w;
    try { w = wasmFile(); } catch (e) { return reply.code(404).send({ error: 'The game isn’t built on this server (npm run ironveil).' }); }
    reply.header('Cache-Control', 'no-cache').header('ETag', w.etag).header('Vary', 'Accept-Encoding').type('application/wasm');
    if (req.headers['if-none-match'] === w.etag) return reply.code(304).send();
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return reply.header('Content-Encoding', 'gzip').send(w.gz);
    return reply.send(w.body);
  });

  // icons and the install manifest (scripts and styles are versioned through src/core/assets.js)
  app.register(require('@fastify/static'), {
    root: PUBLIC, prefix: '/', decorateReply: false, index: false, maxAge: 0,
    allowedPath: (p) => !p.endsWith('.html') && !p.endsWith('.wasm'),
  });

  // ---------- the saves ----------
  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      if (req.noAccess) return reply.code(403).send({ error: 'Ironveil isn’t turned on for your account.' });
      if (!req.user) return reply.code(401).send({ error: 'Not signed in' });
      reply.header('Cache-Control', 'no-store');
      if (['GET', 'HEAD'].includes(req.method)) return;
      // cross-site pages can't set this header, and can't send it cross-origin without CORS
      if (req.headers['x-requested-with'] !== 'ironveil' || !session.sameOrigin(req)) return reply.code(403).send({ error: 'Missing CSRF header' });
    });
    api.setErrorHandler((err, req, reply) => {
      const status = err.statusCode || err.status || 500;
      if (status >= 500) req.log.error(err);
      reply.code(status).send({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
    });
    api.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Not found' }));

    // every save, for the game to read from memory
    api.get('/saves', async (req) => {
      const all = saves.all(req.user.id);
      return {
        saves: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.text])),
        updated: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.updated_at])),
      };
    });

    api.put('/saves/:key', { bodyLimit: MAX_SAVE }, async (req) => {
      const { key } = req.params;
      if (!saves.validKey(key)) throw fail(400, 'That isn’t a save name.');
      const text = typeof req.body === 'string' ? req.body : '';
      if (!/^\s*[[{]/.test(text)) throw fail(400, 'A save is a JSON text.');
      const before = saves.sizeOf(req.user.id, key);
      if (!before && saves.count(req.user.id) >= saves.MAX_KEYS) throw fail(400, 'Too many saves.');
      const bytes = Buffer.byteLength(text);
      if (bytes - before > apps.room(req.user.id, 'ironveil')) throw fail(413, 'Your storage is full: the game can’t be saved. Free some space in your apps.');
      saves.write(req.user.id, key, text);
      bus.emit('storage.changed', { userId: req.user.id, app: 'ironveil' });
      return { ok: true, bytes };
    });

    api.delete('/saves/:key', async (req) => {
      if (!saves.validKey(req.params.key)) throw fail(400, 'That isn’t a save name.');
      saves.remove(req.user.id, req.params.key);
      bus.emit('storage.changed', { userId: req.user.id, app: 'ironveil' });
      return { ok: true };
    });

    // what the profile says, in plain words (the AI connector, the launcher)
    api.get('/profile', async (req) => {
      const p = saves.profile(req.user.id);
      return {
        played: !!p,
        runs: p?.runs || 0,
        best_wave: p?.best_wave || 0,
        total_kills: p?.total_kills || 0,
        play_time_hours: p ? Math.round(((p.total_time || 0) / 3600) * 10) / 10 : 0,
        legacy_shards: p?.shards || 0,
        achievements: p?.unlocked || [],
        run_in_progress: saves.sizeOf(req.user.id, 'run') > 0,
      };
    });
  }, { prefix: '/api' });
};
