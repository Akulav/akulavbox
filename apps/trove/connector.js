'use strict';
// Trove's tools for the AI connector (src/core/connector/tools.js). They go through Trove's own API
// (/api/…), so ownership, hidden library folders, quotas and validation work exactly as in the page.
const db = require('../../src/core/db');
const lib = require('./lib/library');
const { ToolError, multipart, helpers: { str, int, need, isText, fileContent, IMAGE } } = require('../../src/core/connector/tools');
const fileShape = (f) => ({ id: f.id, name: f.filename, size_bytes: f.size_bytes, type: f.mime_type, created_at: f.created_at, ...(f.folder_name !== undefined ? { folder: f.folder_name, folder_id: f.folder_id } : {}), shared: !!f.public_hash });
const folderShape = (f) => ({ id: f.id, name: f.name, ...(f.item_count !== undefined ? { items: f.item_count, size_bytes: f.size_bytes } : {}), ...(f.system_key ? { library: f.system_key } : {}) });

/** A file of the account that Trove would show (not trashed, not in a hidden folder), or an error */
function ownFile(userId, id) {
  const f = db.prepare(`SELECT f.*, d.system_key FROM files f LEFT JOIN folders d ON d.id = f.folder_id
    WHERE f.id = ? AND f.owner_id = ? AND f.trashed_at IS NULL`).get(String(id || ''), userId);
  if (!f || (f.system_key && lib.hiddenKeys(userId).includes(f.system_key))) throw new ToolError('File not found.');
  return f;
}

const SECTIONS = { photos: 'photos', music: 'music', videos: 'videos', books: 'books' };

const TROVE_TOOLS = [
  {
    name: 'trove_list_folder', app: 'box', write: false, title: 'List a Trove folder',
    description: 'The folders and files in a Trove folder (the top level when folder_id is left out), with sizes. Library folders (Photos, Music, Videos, Books) are marked.',
    input: { folder_id: { type: 'string', description: 'A folder id from an earlier listing; leave out for the top level' } },
    run: async (ctx, a) => {
      const d = await ctx.call('box', 'GET', `/api/directory/${a.folder_id ? encodeURIComponent(str(a.folder_id, 64)) : ''}`);
      return { path: d.currentPath.map((p) => p.name).join(' / ') || '(top level)', folders: d.folders.map(folderShape), files: d.files.map(fileShape) };
    },
  },
  {
    name: 'trove_search', app: 'box', write: false, title: 'Search Trove',
    description: 'Files and folders whose name contains the text, across the whole of Trove.',
    input: { query: { type: 'string', description: 'At least 2 characters' } }, required: ['query'],
    run: async (ctx, a) => {
      const d = await ctx.call('box', 'GET', `/api/search?q=${encodeURIComponent(str(a.query, 200))}`);
      return { files: d.files.map(fileShape), folders: d.folders.map(folderShape) };
    },
  },
  {
    name: 'trove_library', app: 'box', write: false, title: 'List a Trove library',
    description: 'The items of a library section (photos, music, videos or books) with their details (title, artist or creator, album or series, length), newest first.',
    input: { section: { type: 'string', enum: Object.keys(SECTIONS) }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 }, query: { type: 'string', description: 'Only items whose name or details contain this' } },
    required: ['section'],
    run: async (ctx, a) => {
      const section = SECTIONS[a.section];
      if (!section) throw new ToolError('section must be photos, music, videos or books.');
      const d = await ctx.call('box', 'GET', `/api/library/${section}`);
      const q = str(a.query, 200).toLowerCase();
      const pick = ['title', 'artist', 'album', 'creator', 'series', 'date', 'duration', 'width', 'height', 'genre', 'author'];
      let items = d.items.map((i) => ({ id: i.id, name: i.filename, size_bytes: i.size_bytes, type: i.mime_type, created_at: i.created_at, ...Object.fromEntries(pick.filter((k) => i[k] != null && i[k] !== '').map((k) => [k, i[k]])) }));
      if (q) items = items.filter((i) => JSON.stringify(i).toLowerCase().includes(q));
      items.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
      const limit = int(a.limit, 100, 1, 500);
      return { total: items.length, items: items.slice(0, limit) };
    },
  },
  {
    name: 'trove_read_file', app: 'box', write: false, title: 'Read a Trove file',
    description: 'The contents of a text file (notes, code, CSV, Markdown, …, up to 2 MB), or an image (up to 4 MB; larger photos come as a preview). Other files give their details only.',
    input: { file_id: { type: 'string' } }, required: ['file_id'],
    run: async (ctx, a) => {
      const f = ownFile(ctx.user.id, a.file_id);
      const info = { id: f.id, name: f.filename, size_bytes: f.size_bytes, type: f.mime_type };
      if (isText(f.filename, f.mime_type)) {
        if (f.size_bytes > 2 * 1024 * 1024) return { ...info, note: 'This text file is larger than 2 MB; open it in Trove.' };
        const r = await ctx.call('box', 'GET', `/api/files/${encodeURIComponent(f.id)}/view`, { raw: true });
        return { ...info, ...fileContent(f.filename, f.mime_type, r.body) };
      }
      if (IMAGE.test(String(f.mime_type))) {
        const url = f.size_bytes <= 4 * 1024 * 1024 ? `/api/files/${encodeURIComponent(f.id)}/view` : `/api/files/${encodeURIComponent(f.id)}/thumb?w=1200`;
        const r = await ctx.call('box', 'GET', url, { raw: true });
        const mime = String(r.headers['content-type'] || f.mime_type).split(';')[0];
        return { ...info, ...fileContent(f.filename, mime, r.body) };
      }
      return { ...info, note: 'Only text files and images can be read through the connector.' };
    },
  },
  {
    name: 'trove_create_folder', app: 'box', write: true, title: 'Create a Trove folder',
    description: 'A new folder, at the top level or inside another folder (not inside a library folder).',
    input: { name: { type: 'string' }, parent_id: { type: 'string', description: 'Leave out for the top level' } }, required: ['name'],
    run: async (ctx, a) => ctx.call('box', 'POST', '/api/folders', { json: { name: need(str(a.name, 255), 'name'), parent_id: str(a.parent_id, 64) || null } }),
  },
  {
    name: 'trove_write_text_file', app: 'box', write: true, title: 'Save a new text file in Trove',
    description: 'Save text (a note, Markdown, CSV, code, …) as a new file. It counts towards the account’s storage.',
    input: { name: { type: 'string', description: 'File name with its extension, e.g. "notes.md"' }, content: { type: 'string' }, folder_id: { type: 'string', description: 'Leave out for the top level' } },
    required: ['name', 'content'],
    run: async (ctx, a) => {
      const name = need(str(a.name, 255), 'name');
      const data = Buffer.from(typeof a.content === 'string' ? a.content : '', 'utf-8');
      if (data.length > 5 * 1024 * 1024) throw new ToolError('The connector saves text files up to 5 MB.');
      const uploadId = `ai-${require('crypto').randomUUID()}`;
      const m = await multipart({ upload_id: uploadId, chunk_index: '0', total_chunks: '1', total_size: String(data.length), offset: '0', folder_id: str(a.folder_id, 64) || 'null' },
        { name, data, type: /\.md$/i.test(name) ? 'text/markdown' : /\.csv$/i.test(name) ? 'text/csv' : /\.json$/i.test(name) ? 'application/json' : 'text/plain' });
      const r = await ctx.call('box', 'POST', '/api/files/upload', m);
      return { id: r.fileId, name, size_bytes: data.length };
    },
  },
  {
    name: 'trove_update_text_file', app: 'box', write: true, title: 'Replace a Trove text file',
    description: 'Replace the whole contents of an existing text file (it keeps its name, folder and share link).',
    input: { file_id: { type: 'string' }, content: { type: 'string' } }, required: ['file_id', 'content'],
    run: async (ctx, a) => {
      const f = ownFile(ctx.user.id, a.file_id);
      if (!isText(f.filename, f.mime_type)) throw new ToolError('Only text files can be replaced this way.');
      return ctx.call('box', 'PUT', `/api/files/${encodeURIComponent(f.id)}/content`, { json: { content: typeof a.content === 'string' ? a.content : '' } });
    },
  },
  {
    name: 'trove_rename', app: 'box', write: true, title: 'Rename in Trove',
    description: 'Rename a file or a folder (give one of file_id or folder_id).',
    input: { file_id: { type: 'string' }, folder_id: { type: 'string' }, name: { type: 'string' } }, required: ['name'],
    run: async (ctx, a) => {
      const name = need(str(a.name, 255), 'name');
      if (a.file_id) return ctx.call('box', 'PATCH', `/api/files/${encodeURIComponent(str(a.file_id, 64))}/name`, { json: { name } });
      return ctx.call('box', 'PATCH', `/api/folders/${encodeURIComponent(need(str(a.folder_id, 64), 'file_id or folder_id'))}/name`, { json: { name } });
    },
  },
  {
    name: 'trove_move', app: 'box', write: true, title: 'Move in Trove',
    description: 'Move files and folders into another folder (to_folder_id), or to the top level when it is left out.',
    input: { file_ids: { type: 'array', items: { type: 'string' } }, folder_ids: { type: 'array', items: { type: 'string' } }, to_folder_id: { type: 'string' } },
    run: async (ctx, a) => {
      const r = await ctx.call('box', 'POST', '/api/items/move', { json: { files: [].concat(a.file_ids || []), folders: [].concat(a.folder_ids || []), folder_id: str(a.to_folder_id, 64) || null } });
      if (!r.moved && r.errors?.length) throw new ToolError(r.errors.join(' '));
      return r;
    },
  },
  {
    name: 'trove_trash', app: 'box', write: true, destructive: true, title: 'Move to Trove’s trash',
    description: 'Move files and folders to the trash. They can be restored from Trove’s Trash page until it is emptied.',
    input: { file_ids: { type: 'array', items: { type: 'string' } }, folder_ids: { type: 'array', items: { type: 'string' } } },
    run: async (ctx, a) => ctx.call('box', 'POST', '/api/items/trash', { json: { files: [].concat(a.file_ids || []), folders: [].concat(a.folder_ids || []) } }),
  },
];


module.exports = { tools: TROVE_TOOLS };
