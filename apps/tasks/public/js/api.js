// Tasks is served under /tasks of the AkulavBox server; signing in happens on the server's /login page.
import { todayISO } from './dates.js';

export const BASE = '/tasks';
export const API = `${BASE}/api`;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Off to the shared sign-in page, coming back here afterwards */
export function toLogin() {
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(`${API}${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        // the CSRF defence: the server refuses changes without it
        'X-Requested-With': 'tasks',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      // the page's own date: "today" and repeats follow this person's clock
      body: body !== undefined ? JSON.stringify({ today: todayISO(), ...body }) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401) toLogin();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
