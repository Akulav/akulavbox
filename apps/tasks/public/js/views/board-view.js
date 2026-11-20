// The board layout: To do, In progress and Done as columns. Drag a card to another column to change
// its status (into Done ticks it off), or within one to reorder (with manual order).
import { store, taskById, updateTask, toggleDone, reorderTasks } from '../store.js';
import { sortTasks } from '../views.js';
import { drag, start, end, draggedId, overRow, overTarget, leave, dropClass, reordered } from '../dnd.js';
import { TaskCheck } from '../components/checkbox.js';
import { TaskMeta } from '../components/task-row.js';
import { QuickAdd } from '../components/quick-add.js';

const COLUMNS = [
  { status: 'todo', label: 'To do', icon: 'circle', color: 'var(--text-3)' },
  { status: 'doing', label: 'In progress', icon: 'circle-dot', color: 'var(--brand)' },
  { status: 'done', label: 'Done', icon: 'circle-check', color: '#22a06b' },
];

export const BoardView = {
  components: { TaskCheck, TaskMeta, QuickAdd },
  props: { view: Object, tasks: Array, sort: String, done: { type: Array, default: () => [] } },
  setup: () => ({ store, drag, dropClass }),
  computed: {
    columns() {
      return COLUMNS.map((c) => ({ ...c, tasks: c.status === 'done' ? this.done.slice(0, 50) : sortTasks(this.tasks.filter((t) => t.status === c.status), this.sort) }));
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
    <div class="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
      <div class="grid min-w-[720px] grid-cols-3 gap-4">
        <section v-for="col in columns" :key="col.status" @dragover="overCol($event, col)" @dragleave="leave($event, 'col:' + col.status)" @drop="drop($event, col)"
          :class="['flex min-h-[320px] flex-col rounded-2xl bg-surface-2/60 p-2.5 transition', dropClass('col:' + col.status)]">
          <header class="mb-2 flex items-center gap-2 px-1.5 pt-1">
            <Icon :name="col.icon" :size="15" :style="{ color: col.color }" />
            <h2 class="font-display text-[14px] font-semibold text-ink">{{ col.label }}</h2>
            <span class="num rounded-md bg-surface px-1.5 text-xs text-ink-3">{{ col.tasks.length }}</span>
          </header>
          <div class="flex-1 space-y-2">
            <article v-for="t in col.tasks" :key="t.id" draggable="true" @dragstart="startDrag($event, t)" @dragend="end"
              @dragover.stop="overCard($event, t, col)" @dragleave="leave($event, 'card:' + t.id)" @drop.stop="drop($event, col, t.id)" @click="open(t)"
              :class="['card cursor-pointer select-none p-3 transition hover:shadow-md', store.selectedId === t.id ? '!border-brand' : '', drag.id === t.id ? 'dragging' : '', dropClass('card:' + t.id), t.status === 'done' ? 'row-done opacity-70' : '', store.leaving[t.id] ? 'row-done' : '']">
              <div class="flex items-start gap-2.5">
                <TaskCheck :task="t" :size="18" class="mt-px" />
                <div class="min-w-0 flex-1">
                  <div class="title text-[14px] leading-snug text-ink">{{ t.title }}</div>
                  <TaskMeta :task="t" :show-list="view.kind !== 'list'" compact />
                </div>
                <Icon v-if="t.flagged" name="flag" :size="13" class="mt-0.5 text-danger" />
              </div>
            </article>
          </div>
          <div v-if="col.status !== 'done'" class="mt-2"><QuickAdd compact :defaults="{ ...view.defaults, status: col.status }" placeholder="Add a card" /></div>
        </section>
      </div>
    </div>`,
};
