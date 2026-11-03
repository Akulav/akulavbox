import { createApp, ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import Icon from './components/Icon.js';
import { BrandMark, BrandLockup, MadeBy } from './components/Brand.js';
import { UiHost, UploadTray, PlayerBar, CallOverlay, Avatar } from './components/Shell.js';
import FileManager from './pages/FileManager.js';
import Trash from './pages/Trash.js';
import ChatVoice from './pages/ChatVoice.js';
import AdminPanel from './pages/AdminPanel.js';
import Profile from './pages/Profile.js';
import CustomAlbums from './pages/CustomAlbums.js';
import Music from './pages/MusicApp.js';
import MediaLibrary from './pages/MediaLibrary.js';
import { forgetFolders } from './lib/library.js';
import { session, setSession, clearSession, api, account, refreshAccount, formatBytes, storage, app as appInfo, checkVersion } from './lib/api.js';
import { stop as stopPlayer, player } from './lib/player.js';
import { rt, connectRealtime, disconnectRealtime, totalUnread } from './lib/realtime.js';
import { toast } from './lib/ui.js';

const TABS = [
  { id: 'files', label: 'Files', icon: 'folder', key: 'f' },
  { id: 'albums', label: 'Photos', icon: 'images', key: 'p' },
  { id: 'videos', label: 'Videos', icon: 'film', key: 'v' },
  { id: 'music', label: 'Music', icon: 'music', key: 'm' },
  { id: 'books', label: 'Books', icon: 'file-text', key: 'b' },
  { id: 'chat', label: 'Chat', icon: 'message', key: 'c' },
  { id: 'trash', label: 'Trash', icon: 'trash', key: 't', secondary: true },
  { id: 'profile', label: 'Profile', icon: 'user', desktopOnly: true, secondary: true, key: 'u' },
  { id: 'admin', label: 'Admin', icon: 'shield', admin: true, secondary: true, key: 'a' },
];

const SHORTCUTS = [
  ['Anywhere', [['/', 'Search this page'], ['?', 'Show these shortcuts'], ['G then F / P / V / M / B / C', 'Go to Files, Photos, Videos, Music, Books, Chat'], ['G then T', 'Go to Trash'], ['Esc', 'Close a dialog or clear the selection']]],
  ['Files', [['Ctrl + A', 'Select everything'], ['Delete', 'Move the selection to the trash'], ['F2', 'Rename the selected item'], ['Shift + click', 'Select a range']]],
  ['Viewer', [['← / →', 'Previous / next file'], ['+ / − / 0', 'Zoom in, out, reset'], ['Space', 'Slideshow'], ['F', 'Full screen'], ['I', 'Details panel'], ['Ctrl + S', 'Save while editing']]],
];

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS.some(t => t.id === parts[0]) ? parts[0] : 'files';
  const args = parts.slice(1).map(decodeURIComponent);
  return { tab, arg: args[0] || null, args };
}

createApp({
  components: { Icon, BrandMark, BrandLockup, MadeBy, UiHost, UploadTray, PlayerBar, CallOverlay, Avatar, MediaLibrary, FileManager, Trash, CustomAlbums, ChatVoice, Profile, AdminPanel, Music },
  template: /*html*/`
    <UiHost />

    <!-- ============ SIGN IN ============ -->
    <div v-if="!session.token" class="min-h-full grid lg:grid-cols-[1.1fr_1fr]">
      <!-- hero -->
      <section class="hidden lg:flex flex-col justify-between gap-10 p-12 xl:p-16 relative overflow-hidden">
        <BrandLockup :size="40" :animated="true" />
        <div class="max-w-lg rise">
          <p class="chip chip-accent !h-7 !px-3 mb-6"><Icon name="lock" :size="13" :stroke="2.2" />Encrypted at rest with AES-256</p>
          <h1 class="title text-[52px] xl:text-[60px] leading-[1.02] tracking-tight">Your files,<br><span class="brand-text">your cloud.</span></h1>
          <p class="text-muted text-[16px] leading-relaxed mt-5 max-w-md">Files, photos, music, videos, books and calls with the people you trust, on a server you own.</p>
          <ul class="grid grid-cols-2 gap-3 mt-10 max-w-md stagger">
            <li v-for="f in features" :key="f.label" class="panel !bg-surface/60 px-4 py-3 flex items-center gap-3">
              <span class="w-9 h-9 rounded-xl grid place-items-center shrink-0" :style="{ background: f.tint + '22', color: f.tint }"><Icon :name="f.icon" :size="18" /></span>
              <span class="text-[13.5px] font-medium">{{ f.label }}</span>
            </li>
          </ul>
        </div>
        <MadeBy :version="appInfo.version" />
      </section>

      <!-- form -->
      <section class="flex flex-col items-center justify-center px-4 py-12">
        <div class="w-full max-w-[400px] rise">
          <div class="lg:hidden flex justify-center mb-8"><BrandLockup :size="44" :animated="true" /></div>
          <div class="panel glass p-7 sm:p-8">
            <h2 class="title text-2xl">Welcome back</h2>
            <p class="text-muted text-[13.5px] mt-1 mb-6">Sign in to your AkulavBox.</p>
            <form @submit.prevent="login" class="space-y-4">
              <div>
                <label class="label" for="u">Username</label>
                <input id="u" v-model="form.username" class="input h-11" autocomplete="username" autofocus required>
              </div>
              <div>
                <label class="label" for="p">Password</label>
                <div class="relative">
                  <input id="p" v-model="form.password" :type="showPw ? 'text' : 'password'" class="input h-11 pr-11" autocomplete="current-password" required @keyup="onPwKey" @keydown="onPwKey">
                  <button type="button" class="icon-btn icon-btn-sm absolute right-2 top-1/2 -translate-y-1/2" @click="showPw = !showPw" :aria-label="showPw ? 'Hide password' : 'Show password'" :title="showPw ? 'Hide password' : 'Show password'">
                    <Icon :name="showPw ? 'eye-off' : 'eye'" :size="16" />
                  </button>
                </div>
                <p v-if="capsLock" class="text-accent text-xs mt-1.5 flex items-center gap-1.5"><Icon name="info" :size="13" />Caps Lock is on</p>
              </div>
              <Transition name="fade"><p v-if="loginError" class="text-danger text-[13px] flex items-center gap-2"><Icon name="alert" :size="15" />{{ loginError }}</p></Transition>
              <button type="submit" class="btn btn-primary w-full h-11 text-[14.5px]" :disabled="loggingIn">
                <Icon v-if="loggingIn" name="loader" :size="16" />{{ loggingIn ? 'Signing in…' : 'Sign in' }}
              </button>
            </form>
          </div>
          <div class="flex items-center justify-between mt-6 px-1">
            <button class="btn btn-ghost btn-sm -ml-2" @click="toggleTheme">
              <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />{{ theme === 'dark' ? 'Light theme' : 'Dark theme' }}
            </button>
            <MadeBy class="lg:hidden" :version="appInfo.version" />
          </div>
        </div>
      </section>
    </div>

    <!-- ============ APP ============ -->
    <template v-else>
      <!-- Top bar: brand · sections · account (sections move to the bottom bar on phones) -->
      <header class="sticky top-0 z-40 border-b border-line glass">
        <div class="max-w-[1500px] mx-auto h-14 md:h-16 px-3 md:px-8 flex items-center gap-2 md:gap-4">
          <a href="#/files" class="shrink-0 min-w-0 mr-auto md:mr-0" title="AkulavBox"><BrandLockup :size="30" :animated="true" /></a>

          <nav class="hidden md:flex flex-1 justify-center" aria-label="Sections">
            <div class="topnav">
              <a v-for="t in mainTabs" :key="t.id" :href="'#/' + t.id" class="topnav-item" :class="{ active: route.tab === t.id }"
                 :aria-current="route.tab === t.id ? 'page' : null" :title="t.label">
                <Icon :name="t.icon" :size="17" class="nav-icon" />
                <span class="hidden lg:inline">{{ t.label }}</span>
                <span v-if="t.id === 'chat' && unread" class="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-fg text-[10.5px] font-semibold grid place-items-center">{{ unread }}</span>
                <span v-if="t.id === 'music' && player.playing && route.tab !== 'music'" class="eq flex items-end gap-[2px] h-3" aria-label="Playing">
                  <span class="w-[3px] h-3 bg-accent rounded-sm"></span><span class="w-[3px] h-3 bg-accent rounded-sm"></span><span class="w-[3px] h-3 bg-accent rounded-sm"></span>
                </span>
              </a>
            </div>
          </nav>

          <div class="flex items-center gap-0.5 shrink-0">
            <a href="#/trash" class="icon-btn relative" :class="{ active: route.tab === 'trash' }" :title="account.trash_bytes ? 'Trash (' + formatBytes(account.trash_bytes) + ')' : 'Trash'">
              <Icon name="trash" :size="18" />
              <span v-if="account.trash_bytes" class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent"></span>
            </a>
            <a v-if="session.role === 'admin'" href="#/admin" class="icon-btn" :class="{ active: route.tab === 'admin' }" title="Admin"><Icon name="shield" :size="18" /></a>
            <button class="icon-btn" @click="toggleTheme" :title="theme === 'dark' ? 'Light theme' : 'Dark theme'"><Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" /></button>

            <!-- account menu -->
            <div class="relative ml-1.5">
              <button class="avatar-ring" :class="{ warn: usedPct >= 90, on: route.tab === 'profile' }" :style="{ '--p': usedPct }" @click="userMenu = !userMenu"
                      :aria-expanded="userMenu" aria-haspopup="menu" :title="session.username + ' · ' + usedPct + '% of storage used'">
                <Avatar :name="session.username" :src="account.profile_image" :size="30" />
                <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface" :class="rt.connected ? 'bg-ok glow-dot' : 'bg-faint'"></span>
              </button>
              <div v-if="userMenu" class="fixed inset-0 z-[229]" @click="userMenu = false"></div>
              <Transition name="pop">
                <div v-if="userMenu" class="menu absolute right-0 top-12 z-[230] w-[270px] !p-0 overflow-hidden" role="menu" @click="userMenu = false">
                  <div class="p-4 flex items-center gap-3 border-b border-line">
                    <Avatar :name="session.username" :src="account.profile_image" :size="40" />
                    <div class="min-w-0">
                      <p class="font-semibold truncate">{{ session.username }}</p>
                      <p class="text-xs text-muted"><span class="capitalize">{{ session.role }}</span> · {{ rt.connected ? 'online' : 'reconnecting…' }}</p>
                    </div>
                  </div>
                  <a v-if="account.loaded" href="#/profile" class="block px-4 py-3 border-b border-line hover:bg-elevated/60">
                    <div class="flex justify-between text-[12.5px] mb-1.5"><span class="text-muted flex items-center gap-1.5"><Icon name="hard-drive" :size="13" />Storage</span><span class="tabular-nums">{{ usedPct }}%</span></div>
                    <div class="meter" :class="{ warn: usedPct >= 90 }"><span :style="{ width: usedPct + '%' }"></span></div>
                    <p class="text-faint text-xs mt-1.5 tabular-nums">{{ formatBytes(account.used_bytes) }} of {{ formatBytes(account.quota_bytes) }}</p>
                  </a>
                  <div class="p-1">
                    <a href="#/profile" class="menu-item"><Icon name="user" :size="16" />Profile & settings</a>
                    <button class="menu-item" @click="showKeys = true"><Icon name="keyboard" :size="16" />Keyboard shortcuts<span class="kbd ml-auto">?</span></button>
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
            <MediaLibrary v-else-if="route.tab === 'videos'" key="videos" kind="videos" />
            <MediaLibrary v-else-if="route.tab === 'books'" key="books" kind="books" />
            <Music v-else-if="route.tab === 'music'" key="music" />
            <ChatVoice v-else-if="route.tab === 'chat'" key="chat" />
            <Profile v-else-if="route.tab === 'profile'" key="profile" />
            <AdminPanel v-else-if="route.tab === 'admin' && session.role === 'admin'" key="admin" />
          </Transition>
        </div>
        <footer v-if="route.tab !== 'chat'" class="hidden md:flex w-full max-w-[1500px] mx-auto mt-auto px-8 pb-6 pt-2 items-center justify-between">
          <MadeBy :version="appInfo.version" />
          <button class="text-[11.5px] text-faint hover:text-muted flex items-center gap-1.5" @click="showKeys = true"><Icon name="keyboard" :size="13" />Shortcuts <span class="kbd !h-[18px] !min-w-[18px] !text-[10.5px]">?</span></button>
        </footer>
      </main>

      <!-- Mobile bottom nav -->
      <nav class="md:hidden fixed bottom-0 inset-x-0 z-[160] h-[60px] border-t border-line glass grid grid-cols-6" aria-label="Sections">
        <a v-for="t in mobileTabs" :key="t.id" :href="'#/' + t.id"
           class="flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium relative transition-colors"
           :class="route.tab === t.id ? 'text-accent' : 'text-muted'">
          <span v-if="route.tab === t.id" class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-accent"></span>
          <Icon :name="t.icon" :size="19" />
          <span class="text-[10px]">{{ t.label }}</span>
          <span v-if="t.id === 'chat' && unread" class="absolute top-1.5 left-1/2 ml-2 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-fg text-[10px] font-semibold grid place-items-center">{{ unread }}</span>
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
      <CallOverlay />
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
    const features = [
      { label: 'Files & sharing', icon: 'folder', tint: '#E8A33D' }, { label: 'Photo albums', icon: 'images', tint: '#5fb3a1' },
      { label: 'Music player', icon: 'music', tint: '#c78bd8' }, { label: 'Videos & books', icon: 'film', tint: '#d0806b' },
      { label: 'Chat & calls', icon: 'phone', tint: '#6ea8e6' }, { label: 'Multi-user', icon: 'users', tint: '#60c798' },
    ];

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

    const visibleTabs = computed(() => TABS.filter(t => !t.admin || session.role === 'admin'));
    const mobileTabs = TABS.filter(t => !t.admin && !t.secondary);
    const mainTabs = mobileTabs;
    const userMenu = ref(false);
    // close the account menu when the page changes
    watch(() => route.tab, () => { userMenu.value = false; });
    const usedPct = computed(() => account.quota_bytes ? Math.min(100, Math.round((account.used_bytes / account.quota_bytes) * 100)) : 0);
    const unread = computed(() => totalUnread());

    const banners = computed(() => {
      const out = [];
      if (!online.value) out.push({ id: 'offline', icon: 'alert', cls: 'border-danger/40 bg-danger/[0.07]', text: 'You’re offline. Changes and uploads continue when the connection comes back.' });
      if (appInfo.updateAvailable) out.push({ id: 'update', icon: 'rotate', cls: 'border-info/40 bg-info/[0.07]', text: `AkulavBox was updated to v${appInfo.version}. Reload to get the new version.`, action: { label: 'Reload', run: () => location.reload() } });
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
      loginError.value = ''; loggingIn.value = true;
      try {
        const data = await api('/api/login', { method: 'POST', body: { ...form } });
        setSession(data.token, { weak: !!data.weak_password });
        form.password = '';
        if (!location.hash) location.hash = '#/files';
      } catch (e) {
        loginError.value = e.status === 401 ? 'Wrong username or password.' : e.message;
      } finally { loggingIn.value = false; }
    };

    const logout = () => {
      stopPlayer();
      disconnectRealtime();
      clearSession();
      forgetFolders();
      Object.assign(account, { username: '', role: '', used_bytes: 0, quota_bytes: 0, trash_bytes: 0, profile_image: null, loaded: false });
      toast('Signed out');
    };

    // Start background services whenever we have a session (also after an expired token is cleared)
    watch(() => session.token, (t, prev) => {
      if (t && !prev) { refreshAccount(); connectRealtime(); }
      else if (!t) { stopPlayer(); disconnectRealtime(); }
    }, { immediate: true });

    // Keep the chat badge in the tab title
    watch(unread, (n) => { document.title = n ? `(${n}) AkulavBox` : 'AkulavBox'; });

    return { session, route, form, login, loginError, loggingIn, showPw, capsLock, onPwKey, logout, theme, toggleTheme, visibleTabs, mobileTabs,
      account, usedPct, formatBytes, player, unread, goFolder, showTop, toTop, rt, appInfo, banners, features, showKeys, shortcuts: SHORTCUTS, mainTabs, userMenu };
  },
}).mount('#app');
