// The calendar layout: a month of days with the view's tasks on them (done ones faded). Drag a task
// to another day, or from "No date" below onto one; click a day's + to add a task on it.
import { store, taskById, updateTask, doneBetween } from '../store.js';
import { sortTasks } from '../views.js';
import { addDays, addMonths, startOfWeek, startOfMonth, parseISO, timeLabel, MONTHS, DAYS } from '../dates.js';
import { drag, start, end, draggedId, overTarget, leave, dropClass } from '../dnd.js';
import { QuickAdd } from '../components/quick-add.js';

const MAX_PER_DAY = 4;
// wide screens fit the whole month in the window, so a day holds as many tasks as its cell has room for
const WIDE = window.matchMedia('(min-width: 1024px)');
const PILL = 24; // a task's line with the gap above it
const CELL_CHROME = 30; // the day's number row and the cell's padding (the compact ones of wide screens)

export const CalendarView = {
  components: { QuickAdd },
  props: { view: Object, tasks: Array },
  data: () => ({ month: startOfMonth(store.today), doneInMonth: [], adding: null, expanded: null, fit: MAX_PER_DAY }),
  setup: () => ({ store, drag, dropClass }),
  computed: {
    title() {
      const d = parseISO(this.month);
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    },
    first() {
      return startOfWeek(this.month, store.prefs.weekStart);
    },
    days() {
      const end = addDays(startOfWeek(addDays(addMonths(this.month, 1), -1), store.prefs.weekStart), 6);
      const out = [];
      for (let d = this.first; d <= end; d = addDays(d, 1)) out.push(d);
      return out;
    },
    heads() {
      return Array.from({ length: 7 }, (_, i) => DAYS[(i + store.prefs.weekStart) % 7].slice(0, 3));
    },
    byDay() {
      const m = {};
      const doneIds = new Set(this.doneInMonth.map((t) => t.id));
      const all = [...sortTasks(this.tasks.filter((t) => t.dueDate), 'due'), ...this.doneInMonth.filter((t) => this.view.filter(t) && !this.tasks.some((x) => x.id === t.id))];
      for (const t of all) (m[t.dueDate] ||= []).push(t);
      for (const k of Object.keys(m)) m[k].sort((a, b) => doneIds.has(a.id) - doneIds.has(b.id));
      return m;
    },
    undated() {
      return this.tasks.filter((t) => !t.dueDate);
    },
  },
  watch: {
    month: { handler: 'loadDone', immediate: true },
    'store.done.total': 'loadDone',
    'days.length'() {
      this.$nextTick(this.measure);
    },
  },
  mounted() {
    this.sizer = new ResizeObserver(() => this.measure());
    this.sizer.observe(this.$refs.grid);
    WIDE.addEventListener('change', this.measure);
  },
  unmounted() {
    this.sizer.disconnect();
    WIDE.removeEventListener('change', this.measure);
  },
  methods: {
    timeLabel,
    measure() {
      if (!WIDE.matches || !this.$refs.grid) return (this.fit = MAX_PER_DAY);
      const cell = this.$refs.grid.clientHeight / (this.days.length / 7);
      this.fit = Math.max(1, Math.floor((cell - CELL_CHROME + 4) / PILL));
    },
    /** the line under a day's shown tasks: "+2 more", or "3 tasks" when the cell has room for none */
    moreLabel(d) {
      return this.room(d) ? `+${this.more(d)} more` : `${this.more(d)} tasks`;
    },
    async loadDone() {
      try {
        this.doneInMonth = await doneBetween(this.days[0], this.days[this.days.length - 1]);
      } catch {
        this.doneInMonth = [];
      }
    },
    shift(n) {
      this.month = startOfMonth(addMonths(this.month, n));
    },
    goToday() {
      this.month = startOfMonth(store.today);
    },
    inMonth(d) {
      return d.slice(0, 7) === this.month.slice(0, 7);
    },
    /** how many of a day's tasks fit: all of them, or one less to leave room for "+n more" */
    room(d) {
      const n = this.byDay[d]?.length || 0;
      return n <= this.fit ? n : this.fit - 1;
    },
    shown(d) {
      const list = this.byDay[d] || [];
      return this.expanded === d ? list : list.slice(0, this.room(d));
    },
    more(d) {
      return Math.max(0, (this.byDay[d]?.length || 0) - this.room(d));
    },
    pill(t) {
      const list = t.listId ? store.lists.find((l) => l.id === t.listId) : null;
      return { '--c': list?.color || `var(--p${t.priority})` };
    },
    open(t) {
      store.selectedId = t.id;
    },
    startDrag(e, t) {
      if (t.status !== 'done') start(e, t);
      else e.preventDefault();
    },
    end,
    leave,
    over(e, d) {
      overTarget(e, `day:${d}`);
    },
    drop(e, d) {
      const id = draggedId(e);
      end();
      const t = id && taskById(id);
      if (!t) return;
      e.preventDefault();
      if (t.dueDate !== d) updateTask(t, { dueDate: d });
    },
  },
  template: /*html*/ `
    <div class="lg:flex lg:h-full lg:flex-col">
      <div class="mb-3 flex shrink-0 items-center gap-2">
        <h2 class="font-display text-lg font-semibold text-ink">{{ title }}</h2>
        <span class="flex-1"></span>
        <Btn size="sm" variant="secondary" @click="goToday">Today</Btn>
        <div class="flex rounded-xl border border-line bg-surface p-0.5">
          <IconButton icon="chevron-left" label="Previous month" @click="shift(-1)" />
          <IconButton icon="chevron-right" label="Next month" @click="shift(1)" />
        </div>
      </div>

      <div class="overflow-hidden rounded-2xl border border-line bg-surface lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div class="cal shrink-0 border-b border-line bg-surface-2/60">
          <div v-for="h in heads" :key="h" class="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3">{{ h }}</div>
        </div>
        <div ref="grid" class="cal cal-fill lg:min-h-0 lg:flex-1">
          <div v-for="(d, i) in days" :key="d" @dragover="over($event, d)" @dragleave="leave($event, 'day:' + d)" @drop="drop($event, d)"
            :class="['cal-day group relative border-line p-1.5 transition lg:p-1', i % 7 ? 'border-l' : '', i >= 7 ? 'border-t' : '', inMonth(d) ? '' : 'bg-surface-2/40', expanded === d ? 'cal-open' : '', dropClass('day:' + d)]">
            <div class="mb-1 flex shrink-0 items-center justify-between lg:mb-0.5">
              <span :class="['num grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-semibold lg:h-5 lg:min-w-5', d === store.today ? 'bg-brand text-white dark:text-[#160b2e]' : inMonth(d) ? 'text-ink-2' : 'text-ink-3/60']">{{ Number(d.slice(8)) }}</span>
              <button type="button" @click="adding = adding === d ? null : d" class="rounded-md p-0.5 text-ink-3 opacity-0 transition hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus:opacity-100" :aria-label="'Add a task on ' + d"><Icon name="plus" :size="14" /></button>
            </div>
            <div class="cal-tasks space-y-1">
              <button v-for="t in shown(d)" :key="t.id" type="button" draggable="true" @dragstart="startDrag($event, t)" @dragend="end" @click="open(t)" :style="pill(t)"
                :class="['flex w-full items-center gap-1.5 truncate rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[12px] leading-snug transition hover:brightness-95', t.status === 'done' ? 'text-ink-3 line-through opacity-60' : 'text-ink', store.selectedId === t.id ? 'ring-1 ring-brand' : '', drag.id === t.id ? 'dragging' : '']"
                style="border-left-color: var(--c); background: color-mix(in srgb, var(--c) 13%, transparent)">
                <span class="truncate"><span v-if="t.dueTime" class="num text-ink-3">{{ timeLabel(t.dueTime) }} </span>{{ t.title }}</span>
              </button>
              <button v-if="more(d) && expanded !== d" type="button" @click="expanded = d" class="w-full truncate rounded-md px-1.5 text-left text-[11.5px] font-medium leading-4 text-ink-3 hover:text-ink">{{ moreLabel(d) }}</button>
            </div>
            <div v-if="adding === d" class="absolute inset-x-1 top-8 z-10"><QuickAdd compact :defaults="{ ...view.defaults, dueDate: d }" placeholder="New task" @added="adding = null" /></div>
          </div>
        </div>
      </div>

      <section v-if="undated.length" class="mt-4 shrink-0 lg:mt-3">
        <h3 class="mb-2 text-[13px] font-medium text-ink-2 lg:mb-1.5">No date <span class="num text-ink-3">{{ undated.length }}</span> <span class="font-normal text-ink-3">· drag one onto a day to plan it</span></h3>
        <div class="scrollbar-thin flex flex-wrap gap-1.5 lg:max-h-[30px] lg:overflow-y-auto">
          <button v-for="t in undated" :key="t.id" type="button" draggable="true" @dragstart="startDrag($event, t)" @dragend="end" @click="open(t)" :style="pill(t)"
            :class="['max-w-[240px] truncate rounded-lg border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink hover:border-brand', drag.id === t.id ? 'dragging' : '']">{{ t.title }}</button>
        </div>
      </section>
    </div>`,
};
