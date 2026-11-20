// e-Management: aplicația (rutele, bara de sus). Importat direct (fără import map), ca politica CSP
// să poată interzice orice script inline. Modulele sunt în js/.
import { createApp } from '/docs/vendor/vue.js';
import { store, spaceLabel, switchSpace, loadSession } from '/docs/js/state.js';
import { DialogHost, Brand, NoAccess } from '/docs/js/ui.js';
import { DocsView } from '/docs/js/documents.js';
import { CategoriesView } from '/docs/js/categories.js';
import { AuditView } from '/docs/js/audit.js';
import { SettingsView } from '/docs/js/settings.js';

// ---------- aplicația ----------
const ROUTES = [
  ['documente', 'Documente', 'DocsView'],
  ['categorii', 'Categorii', 'CategoriesView'],
  ['setari', 'Setări', 'SettingsView'],
  ['jurnal', 'Jurnal', 'AuditView'],
];

const App = {
  components: { NoAccess, Brand, DialogHost, DocsView, CategoriesView, SettingsView, AuditView },
  computed: {
    store: () => store,
    nav: () => ROUTES,
    view() {
      const item = ROUTES.find((n) => n[0] === store.route);
      return item ? item[2] : 'DocsView';
    },
    // culoarea spațiului, și pentru meniul contului
    accent: () => (store.space === 'work' ? '#0f766e' : '#2563eb'),
    pageClass() {
      return { wide: this.view === 'CategoriesView', fit: this.view === 'SettingsView' };
    },
    title() {
      const item = store.me && ROUTES.find((n) => n[2] === this.view);
      return (item ? item[1] + ' · ' + spaceLabel() + ' · ' : '') + 'e-Management';
    },
  },
  methods: { switchSpace },
  watch: {
    // titlul ferestrei arată pagina și spațiul curent
    title: {
      handler(t) {
        document.title = t;
      },
      immediate: true,
    },
    'store.space': {
      handler(v) {
        document.documentElement.dataset.space = v;
      },
      immediate: true,
    },
  },
  template: /*html*/ `
    <template v-if="store.ready">
      <NoAccess v-if="!store.me" />
      <template v-else>
        <header class="topbar">
          <div class="topbar-in">
            <Brand />
            <div class="seg space-switch" role="group" aria-label="Spațiul de stocare">
              <button v-for="s in store.me.stores" :key="s.key" type="button" :class="{ on: store.space === s.key }" :aria-pressed="store.space === s.key" @click="switchSpace(s.key)">{{ s.label }}</button>
            </div>
            <nav class="nav">
              <a v-for="n in nav" :key="n[0]" :href="'#' + n[0]" :class="{ on: view === n[2] }">{{ n[1] }}</a>
            </nav>
            <!-- meniul contului, comun tuturor aplicațiilor (hub/account.js), cu poza din AkulavBox -->
            <div class="userbox"><akb-account :accent="accent" :username="store.me.username" :role="store.me.role"></akb-account></div>
          </div>
        </header>
        <main class="page" :class="pageClass"><component :is="view" /></main>
      </template>
    </template>
    <div v-else class="boot" aria-live="polite"><span class="spinner"></span>Se încarcă…</div>
    <DialogHost />
    <div v-if="store.toast" class="toast" :class="{ err: store.toast.err }" :role="store.toast.err ? 'alert' : 'status'" @click="store.toast = null">{{ store.toast.msg }}</div>`,
};

const app = createApp(App);
// <akb-account> este meniul comun al contului (hub/account.js), nu o componentă Vue
app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('akb-');
app.mount('#app');
loadSession();
