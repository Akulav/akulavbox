'use strict';
const fs = require('node:fs');
const { db, DB_PATH, getSetting, setSetting, tx } = require('../db.js');
const { CURRENCY_CODES } = require('../currencies.js');
const { HttpError, num, oneOf } = require('../util.js');

module.exports = async function routes(router) {
  router.get('/stats', async (_req, reply) => {
    const one = (sql) => db.prepare(sql).get().n;
    let dbSize = 0;
    try {
      dbSize = fs.statSync(DB_PATH).size;
    } catch {}
    return reply.send({
      users: one('SELECT COUNT(*) AS n FROM users WHERE box_id IS NOT NULL'),
      transactions: one('SELECT COUNT(*) AS n FROM transactions'),
      categories: one('SELECT COUNT(*) AS n FROM categories'),
      dbSize,
    });
  });

  // Accounts are managed in the server's Admin console (/admin), not here.

  router.get('/settings', async (_req, reply) => {
    return reply.send({
      defaultCurrency: getSetting('default_currency') ?? 'EUR',
    });
  });

  router.patch('/settings', async (req, reply) => {
    if (req.body.defaultCurrency !== undefined) {
      setSetting('default_currency', oneOf(req.body.defaultCurrency, [...CURRENCY_CODES], { field: 'Currency' }));
    }
    return reply.send({
      defaultCurrency: getSetting('default_currency'),
    });
  });

  router.put('/rates/:code', async (req, reply) => {
    const code = String(req.params.code).toUpperCase();
    if (!CURRENCY_CODES.has(code)) throw new HttpError(404, 'Unknown currency');
    if (code === 'EUR') throw new HttpError(400, 'EUR is the reference currency and is always 1');
    const rate = num(req.body.rate, { field: 'Rate', min: 0.000001, max: 1e9 });
    db.prepare("UPDATE rates SET rate = ?, updated_at = datetime('now'), source = 'manual' WHERE code = ?").run(rate, code);
    return reply.send({ ok: true });
  });

  router.post('/rates/refresh', async (_req, reply) => {
    const sources = [
      { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/EUR', pick: (j) => j.rates },
      { name: 'frankfurter.app', url: 'https://api.frankfurter.app/latest?from=EUR', pick: (j) => j.rates },
    ];
    for (const s of sources) {
      try {
        const r = await fetch(s.url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'florin-budget-app' } });
        if (!r.ok) continue;
        const rates = s.pick(await r.json());
        if (!rates || typeof rates !== 'object') continue;
        let updated = 0;
        tx(() => {
          const stmt = db.prepare("UPDATE rates SET rate = ?, updated_at = datetime('now'), source = ? WHERE code = ?");
          for (const code of CURRENCY_CODES) {
            if (code === 'EUR') continue;
            const v = Number(rates[code]);
            if (Number.isFinite(v) && v > 0) updated += stmt.run(v, s.name, code).changes;
          }
        });
        return reply.send({ ok: true, source: s.name, updated });
      } catch {
        /* try next source */
      }
    }
    throw new HttpError(502, 'Could not reach any exchange-rate provider. Try again later or set rates manually.');
  });

};
