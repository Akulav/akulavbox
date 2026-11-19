import { api, session, toLogin, icon, mark, esc, appTile, formatBytes, accountMenu, madeBy } from './common.js';

const $ = (id) => document.getElementById(id);

async function main() {
  const s = session();
  if (!s) return toLogin('/');
  // the cookie the other apps read follows the stored token (also carries sessions from before 4.0 over)
  try { await api('/api/session', { method: 'POST' }); } catch (e) { if (e.status === 401) return; }

  let data;
  let profile = {};
  try {
    [data, profile] = await Promise.all([api('/api/apps'), api('/api/user/profile').catch(() => ({}))]);
  } catch (e) {
    $('boot').textContent = e.message;
    return;
  }
  const user = { ...data.user, profile_image: profile.profile_image };

  $('lockup').innerHTML = `${mark(30)}<b class="brand-text">AkulavBox</b>`;
  accountMenu($('account'), user, { admin: user.role === 'admin' });

  const h = new Date().getHours();
  $('greet').textContent = `${h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${user.username}`;
  $('when').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // flagged at sign-in (the default admin/admin, say); cleared when the password is changed in AkulavBox
  let weak = false;
  try { weak = localStorage.getItem('akulavWeak') === '1'; } catch (e) { /* private mode */ }
  if (weak) {
    $('weak').hidden = false;
    $('weak').innerHTML = `${icon('key')}<span style="flex:1">Your password is easy to guess, and it opens every app. Change it to keep your data safe.</span><a class="btn btn-sm" href="/box/#/profile">Change password</a>`;
  }

  $('apps').innerHTML = data.apps.map((a) => {
    const pct = a.quota_bytes && a.used_bytes != null ? Math.min(100, Math.round((a.used_bytes / a.quota_bytes) * 100)) : null;
    const usage = pct != null
      ? `<div class="row"><span class="muted">${formatBytes(a.used_bytes)} of ${formatBytes(a.quota_bytes)}</span><span class="num muted">${pct}%</span></div>
         <div class="meter ${pct >= 90 ? 'warn' : ''}" style="--c:${esc(a.color)}"><span style="width:${pct}%"></span></div>`
      : '';
    const off = !a.available;
    return `<a class="panel app-card ${off ? 'off' : ''}" href="${off ? '#' : esc(a.path)}" style="--c:${esc(a.color)}" ${off ? 'aria-disabled="true"' : ''} data-app="${esc(a.id)}">
      <div style="display:flex;align-items:center;gap:14px">${appTile(a, true)}<div style="min-width:0"><h2>${esc(a.name)}</h2>${a.summary ? `<p class="muted" style="font-size:12.5px">${esc(a.summary)}</p>` : ''}</div></div>
      <p class="muted" style="font-size:13.5px">${esc(a.tagline)}</p>
      <div class="foot">${off ? `<p class="alert" style="font-size:12px">${icon('alert')}<span>${esc(a.problem || 'Not running on this server.')}</span></p>` : `${usage}<span class="go">Open ${icon('arrow')}</span>`}</div>
    </a>`;
  }).join('');
  for (const el of document.querySelectorAll('[aria-disabled="true"]')) el.addEventListener('click', (e) => e.preventDefault());

  if (user.role === 'admin') {
    $('admin').hidden = false;
    $('admin-icon').innerHTML = icon('shield');
    $('admin-go').innerHTML = icon('arrow');
  }
  $('footer').innerHTML = `${madeBy(data.version)}<span>${data.apps.length} app${data.apps.length === 1 ? '' : 's'} on this account</span>`;
  $('boot').hidden = true;
  $('page').hidden = false;
}

main();
