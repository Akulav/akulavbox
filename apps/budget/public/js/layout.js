// The frame around every page: the sidebar (a drawer on phones), the theme switch and the account.
import { watchEffect } from 'vue';
import { store, openTransaction } from './store.js';
import { RouterLink, route } from './router.js';
import { Logo } from './icons.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'layout-dashboard', end: true },
  { to: '/transactions', label: 'Transactions', icon: 'arrow-left-right' },
  { to: '/analytics', label: 'Analytics', icon: 'pie-chart' },
  { to: '/categories', label: 'Categories & budgets', icon: 'shapes' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];
// The browser tab says where you are, like every app ("Transactions · Florin")
const PAGES = [...NAV, { to: '/admin', label: 'Admin' }];
watchEffect(() => {
  const p = PAGES.find((n) => (n.end ? route.path === n.to : route.path === n.to || route.path.startsWith(`${n.to}/`)));
  document.title = p ? `${p.label} · Florin` : 'Florin';
});

const THEMES = [
  { v: 'light', icon: 'sun', label: 'Light' },
  { v: 'system', icon: 'monitor', label: 'System' },
  { v: 'dark', icon: 'moon', label: 'Dark' },
];

const Sidebar = {
  components: { RouterLink, Logo },
  emits: ['navigate'],
  data: () => ({ store, THEMES }),
  computed: {
    nav() {
      return store.user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin', icon: 'shield-check' }] : NAV;
    },
  },
  methods: {
    add() {
      openTransaction();
      this.$emit('navigate');
    },
  },
  template: /*html*/ `
    <div class="flex h-full flex-col gap-6 p-4">
      <div class="px-2 pt-1"><Logo /></div>
      <Btn icon="plus" size="lg" class="w-full" @click="add">Add transaction</Btn>
      <nav class="flex flex-col gap-0.5">
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" :end="n.end" @navigate="$emit('navigate')"
          class="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
          active-class="bg-brand-soft text-brand-strong" inactive-class="text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Icon :name="n.icon" :size="18" />
          {{ n.label }}
        </RouterLink>
      </nav>
      <div class="mt-auto flex flex-col gap-3">
        <div class="flex rounded-xl border border-line bg-surface-2 p-0.5">
          <button v-for="t in THEMES" :key="t.v" type="button" @click="store.themePref = t.v" :aria-label="t.label + ' theme'" :title="t.label + ' theme'"
            :class="['flex h-7 flex-1 items-center justify-center rounded-[10px] transition', store.themePref === t.v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink']">
            <Icon :name="t.icon" :size="14" />
          </button>
        </div>
        <div class="border-t border-line pt-3">
          <!-- the account menu every app shares (hub/account.js), with the AkulavBox profile picture -->
          <akb-account expanded up no-theme accent="#1baf7a" :username="store.user?.username" :role="store.user?.role"></akb-account>
        </div>
        <div class="px-2 text-[11px] text-ink-3">Florin v{{ store.config.version }}</div>
      </div>
    </div>`,
};

export const Layout = {
  components: { Sidebar, Logo },
  data: () => ({ mobileOpen: false, store }),
  mounted() {
    // "n" anywhere opens a new transaction
    this.onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      openTransaction();
    };
    document.addEventListener('keydown', this.onKey);
  },
  unmounted() {
    document.removeEventListener('keydown', this.onKey);
  },
  methods: { openTransaction: () => openTransaction() },
  template: /*html*/ `
    <div class="min-h-screen lg:pl-64">
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      <header class="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur lg:hidden">
        <button type="button" @click="mobileOpen = true" class="-ml-2 rounded-lg p-2 text-ink-2" aria-label="Open menu"><Icon name="menu" :size="20" /></button>
        <Logo :size="28" />
        <button type="button" @click="openTransaction" class="-mr-2 rounded-lg p-2 text-brand" aria-label="Add transaction"><Icon name="plus" :size="22" /></button>
      </header>

      <div v-if="mobileOpen" class="fixed inset-0 z-40 lg:hidden">
        <div class="absolute inset-0 bg-black/40" @click="mobileOpen = false"></div>
        <div class="animate-in absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface">
          <button type="button" @click="mobileOpen = false" class="absolute right-3 top-4 rounded-lg p-2 text-ink-3" aria-label="Close menu"><Icon name="x" :size="18" /></button>
          <Sidebar @navigate="mobileOpen = false" />
        </div>
      </div>

      <main class="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <slot />
      </main>
    </div>`,
};
