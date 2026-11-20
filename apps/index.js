'use strict';
// The apps that live next to AkulavBox, each a Fastify plugin under its own prefix. Each keeps its
// files in its own folder of the data folder (config.appDataDir(id)), signs people in with the shared
// cookie (src/core/session.js) and registers its hooks (usage, delete-user, …) in src/core/apps.js.
// An app that can't start (Koma Shelf without sharp) answers with a short page saying why, and the
// launcher and the Admin console show it; the rest of the server runs on.
const apps = require('../src/core/apps');

const closers = [];
const onClose = (fn) => closers.push(fn);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const unavailablePage = (name, message) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(name)} is not running</title>
<body style="font-family:system-ui,sans-serif;background:#0D1518;color:#e3ebe9;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:520px"><h1 style="font-size:22px">${esc(name)} is not running</h1><p style="color:#8ea1a4">${esc(message)}</p><p><a style="color:#E8A33D" href="/">Back to all apps</a></p></div>`;

function unavailable(id, message, dataHooks) {
  const { name } = apps.byId.get(id);
  console.error(`[apps] ${name} could not start: ${message}`);
  apps.failed(id, message, dataHooks);
  return async (scope) => {
    const answer = async (req, reply) => reply.code(503).header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(unavailablePage(name, message));
    scope.get('/', answer);
    scope.all('/*', answer);
  };
}

/** Koma Shelf re-encodes every strip with sharp, an optional dependency of AkulavBox */
function sharpMissing() {
  try { require('sharp'); return null; } catch (e) { return 'Koma Shelf needs the image library sharp, which isn’t installed on this server (npm install sharp).'; }
}

/** Register every app on the server */
function load(fastify) {
  fastify.register(require('./documents'), { prefix: '/docs', onClose });
  const noSharp = sharpMissing();
  if (noSharp) {
    // the site is down, but its data still counts and still goes with a deleted account
    const data = require('./manga/src/data').openData();
    onClose(data.close);
    fastify.register(unavailable('manga', noSharp, data.hooks), { prefix: '/manga' });
  } else fastify.register(require('./manga'), { prefix: '/manga', onClose });
  fastify.register(require('./budget'), { prefix: '/budget', onClose });
}

async function close() {
  for (const fn of closers.splice(0)) { try { await fn(); } catch (e) { /* shutting down */ } }
}

module.exports = { load, close };
