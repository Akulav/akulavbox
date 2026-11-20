// The editors of the details panel: when, how often, how important, which tags.
import { store } from '../store.js';
import { addDays, startOfWeek, dayLabel, longDate, diffDays, repeatLabel, weekday } from '../dates.js';
import { tagCounts } from '../views.js';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** v-model:date and v-model:time */
export const DueEditor = {
  props: { date: String, time: String },
  emits: ['update:date', 'update:time'],
  computed: {
    presets() {
      const t = store.today;
      return [
        ['Today', t, 'sun'],
        ['Tomorrow', addDays(t, 1), 'sunrise'],
        ['Next week', addDays(startOfWeek(t, store.prefs.weekStart), 7), 'calendar-range'],
      ];
    },
    label() {
      if (!this.date) return 'No date';
      const rel = dayLabel(this.date, store.today);
      const full = longDate(this.date, store.today);
      const diff = diffDays(store.today, this.date);
      const ago = diff < -1 ? ` · ${-diff} days ago` : diff > 6 ? ` · in ${diff} days` : '';
      return (rel === full.split(',')[0] ? full : `${rel} · ${full}`) + ago;
    },
  },
  methods: {
    set(d) {
      this.$emit('update:date', d || null);
      if (!d) this.$emit('update:time', null);
    },
  },
  template: /*html*/ `
    <div class="space-y-2">
      <div class="flex flex-wrap gap-1.5">
        <button v-for="[l, d, ic] in presets" :key="l" type="button" @click="set(d)"
          :class="['inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition', date === d ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2 hover:bg-surface-2']">
          <Icon :name="ic" :size="14" />{{ l }}
        </button>
        <button v-if="date" type="button" @click="set(null)" class="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-medium text-ink-3 hover:bg-surface-2"><Icon name="x" :size="14" />Clear</button>
      </div>
      <div class="flex gap-2">
        <input type="date" class="input flex-1" :value="date || ''" @change="set($event.target.value)" aria-label="Due date" />
        <input type="time" class="input !w-32" :value="time || ''" :disabled="!date" @change="$emit('update:time', $event.target.value || null)" aria-label="Time" />
      </div>
      <p class="text-xs text-ink-3">{{ label }}</p>
    </div>`,
};

/** v-model: a repeat rule or null */
export const RepeatEditor = {
  props: { modelValue: Object, dueDate: String },
  emits: ['update:modelValue'],
  data: () => ({ custom: false, SHORT_DAYS }),
  computed: {
    preset() {
      const r = this.modelValue;
      if (!r) return 'none';
      if (this.custom) return 'custom';
      if (r.every === 1 && r.unit === 'day') return 'daily';
      if (r.every === 1 && r.unit === 'week' && r.weekdays?.join() === '1,2,3,4,5') return 'weekdays';
      if (r.every === 1 && r.unit === 'week' && !r.weekdays?.length) return 'weekly';
      if (r.every === 1 && r.unit === 'month') return 'monthly';
      if (r.every === 1 && r.unit === 'year') return 'yearly';
      return 'custom';
    },
    label() {
      return repeatLabel(this.modelValue);
    },
    order() {
      const s = store.prefs.weekStart;
      return Array.from({ length: 7 }, (_, i) => (i + s) % 7);
    },
  },
  methods: {
    pick(p) {
      this.custom = p === 'custom';
      const day = this.dueDate ? Number(this.dueDate.slice(8, 10)) : undefined;
      const rules = {
        none: null,
        daily: { every: 1, unit: 'day' },
        weekdays: { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] },
        weekly: { every: 1, unit: 'week' },
        monthly: { every: 1, unit: 'month', day },
        yearly: { every: 1, unit: 'year' },
        custom: this.modelValue || { every: 1, unit: 'week', weekdays: [weekday(this.dueDate || store.today)] },
      };
      this.$emit('update:modelValue', rules[p]);
    },
    change(fields) {
      const r = { ...(this.modelValue || { every: 1, unit: 'week' }), ...fields };
      if (r.unit !== 'week') delete r.weekdays;
      if (r.unit === 'month' && !r.day && this.dueDate) r.day = Number(this.dueDate.slice(8, 10));
      if (r.unit !== 'month') delete r.day;
      r.every = Math.min(365, Math.max(1, Number(r.every) || 1));
      this.$emit('update:modelValue', r);
    },
    toggleDay(d) {
      const set = new Set(this.modelValue?.weekdays || []);
      set.has(d) ? set.delete(d) : set.add(d);
      this.change({ unit: 'week', weekdays: [...set].sort() });
    },
  },
  template: /*html*/ `
    <div class="space-y-2">
      <select class="input" :value="preset" @change="pick($event.target.value)" aria-label="Repeat">
        <option value="none">Doesn’t repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Every weekday (Mon–Fri)</option>
        <option value="weekly">Every week</option>
        <option value="monthly">Every month</option>
        <option value="yearly">Every year</option>
        <option value="custom">Custom…</option>
      </select>
      <div v-if="preset === 'custom' && modelValue" class="space-y-2 rounded-xl bg-surface-2 p-3">
        <div class="flex items-center gap-2 text-sm text-ink-2">
          Every
          <input type="number" min="1" max="365" class="input !h-9 !w-20" :value="modelValue.every" @change="change({ every: $event.target.value })" aria-label="Every how many" />
          <select class="input !h-9 !w-auto" :value="modelValue.unit" @change="change({ unit: $event.target.value })" aria-label="Unit">
            <option value="day">{{ modelValue.every > 1 ? 'days' : 'day' }}</option>
            <option value="week">{{ modelValue.every > 1 ? 'weeks' : 'week' }}</option>
            <option value="month">{{ modelValue.every > 1 ? 'months' : 'month' }}</option>
            <option value="year">{{ modelValue.every > 1 ? 'years' : 'year' }}</option>
          </select>
        </div>
        <div v-if="modelValue.unit === 'week'" class="flex gap-1">
          <button v-for="d in order" :key="d" type="button" @click="toggleDay(d)" :aria-pressed="modelValue.weekdays?.includes(d)"
            :class="['h-8 flex-1 rounded-lg text-[12px] font-semibold transition', modelValue.weekdays?.includes(d) ? 'bg-brand text-white dark:text-[#160b2e]' : 'bg-surface text-ink-3 hover:text-ink']">{{ SHORT_DAYS[d].slice(0, 2) }}</button>
        </div>
      </div>
      <p v-if="modelValue" class="flex items-center gap-1.5 text-xs text-ink-3"><Icon name="repeat" :size="12" />{{ label }}. Ticking it off makes the next one.</p>
    </div>`,
};

const PRIORITIES = [
  [0, 'None'],
  [1, 'Low'],
  [2, 'Medium'],
  [3, 'High'],
];
export const PriorityPicker = {
  props: { modelValue: Number },
  emits: ['update:modelValue'],
  data: () => ({ PRIORITIES }),
  template: /*html*/ `
    <div class="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2 p-0.5" role="radiogroup" aria-label="Priority">
      <button v-for="[p, l] in PRIORITIES" :key="p" type="button" role="radio" :aria-checked="modelValue === p" @click="$emit('update:modelValue', p)"
        :class="['flex items-center justify-center gap-1.5 rounded-[10px] py-1.5 text-[13px] font-medium transition', modelValue === p ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink']">
        <Icon name="flag" :size="13" :style="{ color: 'var(--p' + p + ')' }" />{{ l }}
      </button>
    </div>`,
};

/** v-model: an array of tags. Enter, comma or space adds one; Backspace on an empty box removes the last. */
export const TagInput = {
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  data: () => ({ text: '' }),
  computed: {
    suggestions() {
      const q = this.text.replace(/^#/, '').toLowerCase();
      const have = new Set(this.modelValue.map((t) => t.toLowerCase()));
      return tagCounts.value.filter((t) => !have.has(t.name.toLowerCase()) && (!q || t.name.toLowerCase().startsWith(q))).slice(0, 6);
    },
  },
  methods: {
    add(t) {
      const tag = String(t || this.text).replace(/^#+/, '').trim().replace(/\s+/g, '-').slice(0, 40);
      this.text = '';
      if (!tag || this.modelValue.some((x) => x.toLowerCase() === tag.toLowerCase())) return;
      this.$emit('update:modelValue', [...this.modelValue, tag]);
    },
    remove(t) {
      this.$emit('update:modelValue', this.modelValue.filter((x) => x !== t));
    },
    key(e) {
      if (['Enter', ',', ' '].includes(e.key) && this.text.trim()) {
        e.preventDefault();
        this.add();
      } else if (e.key === 'Backspace' && !this.text && this.modelValue.length) this.remove(this.modelValue[this.modelValue.length - 1]);
    },
  },
  template: /*html*/ `
    <div>
      <div class="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[0.65rem] border border-line bg-surface px-2 py-1.5 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--ring)]">
        <span v-for="t in modelValue" :key="t" class="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-[12.5px] font-medium text-brand">
          #{{ t }}<button type="button" @click="remove(t)" :aria-label="'Remove #' + t" class="opacity-70 hover:opacity-100"><Icon name="x" :size="12" /></button>
        </span>
        <input v-model="text" @keydown="key" @blur="text.trim() && add()" placeholder="Add a tag" class="min-w-[90px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" aria-label="Add a tag" />
      </div>
      <div v-if="suggestions.length" class="mt-1.5 flex flex-wrap gap-1">
        <button v-for="s in suggestions" :key="s.name" type="button" @mousedown.prevent="add(s.name)" class="rounded-md px-1.5 py-0.5 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink">#{{ s.name }}</button>
      </div>
    </div>`,
};
