// Versioned page assets for every app: the scripts and styles of a page are served at
// <prefix>~<revision>/<path>, cached for a year, gzipped once in memory.
//
// One revision for the whole server: a hash of every asset file (the hub, Trove, e-Management,
// Florin, Tick, and Vue and Tailwind from node_modules). Pages are sent with their asset URLs
// rewritten to it (attributes, the import map), and so are the absolute imports inside the scripts
// (`from '/docs/js/state.js'`, '/hub/vendor/vue.js'); relative imports stay under the same revision on
// their own. So a reload costs no request for an unchanged file, and a browser can never mix an old
// cached module with a new page: when anything changes, every URL changes with it.
//
// A URL with another revision (a page cached from before an update) still gets the current file, with
// no-cache. The revision is re-checked (file sizes and dates, cheap) at most every 2 seconds when a
// page is sent, so an edit or an update shows without a restart.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ASSET = /\.(?:js|mjs|css)$/;
const roots = []; // { prefix: '/docs/', dir, files?: Map<rel, abs> } — longest prefix first
const vendor = new Map(); // '/hub/vendor/vue.js' -> abs path in node_modules

/**
 * A folder whose files are served under `prefix` (the URL the page uses today, e.g. '/docs/'), and
 * versioned under `versioned` (default `prefix`). Trove's files are at the site's root ('/lib/api.js')
 * but versioned under '/box/'.
 */
function addRoot(prefix, dir, { versioned = prefix, skip = null } = {}) {
  roots.push({ prefix, dir, versioned, skip });
  roots.sort((a, b) => b.prefix.length - a.prefix.length);
}
/** A file from node_modules at a fixed URL ('/hub/vendor/vue.js') */
const addVendor = (url, file) => vendor.set(url, file);

// ---------- the revision ----------
let rev = null;
let signature = '';
let checkedAt = 0;
const cache = new Map(); // versioned URL path -> { body, gz, type }

function walk(dir, skip, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (skip && skip.test(p)) continue;
    if (e.isDirectory()) walk(p, skip, out);
    else if (ASSET.test(e.name) || e.name === 'index.html' || e.name.endsWith('.html')) out.push(p);
  }
  return out;
}
const allFiles = () => [...roots.flatMap((r) => walk(r.dir, r.skip)), ...vendor.values()];

/** Sizes and dates of every file: changes when any file does, without reading them */
function quickSignature() {
  const h = crypto.createHash('sha1');
  for (const f of allFiles()) { try { const s = fs.statSync(f); h.update(`${f}:${s.size}:${s.mtimeMs};`); } catch (e) { /* gone */ } }
  return h.digest('hex');
}

/** The current revision, re-checked at most every 2 seconds */
function revision() {
  const now = Date.now();
  if (rev && now - checkedAt < 2000) return rev;
  checkedAt = now;
  const sig = quickSignature();
  if (sig !== signature || !rev) {
    const h = crypto.createHash('sha1');
    for (const f of allFiles()) { try { h.update(f); h.update(fs.readFileSync(f)); } catch (e) { /* gone */ } }
    rev = h.digest('base64url').slice(0, 10);
    signature = sig;
    cache.clear();
    pages.clear();
  }
  return rev;
}

// ---------- URLs ----------
/** The file behind a page URL ('/docs/js/ui.js'), and its versioned URL, or null */
function resolve(url) {
  if (vendor.has(url)) return { file: vendor.get(url), versioned: url.replace(/\/([^/]+)$/, `/~${revision()}/$1`) };
  const g = generated.get(url);
  if (g) return { file: url, generated: g, versioned: `${g.versioned}~${revision()}/${g.rel}` };
  for (const r of roots) {
    if (!url.startsWith(r.prefix)) continue;
    const rel = url.slice(r.prefix.length);
    if (!rel || rel.includes('..') || rel.startsWith('~')) return null;
    const file = path.join(r.dir, rel);
    if (r.skip && r.skip.test(file)) return null;
    try { if (!fs.statSync(file).isFile()) return null; } catch (e) { return null; }
    return { file, versioned: `${r.versioned}~${revision()}/${rel}` };
  }
  return null;
}

// a quoted absolute path to a script or style: '/docs/js/state.js', "/hub/vendor/vue.js"
const QUOTED = /(["'`])(\/[\w./-]+\.(?:js|mjs|css))\1/g;
/** Every quoted asset path that is one of ours, replaced by its versioned URL */
function rewrite(text) {
  return text.replace(QUOTED, (m, q, url) => {
    const hit = resolve(url);
    return hit ? `${q}${hit.versioned}${q}` : m;
  });
}

// ---------- Tailwind, compiled here ----------
// A page with Tailwind's browser build and a `<style type="text/tailwindcss">` gets, in their place, a
// link to `<its root>tailwind.css`: the same classes compiled once on the server (core/tailwind.js), so
// the page never waits for a script to style it, and never shows up unstyled.
const generated = new Map(); // '/budget/tailwind.css' -> { css, dirs, versioned, rel }
const TW_STYLE = /<style type="text\/tailwindcss">([\s\S]*?)<\/style>/;
const TW_SCRIPT = /[ \t]*<script src="\/hub\/vendor\/tailwind\.js"><\/script>\r?\n?/;
const shared = path.join(__dirname, '..', '..', 'hub', 'vue'); // components the Vue apps share

function withCompiledTailwind(file, html) {
  const m = html.match(TW_STYLE);
  if (!m) return html;
  const r = roots.find((x) => file.startsWith(x.dir + path.sep));
  if (!r) return html;
  const url = `${r.prefix}tailwind.css`;
  generated.set(url, { css: m[1], dirs: [r.dir, shared], skip: r.skip, versioned: r.versioned, rel: 'tailwind.css' });
  return html.replace(TW_SCRIPT, '').replace(TW_STYLE, `<link rel="stylesheet" href="${url}">`);
}

/** A page's HTML with its asset URLs versioned (kept until the revision changes) */
const pages = new Map();
function page(file) {
  revision();
  let p = pages.get(file);
  if (!p) {
    const html = rewrite(withCompiledTailwind(file, fs.readFileSync(file, 'utf-8')));
    p = { html, etag: `"${crypto.createHash('sha1').update(html).digest('base64url').slice(0, 16)}"` };
    pages.set(file, p);
  }
  return p;
}

/** Send a page (no-cache, with an ETag: the HTML is small, its assets are what get cached) */
function sendPage(request, reply, file) {
  const p = page(file);
  reply.header('Cache-Control', 'no-cache').header('ETag', p.etag);
  if (request.headers['if-none-match'] === p.etag) return reply.code(304).send();
  return reply.type('text/html; charset=utf-8').send(p.html);
}

// ---------- serving ----------
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const packed = (body, type) => ({ body, gz: body.length > 1024 ? zlib.gzipSync(body, { level: 9 }) : null, type });

/** Load (rewrite, gzip) an asset for a versioned URL's path part */
function load(file) {
  const raw = fs.readFileSync(file);
  // node_modules files are taken as they are; ours get their imports versioned
  const body = [...vendor.values()].includes(file) ? raw : Buffer.from(rewrite(raw.toString('utf-8')));
  return packed(body, TYPES[path.extname(file)] || 'application/octet-stream');
}

// one compile at a time per stylesheet, however many requests ask for it at once
const compiling = new Map();
function loadGenerated(url, g) {
  if (!compiling.has(url)) {
    const at = rev;
    compiling.set(url, require('./tailwind').compile(g.css, g.dirs, { skip: g.skip })
      .then((css) => { const a = packed(Buffer.from(css), TYPES['.css']); if (at === rev) cache.set(url, a); return a; })
      .finally(() => compiling.delete(url)));
  }
  return compiling.get(url);
}

/** The Fastify routes: one per versioned prefix (call once every root is added) */
function routes(fastify) {
  const send = async (request, reply, url) => {
    const current = revision();
    const hit = resolve(url);
    if (!hit || !ASSET.test(hit.file)) return reply.code(404).send({ error: 'Not found' });
    let a = cache.get(hit.file);
    if (!a && hit.generated) {
      try { a = await loadGenerated(hit.file, hit.generated); } catch (e) {
        request.log.error(e);
        return reply.code(500).header('Cache-Control', 'no-store').send({ error: 'The page’s styles could not be built.' });
      }
    }
    if (!a) { a = load(hit.file); cache.set(hit.file, a); }
    reply.header('Cache-Control', request.params.rev === current ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('Vary', 'Accept-Encoding').header('X-Content-Type-Options', 'nosniff').type(a.type);
    if (a.gz && /\bgzip\b/.test(String(request.headers['accept-encoding'] || ''))) return reply.header('Content-Encoding', 'gzip').send(a.gz);
    return reply.send(a.body);
  };
  // the pages that use Tailwind, read now: their stylesheet must be known before any page asks for it
  // (a browser holding a page from before a restart asks for the stylesheet directly)
  for (const r of roots) {
    for (const f of walk(r.dir, r.skip)) {
      if (f.endsWith('.html') && TW_STYLE.test(fs.readFileSync(f, 'utf-8'))) page(f);
    }
  }
  const versionedPrefixes = new Set(roots.map((r) => r.versioned));
  for (const vp of versionedPrefixes) {
    fastify.get(`${vp}~:rev/*`, async (request, reply) => {
      const rel = request.params['*'];
      if (!/^[\w./-]+$/.test(rel) || rel.includes('..')) return reply.code(404).send({ error: 'Not found' });
      // the versioned prefix back to the URL the files live at
      const r = roots.find((x) => x.versioned === vp && resolve(`${x.prefix}${rel}`));
      return send(request, reply, r ? `${r.prefix}${rel}` : `${vp}${rel}`);
    });
  }
  // vendor files: /hub/vendor/~<rev>/vue.js
  const vendorDirs = new Set([...vendor.keys()].map((u) => u.replace(/[^/]+$/, '')));
  for (const d of vendorDirs) fastify.get(`${d}~:rev/:file`, async (request, reply) => send(request, reply, `${d}${request.params.file}`));
}

module.exports = { addRoot, addVendor, routes, rewrite, page, sendPage, revision, resolve };
