import { icon, mark, lockup, appTile, esc, session, saveSession, forgetSession, safeNext, toggleTheme, madeBy } from './common.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next') || '/');
const go = () => location.replace(next);

$('lockup').innerHTML = lockup(34);
$('mark').innerHTML = mark(52);
$('lock-chip').innerHTML = `${icon('shield')}Encrypted at rest with AES-256`;
$('u-wrap').insertAdjacentHTML('afterbegin', icon('user'));
$('p-wrap').insertAdjacentHTML('afterbegin', icon('key'));
const themeBtn = $('theme');
const paintTheme = () => { themeBtn.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'); };
paintTheme();
themeBtn.onclick = () => { toggleTheme(); paintTheme(); };

// The apps behind this sign-in, from the server's one list (the launcher shows each account the ones it may use)
const where = (apps) => [...apps.map((a) => [a.path.replace(/\/$/, ''), a.name]), ['/admin', 'the Admin console'], ['/connect', 'AI connectors'], ['/oauth', 'connect an AI app']];
function paintApps(cat) {
  $('apps').innerHTML = cat.apps.map((a) => `<li>${appTile(a)}<span><b>${esc(a.name)}</b><small>${esc(a.short || a.tagline)}</small></span></li>`).join('');
  $('made').innerHTML = madeBy(cat.version);
  const hit = where(cat.apps).find(([p]) => next === p || next.startsWith(p + '/') || next.startsWith(p + '?') || next.startsWith(p + '#'));
  if (hit && !params.get('out')) $('sub').textContent = `Sign in to continue to ${hit[1]}.`;
}
fetch('/api/apps/catalog').then((r) => r.json()).then(paintApps).catch(() => { $('made').innerHTML = madeBy(); });

const form = $('form');
const err = $('error');
const showForm = () => { $('checking').hidden = true; form.hidden = false; $('u').focus(); };

const post = (url, token) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function resume() {
  // ?out=1: just signed out in one of the apps, so the token kept for Trove's API goes too
  if (params.get('out') === '1') {
    forgetSession();
    await post('/api/logout').catch(() => {});
    $('sub').textContent = 'You are signed out of every app.';
    history.replaceState(null, '', '/login' + (params.get('next') ? `?next=${encodeURIComponent(next)}` : ''));
    return showForm();
  }
  $('checking').hidden = false;
  // signed in already (the token kept in the browser): renew the cookie the other apps read, then go on
  const s = session();
  if (s) {
    try { if ((await post('/api/session', s.token)).ok) return go(); } catch (e) { /* offline: show the form */ }
    forgetSession();
  }
  // signed in through another tab or app (only the cookie): get the token back
  try {
    const r = await post('/api/session/resume');
    if (r.ok) { const d = await r.json(); saveSession(d.token); return go(); }
  } catch (e) { /* not signed in */ }
  showForm();
}

$('show').innerHTML = icon('eye');
$('show').onclick = () => {
  const p = $('p');
  const shown = p.type === 'text';
  p.type = shown ? 'password' : 'text';
  $('show').innerHTML = icon(shown ? 'eye' : 'eye-off');
  $('show').setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
};
const caps = (e) => { if (e.getModifierState) $('caps').hidden = !e.getModifierState('CapsLock'); };
$('p').addEventListener('keyup', caps);
$('p').addEventListener('keydown', caps);

let busy = false;
form.onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const username = $('u').value.trim();
  const password = $('p').value;
  err.hidden = true;
  if (!username || !password) { err.innerHTML = `${icon('alert')}<span>Enter your username and password.</span>`; err.hidden = false; return; }
  busy = true;
  $('go').disabled = true;
  $('go').innerHTML = `${icon('loader', 'spin')}Signing in…`;
  try {
    const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Sign-in failed.'), { status: r.status });
    saveSession(d.token, { weak: !!d.weak_password });
    go();
  } catch (e2) {
    const msg = e2.status === 401 ? 'Wrong username or password.' : e2.status ? e2.message : 'Can’t reach the server. Check your connection and try again.';
    err.innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
    err.hidden = false;
    $('p').value = '';
    $('p').focus();
    busy = false;
    $('go').disabled = false;
    $('go').textContent = 'Sign in';
  }
};

resume();
