// The AI connector's tools: what an AI app may do in each app of an AkulavBox account.
//
// A tool is { name, app, write, destructive?, title, description, input (JSON Schema properties),
// required?, run(ctx, args) }. Trove's tools are here (it is the core); every other app registers its
// own with apps.register(id, { …, connector: { tools } }) (apps/<app>/connector.js).
//
// Tools reuse the apps' own routes: ctx.call() runs a request through Fastify in the process
// (fastify.inject), signed in as the account with a two-minute token that never leaves the server, so
// every check (ownership, quotas, validation, the app being on for the account) stays where it is.
// A tool is offered when the token has the app's scope ('read', or 'write' for tools that change
// something) and the app is on for the account.
const auth = require('../auth');
const apps = require('../apps');
const db = require('../db');
const lib = require('../library');

class ToolError extends Error {}

let server = null;
/** The Fastify instance the tools call into (set when the connector module registers) */
const bind = (fastify) => { server = fastify; };

/** Which header each app's CSRF check wants (the Vue apps); the others check the origin */
const CSRF = { budget: 'florin', tasks: 'tasks' };
const HOST = 'connector.akulavbox.internal';

/**
 * A request into the server as the account. Returns the JSON answer (or { status, headers, body } with
 * raw: true). Errors carry the app's own message.
 */
async function call(user, app, method, url, { json, body, contentType, raw = false } = {}) {
  if (!server) throw new ToolError('The connector is not ready yet.');
  const token = auth.signShort(user);
  const headers = {
    host: HOST, origin: `http://${HOST}`, 'user-agent': 'AkulavBox AI connector',
    authorization: `Bearer ${token}`, cookie: `akb_session=${token}`,
  };
  if (CSRF[app]) headers['x-requested-with'] = CSRF[app];
  let payload;
  if (json !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(json); }
  else if (body !== undefined) { headers['content-type'] = contentType; payload = body; }
  const res = await server.inject({ method, url, headers, payload });
  if (raw && res.statusCode < 400) return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
  let data = null;
  try { data = res.payload ? JSON.parse(res.payload) : null; } catch (e) { data = null; }
  if (res.statusCode >= 400) throw new ToolError(data?.error || data?.message || `The app answered ${res.statusCode}.`);
  if (res.statusCode >= 300) throw new ToolError('The app sent the request somewhere else (is it turned on for this account?).');
  return data;
}

/** A multipart/form-data body (Node's FormData), as { body, contentType } for call() */
async function multipart(fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (file) fd.append(file.field || 'file', new Blob([file.data], { type: file.type || 'application/octet-stream' }), file.name);
  const r = new Response(fd);
  return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
}

// ---------- small helpers for the tools ----------
const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, def, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const need = (v, what) => { if (v === undefined || v === null || v === '') throw new ToolError(`${what} is required.`); return v; };
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|ps1|bat|ya?ml|toml|ini|cfg|conf|env|log|sql|srt|vtt|tex|rtf|svg)$/i;
const isText = (name, mime) => /^text\/|json|xml|javascript|yaml|csv|markdown/.test(String(mime || '')) || TEXT_EXT.test(String(name || ''));
const IMAGE = /^image\/(png|jpe?g|gif|webp)$/;

/** Text, or an MCP image, or a note, from a file's bytes */
function fileContent(name, mime, buf, maxText = 200_000) {
  if (isText(name, mime)) {
    const text = buf.toString('utf-8');
    return { text: text.length > maxText ? `${text.slice(0, maxText)}\n\n[…cut: the file has ${text.length.toLocaleString('en')} characters; ask for less or read it in the app]` : text };
  }
  if (IMAGE.test(String(mime)) && buf.length <= 4 * 1024 * 1024) return { image: { data: buf.toString('base64'), mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime } };
  return { note: `“${name}” is a ${mime || 'binary'} file of ${buf.length.toLocaleString('en')} bytes; only text files and images can be read here.` };
}

// ---------- the account (always offered) ----------
const ACCOUNT_TOOLS = [
  {
    name: 'akulavbox_account', app: null, write: false, title: 'Account overview',
    description: 'Who is signed in, which AkulavBox apps this connector may use (and whether it may change things in them), and the account’s storage. Call this first to see what is available.',
    input: {},
    run: async (ctx) => {
      const space = apps.describeSpace(apps.space(ctx.user.id));
      return {
        account: { username: ctx.user.username, role: ctx.user.role },
        connector: ctx.name,
        apps: apps.APPS.map((a) => ({ id: a.id, name: a.name, about: a.tagline, access: ctx.scopes[a.id] || 'none', on_for_account: apps.access(ctx.user.id, a.id).enabled && apps.status(a.id) === 'running' })),
        storage: space && { used_bytes: space.used_bytes, quota_bytes: space.quota_bytes, free_bytes: space.free_bytes, by_app: Object.fromEntries(space.apps.map((a) => [a.name, a.bytes])) },
      };
    },
  },
];

// ---------- Trove (files, photos, music, videos, books) ----------
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

/** Every tool, with the app it belongs to (the apps that aren't running offer none) */
function all() {
  const out = [...ACCOUNT_TOOLS, ...TROVE_TOOLS];
  for (const a of apps.APPS) {
    if (a.core) continue;
    const c = apps.connectorOf(a.id);
    if (c?.tools) out.push(...c.tools.map((t) => ({ ...t, app: a.id })));
  }
  return out;
}

/** May this token use the tool now? */
function allowed(tool, { user, scopes }) {
  if (!tool.app) return true;
  const level = scopes[tool.app];
  if (!level || (tool.write && level !== 'write')) return false;
  return apps.access(user.id, tool.app).enabled;
}

const forToken = (t) => all().filter((tool) => allowed(tool, t));

/** The tool as MCP lists it */
const describe = (t) => ({
  name: t.name,
  title: t.title,
  description: `${t.app ? `[${apps.byId.get(t.app)?.name}] ` : ''}${t.description}`,
  inputSchema: { type: 'object', properties: t.input || {}, ...(t.required?.length ? { required: t.required } : {}), additionalProperties: false },
  annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: !!t.destructive, idempotentHint: !t.write, openWorldHint: false },
});

/** Run a tool for a token. Throws ToolError for anything the AI should read. */
async function run(t, name, args) {
  const tool = all().find((x) => x.name === name);
  if (!tool) throw new ToolError(`There is no tool called ${name}.`);
  if (!allowed(tool, t)) {
    const app = apps.byId.get(tool.app);
    throw new ToolError(!t.scopes[tool.app] ? `This connector has no access to ${app.name}.` : tool.write && t.scopes[tool.app] !== 'write' ? `This connector may only read ${app.name}, not change it.` : `${app.name} is turned off for this account.`);
  }
  const ctx = { user: t.user, scopes: t.scopes, name: t.name, call: (app, method, url, opts) => call(t.user, app, method, url, opts) };
  return tool.run(ctx, args && typeof args === 'object' ? args : {});
}

module.exports = { bind, call, multipart, run, forToken, describe, all, ToolError, helpers: { str, int, need, isText, fileContent, IMAGE } };
