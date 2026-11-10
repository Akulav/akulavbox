import { createApp, ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import Icon from './components/Icon.js';
import { BrandMark, BrandLockup, MadeBy } from './components/Brand.js';
import { UiHost, UploadTray, PlayerBar, Avatar } from './components/Shell.js';
import FileManager from './pages/FileManager.js';
import Trash from './pages/Trash.js';
import AdminPanel from './pages/AdminPanel.js';
import Profile from './pages/Profile.js';
import CustomAlbums from './pages/CustomAlbums.js';
import Music from './pages/MusicApp.js';
import MediaLibrary from './pages/MediaLibrary.js';
import { forgetFolders } from './lib/library.js';
import { session, setSession, clearSession, api, account, refreshAccount, formatBytes, storage, app as appInfo, checkVersion } from './lib/api.js';
import { stop as stopPlayer, player } from './lib/player.js';
import { toast } from './lib/ui.js';

const TABS = [
  { id: 'files', label: 'Files', icon: 'folder', key: 'f' },
  { id: 'albums', label: 'Photos', icon: 'images', key: 'p' },
  { id: 'videos', label: 'Videos', icon: 'film', key: 'v' },
  { id: 'music', label: 'Music', icon: 'music', key: 'm' },
  { id: 'books', label: 'Books', icon: 'file-text', key: 'b' },
  // opt-in (Profile → Sections): the sixth slot of the phone's bottom bar
  { id: 'xxx', label: 'XXX', icon: 'flame', key: 'x', optIn: true },
  { id: 'trash', label: 'Trash', icon: 'trash', key: 't', secondary: true },
  { id: 'profile', label: 'Profile', icon: 'user', secondary: true, key: 'u' },
  { id: 'admin', label: 'Admin', icon: 'shield', admin: true, secondary: true, key: 'a' },
];

const SHORTCUTS = [
  ['Anywhere', [['/', 'Search this page'], ['?', 'Show these shortcuts'], ['G then F / P / V / M / B', 'Go to Files, Photos, Videos, Music, Books'], ['G then T / U', 'Go to Trash, Profile'], ['Esc', 'Close a dialog or clear the selection']]],
  ['Files', [['Ctrl + A', 'Select everything'], ['Delete', 'Move the selection to the trash'], ['F2', 'Rename the selected item'], ['Shift + click', 'Select a range']]],
  ['Viewer', [['← / →', 'Previous / next file'], ['+ / − / 0', 'Zoom in, out, reset'], ['Space', 'Slideshow, or play and pause'], ['F', 'Full screen'], ['I', 'Details panel'], ['Ctrl + S', 'Save while editing']]],
];

const FEATURES = [
  { label: 'Files & sharing', icon: 'folder', tint: '#E8A33D' }, { label: 'Photo albums', icon: 'images', tint: '#5fb3a1' },
  { label: 'Music player', icon: 'music', tint: '#c78bd8' }, { label: 'Videos & books', icon: 'film', tint: '#d0806b' },
  { label: 'Link downloads', icon: 'download', tint: '#6ea8e6' }, { label: 'Multi-user', icon: 'users', tint: '#60c798' },
];

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS.some(t => t.id === parts[0]) ? parts[0] : 'files';
  const args = parts.slice(1).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  return { tab, arg: args[0] || null, args };
}

createApp({
  components: { Icon, BrandMark, BrandLockup, MadeBy, UiHost, UploadTray, PlayerBar, Avatar, MediaLibrary, FileManager, Trash, CustomAlbums, Profile, AdminPanel, Music },
  template: /*html*/`
    <UiHost />

    <!-- ============ SIGN IN ============ -->
    <div v-if="!session.token" class="min-h-full flex flex-col">
      <div class="flex justify-end p-3 sm:p-5">
        <button class="icon-btn" @click="toggleTheme" :title="theme === 'dark' ? 'Light theme' : 'Dark theme'" :aria-label="theme === 'dark' ? 'Light theme' : 'Dark theme'">
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
        </button>
      </div>

      <main class="flex-1 grid place-items-center px-4 pb-10">
        <div class="w-full max-w-[440px] lg:max-w-[940px] rise">
          <div class="panel glass overflow-hidden grid lg:grid-cols-2">
            <!-- brand half (wide screens) -->
            <section class="login-hero hidden lg:flex flex-col justify-between gap-10 p-10 border-r border-line">
              <BrandLockup :size="34" :animated="true" />
              <div>
                <p class="chip chip-accent !h-7 !px-3 mb-5"><Icon name="lock" :size="13" :stroke="2.2" />Encrypted at rest with AES-256</p>
                <h1 class="title text-[44px] leading-[1.04] tracking-tight">Your files,<br><span class="brand-text">your cloud.</span></h1>
                <p class="text-muted text-[14.5px] leading-relaxed mt-4">Files, photos, music, videos and books, on a server you own.</p>
              </div>
              <ul class="grid grid-cols-2 gap-2.5 stagger">
                <li v-for="f in features" :key="f.label" class="rounded-xl bg-surface/55 border border-line/70 px-3 py-2.5 flex items-center gap-2.5">
                  <span class="w-8 h-8 rounded-lg grid place-items-center shrink-0" :style="{ background: f.tint + '22', color: f.tint }"><Icon :name="f.icon" :size="16" /></span>
                  <span class="text-[13px] font-medium truncate">{{ f.label }}</span>
                </li>
              </ul>
            </section>

            <!-- form half -->
            <section class="p-7 sm:p-10 flex flex-col justify-center">
              <div class="flex flex-col items-center text-center mb-7">
                <BrandMark :size="52" :animated="true" class="mb-4" />
                <h2 class="title text-[26px] leading-tight">Welcome back</h2>
                <p class="text-muted text-[13.5px] mt-1">Sign in to your AkulavBox.</p>
              </div>
              <form @submit.prevent="login" class="space-y-4" novalidate>
                <div>
                  <label class="label" for="u">Username</label>
                  <div class="relative">
                    <Icon name="user" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                    <input id="u" v-model="form.username" class="input h-11 pl-10" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus required>
                  </div>
                </div>
                <div>
                  <label class="label" for="p">Password</label>
                  <div class="relative">
                    <Icon name="key" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                    <input id="p" v-model="form.password" :type="showPw ? 'text' : 'password'" class="input h-11 pl-10 pr-11" autocomplete="current-password" required @keyup="onPwKey" @keydown="onPwKey">
                    <button type="button" class="icon-btn icon-btn-sm absolute right-2 top-1/2 -translate-y-1/2" @click="showPw = !showPw" :aria-label="showPw ? 'Hide password' : 'Show password'" :title="showPw ? 'Hide password' : 'Show password'">
                      <Icon :name="showPw ? 'eye-off' : 'eye'" :size="16" />
                    </button>
                  </div>
                  <p v-if="capsLock" class="text-accent text-xs mt-1.5 flex items-center gap-1.5"><Icon name="info" :size="13" />Caps Lock is on</p>
                </div>
                <Transition name="fade"><p v-if="loginError" role="alert" class="text-danger text-[13px] flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2"><Icon name="alert" :size="15" class="shrink-0" />{{ loginError }}</p></Transition>
                <button type="submit" class="btn btn-primary w-full h-11 text-[14.5px] !mt-6" :disabled="loggingIn">
                  <Icon v-if="loggingIn" name="loader" :size="16" />{{ loggingIn ? 'Signing in…' : 'Sign in' }}
                </button>
              </form>
              <p class="text-faint text-[12px] text-center mt-6">Forgot your password? Ask the admin of this server to reset it.</p>
            </section>
          </div>
          <div class="flex justify-center mt-6"><MadeBy :version="appInfo.version" /></div>
        </div>
      </main>
    </div>

    <!-- ============ APP ============ -->
    <template v-else>
      <!-- Top bar: brand · sections · account (sections move to the bottom bar on phones) -->
      <header class="sticky top-0 z-40 border-b border-line glass">
        <!-- three equal-weight columns, so the sections sit at the true centre of the page whatever the side widths -->
        <div class="max-w-[1500px] mx-auto h-14 md:h-16 px-3 md:px-8 flex md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 md:gap-4">
          <a href="#/files" class="shrink-0 min-w-0 mr-auto md:mr-0 md:justify-self-start" title="AkulavBox"><BrandLockup :size="30" :animated="true" /></a>

          <nav class="hidden md:flex justify-center" aria-label="Sections">
            <div class="topnav">
              <a v-for="t in mainTabs" :key="t.id" :href="'#/' + t.id" class="topnav-item" :class="{ active: route.tab === t.id }"
                 :aria-current="route.tab === t.id ? 'page' : null" :title="t.label">
                <Icon :name="t.icon" :size="17" class="nav-icon" />
                <span class="hidden lg:inline">{{ t.label }}</span>
                <span v-if="t.id === 'music' && player.playing && route.tab !== 'music'" class="eq flex items-end gap-[2px] h-3" aria-label="Playing">
                  <span class="w-[3px] h-3 bg-accent rounded-sm"></span><span class="w-[3px] h-3 bg-accent rounded-sm"></span><span class="w-[3px] h-3 bg-accent rounded-sm"></span>
                </span>
              </a>
            </div>
          </nav>

          <div class="flex items-center gap-0.5 shrink-0 md:justify-self-end">
            <a href="#/trash" class="icon-btn relative" :class="{ active: route.tab === 'trash' }" :title="account.trash_bytes ? 'Trash (' + formatBytes(account.trash_bytes) + ')' : 'Trash'" aria-label="Trash">
              <Icon name="trash" :size="18" />
              <span v-if="account.trash_bytes" class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent"></span>
            </a>
            <a v-if="session.role === 'admin'" href="#/admin" class="icon-btn relative" :class="{ active: route.tab === 'admin' }" title="Admin" aria-label="Admin">
              <Icon name="shield" :size="18" />
              <span v-if="newRelease" class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-info"></span>
            </a>
            <button class="icon-btn" @click="toggleTheme" :title="theme === 'dark' ? 'Light theme' : 'Dark theme'" :aria-label="theme === 'dark' ? 'Light theme' : 'Dark theme'"><Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" /></button>

            <!-- account menu -->
            <div class="relative ml-1.5">
              <button class="avatar-ring" :class="{ warn: usedPct >= 90, on: route.tab === 'profile' }" :style="{ '--p': usedPct }" @click="userMenu = !userMenu"
                      :aria-expanded="userMenu" aria-haspopup="menu" :title="session.username + ' · ' + usedPct + '% of storage used'">
                <Avatar :name="session.username" :src="account.profile_image" :size="30" />
                <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface" :class="online ? 'bg-ok' : 'bg-danger'"></span>
              </button>
              <div v-if="userMenu" class="fixed inset-0 z-[229]" @click="userMenu = false"></div>
              <Transition name="pop">
                <div v-if="userMenu" class="menu absolute right-0 top-12 z-[230] w-[270px] !p-0 overflow-hidden" role="menu" @click="userMenu = false">
                  <div class="p-4 flex items-center gap-3 border-b border-line">
                    <Avatar :name="session.username" :src="account.profile_image" :size="40" />
                    <div class="min-w-0">
                      <p class="font-semibold truncate">{{ session.username }}</p>
                      <p class="text-xs text-muted"><span class="capitalize">{{ session.role }}</span> · {{ online ? 'online' : 'offline' }}</p>
                    </div>
                  </div>
                  <a v-if="account.loaded" href="#/profile" class="block px-4 py-3 border-b border-line hover:bg-elevated/60">
                    <div class="flex justify-between text-[12.5px] mb-1.5"><span class="text-muted flex items-center gap-1.5"><Icon name="hard-drive" :size="13" />Storage</span><span class="tabular-nums">{{ usedPct }}%</span></div>
                    <div class="meter" :class="{ warn: usedPct >= 90 }"><span :style="{ width: usedPct + '%' }"></span></div>
                    <p class="text-faint text-xs mt-1.5 tabular-nums">{{ formatBytes(account.used_bytes) }} of {{ formatBytes(account.quota_bytes) }}</p>
                  </a>
                  <div class="p-1">
                    <a href="#/profile" class="menu-item"><Icon name="user" :size="16" />Profile & settings</a>
                    <button class="menu-item hidden md:flex" @click="showKeys = true"><Icon name="keyboard" :size="16" />Keyboard shortcuts<span class="kbd ml-auto">?</span></button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="logout"><Icon name="logout" :size="16" />Sign out</button>
                  </div>
                  <div class="px-4 py-2.5 border-t border-line bg-elevated/30"><MadeBy :version="appInfo.version" /></div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </header>

      <main class="min-h-[calc(100%-4rem)] flex flex-col" :class="player.current ? 'pb-[140px] md:pb-[96px]' : 'pb-[76px] md:pb-0'">
        <!-- banners -->
        <div v-if="banners.length" class="w-full max-w-[1500px] mx-auto px-4 md:px-8 pt-4 md:pt-6 space-y-2">
          <TransitionGroup name="fade">
            <div v-for="b in banners" :key="b.id" class="panel !shadow-none px-4 py-2.5 flex items-center gap-3 text-[13.5px]" :class="b.cls">
              <Icon :name="b.icon" :size="17" class="shrink-0" />
              <span class="flex-1">{{ b.text }}</span>
              <button v-if="b.action" class="btn btn-sm shrink-0" @click="b.action.run">{{ b.action.label }}</button>
            </div>
          </TransitionGroup>
        </div>
        <div class="w-full max-w-[1500px] mx-auto px-4 md:px-8 py-5 md:py-8">
          <Transition name="page" mode="out-in">
            <FileManager v-if="route.tab === 'files'" key="files" :folder-id="route.arg" @navigate="goFolder" />
            <Trash v-else-if="route.tab === 'trash'" key="trash" />
            <CustomAlbums v-else-if="route.tab === 'albums'" key="albums" :args="route.args" />
            <MediaLibrary v-else-if="route.tab === 'videos'" key="videos" kind="videos" :args="route.args" />
            <MediaLibrary v-else-if="route.tab === 'books'" key="books" kind="books" :args="route.args" />
            <MediaLibrary v-else-if="route.tab === 'xxx' && account.show_xxx" key="xxx" kind="xxx" :args="route.args" />
            <Music v-else-if="route.tab === 'music'" key="music" />
            <Profile v-else-if="route.tab === 'profile'" key="profile" />
            <AdminPanel v-else-if="route.tab === 'admin' && session.role === 'admin'" key="admin" />
          </Transition>
        </div>
        <footer class="hidden md:flex w-full max-w-[1500px] mx-auto mt-auto px-8 pb-6 pt-2 items-center justify-between">
          <MadeBy :version="appInfo.version" />
          <button class="text-[11.5px] text-faint hover:text-muted flex items-center gap-1.5" @click="showKeys = true"><Icon name="keyboard" :size="13" />Shortcuts <span class="kbd !h-[18px] !min-w-[18px] !text-[10.5px]">?</span></button>
        </footer>
      </main>

      <!-- Mobile bottom nav: one column per section, so an opted-in XXX gets its own slot -->
      <nav class="md:hidden fixed bottom-0 inset-x-0 z-[160] border-t border-line glass grid pb-[env(safe-area-inset-bottom)]" aria-label="Sections"
           :style="{ gridTemplateColumns: 'repeat(' + mobileTabs.length + ', minmax(0, 1fr))' }">
        <a v-for="t in mobileTabs" :key="t.id" :href="'#/' + t.id"
           class="h-[60px] flex flex-col items-center justify-center gap-1 font-medium relative transition-colors"
           :class="route.tab === t.id ? 'text-accent' : 'text-muted'" :aria-current="route.tab === t.id ? 'page' : null">
          <span v-if="route.tab === t.id" class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-accent"></span>
          <Icon :name="t.icon" :size="19" />
          <span class="text-[10px] truncate max-w-full px-0.5">{{ t.label }}</span>
          <span v-if="t.id === 'music' && player.playing && route.tab !== 'music'" class="absolute top-2 left-1/2 ml-2.5 w-1.5 h-1.5 rounded-full bg-accent"></span>
        </a>
      </nav>

      <Transition name="fade">
        <button v-if="showTop" class="fixed z-[140] right-4 w-10 h-10 rounded-full panel grid place-items-center text-muted hover:text-fg lift"
                :class="player.current ? 'bottom-[136px] md:bottom-[96px]' : 'bottom-[76px] md:bottom-6'" @click="toTop" title="Back to top" aria-label="Back to top">
          <Icon name="arrow-up" :size="18" />
        </button>
      </Transition>
      <PlayerBar />
      <UploadTray />
    </template>

    <!-- Keyboard shortcuts -->
    <Transition name="fade">
      <div v-if="showKeys" class="fixed inset-0 z-[290] bg-black/55 grid place-items-center p-4" @mousedown.self="showKeys = false">
        <Transition name="pop" appear>
          <div class="panel w-full max-w-xl p-6 max-h-[85vh] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
            <div class="flex items-center justify-between mb-4">
              <h3 class="title text-xl">Keyboard shortcuts</h3>
              <button class="icon-btn" @click="showKeys = false" aria-label="Close"><Icon name="x" :size="18" /></button>
            </div>
            <div v-for="[group, rows] in shortcuts" :key="group" class="mb-5 last:mb-0">
              <p class="label">{{ group }}</p>
              <div v-for="[k, what] in rows" :key="k" class="flex items-center justify-between gap-4 py-1.5 border-b border-line/60 last:border-0 text-[13.5px]">
                <span class="text-muted">{{ what }}</span>
                <span class="flex gap-1 flex-wrap justify-end"><span v-for="part in k.split(' ')" :key="part" :class="['then', '+', '/'].includes(part) ? 'text-faint text-xs self-center' : 'kbd'">{{ part }}</span></span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  `,
  setup() {
    const route = reactive(parseHash());
    const form = reactive({ username: '', password: '' });
    const loginError = ref('');
    const loggingIn = ref(false);
    const showPw = ref(false);
    const capsLock = ref(false);
    const showKeys = ref(false);
    const online = ref(navigator.onLine);
    const theme = ref(document.documentElement.dataset.theme || 'dark');

    const onHash = () => Object.assign(route, parseHash());
    // Back-to-top button after scrolling a couple of screens
    const showTop = ref(false);
    const onScroll = () => { showTop.value = window.scrollY > window.innerHeight * 2; };
    const toTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

    let gPending = 0;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input:not([type=checkbox]), textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape' && showKeys.value) { showKeys.value = false; return; }
      if (document.querySelector('[role=dialog]') && !showKeys.value) return;
      if (!session.token) return;
      // "/" jumps to the search box of the current page
      if (e.key === '/') {
        const box = document.querySelector('main input[type=search]');
        if (box) { e.preventDefault(); box.focus(); box.select(); }
      } else if (e.key === '?') { e.preventDefault(); showKeys.value = !showKeys.value; }
      else if (e.key.toLowerCase() === 'g') { gPending = Date.now(); }
      else if (gPending && Date.now() - gPending < 1200) {
        const t = visibleTabs.value.find(x => x.key === e.key.toLowerCase());
        gPending = 0;
        if (t) { e.preventDefault(); location.hash = '#/' + t.id; }
      }
    };
    const onOnline = () => { online.value = true; };
    const onOffline = () => { online.value = false; };
    const onVisible = () => { if (!document.hidden) checkVersion(); };
    let versionTimer = null;
    onMounted(() => {
      window.addEventListener('hashchange', onHash); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('keydown', onKey);
      window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisible);
      checkVersion();
      versionTimer = setInterval(checkVersion, 10 * 60 * 1000);
    });
    onUnmounted(() => {
      window.removeEventListener('hashchange', onHash); window.removeEventListener('scroll', onScroll); window.removeEventListener('keydown', onKey);
      window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(versionTimer);
    });

    const visibleTabs = computed(() => TABS.filter(t => (!t.admin || session.role === 'admin') && (!t.optIn || account.show_xxx)));
    const mainTabs = computed(() => visibleTabs.value.filter(t => !t.secondary));
    // the phone bar has the same sections (Trash, Profile and Admin sit in the top bar and the account menu)
    const mobileTabs = mainTabs;
    // a turned-off section (or one turned off on another device) falls back to Files
    watch(() => [route.tab, account.loaded, account.show_xxx], () => {
      if (route.tab === 'xxx' && account.loaded && !account.show_xxx) location.hash = '#/files';
    });
    const userMenu = ref(false);
    // close the account menu when the page changes
    watch(() => route.tab, () => { userMenu.value = false; });
    const usedPct = computed(() => account.quota_bytes ? Math.min(100, Math.round((account.used_bytes / account.quota_bytes) * 100)) : 0);

    // The browser tab says where you are ("Videos · AkulavBox")
    watch(() => [route.tab, session.token], () => {
      const t = session.token && TABS.find(x => x.id === route.tab);
      document.title = t ? `${t.label} · AkulavBox` : 'AkulavBox';
    }, { immediate: true });

    // admins hear about new versions on GitHub (the server checks every few hours)
    const newRelease = ref(null);
    const checkRelease = () => {
      if (session.role !== 'admin') { newRelease.value = null; return; }
      api('/api/admin/updates').then(u => { newRelease.value = u.available && !u.ready ? u.latest.version : null; }).catch(() => {});
    };
    watch(() => session.role, checkRelease, { immediate: true });
    watch(() => route.tab, (t, old) => { if (old === 'admin') checkRelease(); });

    const banners = computed(() => {
      const out = [];
      if (!online.value) out.push({ id: 'offline', icon: 'alert', cls: 'border-danger/40 bg-danger/[0.07]', text: 'You’re offline. Changes and uploads continue when the connection comes back.' });
      if (appInfo.updateAvailable) out.push({ id: 'update', icon: 'rotate', cls: 'border-info/40 bg-info/[0.07]', text: `AkulavBox was updated to v${appInfo.version}. Reload to get the new version.`, action: { label: 'Reload', run: () => location.reload() } });
      if (newRelease.value && session.role === 'admin' && route.tab !== 'admin') out.push({ id: 'release', icon: 'download', cls: 'border-info/40 bg-info/[0.07]', text: `AkulavBox ${newRelease.value} is available on GitHub.`, action: { label: 'See update', run: () => { location.hash = '#/admin/updates'; } } });
      if (session.weakPassword && route.tab !== 'profile') out.push({ id: 'weak', icon: 'key', cls: 'border-accent/40 bg-accent/[0.07]', text: 'Your password is easy to guess. Change it to keep your files safe.', action: { label: 'Change password', run: () => { location.hash = '#/profile'; } } });
      if (account.loaded && usedPct.value >= 95) out.push({ id: 'full', icon: 'hard-drive', cls: 'border-danger/40 bg-danger/[0.07]', text: `Your storage is ${usedPct.value}% full. Empty the trash or delete files to make room.`, action: account.trash_bytes ? { label: 'Open trash', run: () => { location.hash = '#/trash'; } } : null });
      return out;
    });

    const goFolder = (id) => { location.hash = id ? `#/files/${encodeURIComponent(id)}` : '#/files'; };

    const toggleTheme = () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme.value;
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.value === 'dark' ? '#0D1518' : '#F3F5F4');
      storage.write('akulavTheme', theme.value);
    };

    const onPwKey = (e) => { if (e.getModifierState) capsLock.value = e.getModifierState('CapsLock'); };

    const login = async () => {
      if (loggingIn.value) return;
      loginError.value = '';
      if (!form.username.trim() || !form.password) { loginError.value = 'Enter your username and password.'; return; }
      loggingIn.value = true;
      try {
        const data = await api('/api/login', { method: 'POST', body: { username: form.username.trim(), password: form.password } });
        setSession(data.token, { weak: !!data.weak_password });
        form.password = '';
        if (!location.hash) location.hash = '#/files';
      } catch (e) {
        loginError.value = e.status === 401 ? 'Wrong username or password.' : e.status ? e.message : 'Can’t reach the server. Check your connection and try again.';
        form.password = '';
        document.getElementById('p')?.focus();
      } finally { loggingIn.value = false; }
    };

    const logout = () => {
      stopPlayer();
      clearSession();
      forgetFolders();
      Object.assign(account, { username: '', role: '', used_bytes: 0, quota_bytes: 0, trash_bytes: 0, profile_image: null, show_xxx: false, loaded: false });
      toast('Signed out');
    };

    // Start background services whenever we have a session (also after an expired token is cleared)
    watch(() => session.token, (t, prev) => {
      if (t && !prev) refreshAccount();
      else if (!t) stopPlayer();
    }, { immediate: true });

    return { session, route, form, login, loginError, loggingIn, showPw, capsLock, onPwKey, logout, theme, toggleTheme, visibleTabs, mobileTabs,
      account, usedPct, formatBytes, player, goFolder, showTop, toTop, online, appInfo, banners, features: FEATURES, showKeys, shortcuts: SHORTCUTS, mainTabs, userMenu, newRelease };
  },
}).mount('#app');
