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
    return { token: null, role: null, id: null, username: '' };
  }
  return { token, role: payload.role, id: payload.id, username: payload.username || '' };
}

export const session = reactive(initialSession());

export function setSession(token) {
  const p = decode(token) || {};
  session.token = token; session.role = p.role; session.id = p.id; session.username = p.username || '';
  write('akulavToken', token); write('akulavRole', p.role);
}

export function clearSession() {
  session.token = null; session.role = null; session.id = null; session.username = '';
  write('akulavToken', null); write('akulavRole', null);
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

// Signed-in account summary (storage meter, avatar) shared by the shell and pages
export const account = reactive({ username: '', role: '', used_bytes: 0, quota_bytes: 0, profile_image: null, loaded: false });

export async function refreshAccount() {
  if (!session.token) return;
  try {
    const p = await api('/api/user/profile');
    Object.assign(account, p, { loaded: true });
  } catch (e) { /* shell keeps last known values */ }
}
