// Shared by the sign-in page, the launcher and the Admin console. No framework, no build step.
// The session is the same one AkulavBox uses: the token in localStorage (akulavToken) for the API,
// and the HttpOnly cookie (set by the server) for the other apps.

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

// ---------- theme (shared with AkulavBox: akulavTheme) ----------
export function applyTheme() {
  let t = store.get('akulavTheme');
  if (!t || t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  return t;
}
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
export async function signOut() {
  forgetSession();
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  location.assign('/login');
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
  manga: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  budget: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
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
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;

/** AkulavBox's mark (a brass tile with an open box) */
let markSeq = 0;
export function mark(size = 32) {
  const id = `m${++markSeq}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7C766"/><stop offset=".55" stop-color="#E8A33D"/><stop offset="1" stop-color="#C9711F"/></linearGradient><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="64" height="64" rx="17" fill="url(#${id}a)"/><rect x="2" y="2" width="60" height="30" rx="15" fill="url(#${id}b)" opacity=".55"/><g fill="none" stroke="#21170A" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"><path d="M32 13.5 48.5 22.8 32 32 15.5 22.8Z" fill="#FFF3D6" fill-opacity=".55"/><path d="M15.5 22.8V41.4L32 50.6 48.5 41.4V22.8"/><path d="M32 32V50.6"/></g></svg>`;
}
export const appTile = (app, lg = false) => `<span class="tile ${lg ? 'lg' : ''}" style="--c:${esc(app.color)}">${app.id === 'box' ? mark(lg ? 30 : 24) : icon(app.id)}</span>`;

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

/** The account menu in the top bar of the launcher and the console */
export function accountMenu(root, user, { admin } = {}) {
  root.innerHTML = `
    <button class="icon-btn" data-theme-btn title="Switch theme" aria-label="Switch theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button>
    <div class="menu-wrap">
      <button class="icon-btn" style="width:auto;height:auto;padding:2px;border-radius:50%" data-menu-btn aria-haspopup="menu" aria-expanded="false" title="${esc(user.username)}">${avatar(user.username, user.profile_image)}</button>
      <div class="menu" role="menu" hidden>
        <div class="menu-head"><b>${esc(user.username)}</b><br><span class="muted" style="font-size:12px;text-transform:capitalize">${esc(user.role)}</span></div>
        <a href="/" role="menuitem">${icon('grid')}All apps</a>
        <a href="/box/#/profile" role="menuitem">${icon('user')}Profile &amp; password</a>
        ${admin ? `<a href="/admin" role="menuitem">${icon('shield')}Admin console</a>` : ''}
        <button type="button" role="menuitem" data-signout>${icon('logout')}Sign out</button>
      </div>
    </div>`;
  const btn = root.querySelector('[data-menu-btn]');
  const menu = root.querySelector('.menu');
  const set = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick = (e) => { e.stopPropagation(); set(menu.hidden); };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  root.querySelector('[data-signout]').onclick = () => signOut();
  root.querySelector('[data-theme-btn]').onclick = (e) => {
    const t = toggleTheme();
    e.currentTarget.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  };
}

export function madeBy(version) {
  return `<span>Made with <span class="heart" aria-label="love">&#9829;</span> by <b class="muted">Akulav</b>${version ? ` · <span class="mono">v${esc(version)}</span>` : ''}</span>`;
}
