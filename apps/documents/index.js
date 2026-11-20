'use strict';
// e-Management (/docs): manager de documente cu două spații, Personal și Serviciu, pentru fiecare cont.
// Rulează în același server ca AkulavBox și folosește aceeași autentificare (cookie-ul comun din
// src/core/session.js). Datele stau în DATA_DIR/documents/<cont>/ (vezi src/db.js).
//
//   src/routes/categories.js   categorii și etichete
//   src/routes/documents.js    documente și fișiere
//   src/routes/backup.js       export / import al unui spațiu, jurnalul de activitate
const path = require('node:path');
const fs = require('node:fs');
const config = require('../../src/core/config');
const session = require('../../src/core/session');
const apps = require('../../src/core/apps');
const { createStores } = require('./src/db');
const { fail } = require('./src/validate');

const MAX_FILE = 50 * 1024 * 1024;
const PUBLIC = path.join(__dirname, 'public');
// Vue compilează șabloanele în browser, de aceea este nevoie de 'unsafe-eval'; restul este blocat.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const stores = createStores(config.appDataDir('documents'));

const hooks = {
  usage: (userId) => stores.usage(userId),
  summary: (userId) => {
    const c = stores.counts(userId);
    return `${c.documents} ${c.documents === 1 ? 'document' : 'documente'}`;
  },
  deleteUser: (userId) => stores.deleteUser(userId),
  totals: () => {
    let bytes = 0;
    let items = 0;
    for (const name of stores.folders()) {
      bytes += stores.usage(name);
      items += stores.counts(name).documents;
    }
    return { bytes, items, label: 'documents' };
  },
};

// Jurnal de activitate: ce și când, pentru fiecare cont (în baza spațiului de serviciu).
function audit(req, action, details = '') {
  try {
    const where = req.store ? `[${req.store.label}] ` : '';
    req.stores.work.db.prepare('INSERT INTO audit_log (username, ip, action, details) VALUES (?, ?, ?, ?)').run(req.user.username, req.ip || '', action, (where + String(details)).slice(0, 500));
  } catch (e) {
    req.log.error(e);
  }
}

// Contul vine din autentificarea comună; pentru rutele /api/s/:store/... se alege și spațiul (req.store).
async function requireUser(req, reply) {
  const s = session.userOf(req, reply);
  if (!s) throw fail(401, 'Este necesară autentificarea.');
  const acc = apps.access(s.user.id, 'documents');
  if (!acc.enabled) throw fail(403, 'Administratorul nu v-a dat acces la e-Management.');
  req.user = { id: s.user.id, username: s.user.username, full_name: s.user.username, role: s.user.role };
  req.quota = acc.quota_bytes;
  req.stores = stores.forUser(s.user.id);
  if (req.params.store !== undefined) {
    req.store = Object.hasOwn(req.stores, req.params.store) ? req.stores[req.params.store] : null;
    if (!req.store) throw fail(404, 'Spațiul de stocare nu există.');
  }
}

module.exports = async function documents(app, opts) {
  apps.register('documents', hooks);
  opts.onClose?.(() => stores.closeAll());

  app.register(require('@fastify/multipart'), { limits: { fileSize: MAX_FILE, files: 10, fields: 5, fieldSize: 200000 } });
  app.register(require('@fastify/static'), { root: PUBLIC, prefix: '/', decorateReply: false, index: false, maxAge: 0 });

  // Apărare suplimentară împotriva CSRF (pe lângă cookie-ul SameSite): cererile care modifică
  // date trebuie să vină de pe aceeași origine.
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    if (!session.sameOrigin(req)) throw fail(403, 'Cerere refuzată: origine necunoscută.');
  });

  const FILE_URL = /^\/docs\/api\/s\/[^/]+\/files\//;
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (session.isHttps(req)) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/docs/api/')) reply.header('Cache-Control', 'no-store');
    // fișierele descărcate nu primesc CSP-ul aplicației: vizualizatorul PDF al browserului are nevoie de propriile resurse
    if (!FILE_URL.test(req.url)) reply.header('Content-Security-Policy', CSP);
    else reply.removeHeader('Content-Security-Policy');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'Fișierul depășește limita de 50 MB.' });
    if (err.code === 'FST_FILES_LIMIT') return reply.code(413).send({ error: 'Cel mult 10 fișiere la o încărcare.' });
    if (err.code === 'FST_FIELDS_LIMIT' || err.code === 'FST_PARTS_LIMIT') return reply.code(413).send({ error: 'Formularul conține prea multe câmpuri.' });
    if (err.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') return reply.code(400).send({ error: 'Formularul trebuie trimis ca multipart/form-data.' });
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'Cererea este prea mare.' });
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (code >= 500) req.log.error(err);
    reply.code(code).send({ error: err.expose ? err.message : code >= 500 ? 'Eroare internă de server.' : 'Cerere invalidă.' });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Pagina sau resursa nu există.' }));

  // Pagina aplicației: fără autentificare se trece prin pagina comună de intrare.
  const indexHtml = (req, reply) => {
    if (!session.userOf(req, reply)) return reply.redirect(session.loginUrl('/docs/'));
    reply.header('Cache-Control', 'no-cache');
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(path.join(PUBLIC, 'index.html')));
  };
  app.get('/', indexHtml);
  app.get('/index.html', indexHtml);

  // Vue este servit local (fără CDN), ca aplicația să funcționeze și fără internet.
  const vueFile = fs.readFileSync(require.resolve('vue/dist/vue.esm-browser.prod.js'));
  app.get('/vendor/vue.js', (req, reply) => reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=86400').send(vueFile));

  const auth = { preHandler: requireUser };
  app.get('/api/me', auth, async (req) => ({
    ...req.user,
    quota_bytes: req.quota,
    used_bytes: stores.usage(req.user.id),
    stores: Object.values(req.stores).map((s) => ({ key: s.key, label: s.label })),
  }));

  const deps = { auth, requireUser, audit, stores };
  app.register(require('./src/routes/categories'), deps);
  app.register(require('./src/routes/documents'), deps);
  app.register(require('./src/routes/backup'), deps);
};

module.exports.stores = stores;
