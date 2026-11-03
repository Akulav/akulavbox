import { createApp, ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import Icon from './components/Icon.js';
import { UiHost, UploadTray, PlayerBar, CallOverlay, Avatar } from './components/Shell.js';
import FileManager from './pages/FileManager.js';
import ChatVoice from './pages/ChatVoice.js';
import AdminPanel from './pages/AdminPanel.js';
import Profile from './pages/Profile.js';
import CustomAlbums from './pages/CustomAlbums.js';
import Music from './pages/MusicApp.js';
import MediaLibrary from './pages/MediaLibrary.js';
import { forgetFolders } from './lib/library.js';
import { session, setSession, clearSession, api, account, refreshAccount, formatBytes, storage } from './lib/api.js';
import { stop as stopPlayer, player } from './lib/player.js';
import { rt, connectRealtime, disconnectRealtime, totalUnread } from './lib/realtime.js';

const TABS = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'albums', label: 'Photos', icon: 'images' },
  { id: 'videos', label: 'Videos', icon: 'film' },
  { id: 'music', label: 'Music', icon: 'music' },
  { id: 'books', label: 'Books', icon: 'file-text' },
  { id: 'chat', label: 'Chat', icon: 'message' },
  { id: 'profile', label: 'Profile', icon: 'user', desktopOnly: true },
  { id: 'admin', label: 'Admin', icon: 'shield', admin: true },
];

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS.some(t => t.id === parts[0]) ? parts[0] : 'files';
  const args = parts.slice(1).map(decodeURIComponent);
  return { tab, arg: args[0] || null, args };
}

createApp({
  components: { Icon, UiHost, UploadTray, PlayerBar, CallOverlay, Avatar, MediaLibrary, FileManager, CustomAlbums, ChatVoice, Profile, AdminPanel, Music },
  template: /*html*/`
    <UiHost />

    <!-- ============ SIGN IN ============ -->
    <div v-if="!session.token" class="min-h-full grid place-items-center px-4 py-12">
      <div class="w-full max-w-[380px]">
        <div class="flex items-center gap-3 mb-10">
          <span class="w-11 h-11 rounded-xl bg-accent text-accent-fg grid place-items-center"><Icon name="box" :size="22" :stroke="2" /></span>
          <div>
            <h1 class="title text-2xl leading-none">AkulavBox</h1>
            <p class="text-muted text-[13px] mt-1">Your private, encrypted storage</p>
          </div>
        </div>
        <form @submit.prevent="login" class="space-y-4">
          <div>
            <label class="label" for="u">Username</label>
            <input id="u" v-model="form.username" class="input h-11" autocomplete="username" autofocus required>
          </div>
          <div>
            <label class="label" for="p">Password</label>
            <input id="p" v-model="form.password" type="password" class="input h-11" autocomplete="current-password" required>
          </div>
          <p v-if="loginError" class="text-danger text-[13px] flex items-center gap-2"><Icon name="alert" :size="15" />{{ loginError }}</p>
          <button type="submit" class="btn btn-primary w-full h-11 text-[14.5px]" :disabled="loggingIn">
            <Icon v-if="loggingIn" name="loader" :size="16" />{{ loggingIn ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <button class="btn btn-ghost btn-sm mt-8 -ml-2" @click="toggleTheme">
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />{{ theme === 'dark' ? 'Light theme' : 'Dark theme' }}
        </button>
      </div>
    </div>

    <!-- ============ APP ============ -->
    <template v-else>
      <!-- Desktop sidebar -->
      <aside class="hidden md:flex fixed inset-y-0 left-0 w-[248px] flex-col border-r border-line bg-surface z-40">
        <div class="h-16 flex items-center gap-2.5 px-5">
          <span class="w-8 h-8 rounded-lg bg-accent text-accent-fg grid place-items-center"><Icon name="box" :size="17" :stroke="2" /></span>
          <span class="title text-[19px]">AkulavBox</span>
        </div>
        <nav class="px-3 mt-2 space-y-0.5" aria-label="Sections">
          <a v-for="t in visibleTabs" :key="t.id" :href="'#/' + t.id" class="nav-item" :class="{ active: route.tab === t.id }"
             :aria-current="route.tab === t.id ? 'page' : null">
            <Icon :name="t.icon" :size="18" />
            <span class="flex-1">{{ t.label }}</span>
            <span v-if="t.id === 'chat' && unread" class="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-accent-fg text-[11px] font-semibold grid place-items-center">{{ unread }}</span>
            <span v-if="t.id === 'music' && player.playing && route.tab !== 'music'" class="flex items-end gap-[2px] h-3" aria-label="Playing">
              <span class="w-[3px] bg-accent rounded-sm animate-pulse h-2"></span><span class="w-[3px] bg-accent rounded-sm animate-pulse h-3" style="animation-delay:.2s"></span><span class="w-[3px] bg-accent rounded-sm animate-pulse h-1.5" style="animation-delay:.4s"></span>
            </span>
          </a>
        </nav>

        <div class="mt-auto p-4 space-y-4">
          <div v-if="account.loaded">
            <div class="flex items-center justify-between text-[12.5px] mb-2">
              <span class="text-muted flex items-center gap-1.5"><Icon name="hard-drive" :size="14" />Storage</span>
              <span class="tabular-nums text-muted">{{ usedPct }}%</span>
            </div>
            <div class="meter" :class="{ warn: usedPct >= 90 }"><span :style="{ width: usedPct + '%' }"></span></div>
            <p class="text-faint text-xs mt-2 tabular-nums">{{ formatBytes(account.used_bytes) }} of {{ formatBytes(account.quota_bytes) }}</p>
          </div>
          <div class="flex items-center gap-2.5 pt-3 border-t border-line">
            <Avatar :name="session.username" :src="account.profile_image" :size="32" />
            <div class="flex-1 min-w-0">
              <p class="text-[13.5px] font-medium truncate">{{ session.username }}</p>
              <p class="text-faint text-xs capitalize">{{ session.role }}</p>
            </div>
            <button class="icon-btn" @click="toggleTheme" :title="theme === 'dark' ? 'Light theme' : 'Dark theme'"><Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" /></button>
            <button class="icon-btn" @click="logout" title="Sign out"><Icon name="logout" :size="17" /></button>
          </div>
        </div>
      </aside>

      <!-- Mobile top bar -->
      <header class="md:hidden sticky top-0 z-40 h-14 flex items-center gap-2 px-4 border-b border-line bg-surface/95 backdrop-blur">
        <span class="w-7 h-7 rounded-lg bg-accent text-accent-fg grid place-items-center"><Icon name="box" :size="15" :stroke="2" /></span>
        <span class="title text-[17px] flex-1">AkulavBox</span>
        <a v-if="session.role === 'admin'" href="#/admin" class="icon-btn" :class="{ active: route.tab === 'admin' }" title="Admin"><Icon name="shield" :size="18" /></a>
        <a href="#/profile" class="ml-1 rounded-full" :class="route.tab === 'profile' ? 'ring-2 ring-accent' : ''" title="Profile"><Avatar :name="session.username" :src="account.profile_image" :size="30" /></a>
        <button class="icon-btn" @click="toggleTheme" title="Theme"><Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" /></button>
        <button class="icon-btn" @click="logout" title="Sign out"><Icon name="logout" :size="18" /></button>
      </header>

      <main class="md:pl-[248px] min-h-full" :class="player.current ? 'pb-[140px] md:pb-[96px]' : 'pb-[76px] md:pb-0'">
        <div class="max-w-[1500px] mx-auto px-4 md:px-8 py-5 md:py-8">
          <FileManager v-if="route.tab === 'files'" :folder-id="route.arg" @navigate="goFolder" />
          <CustomAlbums v-else-if="route.tab === 'albums'" :args="route.args" />
          <MediaLibrary v-else-if="route.tab === 'videos'" key="videos" kind="videos" />
          <MediaLibrary v-else-if="route.tab === 'books'" key="books" kind="books" />
          <Music v-else-if="route.tab === 'music'" />
          <ChatVoice v-else-if="route.tab === 'chat'" />
          <Profile v-else-if="route.tab === 'profile'" />
          <AdminPanel v-else-if="route.tab === 'admin' && session.role === 'admin'" />
        </div>
      </main>

      <!-- Mobile bottom nav -->
      <nav class="md:hidden fixed bottom-0 inset-x-0 z-[160] h-[60px] border-t border-line bg-surface grid grid-cols-6" aria-label="Sections">
        <a v-for="t in mobileTabs" :key="t.id" :href="'#/' + t.id"
           class="flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium relative"
           :class="route.tab === t.id ? 'text-accent' : 'text-muted'">
          <Icon :name="t.icon" :size="19" />
          <span class="text-[10px]">{{ t.label }}</span>
          <span v-if="t.id === 'chat' && unread" class="absolute top-1.5 left-1/2 ml-2 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-fg text-[10px] font-semibold grid place-items-center">{{ unread }}</span>
        </a>
      </nav>

      <Transition name="fade">
        <button v-if="showTop" class="fixed z-[140] right-4 w-10 h-10 rounded-full panel grid place-items-center text-muted hover:text-fg"
                :class="player.current ? 'bottom-[136px] md:bottom-[96px]' : 'bottom-[76px] md:bottom-6'" @click="toTop" title="Back to top" aria-label="Back to top">
          <Icon name="arrow-up" :size="18" />
        </button>
      </Transition>
      <PlayerBar />
      <UploadTray />
      <CallOverlay />
    </template>
  `,
  setup() {
    const route = reactive(parseHash());
    const form = reactive({ username: '', password: '' });
    const loginError = ref('');
    const loggingIn = ref(false);
    const theme = ref(document.documentElement.dataset.theme || 'dark');

    const onHash = () => Object.assign(route, parseHash());
    // Back-to-top button after scrolling a couple of screens
    const showTop = ref(false);
    const onScroll = () => { showTop.value = window.scrollY > window.innerHeight * 2; };
    const toTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // "/" jumps to the search box of the current page
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('[role=dialog]')) return;
      const box = document.querySelector('main input[type=search]');
      if (box) { e.preventDefault(); box.focus(); box.select(); }
    };
    onMounted(() => { window.addEventListener('hashchange', onHash); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('keydown', onKey); });
    onUnmounted(() => { window.removeEventListener('hashchange', onHash); window.removeEventListener('scroll', onScroll); window.removeEventListener('keydown', onKey); });

    const visibleTabs = computed(() => TABS.filter(t => !t.admin || session.role === 'admin'));
    const mobileTabs = TABS.filter(t => !t.admin && !t.desktopOnly);
    const usedPct = computed(() => account.quota_bytes ? Math.min(100, Math.round((account.used_bytes / account.quota_bytes) * 100)) : 0);
    const unread = computed(() => totalUnread());

    const goFolder = (id) => { location.hash = id ? `#/files/${encodeURIComponent(id)}` : '#/files'; };

    const toggleTheme = () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme.value;
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.value === 'dark' ? '#0D1518' : '#F3F5F4');
      storage.write('akulavTheme', theme.value);
    };

    const login = async () => {
      loginError.value = ''; loggingIn.value = true;
      try {
        const data = await api('/api/login', { method: 'POST', body: { ...form } });
        setSession(data.token);
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
      Object.assign(account, { username: '', role: '', used_bytes: 0, quota_bytes: 0, profile_image: null, loaded: false });
    };

    // Start background services whenever we have a session (also after an expired token is cleared)
    watch(() => session.token, (t) => {
      if (t) { refreshAccount(); connectRealtime(); }
      else { stopPlayer(); disconnectRealtime(); }
    }, { immediate: true });

    // Keep the chat badge in the tab title
    watch(unread, (n) => { document.title = n ? `(${n}) AkulavBox` : 'AkulavBox'; });

    return { session, route, form, login, loginError, loggingIn, logout, theme, toggleTheme, visibleTabs, mobileTabs,
      account, usedPct, formatBytes, player, unread, goFolder, showTop, toTop };
  },
}).mount('#app');
