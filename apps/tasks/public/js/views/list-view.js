// The list layout: tasks in groups (by day in Upcoming, by due date, priority, list or status when
// chosen), each group with a small box to add to it. With manual order, drag rows to reorder;
// dropping into another group gives the task that group's date, priority, list or status.
import { store, updateTask, reorderTasks } from '../store.js';
import { groupTasks } from '../views.js';
import { drag, draggedId, overTarget, leave, end, dropClass, reordered } from '../dnd.js';
import { TaskRow } from '../components/task-row.js';
import { QuickAdd } from '../components/quick-add.js';

export const ListView = {
  components: { TaskRow, QuickAdd },
  props: { view: Object, tasks: Array, groupBy: String, sort: String, done: { type: Array, default: () => [] } },
  data: () => ({ adding: null, showDone: doneOpen(), doneLimit: DONE_STEP, limit: ROW_STEP, folded: {} }),
  setup: () => ({ store, dropClass, ROW_STEP }),
  computed: {
    groups() {
      // a group with nothing in it only shows when it is a day to plan (Upcoming)
      return groupTasks(this.tasks, this.groupBy, this.view).filter((g) => g.tasks.length || g.day);
    },
    /** what is drawn: a big list draws its first rows and more as it scrolls (rows of folded groups
     *  don't count), so thousands of tasks stay quick */
    visible() {
      let left = this.limit;
      const out = [];
      for (const g of this.groups) {
        if (left <= 0) break;
        const rows = this.folded[g.key] ? [] : g.tasks.slice(0, left);
        left -= rows.length;
        out.push({ ...g, rows });
      }
      return out;
    },
    hidden() {
      const drawn = this.visible.reduce((n, g) => n + g.rows.length, 0);
      return this.groups.reduce((n, g) => n + (this.folded[g.key] ? 0 : g.tasks.length), 0) - drawn;
    },
    doneShown() {
      return this.done.slice(0, this.doneLimit);
    },
    flat() {
      return this.groups.flatMap((g) => g.tasks.map((t) => t.id));
    },
    showList() {
      return this.view.kind !== 'list';
    },
    sortable() {
      return this.sort === 'manual';
    },
    titled() {
      return this.groups.length > 1 || Boolean(this.groups[0]?.label);
    },
  },
  methods: {
    /** dropped on a row: a new place in the order, and the group's defaults */
    dropOnRow(group, { target, where }) {
      const id = drag.id;
      if (!id || id === target) return;
      this.moveInto(group, id);
      reorderTasks(reordered(this.flat, id, target, where));
    },
    /** dropped on a group's header or its empty space */
    dropOnGroup(e, group) {
      const id = draggedId(e);
      end();
      if (!id) return;
      e.preventDefault();
      this.moveInto(group, id);
    },
    moveInto(group, id) {
      const task = store.tasks.find((t) => t.id === id);
      if (!task || !group.defaults) return;
      const fields = {};
      for (const [k, v] of Object.entries(group.defaults)) if (JSON.stringify(task[k] ?? null) !== JSON.stringify(v ?? null)) fields[k] = v;
      if (Object.keys(fields).length) updateTask(task, fields);
    },
    watchMore() {
      this.seer?.disconnect();
      if (!this.$refs.more) return;
      this.seer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && this.showMore(), { rootMargin: '400px' });
      this.seer.observe(this.$refs.more);
    },
    leave,
    over(e, key) {
      overTarget(e, key);
    },
    fold(g) {
      this.folded = { ...this.folded, [g.key]: !this.folded[g.key] };
      if (!this.folded[g.key]) delete this.folded[g.key];
      try {
        const keys = Object.keys(this.folded);
        if (keys.length) localStorage.setItem(`tasks.fold.${this.view.key}`, JSON.stringify(keys));
        else localStorage.removeItem(`tasks.fold.${this.view.key}`);
      } catch {
        /* storage unavailable */
      }
    },
    loadFolded() {
      try {
        this.folded = Object.fromEntries(JSON.parse(localStorage.getItem(`tasks.fold.${this.view.key}`) || '[]').map((k) => [k, true]));
      } catch {
        this.folded = {};
      }
    },
    showMore() {
      this.limit += ROW_STEP;
    },
    toggleDone() {
      this.showDone = !this.showDone;
      try {
        localStorage.setItem('tasks.doneOpen', this.showDone ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    },
  },
  watch: {
    'view.key'() {
      this.doneLimit = DONE_STEP;
      this.limit = ROW_STEP;
      this.loadFolded();
    },
    // the marker under the drawn rows draws the next ones when it scrolls into sight
    hidden(n) {
      if (n > 0) this.$nextTick(this.watchMore);
    },
  },
  created() {
    this.loadFolded();
  },
  mounted() {
    this.watchMore();
  },
  unmounted() {
    this.seer?.disconnect();
  },
  template: /*html*/ `
    <div class="space-y-6">
      <section v-for="g in visible" :key="g.key" @dragover="g.defaults && over($event, 'group:' + g.key)" @dragleave="leave($event, 'group:' + g.key)" @drop="g.defaults && dropOnGroup($event, g)"
        :class="['rounded-2xl transition', dropClass('group:' + g.key)]">
        <!-- a group folds away (remembered per view on this device), to keep a long list short -->
        <header v-if="titled" class="group mb-1 flex items-center gap-2 border-b border-line px-1 pb-2">
          <button type="button" @click="fold(g)" :aria-expanded="!folded[g.key]" class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-surface-2">
            <Icon name="chevron-down" :size="14" :class="['shrink-0 text-ink-3 transition', folded[g.key] ? '-rotate-90' : '']" />
            <span v-if="g.color" class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: g.color }"></span>
            <Icon v-if="g.priority !== undefined" name="flag" :size="14" :style="{ color: 'var(--p' + g.priority + ')' }" />
            <h2 :class="['truncate font-display text-[15px] font-semibold', g.tone === 'overdue' ? 'text-danger' : 'text-ink']">{{ g.label }}</h2>
            <span v-if="g.sub && g.sub !== g.label" class="shrink-0 text-[12.5px] text-ink-3">{{ g.sub }}</span>
            <span class="num shrink-0 text-xs text-ink-3">{{ g.tasks.length || '' }}</span>
          </button>
          <span class="flex-1"></span>
          <button v-if="g.defaults" type="button" @click="adding = adding === g.key ? null : g.key" class="rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus:opacity-100" :aria-label="'Add to ' + g.label"><Icon name="plus" :size="15" /></button>
        </header>
        <div v-if="!folded[g.key]" class="space-y-px">
          <TaskRow v-for="t in g.rows" :key="t.id" :task="t" :show-list="showList" :sortable="sortable" @drop-on="dropOnRow(g, $event)" />
        </div>
        <p v-if="!g.tasks.length && g.day && !folded[g.key]" class="px-2.5 py-2 text-[13px] text-ink-3">Nothing planned.</p>
        <div v-if="adding === g.key" class="mt-2 px-1"><QuickAdd compact :defaults="{ ...view.defaults, ...g.defaults }" placeholder="Add a task here" /></div>
      </section>

      <button v-if="hidden > 0" ref="more" type="button" @click="showMore" class="w-full rounded-xl px-3 py-2 text-[13px] font-medium text-ink-3 hover:bg-surface-2 hover:text-brand">Show {{ Math.min(hidden, ROW_STEP) }} more of {{ hidden }}</button>

      <!-- what's done stays in sight below the open tasks, quieter, with the newest first -->
      <section v-if="done.length && hidden <= 0" class="done-part">
        <button type="button" @click="toggleDone" :aria-expanded="showDone" class="group mb-1 flex w-full items-center gap-2 border-b border-line px-2.5 pb-2 text-left">
          <span class="grid h-5 w-5 place-items-center rounded-full bg-[#22a06b]/15 text-[#22a06b]"><Icon name="check" :size="12" :stroke="3" /></span>
          <h2 class="font-display text-[15px] font-semibold text-ink-2 group-hover:text-ink">Completed</h2>
          <span class="num text-xs text-ink-3">{{ done.length }}</span>
          <span class="flex-1"></span>
          <Icon name="chevron-down" :size="15" :class="['text-ink-3 transition', showDone ? '' : '-rotate-90']" />
        </button>
        <div v-if="showDone" class="space-y-px">
          <TaskRow v-for="t in doneShown" :key="t.id" :task="t" :show-list="showList" />
          <button v-if="done.length > doneLimit" type="button" @click="doneLimit += 50" class="px-2.5 py-2 text-[13px] font-medium text-ink-3 hover:text-brand">Show {{ Math.min(50, done.length - doneLimit) }} more</button>
        </div>
      </section>
    </div>`,
};

const DONE_STEP = 10;
const ROW_STEP = 150;
/** Completed is open unless it was folded on this device */
function doneOpen() {
  try {
    return localStorage.getItem('tasks.doneOpen') !== '0';
  } catch {
    return true;
  }
}
