// Shared by the sign-in page, the launcher and the Admin console. No framework, no build step.
// The session is the same one AkulavBox uses: the token in localStorage (akulavToken) for the API,
// and the HttpOnly cookie (set by the server) for the other apps.

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

// ---------- theme (shared by every app: akulavTheme, applied before paint by hub/theme.js) ----------
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set('akulavTheme', next);
  document.documentElement.dataset.theme = next;
  return next;
}

// ---------- session ----------
function decode(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) { return null; }
}
/** The stored token, if it hasn't expired: { token, id, username, role } or null */
export function session() {
  const token = store.get('akulavToken');
  const p = token && decode(token);
  if (!p || (p.exp && p.exp * 1000 < Date.now())) return null;
  return { token, id: p.id, username: p.username || '', role: p.role };
}
export function saveSession(token, { weak } = {}) {
  const p = decode(token) || {};
  store.set('akulavToken', token);
  store.set('akulavRole', p.role || null);
  if (weak !== undefined) store.set('akulavWeak', weak ? '1' : null);
}
export function forgetSession() {
  for (const k of ['akulavToken', 'akulavRole', 'akulavWeak']) store.set(k, null);
}
/** A path on this server to go to after signing in, never another site */
export function safeNext(n) {
  return typeof n === 'string' && /^\/(?![/\\])/.test(n) && !/\s/.test(n) ? n : '/';
}
export function toLogin(next = location.pathname + location.search + location.hash) {
  location.replace('/login' + (next && next !== '/' ? '?next=' + encodeURIComponent(next) : ''));
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export async function api(path, { method = 'GET', body } = {}) {
  const s = session();
  const headers = {};
  if (s) headers.Authorization = `Bearer ${s.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }); }
  catch (e) { throw new ApiError('Could not reach the server. Check your connection.', 0); }
  // sliding sessions, like AkulavBox (lib/api.js)
  const fresh = res.headers.get('X-Refresh-Token');
  if (fresh && s) saveSession(fresh);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (res.status === 401 && path !== '/api/login') { forgetSession(); toLogin(); throw new ApiError('Your session expired. Sign in again.', 401); }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  return data;
}

// ---------- formatting ----------
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const n = bytes / Math.pow(k, i);
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${sizes[i]}`;
}
export function parseDbDate(s) {
  if (!s) return null;
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}
export function relative(s) {
  const d = parseDbDate(s);
  if (!d) return null;
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (sec >= n) return rtf.format(-Math.round(sec / n), u);
  return 'just now';
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hue = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
export const avatar = (name, src) => `<span class="avatar" style="--h:${hue(name)}">${src ? `<img src="${esc(src)}" alt="">` : esc(String(name || '?').slice(0, 1).toUpperCase())}</span>`;

// ---------- icons (Lucide paths, like AkulavBox's components/Icon.js) ----------
const PATHS = {
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  documents: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  budget: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  tasks: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  ironveil: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.08 14.08a3 3 0 1 1-4.16-4.16"/><path d="m2 2 20 20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  hdd: '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;

/** AkulavBox's mark (the account and the server): an ink tile with an open box in the apps' colours */
let markSeq = 0;
export function mark(size = 32) {
  const id = `m${++markSeq}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E2D33"/><stop offset="1" stop-color="#0B1215"/></linearGradient><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7C766"/><stop offset=".35" stop-color="#F03862"/><stop offset=".68" stop-color="#3B82F6"/><stop offset="1" stop-color="#1BAF7A"/></linearGradient></defs><rect width="64" height="64" rx="17" fill="url(#${id}a)"/><rect x=".75" y=".75" width="62.5" height="62.5" rx="16.25" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.5"/><g fill="none" stroke="url(#${id}b)" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round"><path d="M32 13.5 48.5 22.8 32 32 15.5 22.8Z" fill="#fff" fill-opacity=".08"/><path d="M15.5 22.8V41.4L32 50.6 48.5 41.4V22.8"/><path d="M32 32V50.6"/></g></svg>`;
}
/** Trove's mark (the files app): a brass tile with stacked layers */
export function troveMark(size = 32) {
  const id = `t${++markSeq}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7C766"/><stop offset=".55" stop-color="#E8A33D"/><stop offset="1" stop-color="#C9711F"/></linearGradient></defs><rect width="64" height="64" rx="17" fill="url(#${id}a)"/><g fill="none" stroke="#21170A" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"><path d="M32 14 50 22.5 32 31 14 22.5Z" fill="#FFF3D6" fill-opacity=".6"/><path d="M14 31.5 32 40 50 31.5"/><path d="M14 40.5 32 49 50 40.5"/></g></svg>`;
}
export const appTile = (app, lg = false) => `<span class="tile ${lg ? 'lg' : ''}" style="--c:${esc(app.color)}">${app.id === 'box' ? troveMark(lg ? 30 : 24) : icon(app.id)}</span>`;
/** The AkulavBox lockup of the top bars: the mark and the word */
export const lockup = (size = 30) => `${mark(size)}<b class="brand-text">AkulavBox</b>`;

// ---------- toasts and dialogs ----------
let toastHost = null;
export function toast(message, kind = 'ok') {
  if (!toastHost) { toastHost = document.createElement('div'); toastHost.className = 'toasts'; toastHost.setAttribute('aria-live', 'polite'); document.body.append(toastHost); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  toastHost.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3200);
}

/**
 * A small modal. fields: [{ name, label, type, value, placeholder, min, step, hint }].
 * Resolves with the field values (or true when there are none), or null when cancelled.
 */
export function dialog({ title, message = '', fields = [], confirm = 'OK', danger = false, check }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<form class="panel dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>${message ? `<p class="muted">${message}</p>` : ''}
      ${fields.map((f, i) => `<div class="field"><label class="label" for="dlg${i}">${esc(f.label)}</label>
        <input class="input" id="dlg${i}" name="${esc(f.name)}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.type === 'password' ? 'autocomplete="new-password"' : 'autocomplete="off"'}>
        ${f.hint ? `<p class="faint" style="font-size:12px;margin-top:5px">${esc(f.hint)}</p>` : ''}</div>`).join('')}
      <p class="alert" hidden style="margin-top:12px"></p>
      <div class="actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}">${esc(confirm)}</button></div>
    </form>`;
    const form = o.querySelector('form');
    const err = o.querySelector('.alert');
    const close = (v) => { o.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    o.addEventListener('mousedown', (e) => { if (e.target === o) close(null); });
    o.querySelector('[data-cancel]').onclick = () => close(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const problem = check?.(values);
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      close(fields.length ? values : true);
    };
    document.addEventListener('keydown', onKey);
    document.body.append(o);
    (o.querySelector('input') || o.querySelector('.btn-primary, .solid')).focus();
  });
}

// ---------- AI connector permissions (the /connect page and the OAuth approval page) ----------
const LEVEL_NAMES = [['', 'No access'], ['read', 'Read'], ['write', 'Read & change']];
/** One row per app with a three-way switch; apps that are off for the account can't be picked */
export function permsHtml(apps, scopes = {}) {
  return apps.map((a) => {
    const cur = a.enabled ? scopes[a.id] || '' : '';
    return `<div class="perm ${a.enabled ? '' : 'off'}" data-app="${esc(a.id)}">
      ${appTile(a)}<div class="perm-name"><b>${esc(a.name)}</b><small>${a.enabled ? esc(a.tagline || '') : 'Not on for your account'}</small></div>
      <div class="seg" role="radiogroup" aria-label="${esc(a.name)}">${LEVEL_NAMES.map(([v, label]) => `<button type="button" role="radio" data-level="${v}" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" ${a.enabled ? '' : 'disabled'}>${label}</button>`).join('')}</div>
    </div>`;
  }).join('');
}
/** Wires the switches of permsHtml; returns a function that reads the choice as scopes */
export function wirePerms(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b || b.disabled) return;
    for (const x of b.parentElement.children) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }
  });
  return () => Object.fromEntries([...root.querySelectorAll('.perm')].map((p) => [p.dataset.app, p.querySelector('.seg .on')?.dataset.level || '']).filter(([, v]) => v));
}
/** Small chips for a set of scopes */
export const scopeChips = (scopes, apps) => apps.filter((a) => scopes[a.id]).map((a) => `<span class="chip scope" style="--c:${esc(a.color)}" title="${esc(a.name)}: ${scopes[a.id] === 'write' ? 'read and change' : 'read only'}"><span class="dot"></span>${esc(a.name)}${scopes[a.id] === 'write' ? ' · change' : ''}</span>`).join('');

/** Copy text, with a toast */
export async function copyText(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what); } catch (e) { toast('Couldn’t copy: select it and copy by hand.', 'error'); }
}

/** The account menu in the top bar: the one every app shares (hub/account.js) */
export function accountMenu(root, user) {
  root.innerHTML = `<akb-account accent="#E8A33D" username="${esc(user.username)}" role="${esc(user.role)}"></akb-account>`;
}

export function madeBy(version) {
  return `<span>Made with <span class="heart" aria-label="love">&#9829;</span> by <b class="muted">Akulav</b>${version ? ` · <span class="mono">v${esc(version)}</span>` : ''}</span>`;
}
