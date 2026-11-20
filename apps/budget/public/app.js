// Florin (/budget): the page. Vue 3 with string templates and no build step, like the rest of
// AkulavBox. Signed-out visitors were already sent to /login by the server.
import { createApp } from 'vue';
import { store, loadUser, loadConfig, loadCategories, loadCurrencies, dismissToast, closeTransaction } from './js/store.js';
import { route, navigate, RouterLink } from './js/router.js';
import { UI } from '/hub/vue/ui.js';
import { LogoMark } from './js/icons.js'; // also registers Florin's icons
import { Layout } from './js/layout.js';
import { TransactionModal } from './js/tx-modal.js';
import Dashboard from './js/pages/dashboard.js';
import Transactions from './js/pages/transactions.js';
import Analytics from './js/pages/analytics.js';
import Categories from './js/pages/categories.js';
import Settings from './js/pages/settings.js';
import Admin from './js/pages/admin.js';

const PAGES = { '/': Dashboard, '/transactions': Transactions, '/analytics': Analytics, '/categories': Categories, '/settings': Settings, '/admin': Admin };

const NotFound = {
  components: { RouterLink },
  template: /*html*/ `
    <div class="flex flex-col items-center py-24 text-center">
      <div class="font-display text-6xl font-extrabold text-brand">404</div>
      <p class="mt-2 text-ink-3">This page wandered off.</p>
      <RouterLink to="/" class="mt-6 text-sm font-semibold text-brand hover:underline">Back to dashboard</RouterLink>
    </div>`,
};

const Root = {
  components: { Layout, TransactionModal, LogoMark },
  data: () => ({ store, route }),
  computed: {
    page() {
      if (this.route.path === '/admin' && store.user?.role !== 'admin') return Dashboard;
      return PAGES[this.route.path] ?? NotFound;
    },
  },
  watch: {
    // a page the account may not see goes back to the dashboard (once we know who is signed in)
    'route.path': { handler: 'guard', immediate: true },
    'store.user': 'guard',
  },
  methods: {
    dismissToast,
    closeTransaction,
    guard() {
      if (store.user && this.route.path === '/admin' && store.user.role !== 'admin') navigate('/', { replace: true });
    },
  },
  template: /*html*/ `
    <div v-if="store.user === undefined" class="flex min-h-screen items-center justify-center">
      <LogoMark :size="44" class="animate-pulse" />
    </div>
    <div v-else-if="!store.user" class="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark :size="44" />
      <p class="max-w-sm text-ink-3">{{ store.error || 'Opening the sign-in page…' }}</p>
      <a href="/" class="text-sm font-semibold text-brand hover:underline">All apps</a>
    </div>
    <Layout v-else>
      <component :is="page" :key="route.path" />
    </Layout>

    <TransactionModal v-if="store.txModal && store.user" :transaction="store.txModal.transaction" :defaults="store.txModal.defaults" @close="closeTransaction" />

    <div class="pointer-events-none fixed inset-x-0 bottom-20 z-[100] lg:bottom-4 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
      <div v-for="t in store.toasts" :key="t.id" class="animate-pop pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-lg shadow-black/5">
        <Icon v-if="t.type === 'error'" name="alert-circle" :size="18" class="text-danger" />
        <Icon v-else name="check-circle-2" :size="18" class="text-brand" />
        <span class="text-ink">{{ t.message }}</span>
        <button type="button" @click="dismissToast(t.id)" class="ml-1 text-ink-3 hover:text-ink" aria-label="Dismiss"><Icon name="x" :size="15" /></button>
      </div>
    </div>`,
};

const app = createApp(Root);
// <akb-account> is the shared account menu (hub/account.js), not a Vue component
app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('akb-');
for (const [name, c] of Object.entries(UI)) app.component(name, c);
app.mount('#app');

loadConfig();
loadCurrencies().catch(() => {});
loadUser().then(() => store.user && loadCategories().catch(() => {}));
