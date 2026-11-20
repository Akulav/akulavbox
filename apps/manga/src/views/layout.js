'use strict';
const { html, raw } = require('../html.js');

const LOGO = raw(`<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--logo-bg)"/><path d="M12 12h29l-6 19H12z" fill="var(--logo-fg)"/><path d="M45 12h7v19H39z" fill="#f03862"/><rect x="12" y="35" width="40" height="17" rx="2" fill="var(--logo-fg)"/><circle cx="24" cy="43.5" r="3.2" fill="var(--logo-bg)"/><circle cx="33" cy="43.5" r="3.2" fill="var(--logo-bg)"/><circle cx="42" cy="43.5" r="3.2" fill="#f03862"/></svg>`);

const icon = {
  heart: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.6-9.4C.9 7.6 3.3 4 6.9 4c2.1 0 3.7 1.1 5.1 3 1.4-1.9 3-3 5.1-3 3.6 0 6 3.6 4.5 7.1-2.1 4.8-9.6 9.4-9.6 9.4z"/></svg>'),
  eye: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11.2a4.2 4.2 0 110-8.4 4.2 4.2 0 010 8.4zm0-2.2a2 2 0 100-4 2 2 0 000 4z"/></svg>'),
  book: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 016.5 2H20v16H6.5a1 1 0 000 2H20v2H6.5A2.5 2.5 0 014 19.5z"/></svg>'),
  lock: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9V7A5 5 0 007 7v2H5v13h14V9zm-8-2a3 3 0 016 0v2H9z"/></svg>'),
  link: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 010-1.4l3.5-3.5a1 1 0 111.4 1.4L12 13.4a1 1 0 01-1.4 0zM13 16.3l-1.8 1.8a4 4 0 01-5.6-5.6l1.8-1.8a1 1 0 10-1.4-1.4l-1.8 1.8a6 6 0 008.4 8.4l1.8-1.8a1 1 0 10-1.4-1.4zm6.6-12a6 6 0 00-8.4 0L9.4 6.1a1 1 0 001.4 1.4l1.8-1.8a4 4 0 015.6 5.6l-1.8 1.8a1 1 0 001.4 1.4l1.8-1.8a6 6 0 000-8.4z"/></svg>'),
  globe: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm7.9 9h-3.5a15.6 15.6 0 00-1.3-6.1A8 8 0 0119.9 11zM12 4.1c.9 1.2 2.1 3.6 2.4 6.9H9.6c.3-3.3 1.5-5.7 2.4-6.9zM8.9 4.9A15.6 15.6 0 007.6 11H4.1a8 8 0 014.8-6.1zM4.1 13h3.5a15.6 15.6 0 001.3 6.1A8 8 0 014.1 13zm7.9 6.9c-.9-1.2-2.1-3.6-2.4-6.9h4.8c-.3 3.3-1.5 5.7-2.4 6.9zm3.1-.8a15.6 15.6 0 001.3-6.1h3.5a8 8 0 01-4.8 6.1z"/></svg>'),
  upload: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 15.6V5.4L7.7 8.7 6.3 7.3 12 1.6l5.7 5.7-1.4 1.4L13 5.4v10.2zM4 14h2v5h12v-5h2v7H4z"/></svg>'),
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/></svg>'),
  sun: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 110 10 5 5 0 010-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>'),
  moon: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 019.4 3.5 9 9 0 1020.5 14.6z"/></svg>'),
  trash: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7zm4 2v8h1.5v-8zm3.5 0v8H15v-8z"/></svg>'),
  edit: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.3V21h3.7L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 000-1.4l-2.3-2.3a1 1 0 00-1.4 0l-1.8 1.8 3.7 3.7z"/></svg>'),
  arrowL: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5.4L14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>'),
  arrowR: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 18.6L10 20l8-8-8-8-1.4 1.4 6.6 6.6z"/></svg>'),
  shield: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1l9 4v6c0 5.6-3.8 10.7-9 12-5.2-1.3-9-6.4-9-12V5z"/></svg>'),
  width: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2v16H3zm16 0h2v16h-2zM7.5 11h9l-2.3-2.3 1.4-1.4L20.3 12l-4.7 4.7-1.4-1.4 2.3-2.3h-9l2.3 2.3-1.4 1.4L3.7 12l4.7-4.7 1.4 1.4z"/></svg>'),
};

const VIS_LABEL = { private: 'Private', unlisted: 'Unlisted', public: 'Public' };
const visBadge = (v) => html`<span class="badge badge-${v}">${v === 'private' ? icon.lock : v === 'unlisted' ? icon.link : icon.globe}${VIS_LABEL[v]}</span>`;

const csrfField = (req) => (req.csrf ? html`<input type="hidden" name="_csrf" value="${req.csrf}">` : '');

const avatar = (name, cls = '') => {
  // a stable colour per name
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return html`<span class="avatar ${cls}" style="--h:${h}" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>`;
};

function nav(req, active) {
  const u = req.user;
  const link = (href, label, key) => html`<a href="${href}" class="${active === key ? 'active' : ''}" ${active === key ? raw('aria-current="page"') : ''}>${label}</a>`;
  return html`
  <header class="site-header">
    <div class="wrap header-row">
      <a class="brand" href="/" aria-label="${req.site.siteName} home">${LOGO}<span>${req.site.siteName}</span></a>
      <nav class="main-nav" aria-label="Main">
        ${link('/', 'Shelf', 'shelf')}
        ${u ? link('/me', 'My library', 'me') : ''}
        ${u?.role === 'admin' ? link('/admin', 'Admin', 'admin') : ''}
      </nav>
      <div class="header-actions">
        ${u
          ? html`<a class="btn btn-primary btn-sm upload-btn" href="/upload">${icon.upload}<span>Upload</span></a>
            <akb-account accent="#f03862" username="${u.username}" role="${u.role}">
              <a href="/u/${u.username}">Public profile</a>
              <a href="/me">My library</a>
              <a href="/account">Koma Shelf account</a>
              ${u.role === 'admin' ? html`<a href="/admin">Moderation</a>` : ''}
            </akb-account>`
          : html`<button class="icon-btn theme-toggle" type="button" aria-label="Switch light/dark theme" data-theme-toggle>${icon.sun}${icon.moon}</button>
            <a class="btn btn-ghost btn-sm" href="~/">All apps</a><a class="btn btn-primary btn-sm" href="/login">Log in</a>`}
      </div>
    </div>
  </header>`;
}

function layout(req, { title, description, body, active, bodyClass = '', og = {}, chrome = true, scripts = [] }) {
  const site = req.site.siteName;
  const fullTitle = title ? `${title} · ${site}` : `${site} — webtoons made with Koma`;
  const desc = description || 'Read webtoons made with Koma, the app that turns books into manga. Keep your creations private or share them on the shelf.';
  const base = req.site.origin + req.site.base;
  const flash = req.flash;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0d1518" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f3f5f4" media="(prefers-color-scheme: light)">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/dela-gothic-one-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/static/app.css?v=${req.site.assetRev}">
<meta property="og:site_name" content="${site}">
<meta property="og:title" content="${title || site}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="${og.type || 'website'}">
${og.url ? html`<meta property="og:url" content="${base}${og.url}"><link rel="canonical" href="${base}${og.url}">` : ''}
${og.image ? html`<meta property="og:image" content="${base}${og.image}"><meta name="twitter:card" content="summary_large_image">` : html`<meta property="og:image" content="${base}/icon-512.png">`}
${og.noindex ? html`<meta name="robots" content="noindex">` : ''}
<script src="~/hub/theme.js"></script>
${req.user ? html`<script src="~/hub/account.js" defer></script>` : ''}
</head>
<body class="${bodyClass}" data-root="${req.site.base}">
${chrome ? nav(req, active) : ''}
${flash ? html`<div class="flash flash-${flash.kind}" role="status"><div class="wrap">${flash.text}</div></div>` : ''}
${body}
${chrome
  ? html`<footer class="site-footer"><div class="wrap footer-row">
      <a class="brand brand-sm" href="/">${LOGO}<span>${site}</span></a>
      <p>Webtoons made with <a href="https://github.com/Akulav/text-to-manga" rel="noopener">Koma</a>, the app that turns books into manga.</p>
      <p class="muted">v${req.site.version} · made by Akulav</p>
    </div></footer>`
  : ''}
<script src="/static/app.js?v=${req.site.assetRev}" defer></script>
${scripts.map((s) => html`<script src="${s}?v=${req.site.assetRev}" defer></script>`)}
</body>
</html>`;
}

function media(work, file) {
  return `/media/${work.id}/${file}${file.startsWith('cover') ? `?v=${work.cover_rev}` : ''}`;
}

function card(work, { showVis = false, showAuthor = true, eager = false } = {}) {
  const ready = work.status === 'ready';
  return html`<article class="card">
    <a class="card-link" href="/w/${work.id}">
      <div class="cover ${ready ? '' : 'cover-empty'}">
        ${ready
          ? html`<img src="${media(work, 'cover.webp')}" srcset="${media(work, 'cover-s.webp')} 300w, ${media(work, 'cover.webp')} 600w" sizes="(max-width: 560px) 46vw, 240px" width="300" height="400" alt="" ${eager ? '' : raw('loading="lazy"')} decoding="async">`
          : html`<div class="cover-state">${work.status === 'failed' ? 'Upload failed' : html`<span class="spinner"></span>Processing…`}</div>`}
        ${showVis ? html`<div class="cover-badges">${visBadge(work.visibility)}</div>` : ''}
        ${ready ? html`<div class="cover-meta"><span>${icon.heart}${work.likes}</span><span>${icon.book}${work.chapters} ch</span></div>` : ''}
      </div>
      <h3 class="card-title">${work.title}</h3>
    </a>
    ${showAuthor && work.username ? html`<a class="card-author" href="/u/${work.username}">${work.username}</a>` : ''}
  </article>`;
}

function grid(works, opts) {
  return html`<div class="grid">${works.map((w, i) => card(w, { ...opts, eager: i < 6 }))}</div>`;
}

function emptyState(title, text, action) {
  return html`<div class="empty">
    <svg class="empty-art" viewBox="0 0 120 90" aria-hidden="true"><rect x="4" y="4" width="54" height="40" rx="4"/><path d="M64 4h52v40H72z"/><rect x="4" y="50" width="112" height="36" rx="4"/><circle cx="30" cy="68" r="4"/><circle cx="44" cy="68" r="4"/><circle cx="58" cy="68" r="4" class="accent"/></svg>
    <h2>${title}</h2>
    <p>${text}</p>
    ${action || ''}
  </div>`;
}

module.exports = { LOGO, icon, visBadge, csrfField, avatar, layout, media, card, grid, emptyState };
