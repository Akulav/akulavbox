'use strict';
// Florin's tools for the AI connector (src/core/connector/tools.js). They go through Florin's own API
// (/budget/api), so currencies, conversion and validation work exactly as in the page. Amounts come
// back in the transaction's currency and in the account's own currency (amount_base).
const { ToolError, helpers: { str, int, need } } = require('../../src/core/connector/tools');

const API = '/budget/api';

const tx = (t) => ({
  id: t.id, date: t.date, kind: t.kind, amount: t.amount, currency: t.currency, amount_base: t.amountBase,
  ...(t.payee ? { payee: t.payee } : {}), ...(t.note ? { note: t.note } : {}),
  category: t.category ? t.category.name : 'Uncategorized', ...(t.categoryId ? { category_id: t.categoryId } : {}),
});

/** A category id from an id or a name (the AI often knows only the name) */
async function categoryId(ctx, a) {
  if (a.category_id !== undefined) return a.category_id === null ? null : int(a.category_id, null, 1, Number.MAX_SAFE_INTEGER);
  if (!a.category) return undefined;
  const name = str(a.category, 40).toLowerCase();
  const cats = (await ctx.call('budget', 'GET', `${API}/categories`)).categories;
  const hit = cats.find((c) => c.name.toLowerCase() === name) || cats.find((c) => c.name.toLowerCase().includes(name));
  if (!hit) throw new ToolError(`There is no category called “${a.category}”. Categories: ${cats.map((c) => c.name).join(', ')}.`);
  return hit.id;
}

const FIELDS = {
  kind: { type: 'string', enum: ['expense', 'income'], default: 'expense' },
  amount: { type: 'number', exclusiveMinimum: 0 },
  currency: { type: 'string', description: 'ISO code like EUR, USD, RON (the account’s own currency when left out)' },
  date: { type: 'string', description: 'YYYY-MM-DD (today when left out)' },
  payee: { type: 'string' },
  note: { type: 'string' },
  category_id: { type: ['integer', 'null'] },
  category: { type: 'string', description: 'A category name, instead of category_id' },
};

async function body(ctx, a, { fill = false } = {}) {
  const b = {};
  for (const k of ['kind', 'amount', 'currency', 'date', 'payee', 'note']) if (a[k] !== undefined) b[k] = a[k];
  if (fill && !b.date) b.date = new Date().toISOString().slice(0, 10);
  if (typeof b.currency === 'string') b.currency = b.currency.toUpperCase();
  const c = await categoryId(ctx, a);
  if (c !== undefined) b.categoryId = c;
  return b;
}

const tools = [
  {
    name: 'florin_categories', write: false, title: 'Florin categories',
    description: 'Expense and income categories with their monthly budget and what was spent in them this month.',
    input: {},
    run: async (ctx) => {
      const r = await ctx.call('budget', 'GET', `${API}/categories`);
      return { categories: r.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, budget: c.budget, spent_this_month: c.spent, transactions: c.count ?? c.cnt, ...(c.archived ? { archived: true } : {}) })) };
    },
  },
  {
    name: 'florin_transactions', write: false, title: 'Find Florin transactions',
    description: 'Transactions, newest first, filtered by dates, kind, category or text (payee, note, category), with the totals of everything that matches.',
    input: {
      from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
      kind: { type: 'string', enum: ['expense', 'income'] }, category_id: { type: 'integer' }, query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, offset: { type: 'integer', minimum: 0, default: 0 },
    },
    run: async (ctx, a) => {
      const q = new URLSearchParams({ limit: String(int(a.limit, 50, 1, 500)), offset: String(int(a.offset, 0, 0, 1e9)) });
      if (a.from) q.set('from', str(a.from, 10));
      if (a.to) q.set('to', str(a.to, 10));
      if (a.kind) q.set('kind', str(a.kind, 10));
      if (a.category_id) q.set('category', String(int(a.category_id, 0, 0, Number.MAX_SAFE_INTEGER)));
      if (a.query) q.set('q', str(a.query, 200));
      const r = await ctx.call('budget', 'GET', `${API}/transactions?${q}`);
      return { currency: r.currency, total: r.total, totals: r.totals, transactions: r.items.map(tx) };
    },
  },
  {
    name: 'florin_month', write: false, title: 'A month in Florin',
    description: 'A month at a glance: spent, income, budget left, the categories, compared with the month before.',
    input: { month: { type: 'string', description: 'YYYY-MM (this month when left out)' } },
    run: async (ctx, a) => ctx.call('budget', 'GET', `${API}/stats/overview${a.month ? `?month=${encodeURIComponent(str(a.month, 7))}` : ''}`),
  },
  {
    name: 'florin_trend', write: false, title: 'Florin trend',
    description: 'Spent and income for each of the last months.',
    input: { months: { type: 'integer', minimum: 2, maximum: 24, default: 6 } },
    run: async (ctx, a) => ctx.call('budget', 'GET', `${API}/stats/trend?months=${int(a.months, 6, 2, 24)}`),
  },
  {
    name: 'florin_add_transaction', write: true, title: 'Add a Florin transaction',
    description: 'Record an expense or an income. The currency is converted with Florin’s rates for the totals.',
    input: FIELDS, required: ['amount'],
    run: async (ctx, a) => {
      need(a.amount, 'amount');
      return { transaction: tx((await ctx.call('budget', 'POST', `${API}/transactions`, { json: await body(ctx, a, { fill: true }) })).transaction) };
    },
  },
  {
    name: 'florin_update_transaction', write: true, title: 'Change a Florin transaction',
    description: 'Change any field of a transaction; the ones left out stay as they are.',
    input: { id: { type: 'integer' }, ...FIELDS }, required: ['id'],
    run: async (ctx, a) => ({ transaction: tx((await ctx.call('budget', 'PATCH', `${API}/transactions/${int(a.id, 0, 0, Number.MAX_SAFE_INTEGER)}`, { json: await body(ctx, a) })).transaction) }),
  },
  {
    name: 'florin_delete_transaction', write: true, destructive: true, title: 'Delete a Florin transaction',
    description: 'Delete a transaction for good.',
    input: { id: { type: 'integer' } }, required: ['id'],
    run: async (ctx, a) => ctx.call('budget', 'DELETE', `${API}/transactions/${int(a.id, 0, 0, Number.MAX_SAFE_INTEGER)}`),
  },
];

module.exports = { tools };
