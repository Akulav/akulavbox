'use strict';
// Koma Shelf's tools for the AI connector (src/core/connector/tools.js). Koma Shelf's pages are
// server-rendered forms, so the tools read and change its database directly, with the same rules as
// the pages: an account sees only its own webtoons here, and may change their title, description
// and who can see them. Uploading stays in the app (and Koma's own API).
const { ToolError, helpers: { str, int } } = require('../../../src/core/connector/tools');
// the same three as works.js (not required from there: this file also loads when the site can't)
const VISIBILITY = new Set(['private', 'unlisted', 'public']);

function connector({ db }) {
  const localOf = (boxId) => db.get('SELECT id FROM users WHERE box_id = ?', boxId);
  const B = '/manga';
  const work = (w) => ({
    id: w.id, title: w.title, ...(w.description ? { description: w.description } : {}), visibility: w.visibility, status: w.status,
    ...(w.error ? { error: w.error } : {}), chapters: w.chapters, pages: w.pages, views: w.views, likes: w.likes, size_bytes: w.bytes,
    created_at: new Date(w.created).toISOString(), ...(w.published ? { published_at: new Date(w.published).toISOString() } : {}),
    link: `${B}/w/${w.id}`,
  });
  const own = (ctx, id) => {
    const u = localOf(ctx.user.id);
    const w = u && db.get('SELECT * FROM works WHERE id = ? AND user_id = ?', String(id || ''), u.id);
    if (!w) throw new ToolError('Webtoon not found.');
    return w;
  };

  const tools = [
    {
      name: 'koma_webtoons', write: false, title: 'My Koma Shelf webtoons',
      description: 'The account’s own webtoons, newest first, with who can see each one (private, unlisted or public), views and likes.',
      input: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
      run: async (ctx, a) => {
        const u = localOf(ctx.user.id);
        if (!u) return { total: 0, webtoons: [], note: 'This account hasn’t opened Koma Shelf yet.' };
        let rows = db.all('SELECT * FROM works WHERE user_id = ? ORDER BY created DESC', u.id);
        const q = str(a.query, 200).toLowerCase();
        if (q) rows = rows.filter((w) => `${w.title}\n${w.description}`.toLowerCase().includes(q));
        return { total: rows.length, webtoons: rows.slice(0, int(a.limit, 100, 1, 500)).map(work) };
      },
    },
    {
      name: 'koma_webtoon', write: false, title: 'A Koma Shelf webtoon',
      description: 'One of the account’s webtoons with its chapters.',
      input: { id: { type: 'string' } }, required: ['id'],
      run: async (ctx, a) => {
        const w = own(ctx, a.id);
        const chapters = db.all('SELECT idx, title, pages FROM chapters WHERE work_id = ? ORDER BY idx', w.id)
          .map((c) => ({ number: c.idx, title: c.title, pages: (() => { try { return JSON.parse(c.pages).length; } catch (e) { return 0; } })() }));
        return { ...work(w), chapter_list: chapters };
      },
    },
    {
      name: 'koma_update_webtoon', write: true, title: 'Change a Koma Shelf webtoon',
      description: 'Change a webtoon’s title, description or who can see it: private (only you), unlisted (anyone with the link) or public (on the shelf).',
      input: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, visibility: { type: 'string', enum: [...VISIBILITY] } },
      required: ['id'],
      run: async (ctx, a) => {
        const w = own(ctx, a.id);
        const title = a.title !== undefined ? str(a.title, 120) || w.title : w.title;
        const description = a.description !== undefined ? (typeof a.description === 'string' ? a.description.replace(/\r\n/g, '\n').trim().slice(0, 4000) : '') : w.description;
        if (a.visibility !== undefined && !VISIBILITY.has(a.visibility)) throw new ToolError('visibility must be private, unlisted or public.');
        const visibility = a.visibility ?? w.visibility;
        // published: when it first became public, like the edit form
        const published = visibility === 'public' && !w.published && w.status === 'ready' ? Date.now() : w.published;
        db.run('UPDATE works SET title = ?, description = ?, visibility = ?, published = ?, updated = ? WHERE id = ?', title, description, visibility, published, Date.now(), w.id);
        return work(db.get('SELECT * FROM works WHERE id = ?', w.id));
      },
    },
  ];
  return { tools };
}

module.exports = { connector };
