import { api, session, toLogin, icon, lockup, esc, appTile, formatBytes, relative, avatar, accountMenu, madeBy, toast, dialog } from './common.js';

// The Admin console: every account, its storage (one space for every app) and which apps it can use.
// Accounts, passwords, roles and storage use the /api/admin/users routes; per-app access and
// defaults use /api/admin/users/:id/apps/:app and /api/admin/apps/defaults (src/modules/console.js).

const $ = (id) => document.getElementById(id);
const GB = 1024 ** 3;
const gb = (b) => Number((b / GB).toFixed(2));
let state = null;
let me = null;
let query = '';

const pct = (used, quota) => (quota ? Math.min(100, Math.round(((used || 0) / quota) * 100)) : 0);

function statsHtml(d) {
  const by = Object.fromEntries(d.apps.map((a) => [a.id, a]));
  const disk = d.disk;
  const tiles = [
    [icon('users'), 'Accounts', d.users.length, `${d.users.filter((u) => u.role === 'admin').length} admin`],
    [icon('hdd'), 'Free disk', disk ? formatBytes(disk.free) : '—', disk ? `of ${formatBytes(disk.total)}` : d.storage_dir],
    ...['box', 'documents', 'ironveil'].filter((id) => by[id]).map((id) => {
      const a = by[id];
      const t = a.totals;
      return [`<span class="dot" style="width:8px;height:8px;border-radius:50%;background:${a.color}"></span>`, a.name,
        a.status === 'running' ? formatBytes(t?.bytes || 0) : '—',
        a.status !== 'running' ? (a.problem || 'not running') : `${(t?.items ?? 0).toLocaleString()} ${t?.label || 'items'}`];
    }),
  ];
  return tiles.map(([ic, k, v, s]) => `<div class="panel stat"><p class="k">${ic}${esc(k)}</p><p class="v num">${esc(v)}</p><p class="s">${esc(s)}</p></div>`).join('');
}

/** The account's one storage space: a bar split by app, and the button that sets its size */
function spaceCell(u, apps) {
  const s = u.space || { quota_bytes: u.quota_bytes, used_bytes: u.used_bytes, by_app: { box: u.used_bytes } };
  const p = pct(s.used_bytes, s.quota_bytes);
  return `<div class="ua ua-space">
    <div class="ua-head"><span class="n">Storage</span><span class="chip ${p >= 90 ? 'chip-danger' : ''}">${p}%</span></div>
    <div class="space-bar">${apps.filter((a) => a.quota && s.by_app[a.id] > 0).map((a) => `<span style="width:${pct(s.by_app[a.id], s.quota_bytes)}%;--c:${a.color}" title="${esc(a.name)}: ${formatBytes(s.by_app[a.id])}"></span>`).join('')}</div>
    <div class="ua-line"><span class="num">${formatBytes(s.used_bytes)} of ${formatBytes(s.quota_bytes)}</span><button data-act="box-quota" data-id="${esc(u.id)}">Change</button></div>
  </div>`;
}

function appCell(u, a) {
  if (a.core) {
    return `<div class="ua" style="--c:${a.color}">
      <div class="ua-head"><span class="dot"></span><span class="n">${esc(a.name)}</span><span class="chip">Always on</span></div>
      <div class="ua-line"><span>${(u.file_count || 0).toLocaleString()} files · ${formatBytes(u.used_bytes)}</span></div>
    </div>`;
  }
  const x = u.apps[a.id];
  return `<div class="ua ${x.enabled ? '' : 'off'}" style="--c:${a.color}">
    <div class="ua-head"><span class="dot"></span><span class="n">${esc(a.name)}</span>
      <label class="switch" title="${x.enabled ? 'Turn off' : 'Turn on'} ${esc(a.name)} for ${esc(u.username)}"><input type="checkbox" data-act="toggle" data-id="${esc(u.id)}" data-app="${a.id}" ${x.enabled ? 'checked' : ''} ${a.status === 'running' ? '' : 'disabled'} aria-label="${esc(a.name)} for ${esc(u.username)}"><span></span></label></div>
    ${a.quota
      ? `<div class="ua-line"><span class="num">${formatBytes(x.used_bytes || 0)}${x.quota_bytes ? ` · limit ${formatBytes(x.quota_bytes)}${x.custom_quota ? '' : ' <span class="faint">(default)</span>'}` : ''}</span><button data-act="app-quota" data-id="${esc(u.id)}" data-app="${a.id}">${x.quota_bytes ? 'Limit' : 'Add limit'}</button></div>`
      : ''}
    <div class="ua-line"><span>${esc(x.summary || (a.quota ? 'Nothing stored yet' : 'Keeps no files'))}</span></div>
  </div>`;
}

function usersHtml(d) {
  const list = d.users.filter((u) => !query || u.username.toLowerCase().includes(query));
  if (!list.length) return `<p class="empty">No account matches “${esc(query)}”.</p>`;
  return list.map((u) => {
    const self = u.id === me.id;
    const seen = relative(u.last_login_at);
    return `<div class="user-row">
      <div class="who">${avatar(u.username, u.profile_image)}<div style="min-width:0">
        <p class="name">${esc(u.username)}${u.role === 'admin' ? '<span class="chip chip-accent">Admin</span>' : ''}${self ? '<span class="chip">You</span>' : ''}</p>
        <small>${seen ? `Signed in ${esc(seen)}` : 'Never signed in'}${u.created_at ? ` · since ${esc(new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short' }))}` : ''}</small>
      </div></div>
      <div class="user-apps">${spaceCell(u, d.apps)}${d.apps.map((a) => appCell(u, a)).join('')}</div>
      <div class="row-actions">
        <button class="icon-btn" data-act="password" data-id="${esc(u.id)}" title="Set a new password" aria-label="Set a new password for ${esc(u.username)}">${icon('key')}</button>
        <button class="icon-btn" data-act="role" data-id="${esc(u.id)}" ${self ? 'disabled' : ''} title="${u.role === 'admin' ? 'Remove admin rights' : 'Make admin'}" aria-label="${u.role === 'admin' ? 'Remove admin rights from' : 'Make admin:'} ${esc(u.username)}" style="${u.role === 'admin' ? 'color:rgb(var(--accent))' : ''}">${icon('shield')}</button>
        <button class="icon-btn" data-act="signout" data-id="${esc(u.id)}" title="Sign out on every device" aria-label="Sign ${esc(u.username)} out on every device">${icon('logout')}</button>
        <button class="icon-btn danger" data-act="delete" data-id="${esc(u.id)}" ${self ? 'disabled' : ''} title="Delete account" aria-label="Delete ${esc(u.username)}">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

function appsHtml(d) {
  return d.apps.map((a) => {
    const def = d.defaults[a.id];
    const t = a.totals || {};
    const status = a.status === 'running' ? '<span class="chip chip-ok">Running</span>' : `<span class="chip chip-danger">${a.status === 'failed' ? 'Not running' : 'Off'}</span>`;
    const using = a.core ? d.users.length : d.users.filter((u) => u.apps[a.id]?.enabled).length;
    return `<div class="panel app-panel" style="--c:${a.color}">
      <div class="top">${appTile(a, true)}<div style="flex:1;min-width:0"><h3>${esc(a.name)}</h3><p class="muted" style="font-size:12.5px">${esc(a.tagline)}</p></div>${status}</div>
      ${a.problem ? `<p class="alert">${icon('alert')}<span>${esc(a.problem)}</span></p>` : ''}
      <dl>
        <dt>Address</dt><dd><a href="${esc(a.path)}">${esc(a.path)}</a></dd>
        <dt>Data folder</dt><dd class="mono" style="font-size:12px">${esc(a.folder)}</dd>
        <dt>Stored</dt><dd>${a.id === 'budget' ? `${(t.items || 0).toLocaleString()} transactions · ${formatBytes(t.bytes || 0)} database` : `${formatBytes(t.bytes || 0)} · ${(t.items || 0).toLocaleString()} ${esc(t.label || 'items')}`}</dd>
        <dt>Accounts</dt><dd>${using} of ${d.users.length} can use it</dd>
      </dl>
      ${a.core
        ? `<p class="faint" style="font-size:12px">Every account has ${esc(a.name)}. Storage is one space per account, shared by every app: set its size in the Accounts tab.</p>`
        : `<form class="defaults" data-defaults="${a.id}">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px"><span class="switch"><input type="checkbox" name="enabled" ${def.enabled ? 'checked' : ''}><span></span></span>On for new accounts</label>
            ${a.quota ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px" title="A limit of its own inside each account's storage. Leave it empty for none.">Limit <input class="input" name="quota" type="number" min="0.1" step="0.1" value="${def.quota_bytes ? gb(def.quota_bytes) : ''}" placeholder="none" aria-label="Default limit in GB, empty for none"> GB</label>` : ''}
            <button class="btn btn-sm">Save</button>
          </form>`}
    </div>`;
  }).join('');
}

function render() {
  const d = state;
  $('summary').textContent = `${d.users.length} account${d.users.length === 1 ? '' : 's'} · ${d.apps.filter((a) => a.status === 'running').length} of ${d.apps.length} apps running · AkulavBox v${d.version}`;
  $('stats').innerHTML = statsHtml(d);
  $('users').innerHTML = usersHtml(d);
  $('app-panels').innerHTML = appsHtml(d);
}

async function load() {
  state = await api('/api/admin/console');
  render();
}

const userOf = (id) => state.users.find((u) => u.id === id);
const appOf = (id) => state.apps.find((a) => a.id === id);

async function act(fn, ok) {
  try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, 'error'); }
  await load().catch(() => {});
}

async function onAction(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const u = userOf(el.dataset.id);
  if (!u) return;
  const kind = el.dataset.act;
  if (kind === 'toggle') {
    const a = appOf(el.dataset.app);
    return act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}/apps/${a.id}`, { method: 'PATCH', body: { enabled: el.checked } }), `${a.name} ${el.checked ? 'turned on' : 'turned off'} for ${u.username}`);
  }
  if (kind === 'box-quota') {
    const used = u.space?.used_bytes ?? u.used_bytes;
    const v = await dialog({ title: `Storage for ${u.username}`, message: `One space for every app on the account. Using ${formatBytes(used)} now.`, fields: [{ name: 'gb', label: 'Size (GB)', type: 'number', min: 0.1, step: 0.1, value: gb(u.quota_bytes) }], confirm: 'Save',
      check: (x) => (Number(x.gb) > 0 ? null : 'Enter a size larger than 0.') });
    if (v) act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}/quota`, { method: 'PATCH', body: { quota: Math.round(Number(v.gb) * GB) } }), 'Storage saved');
    return;
  }
  if (kind === 'app-quota') {
    const a = appOf(el.dataset.app);
    const x = u.apps[a.id];
    const def = state.defaults[a.id].quota_bytes;
    const v = await dialog({ title: `${a.name} limit for ${u.username}`, message: `${a.name} uses ${formatBytes(x.used_bytes || 0)} of the account’s storage. A limit keeps it from taking more than that, even with space left. Leave it empty for ${def ? `the default (${formatBytes(def)})` : 'no limit'}.`,
      fields: [{ name: 'gb', label: 'Limit (GB)', type: 'number', min: 0.1, step: 0.1, value: x.custom_quota ? gb(x.quota_bytes) : '', placeholder: def ? String(gb(def)) : 'none' }], confirm: 'Save',
      check: (x2) => (x2.gb === '' || Number(x2.gb) > 0 ? null : 'Enter a size larger than 0, or leave it empty.') });
    if (v) act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}/apps/${a.id}`, { method: 'PATCH', body: { quota_bytes: v.gb === '' ? null : Math.round(Number(v.gb) * GB) } }), 'Limit saved');
    return;
  }
  if (kind === 'password') {
    const v = await dialog({ title: `New password for ${u.username}`, message: 'They are signed out of every app on every device.', fields: [{ name: 'pw', label: 'New password', type: 'password', hint: 'At least 8 characters. Share it with them securely.' }], confirm: 'Set password',
      check: (x) => (x.pw.length >= 8 ? null : 'Use at least 8 characters.') });
    if (v) act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}/password`, { method: 'PATCH', body: { newPassword: v.pw } }), `Password changed for ${u.username}`);
    return;
  }
  if (kind === 'role') {
    const make = u.role !== 'admin';
    const okd = await dialog({ title: make ? `Make ${u.username} an admin?` : `Remove ${u.username}’s admin rights?`, message: make ? 'Admins manage every account, read the activity log, and restore backups.' : 'They keep their data and their apps.', confirm: make ? 'Make admin' : 'Remove rights' });
    if (okd) act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}/role`, { method: 'PATCH', body: { role: make ? 'admin' : 'user' } }), make ? `${u.username} is now an admin` : `${u.username} is no longer an admin`);
    return;
  }
  if (kind === 'signout') {
    const okd = await dialog({ title: `Sign ${u.username} out everywhere?`, message: 'Every browser and device has to sign in again, in every app.', confirm: 'Sign out' });
    if (okd) act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}/signout`, { method: 'POST' }), `${u.username} was signed out`);
    return;
  }
  if (kind === 'delete') {
    const parts = [`${(u.file_count || 0).toLocaleString()} files in ${appOf('box').name}`, ...state.apps.filter((a) => !a.core && u.apps[a.id]?.summary).map((a) => `${u.apps[a.id].summary} in ${a.name}`)];
    const v = await dialog({ title: `Delete ${u.username}?`, danger: true, confirm: 'Delete for good',
      message: `This removes the account and everything it stored in every app: ${esc(parts.join(', '))}. It can’t be undone.`,
      fields: [{ name: 'name', label: `Type ${u.username} to confirm` }],
      check: (x) => (x.name.trim() === u.username ? null : 'The name doesn’t match.') });
    if (v) act(() => api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' }), `${u.username} was deleted`);
  }
}

async function main() {
  const s = session();
  if (!s) return toLogin('/admin');
  if (s.role !== 'admin') { location.replace('/'); return; }
  me = s;
  try { await load(); } catch (e) {
    if (e.status === 403) { location.replace('/'); return; }
    $('boot').textContent = e.message;
    return;
  }
  $('lockup').innerHTML = lockup(30);
  $('console-chip').innerHTML = `${icon('shield')}Admin`;
  accountMenu($('account'), s);
  $('create-title').innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center">${icon('user-plus')}Create an account</span>`;
  $('create-btn').innerHTML = `${icon('user-plus')}Create`;
  $('refresh').innerHTML = `${icon('rotate')}Refresh`;
  $('server-icon').innerHTML = icon('settings');
  $('footer').innerHTML = madeBy(state.version);

  for (const t of document.querySelectorAll('[data-tab]')) {
    t.onclick = () => {
      for (const x of document.querySelectorAll('[data-tab]')) x.setAttribute('aria-selected', String(x === t));
      for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== t.dataset.tab;
    };
  }
  $('refresh').onclick = () => act(load, 'Refreshed');
  $('search').oninput = (e) => { query = e.target.value.trim().toLowerCase(); $('users').innerHTML = usersHtml(state); };
  $('users').addEventListener('click', (e) => { if (!e.target.closest('input[data-act]')) onAction(e); });
  $('users').addEventListener('change', (e) => { if (e.target.matches('input[data-act="toggle"]')) onAction(e); });

  $('create').onsubmit = async (e) => {
    e.preventDefault();
    const username = $('nu').value.trim();
    const password = $('np').value;
    if (!username) return toast('Enter a username.', 'error');
    if (password.length < 8) return toast('Passwords need at least 8 characters.', 'error');
    $('create-btn').disabled = true;
    await act(async () => {
      await api('/api/admin/users', { method: 'POST', body: { username, password, role: $('nr').value, quota: Math.round(Number($('nq').value || 5) * GB) } });
      $('nu').value = ''; $('np').value = '';
    }, `${username} can sign in now`);
    $('create-btn').disabled = false;
  };

  $('app-panels').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-defaults]');
    if (!f) return;
    e.preventDefault();
    const id = f.dataset.defaults;
    const body = { [id]: { enabled: f.elements.enabled.checked } };
    if (f.elements.quota) {
      const raw = f.elements.quota.value.trim();
      if (raw === '') body[id].quota_bytes = null;
      else {
        const q = Number(raw);
        if (!(q > 0)) return toast('Enter a limit larger than 0, or leave it empty for none.', 'error');
        body[id].quota_bytes = Math.round(q * GB);
      }
    }
    act(() => api('/api/admin/apps/defaults', { method: 'PUT', body }), `Defaults saved for ${appOf(id).name}`);
  });

  $('icon-icon').innerHTML = icon('shield');
  const iconCheck = async (askBitwarden) => {
    const out = $('icon-result');
    out.hidden = false;
    out.innerHTML = `<li class="muted">${icon('loader', 'spin')}Checking…</li>`;
    try {
      const r = await api(`/api/admin/site-icon${askBitwarden ? '?bitwarden=1' : ''}`);
      const bw = r.bitwarden;
      out.innerHTML = [
        `<li class="muted">Address: <span class="mono">${esc(r.address)}</span>${r.public_url_set ? '' : ' (from this page; set PUBLIC_URL in .env to the public address)'}</li>`,
        ...r.steps.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}">${icon(s.ok ? 'check' : 'alert')}<span>${esc(s.text)}</span></li>`),
        bw ? `<li class="${bw.status === 200 ? 'ok' : 'bad'}">${icon(bw.status === 200 ? 'check' : 'alert')}<span>${bw.error ? `Bitwarden’s icon service couldn’t be reached: ${esc(bw.error)}` : bw.status === 200 ? `Bitwarden’s icon service has an icon for this site (${bw.bytes.toLocaleString()} bytes). If your app still shows none, it is its own cache (up to 7 days): remove and re-add the site, or reinstall the extension.` : `Bitwarden’s icon service answers ${bw.status}: no icon yet. It keeps a miss for up to 24 hours (and apps keep it up to 7 days), so a fix shows after that.`}</span></li>` : '',
        `<li class="muted">${r.ok ? 'This server serves an icon Bitwarden can use.' : 'Fix the first failing step above.'} Bitwarden remembers a miss for 24 hours on its servers and up to 7 days in its apps.</li>`,
      ].join('');
    } catch (e) { out.innerHTML = `<li class="bad">${icon('alert')}<span>${esc(e.message)}</span></li>`; }
  };
  $('icon-check').onclick = () => iconCheck(false);
  $('icon-bw').onclick = () => iconCheck(true);

  $('boot').hidden = true;
  $('page').hidden = false;
}

main();
