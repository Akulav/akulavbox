// <akb-account>: the AkulavBox account menu every app shares (e-Management, Koma Shelf, Florin, Tick),
// with the profile picture, the app's own links (children of the element), then All apps,
// Profile & password, AI connectors, Admin console and Sign out. It also switches the shared theme.
//
//   <script src="/hub/theme.js"></script>             (in <head>, before paint)
//   <script src="/hub/account.js" defer></script>
//   <akb-account accent="#1baf7a" username="ana" role="user"><a href="/manga/library">My library</a></akb-account>
//
// Attributes: accent (the app's colour), username / role (known already: no flash before the
// account loads), expanded (name beside the picture, for a sidebar), up (menu opens upwards),
// no-theme (hide the theme button). Signed-out pages don't use it: the apps send them to /login.
(function () {
  if (customElements.get('akb-account')) return;

  var ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    // the apps (the switcher)
    box: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    documents: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    manga: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    budget: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    tasks: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
    ironveil: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  };
  // the menu speaks the page's language (e-Management is in Romanian)
  var RO = /^ro\b/i.test(document.documentElement.lang || '');
  var T = RO
    ? { apps: 'Toate aplicațiile', profile: 'Profil și parolă', connect: 'Conectori AI', admin: 'Consola de administrare', out: 'Ieșire', menu: 'Meniul contului', light: 'Treceți la tema luminoasă', dark: 'Treceți la tema întunecată', account: 'Cont AkulavBox', roles: { admin: 'administrator', user: 'utilizator' } }
    : { apps: 'All apps', profile: 'Profile &amp; password', connect: 'AI connectors', admin: 'Admin console', out: 'Sign out', menu: 'Account menu', light: 'Switch to the light theme', dark: 'Switch to the dark theme', account: 'AkulavBox account', roles: {} };
  var roleName = function (r) { return T.roles[r] || r || ''; };
  var svg = function (name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var hue = function (name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; };

  // ---------- the shared theme ----------
  var KEY = 'akulavTheme';
  function current() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
  function apply(t) {
    var resolved = !t || t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    window.dispatchEvent(new CustomEvent('akb-theme', { detail: { theme: resolved, preference: t || 'system' } }));
  }
  /** Sets the theme for every app: 'light', 'dark' or 'system' */
  function setTheme(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* storage unavailable */ }
    apply(t);
  }
  window.akbTheme = { set: setTheme, get: function () { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } } };
  // another tab (or app) changed it
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(e.newValue); });

  // ---------- the apps' bus in the browser ----------
  // Every open page of every app shares one BroadcastChannel (same origin), so what happens in one
  // reaches the others at once, without polling or a connection to the server:
  //   signed-out   every other page goes to the sign-in page too
  //   storage      files were stored or removed: pages that show storage read it again
  //   account      the profile picture or name changed: account menus repaint
  // window.akbBus.post(type, data) sends (not to the page itself); .on(type, fn) listens.
  var channel = null;
  try { channel = new BroadcastChannel('akulavbox'); } catch (e) { /* very old browsers: each page on its own */ }
  var handlers = {};
  if (channel) channel.onmessage = function (e) {
    var m = e.data || {};
    (handlers[m.type] || []).forEach(function (fn) { try { fn(m.data || {}); } catch (err) { console.error(err); } });
  };
  window.akbBus = window.akbBus || {
    post: function (type, data) { try { if (channel) channel.postMessage({ type: type, data: data || {} }); } catch (e) { /* closed */ } },
    on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  };
  // signed out elsewhere: this page's session is gone too
  window.akbBus.on('signed-out', function () {
    if (location.pathname === '/login') return;
    try { ['akulavToken', 'akulavRole', 'akulavWeak'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* storage unavailable */ }
    location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
  });

  // ---------- who is signed in (once per page) ----------
  var mePromise = null;
  function me() {
    if (!mePromise) {
      mePromise = fetch('/api/session/me', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return mePromise;
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    window.akbBus.post('signed-out');
    try { ['akulavToken', 'akulavRole', 'akulavWeak'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* storage unavailable */ }
    location.assign('/login?out=1');
  }

  class AkbAccount extends HTMLElement {
    static get observedAttributes() { return ['accent']; }
    attributeChangedCallback(name, old, value) {
      if (name === 'accent') this.style.setProperty('--accent', value || '#E8A33D');
    }
    connectedCallback() {
      if (this.shadowRoot) return;
      var root = this.attachShadow({ mode: 'open' });
      this.user = { username: this.getAttribute('username') || '', role: this.getAttribute('role') || '', avatar: null };
      root.innerHTML = '<link rel="stylesheet" href="/hub/account.css">' +
        (this.hasAttribute('no-theme') ? '' : '<button class="icon-btn" data-theme-btn type="button"></button>') +
        '<button class="me" type="button" aria-haspopup="menu" aria-expanded="false"></button>' +
        '<div class="menu" role="menu" hidden></div>';
      this.style.setProperty('--accent', this.getAttribute('accent') || '#E8A33D');
      this.btn = root.querySelector('.me');
      this.menu = root.querySelector('.menu');
      this.themeBtn = root.querySelector('[data-theme-btn]');

      this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.open(this.menu.hidden); });
      this.onDoc = (e) => { if (!this.contains(e.target) && !e.composedPath().includes(this.menu)) this.open(false); };
      this.onKey = (e) => { if (e.key === 'Escape' && !this.menu.hidden) { this.open(false); this.btn.focus(); } };
      document.addEventListener('click', this.onDoc);
      document.addEventListener('keydown', this.onKey);
      if (this.themeBtn) this.themeBtn.addEventListener('click', () => setTheme(current() === 'dark' ? 'light' : 'dark'));
      this.onTheme = () => this.paintTheme();
      window.addEventListener('akb-theme', this.onTheme);
      // the app's own links close the menu too
      this.addEventListener('click', (e) => { if (e.target.closest('a,button')) this.open(false); });

      this.paintTheme();
      this.paint();
      me().then((u) => { if (u) { this.user = u; this.paint(); } });
      // a new picture or name in another app: ask again
      window.akbBus.on('account', () => { mePromise = null; me().then((u) => { if (u) { this.user = u; this.paint(); } }); });
    }
    disconnectedCallback() {
      document.removeEventListener('click', this.onDoc);
      document.removeEventListener('keydown', this.onKey);
      window.removeEventListener('akb-theme', this.onTheme);
    }
    open(on) {
      this.menu.hidden = !on;
      this.btn.setAttribute('aria-expanded', String(on));
      if (on) (this.menu.querySelector('a,button') || this.btn).focus({ preventScroll: true });
    }
    paintTheme() {
      var t = current();
      this.setAttribute('theme', t);
      if (this.themeBtn) {
        var label = t === 'dark' ? T.light : T.dark;
        this.themeBtn.innerHTML = svg(t === 'dark' ? 'sun' : 'moon');
        this.themeBtn.title = label;
        this.themeBtn.setAttribute('aria-label', label);
      }
    }
    avatar(lg) {
      var u = this.user;
      var name = u.username || '?';
      return '<span class="avatar' + (lg ? ' lg' : '') + '" style="--h:' + hue(name) + '">' +
        (u.avatar ? '<img src="' + esc(u.avatar) + '" alt="">' : esc(name.slice(0, 1).toUpperCase())) + '</span>';
    }
    paint() {
      var u = this.user;
      this.btn.title = u.username;
      this.btn.setAttribute('aria-label', T.menu + (u.username ? ' (' + u.username + ')' : ''));
      this.btn.innerHTML = this.avatar(false) + '<span class="who"><b>' + esc(u.username) + '</b><span>' + esc(roleName(u.role)) + '</span></span>';
      // the app switcher: jump to any app of the account without going through the launcher
      var here = location.pathname;
      var switcher = (u.apps || []).length > 1
        ? '<nav class="apps" aria-label="' + T.apps + '">' + u.apps.map(function (a) {
            var cur = here.indexOf(a.path) === 0 || (a.path === '/box/' && here === '/box');
            return '<a class="app' + (cur ? ' current' : '') + '" role="menuitem" href="' + esc(a.path) + '" style="--c:' + esc(a.color) + '"' + (cur ? ' aria-current="page"' : '') + '><span class="tile">' + svg(ICONS[a.id] ? a.id : 'grid') + '</span>' + esc(a.name) + '</a>';
          }).join('') + '</nav>'
        : '';
      this.menu.innerHTML =
        switcher +
        '<div class="head">' + this.avatar(true) + '<div><b>' + esc(u.username) + '</b><span class="role">' + esc(roleName(u.role)) + '</span><span class="acct">' + T.account + '</span></div></div>' +
        '<slot></slot><div class="sep slot-sep"></div>' +
        '<a class="item" role="menuitem" href="/">' + svg('grid') + T.apps + '</a>' +
        '<a class="item" role="menuitem" href="/box/#/profile">' + svg('user') + T.profile + '</a>' +
        '<a class="item" role="menuitem" href="/connect">' + svg('plug') + T.connect + '</a>' +
        (u.role === 'admin' ? '<a class="item" role="menuitem" href="/admin">' + svg('shield') + T.admin + '</a>' : '') +
        '<button class="item danger" role="menuitem" type="button" data-out>' + svg('logout') + T.out + '</button>';
      var mark = () => this.menu.classList.toggle('has-slot', this.children.length > 0);
      mark();
      this.menu.querySelector('slot').addEventListener('slotchange', mark);
      this.menu.querySelector('[data-out]').addEventListener('click', signOut);
    }
  }
  customElements.define('akb-account', AkbAccount);
})();
