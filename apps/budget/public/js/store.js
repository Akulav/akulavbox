// Shared state of the page: who is signed in, the theme, toasts, and the reference data
// (categories, currencies) every page uses. `store.version` goes up after any change, and
// pages that load data watch it to reload.
import { reactive, computed, watch } from 'vue';
import { api, toLogin } from './api.js';

export const store = reactive({
  user: undefined, // undefined = loading, null = no access
  error: null, // e.g. Florin is turned off for this account
  config: { version: '' },
  version: 0,
  categories: [],
  currencies: [],
  txModal: null, // null | { transaction, defaults }
  toasts: [],
  themePref: readPref(),
  systemDark: matchMedia('(prefers-color-scheme: dark)').matches,
});

/* ───────────── Account ───────────── */
export async function loadUser() {
  try {
    store.user = (await api.get('/auth/me')).user;
  } catch (e) {
    if (e.status !== 401) store.error = e.message; // 401 already went to the sign-in page
    store.user = null;
  }
}

export const loadConfig = () => api.get('/config').then((c) => (store.config = c)).catch(() => {});

/** Signing out is shared by every app: forget AkulavBox's stored token too */
export async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  try {
    for (const k of ['akulavToken', 'akulavRole', 'akulavWeak']) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  window.location.assign('/login?out=1');
}
export { toLogin };

/* ───────────── Reference data ───────────── */
export const loadCategories = () => api.get('/categories').then((d) => (store.categories = d.categories));
export const loadCurrencies = () => api.get('/currencies').then((d) => (store.currencies = d.currencies));

/** Something changed: every page reloads what it shows */
export function bump() {
  store.version++;
  loadCategories().catch(() => {});
}

export const openTransaction = (transaction = null, defaults = {}) => (store.txModal = { transaction, defaults });
export const closeTransaction = () => (store.txModal = null);

/* ───────────── Theme ───────────── */
function readPref() {
  try {
    return localStorage.getItem('florin-theme') || 'system';
  } catch {
    return 'system';
  }
}
export const isDark = computed(() => store.themePref === 'dark' || (store.themePref === 'system' && store.systemDark));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => (store.systemDark = e.matches));
watch(
  [isDark, () => store.themePref],
  ([dark, pref]) => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('florin-theme', pref);
    } catch {
      /* storage unavailable */
    }
  },
  { immediate: true },
);

/** Concrete colors for the charts (SVG attributes need real values) */
export const chartTheme = computed(() =>
  isDark.value
    ? { grid: '#232c28', axis: '#808b85', text: '#eef2ef', muted: '#3a4540', surface: '#131917', spend: '#3987e5', income: '#199e70', prev: '#5b6761' }
    : { grid: '#eceeea', axis: '#7f8882', text: '#121614', muted: '#d5dad5', surface: '#ffffff', spend: '#2a78d6', income: '#1baf7a', prev: '#b3bab5' },
);

/* ───────────── Toasts ───────────── */
function push(message, type) {
  const id = Math.random().toString(36).slice(2);
  store.toasts.push({ id, message, type });
  setTimeout(() => dismissToast(id), 4000);
}
export const dismissToast = (id) => (store.toasts = store.toasts.filter((t) => t.id !== id));
export const toast = { success: (m) => push(m, 'success'), error: (m) => push(m, 'error') };

/**
 * Loads `url()` now and whenever it or the data version changes. Returns a reactive
 * { data, loading, error }; a slower older answer never replaces a newer one.
 */
export function useApi(url) {
  const state = reactive({ data: null, loading: true, error: null });
  let seq = 0;
  watch(
    [url, () => store.version],
    async ([u]) => {
      if (!u) return;
      const mine = ++seq;
      state.loading = true;
      try {
        const data = await api.get(u);
        if (mine === seq) Object.assign(state, { data, loading: false, error: null });
      } catch (error) {
        if (mine === seq) Object.assign(state, { loading: false, error });
      }
    },
    { immediate: true },
  );
  return state;
}
