'use strict';
// Koma Shelf: the public pages (the shelf, a work, the reader, a creator's profile).
const { html, raw, timeAgo, plural, compact, paragraphs } = require('../html.js');
const { layout, card, grid, emptyState, icon, visBadge, csrfField, avatar, media } = require('./layout.js');

const SORTS = [
  ['new', 'Newest'],
  ['popular', 'Most liked'],
  ['views', 'Most read'],
];

// --- shelf (home) -----------------------------------------------------------

function shelfPage(req, { works, featured, sort, q, page, hasMore, total }) {
  const qs = (p) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort !== 'new' ? { sort } : {}), ...(p > 1 ? { page: p } : {}) })}`;
  const hero =
    !q && page === 1
      ? html`<section class="hero">
          <div class="hero-tone" aria-hidden="true"></div>
          ${featured ? html`<div class="hero-bg" style="background-image:url('${media(featured, 'cover.webp')}')" aria-hidden="true"></div>` : ''}
          <div class="wrap hero-row">
            <div class="hero-copy">
              <p class="eyebrow">The shelf</p>
              <h1>Books, redrawn<br>as <em>webtoons</em>.</h1>
              <p class="lede">Every story here was turned from text into manga with Koma. Read what people shared, or upload your own — keep it private, share a link, or put it on the shelf.</p>
              <div class="hero-cta">
                ${req.user ? html`<a class="btn btn-primary" href="/upload">${icon.upload}Upload a webtoon</a>` : html`<a class="btn btn-primary" href="/login">Log in to upload</a>`}
                <a class="btn btn-ghost" href="https://github.com/Akulav/text-to-manga/releases/latest" rel="noopener">Get Koma</a>
              </div>
            </div>
            ${featured
              ? html`<a class="hero-feature" href="/w/${featured.id}">
                  <img src="${media(featured, 'cover.webp')}" width="600" height="800" alt="" fetchpriority="high">
                  <span class="hero-feature-label"><span class="eyebrow">Featured</span><strong>${featured.title}</strong><span>by ${featured.username}</span></span>
                </a>`
              : ''}
          </div>
        </section>`
      : '';
  const body = html`
  <main>
    ${hero}
    <section class="wrap section">
      <div class="toolbar">
        <div class="tabs" role="tablist" aria-label="Sort">
          ${SORTS.map(([k, label]) => html`<a role="tab" aria-selected="${sort === k}" class="tab ${sort === k ? 'active' : ''}" href="?${new URLSearchParams({ ...(q ? { q } : {}), ...(k !== 'new' ? { sort: k } : {}) })}">${label}</a>`)}
        </div>
        <form class="search" role="search" action="/" method="get">
          ${icon.search}
          <input type="search" name="q" value="${q}" placeholder="Search titles and creators" aria-label="Search" maxlength="80">
          ${sort !== 'new' ? html`<input type="hidden" name="sort" value="${sort}">` : ''}
        </form>
      </div>
      ${q ? html`<p class="result-note">${plural(total, 'result')} for “${q}” · <a href="/">clear</a></p>` : ''}
      ${works.length
        ? grid(works)
        : q
          ? emptyState('Nothing matches that', 'Try another title or creator name.')
          : emptyState('The shelf is empty — for now', 'Be the first to share a webtoon. Upload Koma’s “out” folder as a zip and set it to Public.', req.user ? html`<a class="btn btn-primary" href="/upload">Upload a webtoon</a>` : html`<a class="btn btn-primary" href="/login">Log in to upload</a>`)}
      ${page > 1 || hasMore
        ? html`<nav class="pager" aria-label="Pages">
            ${page > 1 ? html`<a class="btn btn-ghost" href="${qs(page - 1)}">${icon.arrowL}Newer</a>` : html`<span></span>`}
            <span class="muted">Page ${page}</span>
            ${hasMore ? html`<a class="btn btn-ghost" href="${qs(page + 1)}">More${icon.arrowR}</a>` : html`<span></span>`}
          </nav>`
        : ''}
    </section>
  </main>`;
  return layout(req, { title: q ? `Search: ${q}` : '', body, active: 'shelf', og: { url: '/' } });
}

// --- work page ----------------------------------------------------------------

function workPage(req, { work, author, chapters, isOwner, isAdmin, liked }) {
  const ready = work.status === 'ready';
  const canEdit = isOwner;
  const shareUrl = `/w/${work.id}`;
  const body = html`
  <main class="work">
    ${ready ? html`<div class="work-backdrop" style="background-image:url('${media(work, 'cover-s.webp')}')" aria-hidden="true"></div>` : ''}
    <div class="wrap work-head">
      <div class="work-cover">
        ${ready ? html`<img src="${media(work, 'cover.webp')}" width="600" height="800" alt="Cover of ${work.title}" fetchpriority="high">` : html`<div class="cover cover-empty"><div class="cover-state">${work.status === 'failed' ? 'Upload failed' : html`<span class="spinner"></span>Processing…`}</div></div>`}
      </div>
      <div class="work-info">
        ${isOwner || work.visibility !== 'public' ? html`<div class="work-badges">${visBadge(work.visibility)}</div>` : ''}
        <h1>${work.title}</h1>
        <a class="byline" href="/u/${author.username}">${avatar(author.username, 'avatar-sm')}<span>${author.username}</span></a>
        ${ready
          ? html`<ul class="stats">
              <li>${icon.book}${plural(work.chapters, 'chapter')}</li>
              <li>${icon.eye}${compact(work.views)} reads</li>
              <li>${icon.heart}<span data-like-count>${compact(work.likes)}</span> likes</li>
              <li class="muted">${work.published ? `Shared ${timeAgo(work.published)}` : `Uploaded ${timeAgo(work.created)}`}</li>
            </ul>`
          : ''}
        ${work.description ? html`<div class="description">${paragraphs(work.description)}</div>` : ''}

        ${work.status === 'processing'
          ? html`<div class="processing" data-poll="/api/works/${work.id}/status">
              <p><strong>Getting your webtoon ready…</strong> Strips are being optimised for fast reading. This page updates by itself.</p>
              <div class="bar"><span style="width:${Math.round(work.progress * 100)}%" data-progress></span></div>
            </div>`
          : ''}
        ${work.status === 'failed' ? html`<div class="notice notice-error"><strong>This upload failed.</strong> ${work.error || ''}</div>` : ''}

        <div class="work-actions">
          ${ready && chapters.length ? html`<a class="btn btn-primary btn-lg" href="/w/${work.id}/1" data-continue="${work.id}">${icon.book}Start reading</a>` : ''}
          ${ready
            ? req.user
              ? html`<form method="post" action="/w/${work.id}/like" data-like>${csrfField(req)}<button class="btn btn-ghost btn-like ${liked ? 'liked' : ''}" type="submit" aria-pressed="${liked}">${icon.heart}<span>${liked ? 'Liked' : 'Like'}</span></button></form>`
              : html`<a class="btn btn-ghost" href="/login?next=${encodeURIComponent(shareUrl)}">${icon.heart}Like</a>`
            : ''}
          ${ready && work.visibility !== 'private' ? html`<button class="btn btn-ghost" type="button" data-copy="${shareUrl}">${icon.link}<span>Copy link</span></button>` : ''}
          ${canEdit ? html`<a class="btn btn-ghost" href="/w/${work.id}/edit">${icon.edit}Edit</a>` : ''}
          ${isAdmin && !isOwner
            ? html`<form method="post" action="/admin/works/${work.id}/delete" data-confirm="Delete “${work.title}” by ${author.username}? This removes it for everyone and cannot be undone.">${csrfField(req)}<button class="btn btn-danger" type="submit">${icon.trash}Delete (admin)</button></form>`
            : ''}
        </div>
      </div>
    </div>

    ${ready && chapters.length
      ? html`<section class="wrap section">
          <h2 class="section-title">Chapters</h2>
          <ol class="chapters">
            ${chapters.map(
              (c) => html`<li><a href="/w/${work.id}/${c.idx}" data-chapter="${c.idx}">
                <span class="ch-num">${String(c.idx).padStart(2, '0')}</span>
                <span class="ch-title">${c.title}</span>
                <span class="ch-meta" data-chapter-state></span>
                ${icon.arrowR}
              </a></li>`,
            )}
          </ol>
        </section>`
      : ''}
  </main>`;
  return layout(req, {
    title: work.title,
    description: work.description ? work.description.slice(0, 180) : `${work.title}, a webtoon by ${author.username}, made with Koma.`,
    body,
    og: { url: shareUrl, image: ready ? media(work, 'cover.webp') : null, type: 'article', noindex: work.visibility !== 'public' },
  });
}

// --- reader -------------------------------------------------------------------

function readerPage(req, { work, chapter, chapters, pages }) {
  const n = chapter.idx;
  const prev = n > 1 ? n - 1 : null;
  const next = n < chapters.length ? n + 1 : null;
  const dir = `c${String(n).padStart(3, '0')}`;
  const body = html`
  <div class="reader" style="--strip-bg:${work.bg}" data-reader="${work.id}:${n}">
    <header class="reader-bar" data-reader-bar>
      <a class="icon-btn" href="/w/${work.id}" aria-label="Back to ${work.title}">${icon.arrowL}</a>
      <div class="reader-title">
        <a href="/w/${work.id}">${work.title}</a>
        <label class="chapter-pick">
          <span class="sr-only">Chapter</span>
          <select data-chapter-select>
            ${chapters.map((c) => html`<option value="/w/${work.id}/${c.idx}" ${c.idx === n ? raw('selected') : ''}>${c.idx}. ${c.title}</option>`)}
          </select>
        </label>
      </div>
      <div class="reader-tools">
        ${prev ? html`<a class="icon-btn" href="/w/${work.id}/${prev}" aria-label="Previous chapter" rel="prev">${icon.arrowL}</a>` : ''}
        ${next ? html`<a class="icon-btn" href="/w/${work.id}/${next}" aria-label="Next chapter" rel="next">${icon.arrowR}</a>` : ''}
        <button class="icon-btn" type="button" data-width-toggle aria-label="Toggle wide view" title="Wide view (W)">${icon.width}</button>
      </div>
      <div class="reader-progress"><span data-reader-progress></span></div>
    </header>

    <main class="strip" id="strip">
      <h1 class="sr-only">${work.title} — ${chapter.title}</h1>
      ${pages.map(([w, h, small], i) => {
        const name = String(i + 1).padStart(4, '0');
        const full = `/media/${work.id}/${dir}/${name}.webp`;
        return html`<img src="${full}" ${small ? raw(`srcset="/media/${work.id}/${dir}/${name}-s.webp 720w, ${full} ${w}w" sizes="(max-width: 820px) 100vw, 820px"`) : ''} width="${w}" height="${h}" alt="" ${i < 2 ? raw(i === 0 ? 'fetchpriority="high"' : '') : raw('loading="lazy"')} decoding="async">`;
      })}
    </main>

    <footer class="reader-end">
      <p class="eyebrow">End of chapter ${n}</p>
      <h2>${chapter.title}</h2>
      <div class="reader-end-actions">
        ${next
          ? html`<a class="btn btn-primary btn-lg" href="/w/${work.id}/${next}" rel="next">Next: ${chapters[next - 1].title}${icon.arrowR}</a>`
          : html`<p class="muted">That’s the last chapter.</p>`}
        <a class="btn btn-ghost" href="/w/${work.id}">Back to ${work.title}</a>
      </div>
    </footer>
  </div>`;
  return layout(req, {
    title: `${chapter.title} — ${work.title}`,
    body,
    chrome: false,
    bodyClass: 'reading',
    og: { url: `/w/${work.id}/${n}`, image: media(work, 'cover.webp'), noindex: work.visibility !== 'public' },
    scripts: ['/static/reader.js'],
  });
}

// --- my library ------------------------------------------------------------


function profilePage(req, { profile, works, isSelf }) {
  const likes = works.reduce((s, w) => s + w.likes, 0);
  const body = html`
  <main class="wrap section">
    <div class="profile-head">
      ${avatar(profile.username, 'avatar-xl')}
      <div>
        <h1>${profile.username}</h1>
        <p class="muted">${plural(works.length, 'public webtoon')} · ${plural(likes, 'like')} · joined ${new Date(profile.created).toLocaleDateString('en', { year: 'numeric', month: 'short' })}</p>
        ${profile.bio ? html`<p class="bio">${profile.bio}</p>` : ''}
      </div>
      ${isSelf ? html`<a class="btn btn-ghost" href="/account">${icon.edit}Edit profile</a>` : ''}
    </div>
    ${works.length ? grid(works, { showAuthor: false }) : emptyState('Nothing shared yet', isSelf ? 'Set a webtoon to Public and it shows up here.' : `${profile.username} hasn’t shared anything on the shelf yet.`)}
  </main>`;
  return layout(req, { title: profile.username, body, og: { url: `/u/${profile.username}` } });
}

// --- admin -----------------------------------------------------------------------

module.exports = { shelfPage, workPage, readerPage, profilePage };
