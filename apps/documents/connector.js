'use strict';
// e-Management's tools for the AI connector (src/core/connector/tools.js). The app is in Romanian, the
// tools speak English to the AI; they go through e-Management's own API (/docs/api), so validation,
// the activity log and storage work exactly as in the page. Every account has two spaces: personal
// (Personal) and work (Serviciu).
const { ToolError, multipart, helpers: { str, int, need, fileContent } } = require('../../src/core/connector/tools');

const SPACES = ['personal', 'work'];
const space = (a) => {
  const s = str(a.space || 'personal', 20).toLowerCase();
  if (!SPACES.includes(s)) throw new ToolError('space must be "personal" or "work".');
  return `/docs/api/s/${s}`;
};

/** Categories with their tags, and a tag id → "Category / tag" map */
async function taxonomy(ctx, base) {
  const cats = await ctx.call('documents', 'GET', `${base}/categories`);
  const names = new Map();
  for (const c of cats) for (const t of c.tags) names.set(t.id, `${c.name} / ${t.name}`);
  return { cats, names };
}

const doc = (d, names) => ({
  id: d.id, title: d.title, date: d.doc_date, ...(d.number ? { number: d.number } : {}), ...(d.description ? { description: d.description } : {}),
  tags: d.tagIds.map((id) => names.get(id) || id), tag_ids: d.tagIds,
  files: d.files.map((f) => ({ id: f.id, name: f.name, size_bytes: f.size })), created_at: d.created_at,
});

/** Tag ids from ids or "tag" / "Category / tag" names */
function tagIds(a, { cats }) {
  const out = new Set([].concat(a.tag_ids || []).map(Number).filter(Number.isInteger));
  for (const raw of [].concat(a.tags || [])) {
    const want = String(raw).toLowerCase().trim();
    let hit = null;
    for (const c of cats) for (const t of c.tags) if (`${c.name} / ${t.name}`.toLowerCase() === want || t.name.toLowerCase() === want) hit = hit || t;
    if (!hit) throw new ToolError(`There is no tag “${raw}”. Call docs_categories to see them.`);
    out.add(hit.id);
  }
  return [...out];
}

const SPACE = { type: 'string', enum: SPACES, default: 'personal', description: 'personal (Personal) or work (Serviciu)' };
const FIELDS = {
  space: SPACE,
  title: { type: 'string' },
  date: { type: 'string', description: 'The document’s date, YYYY-MM-DD' },
  number: { type: 'string', description: 'Its number or reference, if it has one' },
  description: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Tag names (or "Category / tag")' },
  tag_ids: { type: 'array', items: { type: 'integer' } },
};

async function listAll(ctx, base) {
  return ctx.call('documents', 'GET', `${base}/documents`);
}

const tools = [
  {
    name: 'docs_categories', write: false, title: 'e-Management categories and tags',
    description: 'The categories of a space and their tags (documents are filed under tags).',
    input: { space: SPACE },
    run: async (ctx, a) => ({ categories: (await taxonomy(ctx, space(a))).cats.map((c) => ({ id: c.id, name: c.name, tags: c.tags.map((t) => ({ id: t.id, name: t.name })) })) }),
  },
  {
    name: 'docs_list', write: false, title: 'List e-Management documents',
    description: 'Documents of a space, newest first, optionally matching a text (title, number, description), a tag, or a date range. Each has its attached files.',
    input: { space: SPACE, query: { type: 'string' }, tag: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
    run: async (ctx, a) => {
      const base = space(a);
      const [list, tax] = await Promise.all([listAll(ctx, base), taxonomy(ctx, base)]);
      let docs = list.map((d) => doc(d, tax.names));
      const q = str(a.query, 200).toLowerCase();
      if (q) docs = docs.filter((d) => `${d.title}\n${d.number || ''}\n${d.description || ''}`.toLowerCase().includes(q));
      if (a.tag) { const t = str(a.tag, 120).toLowerCase(); docs = docs.filter((d) => d.tags.some((x) => String(x).toLowerCase().includes(t))); }
      if (a.from) docs = docs.filter((d) => d.date >= str(a.from, 10));
      if (a.to) docs = docs.filter((d) => d.date <= str(a.to, 10));
      return { total: docs.length, documents: docs.slice(0, int(a.limit, 100, 1, 500)) };
    },
  },
  {
    name: 'docs_get', write: false, title: 'An e-Management document',
    description: 'One document with its tags and attached files.',
    input: { space: SPACE, id: { type: 'integer' } }, required: ['id'],
    run: async (ctx, a) => {
      const base = space(a);
      const [list, tax] = await Promise.all([listAll(ctx, base), taxonomy(ctx, base)]);
      const d = list.find((x) => x.id === Number(a.id));
      if (!d) throw new ToolError('Document not found.');
      return doc(d, tax.names);
    },
  },
  {
    name: 'docs_read_file', write: false, title: 'Read an attached file',
    description: 'The contents of a file attached to a document, when it is text or an image; others give their details only.',
    input: { space: SPACE, file_id: { type: 'integer' } }, required: ['file_id'],
    run: async (ctx, a) => {
      const base = space(a);
      const r = await ctx.call('documents', 'GET', `${base}/files/${int(a.file_id, 0, 0, Number.MAX_SAFE_INTEGER)}?download=1`, { raw: true });
      const name = /filename\*=UTF-8''([^;]+)/.exec(String(r.headers['content-disposition'] || ''))?.[1];
      const file = name ? decodeURIComponent(name) : `file-${a.file_id}`;
      const ext = (file.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' }[ext] || String(r.headers['content-type'] || '').split(';')[0];
      if (r.body.length > 4 * 1024 * 1024 && !/^text\//.test(mime)) return { name: file, size_bytes: r.body.length, note: 'Too large to read through the connector.' };
      return { name: file, size_bytes: r.body.length, ...fileContent(file, mime, r.body) };
    },
  },
  {
    name: 'docs_create', write: true, title: 'Add an e-Management document',
    description: 'A new document record (title, date, optional number, description and tags). Files are attached in the app.',
    input: FIELDS, required: ['title', 'date'],
    run: async (ctx, a) => {
      const base = space(a);
      const tax = await taxonomy(ctx, base);
      const data = { title: need(str(a.title, 300), 'title'), doc_date: need(str(a.date, 10), 'date'), number: str(a.number, 60), description: str(a.description, 5000), tagIds: tagIds(a, tax) };
      const r = await ctx.call('documents', 'POST', `${base}/documents`, await multipart({ data }));
      return doc({ id: r.id, ...data, files: [], created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) }, tax.names);
    },
  },
  {
    name: 'docs_update', write: true, title: 'Change an e-Management document',
    description: 'Change a document’s title, date, number, description or tags; the fields left out stay as they are (tags given replace its tags). Its files stay.',
    input: { id: { type: 'integer' }, ...FIELDS }, required: ['id'],
    run: async (ctx, a) => {
      const base = space(a);
      const [list, tax] = await Promise.all([listAll(ctx, base), taxonomy(ctx, base)]);
      const d = list.find((x) => x.id === Number(a.id));
      if (!d) throw new ToolError('Document not found.');
      const data = {
        title: a.title !== undefined ? str(a.title, 300) : d.title,
        doc_date: a.date !== undefined ? str(a.date, 10) : d.doc_date,
        number: a.number !== undefined ? str(a.number, 60) : d.number,
        description: a.description !== undefined ? str(a.description, 5000) : d.description,
        tagIds: a.tags !== undefined || a.tag_ids !== undefined ? tagIds(a, tax) : d.tagIds,
        removeFileIds: [],
      };
      await ctx.call('documents', 'PUT', `${base}/documents/${d.id}`, await multipart({ data }));
      return doc({ ...d, ...data }, tax.names);
    },
  },
  {
    name: 'docs_delete', write: true, destructive: true, title: 'Delete an e-Management document',
    description: 'Delete a document and its attached files for good (e-Management has no trash).',
    input: { space: SPACE, id: { type: 'integer' } }, required: ['id'],
    run: async (ctx, a) => ctx.call('documents', 'DELETE', `${space(a)}/documents/${int(a.id, 0, 0, Number.MAX_SAFE_INTEGER)}`),
  },
];

module.exports = { tools };
