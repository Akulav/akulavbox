// Florin's own administration: usage, exchange rates and the default currency. Accounts, roles and
// access to Florin are managed for every app at once in the server's Admin console (/admin).
import { api } from '../api.js';
import { store, toast, loadCurrencies, loadConfig } from '../store.js';
import { dateLabel } from '../format.js';

const OverviewTab = {
  data: () => ({ stats: null }),
  created() {
    api.get('/admin/stats').then((s) => (this.stats = s)).catch((e) => toast.error(e.message));
  },
  computed: {
    tiles() {
      const s = this.stats;
      return [
        ['users', 'People using Florin', `${s.users}`, 'accounts that opened it'],
        ['receipt', 'Transactions', s.transactions.toLocaleString(), `${s.categories} categories`],
        ['database', 'Database', `${(s.dbSize / 1024 / 1024).toFixed(2)} MB`, 'SQLite'],
      ];
    },
  },
  methods: { openConsole: () => (window.location.href = '/admin') },
  template: /*html*/ `
    <div class="space-y-5">
      <div v-if="stats" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="[icon, label, value, sub] in tiles" :key="label" class="card p-4">
          <div class="flex items-center gap-2 text-xs font-medium text-ink-3"><Icon :name="icon" :size="14" /> {{ label }}</div>
          <div class="num mt-2 font-display text-[22px] font-extrabold leading-none">{{ value }}</div>
          <div class="mt-1.5 text-xs text-ink-3">{{ sub }}</div>
        </div>
      </div>
      <Card title="Accounts" subtitle="Who can use Florin, roles and passwords are managed for every app in the Admin console.">
        <Btn variant="secondary" icon="external-link" @click="openConsole">Open the Admin console</Btn>
      </Card>
    </div>`,
};

const RatesTab = {
  data: () => ({ store, busy: false, edits: {} }),
  methods: {
    dateLabel,
    changed(c) {
      return this.edits[c.code] !== undefined && this.edits[c.code] !== String(c.rate);
    },
    async refresh() {
      this.busy = true;
      try {
        const r = await api.post('/admin/rates/refresh');
        await loadCurrencies();
        toast.success(`Updated ${r.updated} rates from ${r.source}`);
      } catch (err) {
        toast.error(err.message);
      } finally {
        this.busy = false;
      }
    },
    async saveRate(code) {
      try {
        await api.put(`/admin/rates/${code}`, { rate: Number(this.edits[code]) });
        await loadCurrencies();
        delete this.edits[code];
        toast.success(`${code} rate saved`);
      } catch (err) {
        toast.error(err.message);
      }
    },
  },
  template: /*html*/ `
    <Card title="Exchange rates" subtitle="Units of each currency per 1 EUR. New transactions are converted at the rate in effect when they're saved." body-class="p-0 pt-4">
      <template #action><Btn size="sm" variant="secondary" icon="refresh-cw" :loading="busy" @click="refresh">Fetch latest</Btn></template>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[560px] text-sm">
          <thead>
            <tr class="border-y border-line bg-surface-2/60 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
              <th class="px-5 py-2.5">Currency</th>
              <th class="px-3 py-2.5">Rate per EUR</th>
              <th class="px-3 py-2.5">Source</th>
              <th class="px-5 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in store.currencies" :key="c.code" class="border-b border-line last:border-0">
              <td class="px-5 py-2.5"><span class="font-semibold">{{ c.code }}</span> <span class="text-ink-3">{{ c.name }}</span></td>
              <td class="px-3 py-2">
                <span v-if="c.code === 'EUR'" class="num text-ink-3">1 (reference)</span>
                <div v-else class="flex items-center gap-2">
                  <input class="input num !h-8 !w-32" inputmode="decimal" :value="edits[c.code] ?? String(c.rate)" @input="edits[c.code] = $event.target.value"
                    @keydown.enter="edits[c.code] !== undefined && saveRate(c.code)" :aria-label="c.code + ' rate'" />
                  <Btn v-if="changed(c)" size="sm" @click="saveRate(c.code)">Save</Btn>
                </div>
              </td>
              <td class="px-3 py-2.5 text-ink-3">{{ c.source }}</td>
              <td class="px-5 py-2.5 text-ink-3">{{ dateLabel(c.updatedAt?.slice(0, 10)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>`,
};

const SettingsTab = {
  data: () => ({ store, s: null }),
  created() {
    api.get('/admin/settings').then((s) => (this.s = s)).catch((e) => toast.error(e.message));
  },
  methods: {
    async update(patch) {
      try {
        this.s = await api.patch('/admin/settings', patch);
        loadConfig();
        toast.success('Settings saved');
      } catch (err) {
        toast.error(err.message);
      }
    },
  },
  template: /*html*/ `
    <Card v-if="s" title="Application settings">
      <div class="divide-y divide-line">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="text-sm font-semibold">Default currency</div>
            <div class="text-xs text-ink-3">Pre-selected for new accounts.</div>
          </div>
          <select class="input sm:!w-60" :value="s.defaultCurrency" @change="update({ defaultCurrency: $event.target.value })">
            <option v-for="c in store.currencies" :key="c.code" :value="c.code">{{ c.code }} — {{ c.name }}</option>
          </select>
        </div>
      </div>
    </Card>`,
};

export default {
  components: { OverviewTab, RatesTab, SettingsTab },
  data: () => ({
    tab: 'overview',
    tabs: [
      { value: 'overview', label: 'Overview' },
      { value: 'rates', label: 'Exchange rates' },
      { value: 'settings', label: 'Settings' },
    ],
  }),
  template: /*html*/ `
    <div>
      <PageHeader title="Administration" subtitle="Exchange rates and Florin settings.">
        <Segmented v-model="tab" :options="tabs" />
      </PageHeader>
      <OverviewTab v-if="tab === 'overview'" />
      <RatesTab v-else-if="tab === 'rates'" />
      <SettingsTab v-else />
    </div>`,
};
