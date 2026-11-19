'use strict';
// Koma Shelf: moderation for admins, and error pages.
const { html, raw, timeAgo, plural, compact, paragraphs } = require('../html.js');
const { layout, card, grid, emptyState, icon, visBadge, csrfField, avatar, media } = require('./layout.js');

const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.max(0, Math.round(b / 1024 ** 2))} MB`);

function adminPage(req, { works, users, stats, q }) {
  const body = html`
  <main class="wrap section">
    <div class="page-head">
      <div><p class="eyebrow">${icon.shield}Admin</p><h1>Moderation</h1>
      <p class="muted">Public and unlisted webtoons. Private works stay private, even from admins.</p></div>
    </div>
    <ul class="stat-tiles">
      <li><strong>${compact(stats.users)}</strong><span>accounts</span></li>
      <li><strong>${compact(stats.public)}</strong><span>on the shelf</span></li>
      <li><strong>${compact(stats.unlisted)}</strong><span>unlisted</span></li>
      <li><strong>${compact(stats.private)}</strong><span>private</span></li>
      <li><strong>${stats.disk[0]}</strong><span>${stats.disk[1]} stored</span></li>
    </ul>
    <form class="search search-wide" method="get" action="/admin">${icon.search}<input type="search" name="q" value="${q}" placeholder="Filter by title or creator" aria-label="Filter"></form>
    ${works.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Webtoon</th><th>Creator</th><th>Visibility</th><th>Shared</th><th class="num">Reads</th><th class="num">Likes</th><th></th></tr></thead>
          <tbody>
            ${works.map(
              (w) => html`<tr>
                <td><a class="table-work" href="/w/${w.id}">${w.status === 'ready' ? html`<img src="${media(w, 'cover-s.webp')}" width="36" height="48" alt="" loading="lazy">` : html`<span class="thumb-empty"></span>`}<span>${w.title}</span></a></td>
                <td><a href="/u/${w.username}">${w.username}</a></td>
                <td>${visBadge(w.visibility)}</td>
                <td class="muted">${timeAgo(w.published || w.created)}</td>
                <td class="num">${compact(w.views)}</td>
                <td class="num">${compact(w.likes)}</td>
                <td><div class="actions">
                  ${w.visibility === 'public' ? html`<form method="post" action="/admin/works/${w.id}/unpublish">${csrfField(req)}<button class="btn btn-ghost btn-sm" type="submit" title="Take it off the shelf (becomes private)">Unpublish</button></form>` : ''}
                  <form method="post" action="/admin/works/${w.id}/delete" data-confirm="Delete “${w.title}” by ${w.username}? This cannot be undone.">${csrfField(req)}<button class="btn btn-danger btn-sm" type="submit">${icon.trash}Delete</button></form>
                </div></td>
              </tr>`,
            )}
          </tbody></table></div>`
      : emptyState('Nothing to moderate', q ? 'No shared webtoons match that filter.' : 'No one has shared anything yet.')}
    <h2 class="section-title" id="users">Newest creators</h2>
    <p class="muted">Accounts, roles and storage limits are managed in the <a href="~/admin">Admin console</a>.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>User</th><th>Role</th><th>First visit</th><th class="num">Works</th><th class="num">Stored</th></tr></thead>
      <tbody>${users.map(
        (u) => html`<tr>
          <td><a class="table-work" href="/u/${u.username}">${avatar(u.username, 'avatar-sm')}<span>${u.username}</span></a></td>
          <td>${u.role === 'admin' ? html`<span class="badge badge-public">${icon.shield}admin</span>` : 'user'}</td>
          <td class="muted">${timeAgo(u.created)}</td>
          <td class="num">${u.works}</td>
          <td class="num">${size(u.bytes)}</td>
        </tr>`,
      )}</tbody>
    </table></div>
  </main>`;
  return layout(req, { title: 'Admin', body, active: 'admin', og: { noindex: true } });
}

// --- errors -------------------------------------------------------------------

function errorPage(req, status, message) {
  const titles = { 400: 'That didn’t work', 403: 'Not allowed', 404: 'Page not found', 413: 'That upload is too big', 429: 'Slow down a little', 500: 'Something broke' };
  const body = html`<main class="wrap section">${emptyState(titles[status] || 'Error', message || (status === 404 ? 'This page doesn’t exist — or it’s private.' : 'Please try again.'), html`<a class="btn btn-primary" href="/">Back to the shelf</a>`)}</main>`;
  return layout(req, { title: titles[status] || 'Error', body, og: { noindex: true } });
}

module.exports = { adminPage, errorPage };
