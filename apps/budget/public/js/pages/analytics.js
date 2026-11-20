// Patterns over a few months: by category, weekday, day (a heatmap), payee and currency.
import { ref, computed } from 'vue';
import { qs } from '../api.js';
import { store, useApi, openTransaction, chartTheme, isDark } from '../store.js';
import { dateLabel, money, money0, monthLabel, pct, monthStart, yearStart, todayISO, eachDay, isoDate } from '../format.js';
import { CategoryIcon } from '../icons.js';
import { BarChart } from '../charts.js';

const RANGES = {
  '3m': () => [monthStart(2), todayISO()],
  '6m': () => [monthStart(5), todayISO()],
  '12m': () => [monthStart(11), todayISO()],
  ytd: () => [yearStart(), todayISO()],
};
const RANGE_OPTIONS = [
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '12m', label: '12M' },
  { value: 'ytd', label: 'YTD' },
];
const MAX_STACK = 7;

const Kpi = {
  props: { icon: String, label: String, value: String, sub: String },
  template: /*html*/ `
    <div class="card animate-in p-4">
      <div class="flex items-center gap-2 text-xs font-medium text-ink-3"><Icon :name="icon" :size="14" /> {{ label }}</div>
      <div class="num mt-2 font-display text-[22px] font-extrabold leading-none">{{ value }}</div>
      <div v-if="sub" class="mt-1.5 text-xs text-ink-3">{{ sub }}</div>
    </div>`,
};

// Sequential single-hue ramp (light → dark), with the zero bucket receding to the surface.
const HEAT_LIGHT = ['var(--surface-2)', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const HEAT_DARK = ['var(--surface-2)', '#14304f', '#184f95', '#2a78d6', '#5598e7', '#9ec5f4'];

/** One square per day, Monday first, a column per week */
const Heatmap = {
  props: { from: String, to: String, daily: Array, currency: String },
  computed: {
    ramp: () => (isDark.value ? HEAT_DARK : HEAT_LIGHT),
    grid() {
      const map = Object.fromEntries(this.daily.map((d) => [d.date, d.spent]));
      const days = eachDay(this.from, this.to);
      const values = days.map((d) => map[isoDate(d)] ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
      // Cap the scale at the 95th percentile so one rent payment doesn't wash everything out.
      const cap = values.length ? values[Math.floor(values.length * 0.95)] : 1;
      const bucket = (v) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / cap) * 5)));
      const weeks = [];
      let week = Array(7).fill(null);
      for (const d of days) {
        const wd = (d.getDay() + 6) % 7;
        const date = isoDate(d);
        const value = map[date] ?? 0;
        week[wd] = { date, color: this.ramp[bucket(value)], title: `${dateLabel(date, 'EEE d MMM yyyy')}: ${money(value, this.currency)}` };
        if (wd === 6) {
          weeks.push(week);
          week = Array(7).fill(null);
        }
      }
      if (week.some(Boolean)) weeks.push(week);
      return weeks;
    },
  },
  data: () => ({ labels: ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] }),
  template: /*html*/ `
    <div>
      <div class="scrollbar-thin overflow-x-auto pb-2">
        <div class="flex gap-[3px]">
          <div class="mr-1 flex flex-col gap-[3px] text-[10px] text-ink-3">
            <div v-for="(l, i) in labels" :key="i" class="flex h-4 items-center">{{ l }}</div>
          </div>
          <div v-for="(w, i) in grid" :key="i" class="flex flex-col gap-[3px]">
            <template v-for="(d, j) in w" :key="j">
              <div v-if="d" class="h-4 w-4 rounded-[3px] transition hover:ring-2 hover:ring-ink-3" :style="{ backgroundColor: d.color }" :title="d.title"></div>
              <div v-else class="h-4 w-4"></div>
            </template>
          </div>
        </div>
      </div>
      <div class="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-3">
        Less
        <span v-for="c in ramp" :key="c" class="h-[11px] w-[11px] rounded-[3px]" :style="{ backgroundColor: c }"></span>
        More
      </div>
    </div>`,
};

export default {
  components: { Kpi, Heatmap, CategoryIcon, BarChart },
  setup() {
    const rangeKey = ref('6m');
    const range = computed(() => RANGES[rangeKey.value]());
    const res = useApi(() => `/stats/analytics${qs({ from: range.value[0], to: range.value[1] })}`);
    return { store, rangeKey, range, res, RANGE_OPTIONS };
  },
  computed: {
    ct: () => chartTheme.value,
    data() {
      return this.res.data;
    },
    cur() {
      return this.data?.currency ?? store.user.baseCurrency;
    },
    totals() {
      return this.data.totals;
    },
    /** Everything beyond the top categories folded into "Other" for the stacked chart */
    stack() {
      if (!this.data) return { keys: [], rows: [] };
      const cats = this.data.categories;
      const head = cats.slice(0, MAX_STACK - 1);
      const tail = cats.slice(MAX_STACK - 1);
      const useOther = tail.length > 1;
      const keys = useOther ? [...head, { key: 'other', name: `Other (${tail.length})`, color: '#9aa3a0' }] : cats;
      const rows = this.data.monthly.map((m) => {
        const row = { month: m.month };
        for (const k of head) row[k.key] = m[k.key] ?? 0;
        if (useOther) row.other = tail.reduce((a, k) => a + (m[k.key] ?? 0), 0);
        else for (const k of tail) row[k.key] = m[k.key] ?? 0;
        return row;
      });
      return { keys, rows };
    },
    legend() {
      return this.stack.keys.map((k) => ({ label: k.name, color: k.color }));
    },
    peak() {
      return Math.max(...this.data.weekday.map((x) => x.average));
    },
    busiestDay() {
      return [...this.data.weekday].sort((a, b) => b.average - a.average)[0].day;
    },
    perDaySub() {
      return `${dateLabel(this.range[0], 'd MMM')} – ${dateLabel(this.range[1], 'd MMM yyyy')}`;
    },
    netSub() {
      return `Net ${this.totals.net >= 0 ? '+' : '−'}${money0(Math.abs(this.totals.net), this.cur)}`;
    },
  },
  methods: {
    money,
    money0,
    pct,
    dateLabel,
    monthShort: (m) => monthLabel(m, 'MMM yy'),
    monthLong: (m) => monthLabel(m, 'MMMM yyyy'),
    weekdayColor(row) {
      return row.average === this.peak ? this.ct.spend : this.ct.muted;
    },
    open: (t) => openTransaction({ ...t, kind: 'expense', categoryId: t.category?.id ?? null }),
  },
  template: /*html*/ `
    <div>
      <PageHeader title="Analytics" subtitle="Patterns and trends in your spending.">
        <Segmented v-model="rangeKey" :options="RANGE_OPTIONS" />
      </PageHeader>

      <div v-if="res.loading && !data" class="grid gap-4"><Skeleton class="h-24" /><Skeleton class="h-80" /></div>
      <Card v-else-if="!data || totals.count === 0">
        <EmptyState icon="bar-chart-3" title="Not enough data yet" message="Add some expenses and come back to see your patterns." />
      </Card>
      <div v-else class="space-y-4">
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi icon="wallet" label="Total spent" :value="money0(totals.spent, cur)" :sub="totals.count + ' expenses'" />
          <Kpi icon="calendar-days" label="Per day" :value="money(totals.perDay, cur)" :sub="perDaySub" />
          <Kpi icon="piggy-bank" label="Savings rate" :value="totals.savingsRate === null ? '—' : pct(totals.savingsRate, 1)" :sub="netSub" />
          <Kpi icon="receipt" label="Average expense" :value="money(totals.average, cur)" />
        </div>

        <Card title="Monthly spending by category" subtitle="Stacked by category">
          <template #action><Legend :items="legend" /></template>
          <div class="h-[320px]">
            <BarChart :rows="stack.rows" x="month" :series="stack.keys" stacked hide-zero :max-bar="48" :gap="0.28" :x-label="monthShort" :tip-label="monthLong" :currency="cur" />
          </div>
        </Card>

        <div class="grid gap-4 lg:grid-cols-2">
          <Card title="Category ranking" subtitle="Share of total spending">
            <ul class="space-y-3">
              <li v-for="c in data.categories" :key="c.key" class="flex items-center gap-3">
                <CategoryIcon :icon="c.icon" :color="c.color" size="sm" />
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span class="truncate font-medium">{{ c.name }}</span>
                    <span class="num shrink-0 font-semibold">{{ money0(c.spent, cur) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div class="h-full rounded-full" :style="{ width: (c.spent / totals.spent) * 100 + '%', backgroundColor: c.color }"></div>
                    </div>
                    <span class="num w-10 text-right text-xs text-ink-3">{{ pct((c.spent / totals.spent) * 100) }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </Card>

          <Card title="Spending by weekday" subtitle="Average spent on each day of the week">
            <div class="h-[260px]">
              <BarChart :rows="data.weekday" x="day" :series="[{ key: 'average', name: 'Average', color: ct.muted }]" :bar-color="weekdayColor" :max-bar="36" :gap="0.1" :currency="cur" />
            </div>
            <p class="mt-2 text-xs text-ink-3">Your biggest spending day is <span class="font-semibold text-ink-2">{{ busiestDay }}</span>.</p>
          </Card>
        </div>

        <Card title="Daily spending" subtitle="Each square is a day — stronger colour means more spent">
          <Heatmap :from="range[0]" :to="range[1]" :daily="data.daily" :currency="cur" />
        </Card>

        <div class="grid gap-4 lg:grid-cols-3">
          <Card title="Top payees">
            <ol v-if="data.topPayees.length" class="space-y-2.5">
              <li v-for="(p, i) in data.topPayees" :key="p.name" class="flex items-center gap-3 text-sm">
                <span class="num flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-xs font-semibold text-ink-3">{{ i + 1 }}</span>
                <span class="min-w-0 flex-1 truncate font-medium">{{ p.name }}</span>
                <span class="text-xs text-ink-3">{{ p.count }}×</span>
                <span class="num w-20 text-right font-semibold">{{ money0(p.spent, cur) }}</span>
              </li>
            </ol>
            <p v-else class="text-sm text-ink-3">Add payees to your expenses to see them here.</p>
          </Card>

          <Card title="By currency" :subtitle="'Converted to ' + cur">
            <ul class="space-y-3">
              <li v-for="c in data.byCurrency" :key="c.code" class="flex items-center gap-3 text-sm">
                <span class="flex h-9 w-12 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold">{{ c.code }}</span>
                <div class="min-w-0 flex-1">
                  <div class="num font-semibold">{{ money(c.original, c.code) }}</div>
                  <div class="text-xs text-ink-3">{{ c.count }} transactions</div>
                </div>
                <div class="text-right">
                  <div class="num font-semibold">{{ money0(c.spent, cur) }}</div>
                  <div class="num text-xs text-ink-3">{{ pct((c.spent / totals.spent) * 100) }}</div>
                </div>
              </li>
            </ul>
          </Card>

          <Card title="Largest expenses">
            <ul class="space-y-1">
              <li v-for="t in data.largest" :key="t.id">
                <button type="button" @click="open(t)" class="flex w-full items-center gap-3 rounded-lg p-1.5 text-left text-sm hover:bg-surface-2">
                  <CategoryIcon :icon="t.category?.icon ?? 'tag'" :color="t.category?.color ?? '#9ca3af'" size="sm" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium">{{ t.payee || t.category?.name || 'Expense' }}</div>
                    <div class="text-xs text-ink-3">{{ dateLabel(t.date) }}</div>
                  </div>
                  <span class="num font-semibold">{{ money0(t.amountBase, cur) }}</span>
                </button>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>`,
};
