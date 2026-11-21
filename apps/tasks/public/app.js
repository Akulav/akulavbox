// Tasks (/tasks): the page. Vue 3 with string templates and no build step, like the rest of
// AkulavBox; the building blocks shared with the other Vue apps are in /hub/vue/.
import { createApp } from 'vue';
import { UI } from '/hub/vue/ui.js';
import { store, load, dismiss } from './js/store.js';
import { route, navigate, RouterLink } from './js/router.js';
import { SMART, counts as smartCounts } from './js/views.js';
import { Logo } from './js/icons.js'; // also registers Tasks' icons
import { Sidebar } from './js/components/sidebar.js';
import { TaskDetail } from './js/components/task-detail.js';
import { ListEditor } from './js/components/list-editor.js';
import { Settings } from './js/components/settings.js';
import { PageView } from './js/views/page.js';

const TABS = SMART.filter((v) => ['inbox', 'today', 'upcoming', 'flagged'].includes(v.id));

const Root = {
  components: { Sidebar, TaskDetail, ListEditor, Settings, PageView, Logo, RouterLink },
  data: () => ({ store, drawer: false, editing: undefined, settings: false, TABS }),
  computed: {
    counts() {
      return smartCounts.value;
    },
    editingList() {
      return this.editing !== undefined;
    },
  },
  watch: {
    'store.ready'(ready) {
      if (ready && route.path === '/') navigate(`/${store.prefs.startView}`, { replace: true });
    },
  },
  setup: () => ({ route }),
  mounted() {
    this.onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !store.user) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (typing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'n' || e.key === 'q') {
        e.preventDefault();
        store.quickFocus++;
      } else if (e.key === '/') {
        e.preventDefault();
        if (window.innerWidth < 1024) this.drawer = true;
        // the box that is on screen (the sidebar, or the drawer on phones)
        this.$nextTick(() => [...document.querySelectorAll('[data-search]')].find((el) => el.offsetParent)?.focus());
      } else if (e.key === '?') {
        this.settings = true;
      }
    };
    document.addEventListener('keydown', this.onKey);
  },
  unmounted() {
    document.removeEventListener('keydown', this.onKey);
  },
  methods: {
    dismiss,
    run(t) {
      dismiss(t.id);
      t.action.run();
    },
    addOnPhone() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      store.quickFocus++;
    },
  },
  template: /*html*/ `
    <div v-if="!store.ready" class="grid min-h-screen place-items-center"><img src="/tasks/favicon.svg" width="44" height="44" alt="" class="animate-pulse" /></div>
    <div v-else-if="!store.user" class="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <img src="/tasks/favicon.svg" width="44" height="44" alt="" />
      <p class="max-w-sm text-ink-3">{{ store.error || 'Opening the sign-in page…' }}</p>
      <a href="/" class="text-sm font-semibold text-brand hover:underline">All apps</a>
    </div>
    <!-- wide screens: the page is exactly the window; each view scrolls inside itself (page.js) -->
    <div v-else class="flex min-h-screen lg:h-screen lg:overflow-hidden">
      <aside class="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar @new-list="editing = null" @edit-list="editing = $event" @settings="settings = true" />
      </aside>

      <div v-if="drawer" class="fixed inset-0 z-40 lg:hidden">
        <div class="absolute inset-0 bg-black/40" @click="drawer = false"></div>
        <div class="animate-in absolute inset-y-0 left-0 w-80 max-w-[86vw] border-r border-line bg-surface">
          <Sidebar @navigate="drawer = false" @new-list="drawer = false; editing = null" @edit-list="drawer = false; editing = $event" @settings="drawer = false; settings = true" />
        </div>
      </div>

      <div class="flex min-w-0 flex-1 lg:h-screen">
        <main class="min-w-0 flex-1 lg:flex lg:h-full lg:flex-col">
          <!-- the account top right, like every app; phones also get the brand and the add button (the sidebar has the brand on wide screens) -->
          <header class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface/85 px-4 backdrop-blur md:px-6 lg:h-[60px]">
            <Logo :size="26" class="lg:hidden" />
            <button type="button" @click="addOnPhone" class="ml-auto rounded-lg p-2 text-brand lg:hidden" aria-label="Add a task"><Icon name="plus" :size="22" /></button>
            <span class="hidden flex-1 lg:block"></span>
            <akb-account accent="#8b5cf6" :username="store.user?.username" :role="store.user?.role"></akb-account>
          </header>
          <div class="pb-20 lg:min-h-0 lg:flex-1 lg:pb-0"><PageView @edit-list="editing = $event" /></div>
        </main>
        <TaskDetail />
      </div>

      <!-- phones: the main views in a bottom bar, one tap away; "More" opens the lists, tags and search -->
      <nav class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Views">
        <RouterLink v-for="v in TABS" :key="v.id" :to="'/' + v.id"
          class="relative flex h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors"
          active-class="text-brand" inactive-class="text-ink-3">
          <Icon :name="v.icon" :size="19" />
          <span>{{ v.name }}</span>
          <span v-if="counts[v.id]" class="absolute left-1/2 top-2 ml-2 min-w-4 rounded-full bg-brand px-1 text-center text-[9.5px] font-semibold leading-4 text-white tabular-nums">{{ counts[v.id] > 99 ? '99+' : counts[v.id] }}</span>
        </RouterLink>
        <button type="button" @click="drawer = true" class="flex h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-ink-3">
          <Icon name="menu" :size="19" /><span>More</span>
        </button>
      </nav>
    </div>

    <ListEditor v-if="editingList" :list="editing" @close="editing = undefined" />
    <Settings v-if="settings" @close="settings = false" />

    <div class="pointer-events-none fixed inset-x-0 bottom-20 z-[100] lg:bottom-4 flex flex-col items-center gap-2 px-4 sm:items-start sm:pl-6 lg:pl-[312px]" aria-live="polite">
      <div v-for="t in store.toasts" :key="t.id" class="animate-pop pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-lg shadow-black/10">
        <Icon :name="t.error ? 'circle-alert' : 'circle-check'" :size="18" :class="t.error ? 'text-danger' : 'text-brand'" />
        <span class="text-ink">{{ t.message }}</span>
        <button v-if="t.action" type="button" @click="run(t)" class="ml-1 rounded-md px-2 py-0.5 text-sm font-semibold text-brand hover:bg-brand-soft">{{ t.action.label }}</button>
        <button type="button" @click="dismiss(t.id)" class="text-ink-3 hover:text-ink" aria-label="Dismiss"><Icon name="x" :size="15" /></button>
      </div>
    </div>`,
};

const app = createApp(Root);
for (const [name, c] of Object.entries(UI)) app.component(name, c);
// <akb-account> is the shared account menu (hub/account.js), not a Vue component
app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('akb-');
app.mount('#app');
load();
