// The month at a glance: totals, the spending pace, categories, budgets and the latest transactions.
import { ref } from 'vue';
import { store, useApi, openTransaction, chartTheme } from '../store.js';
import { changePct, dateLabel, money, money0, monthLabel, shiftMonth, thisMonth, pct } from '../format.js';
import { CategoryIcon } from '../icons.js';
import { RouterLink } from '../router.js';
import { BarChart, PaceChart, Donut } from '../charts.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const MAX_SLICES = 7;

export const MonthPicker = {
  props: { modelValue: { type: String, required: true } },
  emits: ['update:modelValue'],
  computed: {
    isCurrent() {
      return this.modelValue === thisMonth();
    },
    label() {
      return monthLabel(this.modelValue, 'MMMM yyyy');
    },
  },
  methods: {
    shift(d) {
      this.$emit('update:modelValue', shiftMonth(this.modelValue, d));
    },
  },
  template: /*html*/ `
    <div class="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
      <button type="button" @click="shift(-1)" class="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Previous month"><Icon name="chevron-left" /></button>
      <span class="min-w-[110px] text-center text-sm font-semibold">{{ label }}</span>
      <button type="button" @click="shift(1)" :disabled="isCurrent" class="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Next month"><Icon name="chevron-right" /></button>
    </div>`,
};

const Stat = {
  props: { icon: String, label: String, value: String, accent: { type: String, default: 'var(--brand)' } },
  template: /*html*/ `
    <div class="card animate-in flex flex-col gap-3 p-5">
      <div class="flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <span class="flex h-7 w-7 items-center justify-center rounded-lg" :style="{ backgroundColor: 'color-mix(in srgb, ' + accent + ' 14%, transparent)', color: accent }">
          <Icon :name="icon" :size="15" :stroke="2.2" />
        </span>
        {{ label }}
      </div>
      <div class="num font-display text-[26px] font-extrabold leading-none tracking-tight">{{ value }}</div>
      <div class="min-h-[20px]"><slot /></div>
    </div>`,
};

/** One transaction in a list */
export const TxRow = {
  components: { CategoryIcon },
  props: { t: { type: Object, required: true }, currency: String },
  computed: {
    income() {
      return this.t.kind === 'income';
    },
    sub() {
      const t = this.t;
      return `${t.category?.name ?? 'Uncategorized'} · ${dateLabel(t.date, 'd MMM')}${t.note ? ` · ${t.note}` : ''}`;
    },
  },
  methods: { money },
  template: /*html*/ `
    <button type="button" class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-2">
      <CategoryIcon :icon="t.category?.icon ?? 'tag'" :color="t.category?.color ?? '#9ca3af'" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold">{{ t.payee || t.category?.name || 'Transaction' }}</div>
        <div class="truncate text-xs text-ink-3">{{ sub }}</div>
      </div>
      <div class="text-right">
        <div :class="['num text-sm font-semibold', income ? 'text-brand' : '']">{{ income ? '+' : '−' }}{{ money(t.amount, t.currency) }}</div>
        <div v-if="t.currency !== currency" class="num text-[11px] text-ink-3">≈ {{ money(t.amountBase, currency) }}</div>
      </div>
    </button>`,
};

export default {
  components: { MonthPicker, Stat, TxRow, CategoryIcon, RouterLink, BarChart, PaceChart, Donut },
  setup() {
    const month = ref(thisMonth());
    const overview = useApi(() => `/stats/overview?month=${month.value}`);
    const trend = useApi(() => `/stats/trend?months=12&month=${month.value}`);
    return { store, month, overview, trend, greeting: greeting() };
  },
  computed: {
    ct: () => chartTheme.value,
    data() {
      return this.overview.data;
    },
    cur() {
      return this.data?.currency ?? store.user.baseCurrency;
    },
    firstName: () => store.user.name.split(' ')[0],
    t() {
      return this.data.totals;
    },
    budgetLeft() {
      return this.t.budget - this.t.spent;
    },
    net() {
      return this.t.income - this.t.spent;
    },
    empty() {
      return this.t.count === 0 && this.t.income === 0 && !this.data.recent.length;
    },
    monthName() {
      return monthLabel(this.month, 'MMMM');
    },
    prevName() {
      return monthLabel(shiftMonth(this.month, -1), 'MMMM');
    },
    spentDelta() {
      return changePct(this.t.spent, this.data.isCurrent ? this.t.prevSpentToDate : this.t.prevSpent);
    },
    /** The biggest categories, the rest folded into "Other" */
    slices() {
      const spent = (this.data?.byCategory ?? []).filter((c) => c.spent > 0);
      if (spent.length <= MAX_SLICES) return spent;
      const rest = spent.slice(MAX_SLICES - 1);
      return [...spent.slice(0, MAX_SLICES - 1), { id: 'other', name: `Other (${rest.length})`, color: '#9aa3a0', spent: rest.reduce((a, c) => a + c.spent, 0) }];
    },
    budgets() {
      return (this.data?.byCategory ?? []).filter((c) => c.budget > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget).slice(0, 6);
    },
    trendSeries() {
      return [
        { key: 'spent', name: 'Spending', color: this.ct.spend },
        { key: 'income', name: 'Income', color: this.ct.income },
      ];
    },
  },
  methods: {
    money,
    money0,
    pct,
    monthShort: (m) => monthLabel(m, 'MMM'),
    monthLong: (m) => monthLabel(m, 'MMMM yyyy'),
    add: () => openTransaction(),
    edit: (tx) => openTransaction({ ...tx, categoryId: tx.category?.id ?? null }),
  },
  template: /*html*/ `
    <div v-if="!data" class="space-y-6">
      <Skeleton class="h-10 w-64" />
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Skeleton v-for="i in 4" :key="i" class="h-36" /></div>
      <Skeleton class="h-80" />
    </div>
    <div v-else class="space-y-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-sm text-ink-3">{{ greeting }},</p>
          <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{{ firstName }} 👋</h1>
        </div>
        <div class="flex items-center gap-2">
          <MonthPicker v-model="month" />
          <Btn icon="plus" @click="add" class="!hidden sm:!inline-flex">Add</Btn>
        </div>
      </div>

      <Card v-if="empty">
        <EmptyState icon="receipt" title="Your dashboard is waiting" message="Add your first expense and Florin will start drawing your spending picture.">
          <Btn icon="plus" @click="add">Add first transaction</Btn>
        </EmptyState>
      </Card>
      <template v-else>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon="wallet" :label="'Spent in ' + monthName" :value="money(t.spent, cur)" :accent="ct.spend">
            <Delta :value="spentDelta" :suffix="data.isCurrent ? 'vs same point last month' : 'vs previous month'" />
          </Stat>
          <Stat icon="target" label="Budget left" :value="t.budget ? money(budgetLeft, cur) : '—'" :accent="budgetLeft < 0 ? 'var(--danger)' : 'var(--brand)'">
            <div v-if="t.budget" class="space-y-1.5">
              <ProgressBar :value="t.spent" :max="t.budget" color="var(--brand)" />
              <div class="text-xs text-ink-3">{{ pct((t.spent / t.budget) * 100) }} of {{ money0(t.budget, cur) }} used</div>
            </div>
            <RouterLink v-else to="/categories" class="text-xs font-medium text-brand hover:underline">Set monthly budgets →</RouterLink>
          </Stat>
          <Stat icon="calendar-days" label="Daily average" :value="money(t.dailyAvg, cur)" accent="var(--gold)">
            <span class="text-xs text-ink-3">
              <template v-if="data.isCurrent">On track for <span class="num font-semibold text-ink-2">{{ money0(t.projected, cur) }}</span> this month</template>
              <template v-else>{{ t.count }} expenses this month</template>
            </span>
          </Stat>
          <Stat icon="trending-up" label="Net this month" :value="(net >= 0 ? '+' : '−') + money(Math.abs(net), cur)" :accent="net >= 0 ? ct.income : 'var(--danger)'">
            <span class="text-xs text-ink-3">
              <span class="num font-semibold text-ink-2">{{ money(t.income, cur) }}</span> income
              <template v-if="t.income > 0"> · saved {{ pct(Math.max(0, (net / t.income) * 100)) }}</template>
            </span>
          </Stat>
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
          <Card class="xl:col-span-2" title="Spending pace" subtitle="Cumulative spending this month compared with last month">
            <template #action><Legend :items="[{ label: monthName, color: ct.spend }, { label: prevName, color: ct.prev, dashed: true }]" /></template>
            <div class="h-[280px]"><PaceChart :rows="data.daily" :current="monthName" :previous="prevName" :currency="cur" /></div>
          </Card>

          <Card title="Where it went" :subtitle="monthName + ' by category'">
            <template v-if="slices.length">
              <div class="relative mx-auto h-[190px] w-[190px]">
                <Donut :slices="slices" :currency="cur" />
                <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-[11px] font-medium uppercase tracking-wide text-ink-3">Total</span>
                  <span class="num font-display text-lg font-extrabold">{{ money0(t.spent, cur) }}</span>
                </div>
              </div>
              <ul class="mt-4 space-y-2">
                <li v-for="s in slices" :key="s.id ?? 'none'" class="flex items-center gap-2 text-sm">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-sm" :style="{ backgroundColor: s.color }"></span>
                  <span class="min-w-0 flex-1 truncate text-ink-2">{{ s.name }}</span>
                  <span class="num text-xs text-ink-3">{{ pct((s.spent / t.spent) * 100) }}</span>
                  <span class="num w-20 text-right font-semibold">{{ money0(s.spent, cur) }}</span>
                </li>
              </ul>
            </template>
            <EmptyState v-else title="No expenses yet" message="Nothing spent this month." />
          </Card>
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
          <Card class="xl:col-span-2" title="Last 12 months" subtitle="Monthly spending and income">
            <template #action><Legend :items="[{ label: 'Spending', color: ct.spend }, { label: 'Income', color: ct.income }]" /></template>
            <div class="h-[260px]">
              <BarChart v-if="trend.data" :rows="trend.data.months" x="month" :series="trendSeries" :x-label="monthShort" :tip-label="monthLong" :currency="cur" />
            </div>
          </Card>

          <Card title="Budgets" subtitle="Monthly limits by category">
            <template #action><RouterLink to="/categories" class="text-xs font-semibold text-brand hover:underline">Manage</RouterLink></template>
            <ul v-if="budgets.length" class="space-y-4">
              <li v-for="c in budgets" :key="c.id">
                <div class="mb-1.5 flex items-center gap-2 text-sm">
                  <CategoryIcon :icon="c.icon" :color="c.color" size="sm" />
                  <span class="flex-1 truncate font-medium">{{ c.name }}</span>
                  <Badge v-if="c.spent > c.budget" tone="danger"><Icon name="alert-triangle" :size="11" /> Over</Badge>
                  <span class="num text-xs text-ink-3"><span class="font-semibold text-ink">{{ money0(c.spent, cur) }}</span> / {{ money0(c.budget, cur) }}</span>
                </div>
                <ProgressBar :value="c.spent" :max="c.budget" :color="c.color" />
              </li>
            </ul>
            <EmptyState v-else icon="target" title="No budgets set" message="Give categories a monthly limit to track them here." />
          </Card>
        </div>

        <Card title="Recent transactions" body-class="px-3 pb-3 pt-2">
          <template #action><RouterLink to="/transactions" class="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">View all <Icon name="arrow-right" :size="13" /></RouterLink></template>
          <div class="grid gap-x-4 md:grid-cols-2">
            <TxRow v-for="tx in data.recent" :key="tx.id" :t="tx" :currency="cur" @click="edit(tx)" />
          </div>
        </Card>
      </template>
    </div>`,
};
