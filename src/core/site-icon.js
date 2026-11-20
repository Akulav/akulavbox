// "Why doesn't Bitwarden show this site's icon?" A check that fetches the server's public address the
// way Bitwarden's icon service does (bitwarden/server, src/Icons), from this server, and says what each
// step found. Node, like that service (.NET), checks the whole TLS certificate chain itself: a chain
// missing its intermediate certificate, which browsers often forgive, fails here as it fails there.
//
// Bitwarden's rules, in short: the address must be a domain name (no IP, no port) with an IPv4 address;
// it fetches https://<domain>/ (http only when that fails), follows at most 2 redirects (301, 302, 303,
// 307; not 308), reads the <link> icons of <head> (rel icon / shortcut icon / apple-touch-icon, or any
// link to a .ico/.png/.jpg), prefers sizes 32x32, then 64x64, then other squares 24–128, then 16x16,
// keeps PNG, ICO and JPEG only (by type or first bytes), and falls back to /favicon.ico. It caches what
// it found, a miss included, for 24 hours, and browsers keep its answer for 7 days.
const dns = require('dns').promises;
const net = require('net');

const TIMEOUT = 8000;
const REDIRECTS = new Set([301, 302, 303, 307]);
const IMAGE_TYPES = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg']);

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { return await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'AkulavBox site icon check' } }); }
  finally { clearTimeout(t); }
}
const why = (e) => {
  const c = e?.cause;
  if (e?.name === 'AbortError') return `no answer within ${TIMEOUT / 1000} seconds`;
  if (c?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || c?.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY') return 'the HTTPS certificate chain is incomplete (the server doesn’t send the intermediate certificate). Browsers often forgive this; Bitwarden’s icon service doesn’t. Serve the full chain (fullchain.pem) in your proxy';
  if (c?.code === 'CERT_HAS_EXPIRED') return 'the HTTPS certificate has expired';
  if (c?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'the HTTPS certificate is for another name';
  if (c?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || c?.code === 'SELF_SIGNED_CERT_IN_CHAIN') return 'the HTTPS certificate is self-signed';
  return c?.code ? `${c.code}: ${c.message || ''}`.trim() : e?.message || String(e);
};

/** Follow a URL like Bitwarden does: at most 2 redirects, of the kinds it follows */
async function follow(url, steps) {
  let cur = url;
  for (let hop = 0; hop <= 2; hop++) {
    let res;
    try { res = await get(cur); } catch (e) { steps.push({ ok: false, text: `${cur}: ${why(e)}` }); return null; }
    if (res.status >= 200 && res.status < 300) return { res, url: cur };
    if (REDIRECTS.has(res.status) && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), cur).toString();
      steps.push({ ok: true, text: `${cur} redirects (${res.status}) to ${next}` });
      cur = next;
      continue;
    }
    steps.push({ ok: false, text: res.status === 308 ? `${cur} answers 308 (Permanent Redirect), which Bitwarden doesn’t follow. Use 301 in your proxy.` : `${cur} answers ${res.status}` });
    return null;
  }
  steps.push({ ok: false, text: 'more than 2 redirects: Bitwarden stops after 2' });
  return null;
}

const attr = (tag, name) => (new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag) || []).slice(2).find((x) => x !== undefined) ?? null;
const BLOCKED_REL = new Set(['preload', 'image_src', 'preconnect', 'canonical', 'alternate', 'stylesheet']);
const ICON_REL = new Set(['icon', 'apple-touch-icon', 'shortcut icon']);
function priority(sizes) {
  const m = /^(\d+)x(\d+)$/.exec(String(sizes || '').trim());
  if (!m || m[1] !== m[2]) return 200;
  const s = Number(m[1]);
  return s === 32 ? 1 : s === 64 ? 2 : s >= 24 && s <= 128 ? 3 : s === 16 ? 4 : 100;
}
function iconLinks(html, base) {
  const head = /<head[\s>][\s\S]*?<\/head>/i.exec(html)?.[0] || '';
  const out = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href || !href.trim()) continue;
    const rel = (attr(tag, 'rel') || '').trim().toLowerCase();
    const ext = (/\.([a-z0-9]+)$/i.exec(href.split('#')[0]) || [])[1]?.toLowerCase();
    if (!ICON_REL.has(rel) && (BLOCKED_REL.has(rel) || !['ico', 'png', 'jpg', 'jpeg'].includes(ext))) continue;
    out.push({ href: new URL(href, base).toString(), rel, sizes: attr(tag, 'sizes'), priority: priority(attr(tag, 'sizes')) });
  }
  return out.slice(0, 200).sort((a, b) => a.priority - b.priority).slice(0, 10);
}

/** Is it an icon Bitwarden keeps? (type or first bytes, and a PNG that ends properly) */
function validIcon(type, buf) {
  const t = String(type || '').split(';')[0].trim().toLowerCase();
  const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
  const isIco = buf.length > 6 && buf.readUInt32BE(0) === 0x00000100;
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!IMAGE_TYPES.has(t) && !isPng && !isIco && !isJpg) return `not a PNG, ICO or JPEG (${t || 'no type'})`;
  if (isPng) {
    let o = 8;
    while (o + 12 <= buf.length) {
      const len = buf.readUInt32BE(o);
      if (buf.toString('latin1', o + 4, o + 8) === 'IEND') return null;
      o += 12 + len;
    }
    return 'a PNG without its end (IEND)';
  }
  return null;
}

/** Run the check for an address like https://cloud.example.com. Returns { ok, icon, steps }. */
async function check(address) {
  const steps = [];
  let u;
  try { u = new URL(address); } catch (e) { return { ok: false, steps: [{ ok: false, text: `“${address}” isn’t an address.` }] }; }
  const host = u.hostname;
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return { ok: false, steps: [{ ok: false, text: `${host} is an IP address: Bitwarden only fetches icons for domain names.` }] };
  if (!host.includes('.')) return { ok: false, steps: [{ ok: false, text: `${host} has no dot: Bitwarden refuses names like that.` }] };
  if (u.port) steps.push({ ok: false, text: `The address has a port (${u.port}). Bitwarden asks the domain on the standard ports (443, then 80), so the icon has to be reachable there.` });
  try {
    const a = await dns.resolve4(host);
    steps.push({ ok: true, text: `${host} has an IPv4 address (${a[0]}).` });
    if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.)/.test(a[0])) steps.push({ ok: false, text: `${a[0]} is a private address: Bitwarden’s icon service (on the internet) can’t reach it.` });
  } catch (e) {
    steps.push({ ok: false, text: `${host} has no IPv4 (A) record. Bitwarden’s icon service needs one, even when the site works over IPv6.` });
  }

  let page = await follow(`https://${host}/`, steps);
  if (!page) {
    steps.push({ ok: false, text: 'Trying http:// as Bitwarden does next.' });
    page = await follow(`http://${host}/`, steps);
  }
  const tried = [];
  if (page) {
    const html = await page.res.text().catch(() => '');
    const links = iconLinks(html, page.url);
    steps.push({ ok: links.length > 0, text: links.length ? `${page.url} lists ${links.length} usable icon(s); the best: ${links[0].href}${links[0].sizes ? ` (${links[0].sizes})` : ''}.` : `${page.url} lists no icon Bitwarden can use in its <head>.` });
    tried.push(...links.map((l) => l.href));
  }
  tried.push(`https://${host}/favicon.ico`);
  for (const url of [...new Set(tried)]) {
    const r = await follow(url, steps);
    if (!r) continue;
    const buf = Buffer.from(await r.res.arrayBuffer());
    const bad = validIcon(r.res.headers.get('content-type'), buf);
    if (bad) { steps.push({ ok: false, text: `${url}: ${bad}.` }); continue; }
    steps.push({ ok: true, text: `${url} is a valid icon (${buf.length.toLocaleString('en')} bytes). Bitwarden would use it.` });
    return { ok: true, icon: url, steps };
  }
  steps.push({ ok: false, text: 'No icon Bitwarden could use was found.' });
  return { ok: false, icon: null, steps };
}

module.exports = { check, iconLinks, validIcon, priority };
