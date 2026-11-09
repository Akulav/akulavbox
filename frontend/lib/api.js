import { reactive } from 'vue';

const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

function decode(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) { return null; }
}

function initialSession() {
  const token = read('akulavToken');
  const payload = token ? decode(token) : null;
  // Drop expired tokens up front instead of letting every request fail
  if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
    write('akulavToken', null); write('akulavRole', null);
    return { token: null, role: null, id: null, username: '', weakPassword: false };
  }
  return { token, role: payload.role, id: payload.id, username: payload.username || '', weakPassword: read('akulavWeak') === '1' };
}

export const session = reactive(initialSession());

/** Store a token. `weak` is set at sign-in when the password is easy to guess. */
export function setSession(token, { weak } = {}) {
  const p = decode(token) || {};
  session.token = token; session.role = p.role; session.id = p.id; session.username = p.username || '';
  write('akulavToken', token); write('akulavRole', p.role);
  if (weak !== undefined) { session.weakPassword = !!weak; write('akulavWeak', weak ? '1' : null); }
}

export function clearSession() {
  session.token = null; session.role = null; session.id = null; session.username = ''; session.weakPassword = false;
  write('akulavToken', null); write('akulavRole', null); write('akulavWeak', null);
}

// Server/app info (version, author) from the public health endpoint
export const app = reactive({ version: '', author: 'Akulav', name: 'AkulavBox', loadedVersion: '', updateAvailable: false });
export async function checkVersion() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const h = await res.json();
    if (!app.loadedVersion) app.loadedVersion = h.version;
    Object.assign(app, { version: h.version, author: h.author || app.author, name: h.name || app.name });
    // the server was updated while this tab stayed open
    app.updateAvailable = !!app.loadedVersion && h.version !== app.loadedVersion;
  } catch (e) { /* offline: keep what we know */ }
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** fetch wrapper: JSON in/out, auth header, readable errors, auto-logout on 401 */
export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (session.token) opts.headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) {
    if (body instanceof FormData) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  let res;
  try { res = await fetch(path, opts); }
  catch (e) { throw new ApiError('Could not reach the server. Check your connection.', 0); }

  if (res.status === 401 && path !== '/api/login') {
    clearSession();
    throw new ApiError('Your session expired. Sign in again.', 401);
  }
  // Sliding sessions: the server hands out a fresh token once a day
  const fresh = res.headers.get('X-Refresh-Token');
  if (fresh && session.token) setSession(fresh);
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) throw new ApiError((data && data.error) || (typeof data === 'string' && data) || `Request failed (${res.status})`, res.status);
  return data;
}

export const fileUrl = (id, { download = false } = {}) =>
  `/api/files/${id}/view?token=${encodeURIComponent(session.token || '')}${download ? '&download=1' : ''}`;

export const sharedUrl = (hash) => `${location.origin}/shared/${hash}`;

export function downloadUrl(url) {
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

/** Download files and folders as one zip (a form POST, so the browser streams it to disk) */
export function downloadZip({ files = [], folders = [], name = 'AkulavBox download' }) {
  const form = document.createElement('form');
  form.method = 'POST'; form.action = '/api/zip'; form.style.display = 'none';
  for (const [k, v] of Object.entries({ token: session.token || '', files: files.join(','), folders: folders.join(','), name })) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = k; input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form); form.submit(); form.remove();
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const n = bytes / Math.pow(k, i);
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${sizes[i]}`;
}

/** SQLite datetime('now') is UTC without a zone marker */
export function parseDbDate(s) {
  if (!s) return null;
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}

export function formatDate(s) {
  const d = parseDbDate(s);
  if (!d) return '—';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }
}

export const storage = { read, write };

/** A random id. crypto.randomUUID only exists on https and localhost; a server opened by its LAN address is neither */
export function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

// Signed-in account summary (storage meter, avatar) shared by the shell and pages
export const account = reactive({ username: '', role: '', used_bytes: 0, quota_bytes: 0, trash_bytes: 0, profile_image: null, show_xxx: false, loaded: false });

export function formatRelative(s) {
  const d = parseDbDate(s);
  if (!d) return '—';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [u, n] of units) if (Math.abs(sec) >= n) return rtf.format(-Math.round(sec / n), u);
  return 'just now';
}

export async function refreshAccount() {
  if (!session.token) return;
  try {
    const p = await api('/api/user/profile');
    Object.assign(account, p, { loaded: true });
  } catch (e) { /* shell keeps last known values */ }
}
