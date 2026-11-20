// The box at the top of every view: type a line, see what Tasks understood as chips, press Enter.
// A task added in a view gets that view's defaults (its list, Today's date, the tag…); what the line
// says wins over them.
import { store, addTask, listById } from '../store.js';
import { parseQuick } from '../quick.js';
import { dayLabel, timeLabel, repeatLabel } from '../dates.js';

const CHIP = {
  date: ['calendar', 'text-brand'],
  time: ['clock', 'text-brand'],
  repeat: ['repeat', 'text-[#0891b2] dark:text-[#22d3ee]'],
  priority: ['flag', 'text-danger'],
  flag: ['flag', 'text-danger'],
  tag: ['hash', 'text-ink-2'],
  list: ['list', 'text-ink-2'],
};

export const QuickAdd = {
  props: { defaults: { type: Object, default: () => ({}) }, placeholder: { type: String, default: '' }, compact: Boolean },
  emits: ['added'],
  data: () => ({ text: '', smart: true, busy: false, focused: false }),
  computed: {
    parsed() {
      if (!this.smart) return null;
      return parseQuick(this.text, { lists: store.lists, today: store.today, weekStart: store.prefs.weekStart });
    },
    chips() {
      const p = this.parsed;
      if (!p || !this.text.trim()) return [];
      const out = [];
      if (p.dueDate) out.push({ type: 'date', label: dayLabel(p.dueDate, store.today) });
      if (p.dueTime) out.push({ type: 'time', label: timeLabel(p.dueTime) });
      if (p.repeat) out.push({ type: 'repeat', label: repeatLabel(p.repeat) });
      if (p.priority) out.push({ type: 'priority', label: ['', 'Low', 'Medium', 'High'][p.priority] });
      if (p.flagged) out.push({ type: 'flag', label: 'Flagged' });
      for (const t of p.tags) out.push({ type: 'tag', label: t });
      if (p.listId) out.push({ type: 'list', label: listById(p.listId)?.name });
      return out.map((c) => ({ ...c, icon: CHIP[c.type][0], cls: CHIP[c.type][1] }));
    },
    where() {
      const d = this.defaults;
      if (this.parsed?.listId) return '';
      if (d.listId) return listById(d.listId)?.name || '';
      return '';
    },
    hint() {
      return this.placeholder || 'Add a task… try “Pay rent every month #home !high”';
    },
  },
  watch: {
    'store.quickFocus'() {
      if (!this.compact) this.$refs.input?.focus();
    },
  },
  setup: () => ({ store }),
  methods: {
    async submit() {
      const text = this.text.trim();
      if (!text || this.busy) return;
      const p = this.parsed;
      const d = this.defaults;
      const fields = p
        ? {
            title: p.title,
            listId: p.listId ?? d.listId ?? null,
            dueDate: p.dueDate ?? d.dueDate ?? null,
            dueTime: p.dueTime,
            priority: p.priority || d.priority || 0,
            flagged: p.flagged || Boolean(d.flagged),
            tags: [...new Set([...(d.tags || []), ...p.tags])],
            repeat: p.repeat,
            status: d.status,
          }
        : { title: text, ...d };
      this.busy = true;
      const task = await addTask(fields);
      this.busy = false;
      if (task) {
        this.text = '';
        this.$emit('added', task);
      }
    },
  },
  template: /*html*/ `
    <form @submit.prevent="submit" :class="['rounded-2xl border bg-surface transition', focused ? 'border-brand shadow-[0_0_0_3px_var(--ring)]' : 'border-line', compact ? 'p-1' : 'p-1.5']">
      <div class="flex items-center gap-2">
        <span :class="['grid shrink-0 place-items-center rounded-xl text-brand', compact ? 'h-7 w-7' : 'h-9 w-9 bg-brand-soft']"><Icon :name="busy ? 'loader-2' : 'plus'" :size="compact ? 15 : 18" :class="busy ? 'animate-spin' : ''" /></span>
        <input ref="input" v-model="text" :placeholder="hint" maxlength="500" @focus="focused = true" @blur="focused = false" @keydown.esc="text = ''; $event.target.blur()"
          :class="['min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3', compact ? 'h-7 text-[13px]' : 'h-9 text-[15px]']" aria-label="New task" />
        <button v-if="!compact" type="button" @click="smart = !smart" :aria-pressed="smart" :title="smart ? 'Smart: dates, #tags, !priority, @list and repeats are read from the text. Click to add it as written.' : 'Add the text as written. Click to read dates, tags and the rest from it.'"
          :class="['grid h-8 w-8 shrink-0 place-items-center rounded-lg transition', smart ? 'text-brand hover:bg-brand-soft' : 'text-ink-3 hover:bg-surface-2']">
          <Icon name="sparkles" :size="16" />
        </button>
        <Btn v-if="!compact && text.trim()" type="submit" size="sm" :loading="busy">Add</Btn>
      </div>
      <div v-if="chips.length || where" class="flex flex-wrap items-center gap-1.5 px-2 pb-1 pt-1.5">
        <span v-for="(c, i) in chips" :key="i" :class="['inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-[12px] font-medium', c.cls]">
          <Icon :name="c.icon" :size="12" />{{ c.label }}
        </span>
        <span v-if="where" class="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[12px] text-ink-3"><Icon name="list" :size="12" />in {{ where }}</span>
      </div>
    </form>`,
};
