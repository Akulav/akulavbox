'use strict';
// Tasks (/tasks): to-dos with lists, tags, checklists, due dates and repeats, shown as a list, a
// board or a calendar. A Fastify plugin of the AkulavBox server; data in DATA_DIR/tasks/tasks.db,
// accounts from AkulavBox. The page (public/) is Vue 3 with string templates and Tailwind compiled in
// the browser, no build step; its headers, API scope and page come from src/core/vue-app.js.
const fs = require('node:fs');
const path = require('node:path');
const apps = require('../../src/core/apps');
const vueApp = require('../../src/core/vue-app');
const { db, DB_PATH } = require('./server/db');
const store = require('./server/store');
const { loadUser } = require('./server/auth');

const PUBLIC = path.join(__dirname, 'public');
const { version: VERSION } = require('./meta.json');

const hooks = {
  usage: () => null, // no files: nothing counts towards a quota
  summary: (boxId) => {
    const n = store.openCount(boxId);
    return n ? `${n} open task${n === 1 ? '' : 's'}` : 'Nothing to do';
  },
  totals: () => {
    let bytes = 0;
    try { bytes = fs.statSync(DB_PATH).size; } catch { /* not created yet */ }
    return { bytes, items: store.totalCount(), label: 'tasks' };
  },
  deleteUser: (boxId) => store.deleteUser(boxId),
  // what an AI app may do here through the AI connector (src/core/connector)
  connector: require('./connector'),
};

module.exports = async function tasks(app, opts) {
  apps.register('tasks', hooks);
  opts.onClose?.(() => db.close());
  const where = { prefix: opts.prefix, publicDir: PUBLIC };

  app.addHook('onRequest', loadUser);
  vueApp.headers(app, where);
  vueApp.api(app, {
    csrfName: 'tasks',
    routes: async (api) => {
      api.get('/health', async () => ({ ok: true, version: VERSION }));
      await api.register(require('./server/routes'));
    },
  });
  vueApp.servePage(app, where);
};
