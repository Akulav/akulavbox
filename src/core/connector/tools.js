// The AI connector's tools: what an AI app may do in each app of an AkulavBox account.
//
// A tool is { name, app, write, destructive?, title, description, input (JSON Schema properties),
// required?, run(ctx, args) }. Every app registers its own with apps.register(id, { …, connector:
// { tools } }) (apps/<app>/connector.js); the account overview is here.
//
// Tools reuse the apps' own routes: ctx.call() runs a request through Fastify in the process
// (fastify.inject), signed in as the account with a two-minute token that never leaves the server, so
// every check (ownership, quotas, validation, the app being on for the account) stays where it is.
// A tool is offered when the token has the app's scope ('read', or 'write' for tools that change
// something) and the app is on for the account.
const auth = require('../auth');
const apps = require('../apps');

class ToolError extends Error {}

let server = null;
/** The Fastify instance the tools call into (set when the connector module registers) */
const bind = (fastify) => { server = fastify; };

/** Which header each app's CSRF check wants (the Vue apps); the others check the origin */
const CSRF = { budget: 'florin', tasks: 'tasks', ironveil: 'ironveil' };
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

/** Every tool, with the app it belongs to (the apps that aren't running offer none) */
function all() {
  const out = [...ACCOUNT_TOOLS];
  for (const a of apps.APPS) {
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
