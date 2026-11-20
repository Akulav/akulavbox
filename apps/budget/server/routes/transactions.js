'use strict';
const { db, rateOf, toEur } = require('../db.js');
const { CURRENCY_CODES } = require('../currencies.js');
const { HttpError, date, num, oneOf, str, round2 } = require('../util.js');

module.exports = async function routes(router) {
  function serialize(t, baseRate) {
    return {
      id: t.id,
      kind: t.kind,
      amount: t.amount,
      currency: t.currency,
      amountBase: round2(t.amount_eur * baseRate),
      date: t.date,
      payee: t.payee,
      note: t.note,
      categoryId: t.category_id,
      category: t.category_id
        ? { id: t.category_id, name: t.c_name, icon: t.c_icon, color: t.c_color }
        : null,
      createdAt: t.created_at,
    };
  }

  const SELECT = `SELECT t.*, c.name AS c_name, c.icon AS c_icon, c.color AS c_color
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id`;

  function buildFilter(req) {
    const q = req.query;
    const where = ['t.user_id = ?'];
    const params = [req.user.id];
    if (q.from) (where.push('t.date >= ?'), params.push(date(q.from, { field: 'From' })));
    if (q.to) (where.push('t.date <= ?'), params.push(date(q.to, { field: 'To' })));
    if (q.kind) (where.push('t.kind = ?'), params.push(oneOf(q.kind, ['expense', 'income'], { field: 'Kind' })));
    if (q.currency) (where.push('t.currency = ?'), params.push(String(q.currency)));
    if (q.category === 'none') where.push('t.category_id IS NULL');
    else if (q.category) {
      const ids = String(q.category).split(',').map(Number).filter(Number.isInteger);
      if (ids.length) (where.push(`t.category_id IN (${ids.map(() => '?').join(',')})`), params.push(...ids));
    }
    if (q.q) {
      where.push("(t.payee LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
      const like = `%${String(q.q).replace(/[%_]/g, '\\$&')}%`;
      params.push(like, like, like);
    }
    return { where: where.join(' AND '), params };
  }

  const SORTS = {
    date_desc: 't.date DESC, t.id DESC',
    date_asc: 't.date ASC, t.id ASC',
    amount_desc: 't.amount_eur DESC',
    amount_asc: 't.amount_eur ASC',
  };

  router.get('/', async (req, reply) => {
    const { where, params } = buildFilter(req);
    const baseRate = rateOf(req.user.base_currency) ?? 1;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const order = SORTS[req.query.sort] ?? SORTS.date_desc;
    const items = db.prepare(`${SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS n,
          COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount_eur END),0) AS spent,
          COALESCE(SUM(CASE WHEN t.kind='income' THEN t.amount_eur END),0) AS earned
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE ${where}`,
      )
      .get(...params);
    return reply.send({
      items: items.map((t) => serialize(t, baseRate)),
      total: agg.n,
      totals: { spent: round2(agg.spent * baseRate), income: round2(agg.earned * baseRate) },
      currency: req.user.base_currency,
    });
  });

  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // guard against CSV formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  router.get('/export.csv', async (req, reply) => {
    const { where, params } = buildFilter(req);
    const baseRate = rateOf(req.user.base_currency) ?? 1;
    const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY t.date DESC, t.id DESC`).all(...params);
    const header = ['Date', 'Type', 'Category', 'Payee', 'Note', 'Amount', 'Currency', `Amount (${req.user.base_currency})`];
    const lines = [header.join(',')];
    for (const t of rows) {
      lines.push(
        [t.date, t.kind, t.c_name ?? 'Uncategorized', t.payee, t.note, t.amount, t.currency, round2(t.amount_eur * baseRate)]
          .map(csvCell)
          .join(','),
      );
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="florin-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send('﻿' + lines.join('\r\n'));
  });

  function parse(req, existing) {
    const b = req.body;
    const merged = {
      kind: b.kind ?? existing?.kind ?? 'expense',
      amount: b.amount ?? existing?.amount,
      currency: b.currency ?? existing?.currency ?? req.user.base_currency,
      date: b.date ?? existing?.date,
      payee: b.payee ?? existing?.payee ?? '',
      note: b.note ?? existing?.note ?? '',
      categoryId: b.categoryId !== undefined ? b.categoryId : existing?.category_id ?? null,
    };
    const t = {
      kind: oneOf(merged.kind, ['expense', 'income'], { field: 'Type' }),
      amount: round2(num(merged.amount, { field: 'Amount', min: 0.01, max: 1e12 })),
      currency: oneOf(merged.currency, [...CURRENCY_CODES], { field: 'Currency' }),
      date: date(merged.date),
      payee: str(merged.payee, { field: 'Payee', max: 120 }),
      note: str(merged.note, { field: 'Note', max: 500 }),
      categoryId: merged.categoryId === null || merged.categoryId === '' ? null : Number(merged.categoryId),
    };
    if (t.categoryId !== null) {
      const c = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(t.categoryId, req.user.id);
      if (!c) throw new HttpError(400, 'Unknown category');
    }
    // Keep the existing conversion snapshot unless amount/currency changed.
    t.amountEur =
      existing && existing.amount === t.amount && existing.currency === t.currency ? existing.amount_eur : toEur(t.amount, t.currency);
    return t;
  }

  router.post('/', async (req, reply) => {
    const t = parse(req);
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO transactions (user_id, category_id, kind, amount, currency, amount_eur, date, payee, note) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(req.user.id, t.categoryId, t.kind, t.amount, t.currency, t.amountEur, t.date, t.payee, t.note);
    const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(lastInsertRowid);
    return reply.code(201).send({ transaction: serialize(row, rateOf(req.user.base_currency) ?? 1) });
  });

  function own(req) {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!t) throw new HttpError(404, 'Transaction not found');
    return t;
  }

  router.patch('/:id', async (req, reply) => {
    const existing = own(req);
    const t = parse(req, existing);
    db.prepare(
      'UPDATE transactions SET category_id=?, kind=?, amount=?, currency=?, amount_eur=?, date=?, payee=?, note=? WHERE id=?',
    ).run(t.categoryId, t.kind, t.amount, t.currency, t.amountEur, t.date, t.payee, t.note, existing.id);
    const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(existing.id);
    return reply.send({ transaction: serialize(row, rateOf(req.user.base_currency) ?? 1) });
  });

  router.delete('/:id', async (req, reply) => {
    const t = own(req);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(t.id);
    return reply.send({ ok: true });
  });

  router.get('/payees', async (req, reply) => {
    const rows = db
      .prepare(
        `SELECT payee, category_id, COUNT(*) AS n FROM transactions WHERE user_id = ? AND payee != ''
         GROUP BY payee ORDER BY n DESC LIMIT 200`,
      )
      .all(req.user.id);
    return reply.send({ payees: rows.map((r) => ({ name: r.payee, categoryId: r.category_id, count: r.n })) });
  });

};
