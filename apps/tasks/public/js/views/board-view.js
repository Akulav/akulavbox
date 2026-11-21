// The board layout: To do and Done as columns. Drag a card into Done to tick it off (or back to reopen it),
// or within To do to reorder (with manual order).
import { store, taskById, updateTask, toggleDone, reorderTasks } from '../store.js';
import { sortTasks } from '../views.js';
import { drag, start, end, draggedId, overRow, overTarget, leave, dropClass, reordered } from '../dnd.js';
import { TaskCheck } from '../components/checkbox.js';
import { TaskMeta } from '../components/task-row.js';
import { QuickAdd } from '../components/quick-add.js';

const COLUMNS = [
  { status: 'todo', label: 'To do', icon: 'circle', color: 'var(--text-3)' },
  { status: 'done', label: 'Done', icon: 'circle-check', color: '#22a06b' },
];
const STEP = 100;
const DONE_SHOWN = 50;

export const BoardView = {
  components: { TaskCheck, TaskMeta, QuickAdd },
  props: { view: Object, tasks: Array, sort: String, done: { type: Array, default: () => [] } },
  data: () => ({ limit: STEP }),
  setup: () => ({ store, drag, dropClass, STEP }),
  computed: {
    columns() {
      return COLUMNS.map((c) => {
        const tasks = c.status === 'done' ? this.done : sortTasks(this.tasks.filter((t) => t.status === c.status), this.sort);
        // a long column shows its first cards and more on request, so a big list stays quick
        return { ...c, tasks, shown: tasks.slice(0, c.status === 'done' ? DONE_SHOWN : this.limit) };
      });
    },
  },
  watch: {
    'view.key'() {
      this.limit = STEP;
    },
  },
  methods: {
    open(t) {
      store.selectedId = t.id;
    },
    startDrag(e, t) {
      start(e, t);
    },
    end,
    leave,
    overCard(e, t, col) {
      if (this.sort === 'manual' && col.status !== 'done' && drag.id !== t.id) overRow(e, `card:${t.id}`);
      else overTarget(e, `col:${col.status}`);
    },
    overCol(e, col) {
      if (drag.over?.startsWith?.('card:')) return;
      overTarget(e, `col:${col.status}`);
    },
    async drop(e, col, target) {
      const id = draggedId(e);
      const where = drag.where;
      end();
      const task = id && taskById(id);
      if (!task) return;
      e.preventDefault();
      if (col.status === 'done') {
        if (task.status !== 'done') toggleDone(task);
        return;
      }
      if (task.status !== col.status) await updateTask(task, { status: col.status });
      if (target && where !== 'into' && this.sort === 'manual') reorderTasks(reordered(col.tasks.map((t) => t.id), id, target, where));
    },
  },
  template: /*html*/ `
    <!-- wide screens: the columns fill the window and each scrolls by itself -->
    <div class="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0 lg:h-full">
      <div class="grid min-w-[560px] grid-cols-2 gap-4 lg:h-full">
        <section v-for="col in columns" :key="col.status" @dragover="overCol($event, col)" @dragleave="leave($event, 'col:' + col.status)" @drop="drop($event, col)"
          :class="['flex min-h-[320px] flex-col rounded-2xl bg-surface-2/60 p-2.5 transition lg:min-h-0', dropClass('col:' + col.status)]">
          <header class="mb-2 flex shrink-0 items-center gap-2 px-1.5 pt-1">
            <Icon :name="col.icon" :size="15" :style="{ color: col.color }" />
            <h2 class="font-display text-[14px] font-semibold text-ink">{{ col.label }}</h2>
            <span class="num rounded-md bg-surface px-1.5 text-xs text-ink-3">{{ col.status === 'done' && view.kind === 'list' ? view.list.done : col.tasks.length }}</span>
          </header>
          <div class="scrollbar-thin -mx-1 flex-1 space-y-2 px-1 pb-1 lg:min-h-0 lg:overflow-y-auto">
            <article v-for="t in col.shown" :key="t.id" draggable="true" @dragstart="startDrag($event, t)" @dragend="end"
              @dragover.stop="overCard($event, t, col)" @dragleave="leave($event, 'card:' + t.id)" @drop.stop="drop($event, col, t.id)" @click="open(t)"
              :class="['card cursor-pointer select-none p-3 transition hover:shadow-md', store.selectedId === t.id ? '!border-brand' : '', drag.id === t.id ? 'dragging' : '', dropClass('card:' + t.id), t.status === 'done' ? 'row-done row-complete' : '', store.leaving[t.id] ? 'row-done' : '', store.arrived[t.id] ? 'row-arrive' : '']">
              <div class="flex items-start gap-2.5">
                <TaskCheck :task="t" :size="20" class="-mt-px" />
                <div class="min-w-0 flex-1">
                  <div class="title text-[14px] leading-snug text-ink">{{ t.title }}</div>
                  <TaskMeta :task="t" :show-list="view.kind !== 'list'" compact />
                </div>
                <Icon v-if="t.flagged" name="flag" :size="13" class="mt-0.5 text-danger" />
              </div>
            </article>
            <button v-if="col.status !== 'done' && col.tasks.length > col.shown.length" type="button" @click="limit += STEP" class="w-full rounded-xl px-3 py-2 text-[13px] font-medium text-ink-3 hover:bg-surface hover:text-brand">Show {{ Math.min(STEP, col.tasks.length - col.shown.length) }} more of {{ col.tasks.length - col.shown.length }}</button>
          </div>
          <div v-if="col.status !== 'done'" class="mt-2 shrink-0"><QuickAdd compact :defaults="{ ...view.defaults, status: col.status }" placeholder="Add a card" /></div>
        </section>
      </div>
    </div>`,
};
