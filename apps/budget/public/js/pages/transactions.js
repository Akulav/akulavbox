// Every transaction: search, filters, date ranges, CSV export and "load more".
import { api, API, qs } from '../api.js';
import { store, openTransaction } from '../store.js';
import { dateLabel, money, monthStart, monthEnd, yearStart, todayISO } from '../format.js';
import { TxRow } from './dashboard.js';

const PRESETS = {
  month: () => [monthStart(0), monthEnd(0)],
  last: () => [monthStart(1), monthEnd(1)],
  '3m': () => [monthStart(2), todayISO()],
  year: () => [yearStart(), todayISO()],
  all: () => ['', ''],
};
const PRESET_LABELS = { month: 'This month', last: 'Last month', '3m': 'Last 3 months', year: 'This year', all: 'All time', custom: 'Custom range' };
const PAGE = 60;

export default {
  components: { TxRow },
  data: () => ({
    store,
    PRESET_LABELS,
    preset: 'month',
    range: PRESETS.month(),
    q: '',
    debouncedQ: '',
    kind: '',
    category: '',
    currency: '',
    sort: 'date_desc',
    data: null,
    loadingMore: false,
  }),
  computed: {
    filters() {
      return { from: this.range[0], to: this.range[1], q: this.debouncedQ, kind: this.kind, category: this.category, currency: this.currency, sort: this.sort };
    },
    hasFilters() {
      return Boolean(this.q || this.kind || this.category || this.currency);
    },
    cur() {
      return this.data?.currency ?? store.user.baseCurrency;
    },
    categories() {
      return store.categories.filter((c) => !this.kind || c.kind === this.kind);
    },
    /** By day when sorted by date, with each day's net */
    groups() {
      if (!this.data) return [];
      if (!this.sort.startsWith('date')) return [{ key: 'all', items: this.data.items }];
      const map = new Map();
      for (const t of this.data.items) {
        if (!map.has(t.date)) map.set(t.date, []);
        map.get(t.date).push(t);
      }
      return [...map.entries()].map(([date, items]) => ({
        key: date,
        label: dateLabel(date, 'EEEE, d MMMM yyyy'),
        items,
        net: items.reduce((a, t) => a + (t.kind === 'income' ? t.amountBase : -t.amountBase), 0),
      }));
    },
    summary() {
      return [
        ['Transactions', this.data.total.toLocaleString(), ''],
        ['Spent', money(this.data.totals.spent, this.cur), ''],
        ['Income', money(this.data.totals.income, this.cur), 'text-brand'],
      ];
    },
  },
  watch: {
    q(v) {
      clearTimeout(this.qTimer);
      this.qTimer = setTimeout(() => (this.debouncedQ = v), 250);
    },
    preset(p) {
      if (p !== 'custom') this.range = PRESETS[p]();
    },
    filters: { handler: 'load', deep: true },
    'store.version': 'load',
  },
  created() {
    this.load();
  },
  unmounted() {
    clearTimeout(this.qTimer);
  },
  methods: {
    money,
    async load() {
      const mine = (this.seq = (this.seq || 0) + 1);
      try {
        const d = await api.get(`/transactions${qs({ ...this.filters, limit: PAGE })}`);
        if (mine === this.seq) this.data = d;
      } catch {
        /* keep what is shown */
      }
    },
    async loadMore() {
      this.loadingMore = true;
      try {
        const d = await api.get(`/transactions${qs({ ...this.filters, limit: PAGE, offset: this.data.items.length })}`);
        this.data = { ...this.data, items: [...this.data.items, ...d.items] };
      } finally {
        this.loadingMore = false;
      }
    },
    clear() {
      this.q = '';
      this.kind = '';
      this.category = '';
      this.currency = '';
    },
    exportCsv() {
      window.location.href = `${API}/transactions/export.csv${qs(this.filters)}`;
    },
    add: () => openTransaction(),
    edit: (t) => openTransaction(t),
  },
  template: /*html*/ `
    <div>
      <PageHeader title="Transactions" subtitle="Every expense and income, searchable and filterable.">
        <Btn variant="secondary" icon="download" @click="exportCsv">Export CSV</Btn>
        <Btn icon="plus" @click="add">Add transaction</Btn>
      </PageHeader>

      <div class="card mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div class="relative min-w-[220px] flex-1">
          <Icon name="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input class="input has-icon" placeholder="Search payee, note or category…" v-model="q" aria-label="Search" />
        </div>
        <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select class="input sm:!w-auto" v-model="preset" aria-label="Date range">
            <option v-for="(v, k) in PRESET_LABELS" :key="k" :value="k">{{ v }}</option>
          </select>
          <select class="input sm:!w-auto" v-model="kind" aria-label="Type">
            <option value="">All types</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
          </select>
          <select class="input sm:!w-auto" v-model="category" aria-label="Category">
            <option value="">All categories</option>
            <option v-for="c in categories" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
            <option value="none">Uncategorized</option>
          </select>
          <select class="input sm:!w-auto" v-model="currency" aria-label="Currency">
            <option value="">All currencies</option>
            <option v-for="c in store.currencies" :key="c.code" :value="c.code">{{ c.code }}</option>
          </select>
          <select class="input sm:!w-auto" v-model="sort" aria-label="Sort">
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest first</option>
            <option value="amount_asc">Smallest first</option>
          </select>
        </div>
        <div v-if="preset === 'custom'" class="flex items-center gap-2">
          <input type="date" class="input" v-model="range[0]" aria-label="From" />
          <span class="text-ink-3">–</span>
          <input type="date" class="input" v-model="range[1]" aria-label="To" />
        </div>
        <Btn v-if="hasFilters" variant="ghost" size="sm" icon="x" @click="clear">Clear</Btn>
      </div>

      <div v-if="data" class="mb-4 grid grid-cols-3 gap-3">
        <div v-for="[label, value, cls] in summary" :key="label" class="card px-4 py-3">
          <div class="text-xs text-ink-3">{{ label }}</div>
          <div :class="['num mt-0.5 truncate font-display text-lg font-extrabold', cls]">{{ value }}</div>
        </div>
      </div>

      <Card body-class="p-2 sm:p-3">
        <div v-if="!data" class="space-y-2 p-2"><Skeleton v-for="i in 8" :key="i" class="h-12" /></div>
        <EmptyState v-else-if="!data.items.length" icon="receipt"
          :title="hasFilters ? 'No matching transactions' : 'No transactions in this period'"
          :message="hasFilters ? 'Try a different search or clear the filters.' : 'Add one, or pick a wider date range.'">
          <Btn v-if="!hasFilters" icon="plus" @click="add">Add transaction</Btn>
        </EmptyState>
        <template v-else>
          <div v-for="g in groups" :key="g.key" class="mb-1">
            <div v-if="g.label" class="flex items-center justify-between px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
              <span>{{ g.label }}</span>
              <span class="num normal-case tracking-normal">{{ g.net >= 0 ? '+' : '−' }}{{ money(Math.abs(g.net), cur) }}</span>
            </div>
            <TxRow v-for="t in g.items" :key="t.id" :t="t" :currency="cur" @click="edit(t)" />
          </div>
          <div v-if="data.items.length < data.total" class="flex justify-center p-3">
            <Btn variant="secondary" @click="loadMore" :loading="loadingMore">Load more ({{ data.total - data.items.length }} remaining)</Btn>
          </div>
        </template>
      </Card>
    </div>`,
};
