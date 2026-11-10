const path = require('path');
const config = require('./core/config');

// Refuse to start with a configuration that would fail later in confusing ways
const { problems, warnings } = config.validate();
for (const w of warnings) console.warn(`[config] Warning: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`[config] ${p}`);
  process.exit(1);
}

// Login tokens travel in ?token= for media URLs: keep them out of the logs
const redact = (url) => String(url || '').replace(/([?&]token=)[^&]+/g, '$1[redacted]');

// Logging every request (hundreds per photo grid) slows things down; set LOG_LEVEL=info to see them
const fastify = require('fastify')({
  logger: {
    level: config.logLevel,
    serializers: { req: (req) => ({ method: req.method, url: redact(req.url), remoteAddress: req.ip }) },
  },
  trustProxy: process.env.TRUST_PROXY === '1',
});

const db = require('./core/db');
const instance = require('./core/instance');
const activity = require('./core/activity');
const backup = require('./core/backup');

// The app is served from this same origin, so other sites get no CORS access by default.
// CORS_ORIGIN=https://a.example,https://b.example opens the API to those origins (e.g. a separate client).
fastify.register(require('@fastify/cors'), { origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['X-Refresh-Token'] });

// Baseline security headers for every response
fastify.addHook('onSend', async (request, reply, payload) => {
  // never send ?token= URLs to other sites in the Referer header
  reply.header('Referrer-Policy', 'same-origin');
  if (!reply.hasHeader('X-Content-Type-Options')) reply.header('X-Content-Type-Options', 'nosniff');
  if (!request.url.startsWith('/shared/')) {
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    // a page opened from here (a shared link, a file) can't reach back into the signed-in window
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  }
  // the app itself (user files carry their own sandbox CSP from mime.fileCsp): no plugins,
  // no <base> hijacking, forms only post back here, and no framing by other sites
  if (!reply.hasHeader('Content-Security-Policy') && /^text\/html/.test(String(reply.getHeader('content-type') || ''))) {
    reply.header('Content-Security-Policy', "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  }
  // nothing in the app needs these (calls were removed in 3.0)
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  return payload;
});

// Gzip large JSON answers: a library of thousands of videos (with their descriptions)
// or a big folder listing shrinks 5–10×. Media streams are left alone.
const gzip = require('util').promisify(require('zlib').gzip);
fastify.addHook('onSend', async (request, reply, payload) => {
  if (typeof payload !== 'string' || payload.length < 4096) return payload;
  if (!/\bgzip\b/.test(String(request.headers['accept-encoding'] || ''))) return payload;
  if (reply.hasHeader('content-encoding') || !/json/.test(String(reply.getHeader('content-type') || ''))) return payload;
  const vary = reply.getHeader('vary');
  reply.header('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  reply.header('Content-Encoding', 'gzip');
  reply.removeHeader('content-length');
  return gzip(payload, { level: 5 });
});

// Serve the static frontend SPA (revalidated on every load so updates show up immediately)
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../frontend'),
  prefix: '/',
  cacheControl: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    // fonts and icons never change between versions
    if (/\.(png|ico|woff2?)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
  },
});

// Plain HTML form posts (zip and backup downloads are real navigations, so the browser
// streams them to disk). On the root, so every module below gets it.
fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4 * 1024 * 1024 },
  (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

// API routes
fastify.register(require('./modules/auth'));
fastify.register(require('./modules/admin'));
fastify.register(require('./modules/files'));
fastify.register(require('./modules/trash'));
fastify.register(require('./modules/albums'));
fastify.register(require('./modules/music'));
fastify.register(require('./modules/library'));
fastify.register(require('./modules/collections'));
fastify.register(require('./modules/downloads'));

// Unknown /api routes answer in JSON; anything else falls back to the app
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
  return reply.sendFile('index.html');
});

const start = async () => {
  try {
    await fastify.listen({ port: config.port, host: config.host });
    // only once the port is ours: a second copy that fails to listen must not claim the folder
    instance.claim();
    process.on('exit', instance.release);
    const schema = db.schema;
    console.log(`${config.name} v${config.version} by ${config.author} is running on http://localhost:${config.port}`);
    console.log(`  storage: ${config.storageDir}`);
    if (schema && schema.backup) console.log(`  database upgraded from schema ${schema.from} to ${schema.to} (backup: ${schema.backup})`);
    // the swap ran before anything could log: record its outcome now
    if (db.restored) activity.log(null, 'backup.restored', { detail: `Backup from ${db.restored.created_at}: ${db.restored.users} accounts, ${db.restored.files} files. The replaced data is in ${db.restored.previous}` });
    const failed = backup.pending()?.failed;
    if (failed && Date.now() - Date.parse(failed.at) < 60e3) activity.log(null, 'backup.restore_failed', { detail: failed.error });
  } catch (err) {
    fastify.log.error(err);
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Set PORT in .env to use another one.` : err.message);
    process.exit(1);
  }
};

// Graceful shutdown: finish in-flight requests, then close the database cleanly
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received, shutting down…`);
  const force = setTimeout(() => process.exit(0), 4000);
  force.unref();
  try { await fastify.close(); } catch (e) { /* ignore */ }
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Admin → Restart: the same clean stop, so the database is closed before a restore is swapped in
process.on('akulavbox:restart', () => shutdown('Restart'));

start();
