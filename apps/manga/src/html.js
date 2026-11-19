'use strict';
// Tiny HTML templating: html`...` escapes every interpolated value unless it is itself html`` or raw().

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const raw = (s) => new Safe(String(s));

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Safe(out);
}

const toString = (v) => render(v);

// --- formatting helpers ---------------------------------------------------

function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, len] of units) {
    const n = Math.floor(s / len);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function compact(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

const plural = (n, word) => `${compact(n)} ${word}${n === 1 ? '' : 's'}`;

/** Paragraphs from plain text: blank lines split paragraphs, single newlines become <br>. */
function paragraphs(text) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => html`<p>${p.split('\n').map((line, i) => (i ? html`<br>${line}` : line))}</p>`);
}

/**
 * The site is served under a prefix ("/manga") but its views use root paths ("/w/abc"): every root
 * path in href/src/action/poster/srcset and url('/…') gets the prefix. "~/…" means a page of the
 * server around the site and becomes "/…". Escaped text can't match: its quotes are &quot;.
 */
function withBase(prefix, s) {
  return String(s)
    .replace(/(\s(?:href|src|action|poster|srcset)=")\/(?!\/)/g, `$1${prefix}/`)
    .replace(/(\s\d+w,\s*)\/(?!\/)/g, `$1${prefix}/`)
    .replace(/url\('\/(?!\/)/g, `url('${prefix}/`)
    .replace(/(\s(?:href|action)=")~\//g, '$1/');
}

module.exports = { esc, raw, html, toString, timeAgo, compact, plural, paragraphs, withBase };
