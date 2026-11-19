'use strict';
const { db, rateOf } = require('../db.js');
const { HttpError, num, oneOf, str, round2 } = require('../util.js');

module.exports = async function routes(router) {

  const HEX = /^#[0-9a-f]{6}$/i;

  function serialize(c, spentEur = 0, count = 0, baseRate = 1) {
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      kind: c.kind,
      budget: c.budget,
      archived: !!c.archived,
      position: c.position,
      monthSpent: round2(spentEur * baseRate),
      txCount: count,
    };
  }

  router.get('/', async (req, reply) => {
    const month = new Date().toISOString().slice(0, 7);
    const baseRate = rateOf(req.user.base_currency) ?? 1;
    const rows = db
      .prepare(
        `SELECT c.*,
          COALESCE((SELECT SUM(amount_eur) FROM transactions t WHERE t.category_id = c.id AND substr(t.date,1,7) = ?), 0) AS spent,
          (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS cnt
         FROM categories c WHERE c.user_id = ? ORDER BY c.kind, c.position, c.name`,
      )
      .all(month, req.user.id);
    return reply.send({ categories: rows.map((r) => serialize(r, r.spent, r.cnt, baseRate)) });
  });

  function parse(body, partial = false) {
    const o = { optional: partial };
    const color = body.color === undefined && partial ? undefined : String(body.color ?? '#2a78d6');
    if (color !== undefined && !HEX.test(color)) throw new HttpError(400, 'Color must be a hex value like #2a78d6');
    return {
      name: str(body.name, { field: 'Name', min: 1, max: 40, ...o }),
      icon: str(body.icon ?? (partial ? undefined : 'tag'), { field: 'Icon', min: 1, max: 40, ...o }),
      color,
      kind: oneOf(body.kind ?? (partial ? undefined : 'expense'), ['expense', 'income'], { field: 'Kind', ...o }),
      budget: num(body.budget ?? (partial ? undefined : 0), { field: 'Budget', min: 0, max: 1e12, ...o }),
      archived: body.archived === undefined ? undefined : body.archived ? 1 : 0,
    };
  }

  router.post('/', async (req, reply) => {
    const c = parse(req.body);
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories WHERE user_id = ?').get(req.user.id).p;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO categories (user_id, name, icon, color, kind, budget, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, c.name, c.icon, c.color, c.kind, c.budget, pos);
    return reply.code(201).send({ category: serialize(db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid)) });
  });

  function own(req) {
    const c = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!c) throw new HttpError(404, 'Category not found');
    return c;
  }

  router.patch('/:id', async (req, reply) => {
    const existing = own(req);
    const patch = parse(req.body, true);
    const next = { ...existing };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
    db.prepare('UPDATE categories SET name = ?, icon = ?, color = ?, kind = ?, budget = ?, archived = ? WHERE id = ?').run(
      next.name,
      next.icon,
      next.color,
      next.kind,
      next.budget,
      next.archived,
      existing.id,
    );
    return reply.send({ category: serialize(db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.id)) });
  });

  router.delete('/:id', async (req, reply) => {
    const c = own(req);
    db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
    return reply.send({ ok: true });
  });

};
