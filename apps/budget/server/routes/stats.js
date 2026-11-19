'use strict';
const { db, rateOf } = require('../db.js');
const { HttpError, date, round2 } = require('../util.js');

module.exports = async function routes(router) {

  const pad = (n) => String(n).padStart(2, '0');
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
  const shiftMonth = (ym, delta) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function parseMonth(v) {
  const m = v ? String(v) : todayStr().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, 'Month must be YYYY-MM');
  return m;
}

router.get('/overview', async (req, reply) => {
  const uid = req.user.id;
  const r = rateOf(req.user.base_currency) ?? 1;
  const month = parseMonth(req.query.month);
  const prev = shiftMonth(month, -1);
  const [y, m] = month.split('-').map(Number);
  const [py, pm] = prev.split('-').map(Number);
  const dim = daysIn(y, m);
  const today = todayStr();
  const isCurrent = today.slice(0, 7) === month;
  const isFuture = month > today.slice(0, 7);
  const elapsed = isCurrent ? Number(today.slice(8, 10)) : isFuture ? 0 : dim;

  const sums = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN kind='expense' THEN amount_eur END),0) AS spent,
            COALESCE(SUM(CASE WHEN kind='income' THEN amount_eur END),0) AS income,
            COUNT(CASE WHEN kind='expense' THEN 1 END) AS n
     FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?`,
  );
  const cur = sums.get(uid, month);
  const last = sums.get(uid, prev);
  // Same-period comparison: last month up to the same day-of-month.
  const lastToDate = db
    .prepare(
      `SELECT COALESCE(SUM(amount_eur),0) AS s FROM transactions
       WHERE user_id = ? AND kind='expense' AND substr(date,1,7) = ? AND CAST(substr(date,9,2) AS INTEGER) <= ?`,
    )
    .get(uid, prev, elapsed || dim).s;

  const byCategory = db
    .prepare(
      `SELECT c.id, c.name, c.icon, c.color, c.budget, COALESCE(s.spent,0) AS spent, COALESCE(s.n,0) AS n
       FROM categories c
       LEFT JOIN (SELECT category_id, SUM(amount_eur) AS spent, COUNT(*) AS n FROM transactions
                  WHERE user_id = ? AND kind='expense' AND substr(date,1,7) = ? GROUP BY category_id) s ON s.category_id = c.id
       WHERE c.user_id = ? AND c.kind = 'expense' AND (c.archived = 0 OR s.spent > 0)
       ORDER BY spent DESC, c.position`,
    )
    .all(uid, month, uid)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, budget: c.budget, spent: round2(c.spent * r), count: c.n }));
  const uncategorized = db
    .prepare(
      `SELECT COALESCE(SUM(amount_eur),0) AS s, COUNT(*) AS n FROM transactions
       WHERE user_id = ? AND kind='expense' AND category_id IS NULL AND substr(date,1,7) = ?`,
    )
    .get(uid, month);
  if (uncategorized.s > 0) {
    byCategory.push({ id: null, name: 'Uncategorized', icon: 'tag', color: '#9ca3af', budget: 0, spent: round2(uncategorized.s * r), count: uncategorized.n });
    byCategory.sort((a, b) => b.spent - a.spent);
  }

  const dailyRows = db.prepare(
    `SELECT CAST(substr(date,9,2) AS INTEGER) AS d, SUM(amount_eur) AS s FROM transactions
     WHERE user_id = ? AND kind='expense' AND substr(date,1,7) = ? GROUP BY d`,
  );
  const curDaily = Object.fromEntries(dailyRows.all(uid, month).map((x) => [x.d, x.s]));
  const prevDaily = Object.fromEntries(dailyRows.all(uid, prev).map((x) => [x.d, x.s]));
  const pdim = daysIn(py, pm);
  let cc = 0;
  let pc = 0;
  const daily = [];
  for (let d = 1; d <= Math.max(dim, pdim); d++) {
    cc += curDaily[d] ?? 0;
    pc += prevDaily[d] ?? 0;
    daily.push({
      day: d,
      spent: d <= dim ? round2((curDaily[d] ?? 0) * r) : null,
      cumulative: d <= elapsed ? round2(cc * r) : null,
      prevCumulative: d <= pdim ? round2(pc * r) : null,
    });
  }

  const budgetTotal = byCategory.reduce((a, c) => a + (c.budget || 0), 0);
  const spent = round2(cur.spent * r);
  const dailyAvg = elapsed ? round2(spent / elapsed) : 0;

  const recent = db
    .prepare(
      `SELECT t.*, c.name AS c_name, c.icon AS c_icon, c.color AS c_color FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 7`,
    )
    .all(uid)
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: t.amount,
      currency: t.currency,
      amountBase: round2(t.amount_eur * r),
      date: t.date,
      payee: t.payee,
      note: t.note,
      category: t.category_id ? { id: t.category_id, name: t.c_name, icon: t.c_icon, color: t.c_color } : null,
    }));

  return reply.send({
    currency: req.user.base_currency,
    month,
    isCurrent,
    daysInMonth: dim,
    daysElapsed: elapsed,
    totals: {
      spent,
      income: round2(cur.income * r),
      count: cur.n,
      prevSpent: round2(last.spent * r),
      prevSpentToDate: round2(lastToDate * r),
      prevIncome: round2(last.income * r),
      budget: round2(budgetTotal),
      dailyAvg,
      projected: isCurrent ? round2(dailyAvg * dim) : spent,
    },
    byCategory,
    daily,
    recent,
  });
});

router.get('/trend', async (req, reply) => {
  const r = rateOf(req.user.base_currency) ?? 1;
  const end = parseMonth(req.query.month);
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
  const start = shiftMonth(end, -(months - 1));
  const rows = db
    .prepare(
      `SELECT substr(date,1,7) AS m,
              SUM(CASE WHEN kind='expense' THEN amount_eur ELSE 0 END) AS spent,
              SUM(CASE WHEN kind='income' THEN amount_eur ELSE 0 END) AS income
       FROM transactions WHERE user_id = ? AND substr(date,1,7) BETWEEN ? AND ? GROUP BY m`,
    )
    .all(req.user.id, start, end);
  const map = Object.fromEntries(rows.map((x) => [x.m, x]));
  const out = [];
  for (let i = 0; i < months; i++) {
    const m = shiftMonth(start, i);
    out.push({ month: m, spent: round2((map[m]?.spent ?? 0) * r), income: round2((map[m]?.income ?? 0) * r) });
  }
  return reply.send({ currency: req.user.base_currency, months: out });
});

router.get('/analytics', async (req, reply) => {
  const uid = req.user.id;
  const r = rateOf(req.user.base_currency) ?? 1;
  const to = date(req.query.to ?? todayStr(), { field: 'To' });
  const from = date(req.query.from ?? `${shiftMonth(to.slice(0, 7), -5)}-01`, { field: 'From' });
  if (from > to) throw new HttpError(400, '"From" must be before "To"');
  const P = [uid, from, to];
  const W = `t.user_id = ? AND t.date BETWEEN ? AND ?`;

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind='expense' THEN amount_eur END),0) AS spent,
              COALESCE(SUM(CASE WHEN kind='income' THEN amount_eur END),0) AS income,
              COUNT(CASE WHEN kind='expense' THEN 1 END) AS n
       FROM transactions t WHERE ${W}`,
    )
    .get(...P);

  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.color, c.icon, SUM(t.amount_eur) AS s, COUNT(*) AS n FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id WHERE ${W} AND t.kind='expense'
       GROUP BY c.id ORDER BY s DESC`,
    )
    .all(...P)
    .map((c) => ({
      id: c.id,
      key: c.id ? `c${c.id}` : 'none',
      name: c.name ?? 'Uncategorized',
      color: c.color ?? '#9ca3af',
      icon: c.icon ?? 'tag',
      spent: round2(c.s * r),
      count: c.n,
    }));

  const monthlyRows = db
    .prepare(
      `SELECT substr(t.date,1,7) AS m, t.category_id AS cid, SUM(t.amount_eur) AS s FROM transactions t
       WHERE ${W} AND t.kind='expense' GROUP BY m, cid ORDER BY m`,
    )
    .all(...P);
  const monthly = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
    const row = { month: m };
    for (const c of categories) row[c.key] = 0;
    monthly.push(row);
  }
  for (const x of monthlyRows) {
    const row = monthly.find((mm) => mm.month === x.m);
    if (row) row[x.cid ? `c${x.cid}` : 'none'] = round2(x.s * r);
  }

  const weekdayRows = db
    .prepare(
      `SELECT CAST(strftime('%w', t.date) AS INTEGER) AS wd, SUM(t.amount_eur) AS s, COUNT(*) AS n
       FROM transactions t WHERE ${W} AND t.kind='expense' GROUP BY wd`,
    )
    .all(...P);
  // Count how many of each weekday the range contains, for a fair average.
  const wdCount = Array(7).fill(0);
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    wdCount[d.getUTCDay()]++;
  }
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const row = weekdayRows.find((x) => x.wd === wd);
    const total = (row?.s ?? 0) * r;
    return { day: names[wd], total: round2(total), average: round2(wdCount[wd] ? total / wdCount[wd] : 0), count: row?.n ?? 0 };
  });

  const daily = db
    .prepare(`SELECT t.date AS d, SUM(t.amount_eur) AS s FROM transactions t WHERE ${W} AND t.kind='expense' GROUP BY t.date`)
    .all(...P)
    .map((x) => ({ date: x.d, spent: round2(x.s * r) }));

  const topPayees = db
    .prepare(
      `SELECT t.payee AS name, SUM(t.amount_eur) AS s, COUNT(*) AS n FROM transactions t
       WHERE ${W} AND t.kind='expense' AND t.payee != '' GROUP BY t.payee ORDER BY s DESC LIMIT 8`,
    )
    .all(...P)
    .map((x) => ({ name: x.name, spent: round2(x.s * r), count: x.n }));

  const byCurrency = db
    .prepare(
      `SELECT t.currency AS code, SUM(t.amount) AS original, SUM(t.amount_eur) AS s, COUNT(*) AS n FROM transactions t
       WHERE ${W} AND t.kind='expense' GROUP BY t.currency ORDER BY s DESC`,
    )
    .all(...P)
    .map((x) => ({ code: x.code, original: round2(x.original), spent: round2(x.s * r), count: x.n }));

  const largest = db
    .prepare(
      `SELECT t.*, c.name AS c_name, c.icon AS c_icon, c.color AS c_color FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id WHERE ${W} AND t.kind='expense' ORDER BY t.amount_eur DESC LIMIT 5`,
    )
    .all(...P)
    .map((t) => ({
      id: t.id,
      amount: t.amount,
      currency: t.currency,
      amountBase: round2(t.amount_eur * r),
      date: t.date,
      payee: t.payee,
      note: t.note,
      category: t.category_id ? { id: t.category_id, name: t.c_name, icon: t.c_icon, color: t.c_color } : null,
    }));

  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const spent = round2(totals.spent * r);
  const income = round2(totals.income * r);
  return reply.send({
    currency: req.user.base_currency,
    from,
    to,
    totals: {
      spent,
      income,
      net: round2(income - spent),
      savingsRate: income > 0 ? round2(((income - spent) / income) * 100) : null,
      perDay: round2(spent / days),
      count: totals.n,
      average: totals.n ? round2(spent / totals.n) : 0,
    },
    categories,
    monthly,
    weekday,
    daily,
    topPayees,
    byCurrency,
    largest,
  });
});

};
