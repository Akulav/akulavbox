// e-Management: Starea comună, apelurile către server și sesiunea.
import { reactive } from '/docs/vendor/vue.js';

// Autentificarea este comună tuturor aplicațiilor de pe acest server (pagina /login).
export const toLogin = () => location.assign('/login?next=' + encodeURIComponent('/docs/' + location.hash));

export const readPref = (k, d) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};
export const writePref = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

// ---------- stare comună ----------
export const store = reactive({
  ready: false,
  me: null,
  error: null,
  // spațiul de stocare deschis: 'personal' sau 'work'; fiecare are documentele și categoriile lui
  space: readPref('space', 'personal'),
  categories: [],
  docs: [],
  docsLoaded: false,
  toast: null,
  dialog: null,
  route: location.hash.slice(1) || 'documente',
});
window.addEventListener('hashchange', () => (store.route = location.hash.slice(1) || 'documente'));

// Adresa API a spațiului curent.
export const sp = (p) => '/docs/api/s/' + store.space + p;
export const spaceLabel = () => ((store.me && store.me.stores.find((s) => s.key === store.space)) || {}).label || '';

// La ieșire (sau la expirarea sesiunii) datele dispar imediat din pagină.
export function clearSession() {
  store.me = null;
  store.categories = [];
  store.docs = [];
  store.docsLoaded = false;
  store.dialog = null;
}

export let toastTimer;
export function toast(msg, err = false) {
  store.toast = { msg, err };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = null), err ? 6000 : 2800);
}

// Fereastră de confirmare / întrebare în stilul aplicației (în locul confirm/prompt/alert ale browserului).
// Întoarce true/false sau, cu `input: true`, textul introdus (null la anulare).
export function ask(opts) {
  return new Promise((resolve) => {
    if (store.dialog) store.dialog.resolve(opts.input ? null : false);
    store.dialog = { title: 'Confirmare', okLabel: 'Confirmă', value: '', ...opts, resolve };
  });
}

export async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.raw) {
    init.headers['Content-Type'] = 'application/octet-stream';
    init.body = opts.raw;
  } else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let r;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error('Serverul nu răspunde. Verificați conexiunea și reîncercați.');
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401) {
      clearSession();
      toLogin();
    }
    throw new Error((data && data.error) || (r.status >= 500 ? 'Eroare internă de server.' : 'Cererea nu a putut fi procesată.'));
  }
  return data;
}

// Rulează o acțiune și afișează rezultatul; întoarce true la succes.
export async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

export async function loadCategories() {
  store.categories = await api(sp('/categories'));
}
export async function loadDocs() {
  store.docs = await api(sp('/documents'));
  store.docsLoaded = true;
}
export async function loadSpace() {
  await Promise.all([loadCategories(), loadDocs()]);
}

// Trecerea între spațiul personal și cel de serviciu: datele celuilalt spațiu dispar imediat din pagină.
export async function switchSpace(key) {
  if (key === store.space) return;
  store.space = key;
  writePref('space', key);
  store.categories = [];
  store.docs = [];
  store.docsLoaded = false;
  await run(loadSpace);
}

export async function loadSession() {
  let me = null;
  try {
    me = await api('/docs/api/me');
  } catch (e) {
    store.error = e.message;
  }
  if (!me) clearSession();
  if (me && !me.stores.some((s) => s.key === store.space)) store.space = me.stores[0].key;
  store.me = me;
  if (me) {
    try {
      await loadSpace();
    } catch (e) {
      toast(e.message, true);
    }
  }
  store.ready = true;
}
