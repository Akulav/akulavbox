import { api, session, toLogin, icon, lockup, esc, appTile, formatBytes, accountMenu, madeBy } from './common.js';

const $ = (id) => document.getElementById(id);

/** The account's one storage space: a bar split by app, and how much each one takes */
function spaceHtml(s) {
  if (!s) return '';
  const pct = (b) => (s.quota_bytes ? Math.min(100, (b / s.quota_bytes) * 100) : 0);
  const total = Math.round(pct(s.used_bytes));
  return `<div class="space-head">
      <div><p class="section-title" style="margin:0 0 4px">Storage</p>
        <p><b class="num" style="font-size:20px">${formatBytes(s.used_bytes)}</b> <span class="muted">of ${formatBytes(s.quota_bytes)} used</span></p></div>
      <span class="chip ${total >= 90 ? 'chip-danger' : ''}">${formatBytes(s.free_bytes)} free</span>
    </div>
    <div class="space-bar" role="img" aria-label="${total}% of your storage is used">${s.apps.filter((a) => a.bytes > 0).map((a) => `<span style="width:${pct(a.bytes)}%;--c:${esc(a.color)}" title="${esc(a.name)}: ${formatBytes(a.bytes)}"></span>`).join('')}</div>
    <ul class="space-legend">${s.apps.map((a) => `<li><span class="dot" style="--c:${esc(a.color)}"></span>${esc(a.name)} <span class="muted num">${formatBytes(a.bytes)}</span></li>`).join('')}</ul>
    <p class="faint" style="font-size:12px;margin-top:10px">One space for every app on your account. Florin and Tick keep no files.</p>`;
}

async function main() {
  const s = session();
  if (!s) return toLogin('/');
  // the cookie the other apps read follows the stored token (also carries sessions from before 4.0 over)
  try { await api('/api/session', { method: 'POST' }); } catch (e) { if (e.status === 401) return; }

  let data;
  try {
    data = await api('/api/apps');
  } catch (e) {
    $('boot').innerHTML = `<div style="text-align:center"><p style="margin:0 0 12px">${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  const user = data.user;

  $('lockup').innerHTML = lockup(30);
  accountMenu($('account'), user);

  const h = new Date().getHours();
  $('greet').textContent = `${h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${user.username}`;
  $('when').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // flagged at sign-in (the default admin/admin, say); cleared when the password is changed in the profile
  let weak = false;
  try { weak = localStorage.getItem('akulavWeak') === '1'; } catch (e) { /* private mode */ }
  if (weak) {
    $('weak').hidden = false;
    $('weak').innerHTML = `${icon('key')}<span style="flex:1">Your password is easy to guess, and it opens every app. Change it to keep your data safe.</span><a class="btn btn-sm" href="/box/#/profile">Change password</a>`;
  }

  $('space').innerHTML = spaceHtml(data.space);
  $('space').hidden = !data.space;

  $('apps').innerHTML = data.apps.map((a) => {
    const usage = a.stores_files && a.used_bytes != null
      ? `<div class="row"><span class="muted">${formatBytes(a.used_bytes)} stored${a.limit_bytes ? ` · limit ${formatBytes(a.limit_bytes)}` : ''}</span></div>`
      : '';
    const off = !a.available;
    return `<a class="panel app-card ${off ? 'off' : ''}" href="${off ? '#' : esc(a.path)}" style="--c:${esc(a.color)}" ${off ? 'aria-disabled="true"' : ''} data-app="${esc(a.id)}">
      <div style="display:flex;align-items:center;gap:14px">${appTile(a, true)}<div style="min-width:0"><h2>${esc(a.name)}</h2>${a.summary ? `<p class="muted" style="font-size:12.5px">${esc(a.summary)}</p>` : ''}</div></div>
      <p class="muted" style="font-size:13.5px">${esc(a.tagline)}</p>
      <div class="foot">${off ? `<p class="alert" style="font-size:12px">${icon('alert')}<span>${esc(a.problem || 'Not running on this server.')}</span></p>` : `${usage}<span class="go">Open ${icon('arrow')}</span>`}</div>
    </a>`;
  }).join('');
  for (const el of document.querySelectorAll('[aria-disabled="true"]')) el.addEventListener('click', (e) => e.preventDefault());

  $('profile-icon').innerHTML = icon('user');
  $('connect-icon').innerHTML = icon('plug');
  $('admin-icon').innerHTML = icon('shield');
  for (const el of document.querySelectorAll('[data-go]')) el.innerHTML = icon('arrow');
  $('admin').hidden = user.role !== 'admin';
  $('footer').innerHTML = `${madeBy(data.version)}<span>${data.apps.length} app${data.apps.length === 1 ? '' : 's'} on this account</span>`;
  // files stored or removed in another open app: the storage card follows (hub/account.js, akbBus)
  let pending = null;
  window.akbBus?.on('storage', () => {
    clearTimeout(pending);
    pending = setTimeout(async () => { try { const d = await api('/api/apps'); $('space').innerHTML = spaceHtml(d.space); } catch (e) { /* next time */ } }, 400);
  });
  $('boot').hidden = true;
  $('page').hidden = false;
}

main();
