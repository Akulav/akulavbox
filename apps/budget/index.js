'use strict';
// Florin (/budget): expenses and income in any currency, with budgets and charts. A Fastify plugin of
// the AkulavBox server; data in DATA_DIR/budget/florin.db, accounts from AkulavBox.
// The page (public/) is Vue 3 with string templates and Tailwind compiled by the server (src/core/tailwind.js), like the rest
// of AkulavBox: no build step. Its headers, API scope and page come from src/core/vue-app.js.
const fs = require('node:fs');
const path = require('node:path');
const apps = require('../../src/core/apps');
const vueApp = require('../../src/core/vue-app');
const { db, getSetting, DB_PATH } = require('./server/db.js');
const { loadUser, requireAuth, requireAdmin, rowOfBox } = require('./server/auth.js');

const PUBLIC = path.join(__dirname, 'public');
const { version: VERSION } = require('./meta.json');

const hooks = {
  usage: () => null, // no files: nothing counts towards a quota
  summary: (boxId) => {
    const u = rowOfBox(boxId);
    const n = u ? db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?').get(u.id).n : 0;
    return `${n} transaction${n === 1 ? '' : 's'}`;
  },
  totals: () => {
    let bytes = 0;
    try { bytes = fs.statSync(DB_PATH).size; } catch { /* not created yet */ }
    return { bytes, items: db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, label: 'transactions' };
  },
  // categories and transactions go with the row (ON DELETE CASCADE)
  deleteUser: (boxId) => db.prepare('DELETE FROM users WHERE box_id = ?').run(boxId),
  // what an AI app may do here through the AI connector (src/core/connector)
  connector: require('./connector'),
};

module.exports = async function budget(app, opts) {
  apps.register('budget', hooks);
  opts.onClose?.(() => db.close());
  const where = { prefix: opts.prefix, publicDir: PUBLIC };

  app.addHook('onRequest', loadUser);
  vueApp.headers(app, where);
  vueApp.api(app, {
    csrfName: 'florin',
    routes: async (api) => {
      api.get('/health', async () => ({ ok: true, version: VERSION }));
      api.get('/config', async () => ({ appName: 'Florin', version: VERSION, defaultCurrency: getSetting('default_currency') ?? 'EUR' }));
      api.get('/currencies', async () => ({ currencies: db.prepare('SELECT code, name, rate, updated_at AS updatedAt, source FROM rates ORDER BY code').all() }));
      api.register(require('./server/routes/auth.js'), { prefix: '/auth' });
      // everything else needs a signed-in account (and /admin an admin)
      for (const [name, guard] of [['categories', requireAuth], ['transactions', requireAuth], ['stats', requireAuth], ['admin', requireAdmin]]) {
        api.register(async (scope) => {
          scope.addHook('preHandler', guard);
          scope.register(require(`./server/routes/${name}.js`));
        }, { prefix: `/${name}` });
      }
    },
  });
  vueApp.servePage(app, where);
};
