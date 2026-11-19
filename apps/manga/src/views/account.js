'use strict';
// Koma Shelf: the account page (profile, storage, API tokens for Koma).
const { html, raw, timeAgo, plural, compact, paragraphs } = require('../html.js');
const { layout, card, grid, emptyState, icon, visBadge, csrfField, avatar, media } = require('./layout.js');

function komaSection(req, { tokens = [], siteUrl = '', newToken }) {
  return html`<section class="card-form" id="koma">
    <h2>Connect Koma</h2>
    <p class="muted">Publish straight from the Koma app: open <strong>Settings → Koma Shelf</strong> in Koma, paste this site’s address and a token, then use <strong>Publish</strong> on a finished manga’s Files tab.</p>
    <div class="kv"><span>Site address</span><code data-copy-text>${siteUrl}</code></div>
    ${newToken
      ? html`<div class="notice notice-ok token-new" role="status">
          <strong>Token “${newToken.name}” created.</strong> Copy it now — it won’t be shown again.
          <div class="token-box"><code>${newToken.token}</code><button class="btn btn-ghost btn-sm" type="button" data-copy-value="${newToken.token}">${icon.link}<span>Copy</span></button></div>
        </div>`
      : ''}
    <form class="token-form" method="post" action="/account/tokens">
      ${csrfField(req)}
      <input name="name" maxlength="60" placeholder="Token name, e.g. My PC" aria-label="Token name">
      <button class="btn btn-primary" type="submit">Create token</button>
    </form>
    ${tokens.length
      ? html`<ul class="token-list">
          ${tokens.map(
            (t) => html`<li>
              <div><strong>${t.name}</strong> <code>${t.prefix}…</code><br><small class="muted">created ${timeAgo(t.created)} · ${t.last_used ? `last used ${timeAgo(t.last_used)}` : 'never used'}</small></div>
              <form method="post" action="/account/tokens/${t.id}/delete" data-confirm="Revoke “${t.name}”? Koma installs using it will stop uploading.">${csrfField(req)}<button class="btn btn-danger btn-sm" type="submit">Revoke</button></form>
            </li>`,
          )}
        </ul>`
      : html`<p class="hint">No tokens yet.</p>`}
  </section>`;
}

const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.max(0, Math.round(b / 1024 ** 2))} MB`);

function accountPage(req, { error, ok, tokens, siteUrl, newToken, usage = { used: 0, quota: 0 } }) {
  const u = req.user;
  const body = html`
  <main class="wrap narrow section">
    <p class="eyebrow">Account</p>
    <h1>${u.username}</h1>
    <p class="muted">Member since ${new Date(u.created).toLocaleDateString('en', { year: 'numeric', month: 'long' })}${u.role === 'admin' ? ' · admin' : ''}</p>
    ${error ? html`<div class="notice notice-error" role="alert">${error}</div>` : ''}
    ${ok ? html`<div class="notice notice-ok" role="status">${ok}</div>` : ''}
    <form class="form card-form" method="post" action="/account/profile">
      ${csrfField(req)}
      <h2>Profile</h2>
      <label class="field"><span>About you <small class="muted">— shown on your public profile</small></span><textarea name="bio" rows="3" maxlength="500">${u.bio}</textarea></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save</button></div>
    </form>
    <section class="card-form">
      <h2>Sign-in and storage</h2>
      <p class="muted">You use the same account for every app on this server. Change your password or sign out other devices in your account profile.</p>
      ${usage.quota ? html`<p>${size(usage.used)} of ${size(usage.quota)} used by your webtoons.</p><div class="progress" role="progressbar" aria-valuenow="${Math.round((usage.used / usage.quota) * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100, Math.round((usage.used / usage.quota) * 100))}%"></span></div>` : ''}
      <div class="form-actions"><a class="btn btn-ghost" href="~/box/#/profile">Open my profile</a></div>
    </section>
    ${komaSection(req, { tokens, siteUrl, newToken })}
  </main>`;
  return layout(req, { title: 'Account', body, og: { noindex: true } });
}

module.exports = { accountPage };
