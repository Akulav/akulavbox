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

fastify.register(require('@fastify/cors'));

// Baseline security headers for every response
fastify.addHook('onSend', async (request, reply, payload) => {
  // never send ?token= URLs to other sites in the Referer header
  reply.header('Referrer-Policy', 'same-origin');
  if (!reply.hasHeader('X-Content-Type-Options')) reply.header('X-Content-Type-Options', 'nosniff');
  if (!request.url.startsWith('/shared/')) reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('X-Powered-By', `${config.name}/${config.version}`);
  return payload;
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

// API routes
fastify.register(require('./modules/auth'));
fastify.register(require('./modules/admin'));
fastify.register(require('./modules/files'));
fastify.register(require('./modules/trash'));
fastify.register(require('./modules/albums'));
fastify.register(require('./modules/chat'));
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
    const schema = db.schema;
    console.log(`${config.name} v${config.version} by ${config.author} is running on http://localhost:${config.port}`);
    console.log(`  storage: ${config.storageDir}`);
    if (schema && schema.backup) console.log(`  database upgraded from schema ${schema.from} to ${schema.to} (backup: ${schema.backup})`);
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

start();
