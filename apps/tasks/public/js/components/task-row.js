// One task in a list: the check, the title, and what matters about it (when, how often, the
// checklist, tags, the list). Click opens the details; drag (by the handle, or anywhere with a mouse)
// to reorder it, or drop it on a list, a day or a tag.
import { store, updateTask, listById } from '../store.js';
import { dueInfo, repeatLabel, addDays } from '../dates.js';
import { localDay } from '../views.js';
import { drag, start, end, overRow, leave, dropClass } from '../dnd.js';
import { RouterLink } from '../router.js';
import { TaskCheck } from './checkbox.js';

export const TONE = {
  overdue: 'text-danger',
  today: 'text-brand',
  tomorrow: 'text-[#d97706] dark:text-gold',
  soon: 'text-ink-2',
  later: 'text-ink-3',
};

/** The little facts under a title, shared by the row, the board card and the calendar */
export const TaskMeta = {
  components: { RouterLink },
  props: { task: { type: Object, required: true }, showList: Boolean, compact: Boolean },
  computed: {
    due() {
      // a done task isn't due any more
      return this.task.status === 'done' ? null : dueInfo(this.task.dueDate, this.task.dueTime, store.today);
    },
    tone() {
      return this.due ? TONE[this.due.tone] : '';
    },
    list() {
      return this.showList && this.task.listId ? listById(this.task.listId) : null;
    },
    items() {
      const c = this.task.checklist;
      return c.length ? `${c.filter((i) => i.done).length}/${c.length}` : '';
    },
    repeat() {
      return repeatLabel(this.task.repeat);
    },
    any() {
      return this.due || this.repeat || this.items || this.task.notes || this.task.tags.length || this.list;
    },
  },
  template: /*html*/ `
    <div v-if="any" :class="['flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3', compact ? 'mt-1' : 'mt-0.5']">
      <span v-if="due" :class="['inline-flex items-center gap-1 font-medium', tone]">
        <Icon :name="due.tone === 'overdue' ? 'circle-alert' : 'calendar'" :size="12" />{{ due.label }}
      </span>
      <span v-if="repeat" class="inline-flex items-center gap-1" :title="repeat"><Icon name="repeat" :size="12" /><span v-if="!compact">{{ repeat }}</span></span>
      <span v-if="items" class="inline-flex items-center gap-1" title="Checklist"><Icon name="square-check" :size="12" />{{ items }}</span>
      <span v-if="task.notes" class="inline-flex items-center" title="Has notes"><Icon name="align-left" :size="12" /></span>
      <span v-for="t in task.tags" :key="t" @click.stop><RouterLink :to="'/tag/' + encodeURIComponent(t)" class="rounded-md bg-surface-2 px-1.5 py-px font-medium text-ink-2 hover:text-brand">#{{ t }}</RouterLink></span>
      <span v-if="list" class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full" :style="{ background: list.color }"></span>{{ list.name }}</span>
    </div>`,
};

export const TaskRow = {
  components: { TaskCheck, TaskMeta },
  props: { task: { type: Object, required: true }, showList: Boolean, sortable: Boolean },
  emits: ['drop-on'],
  computed: {
    selected() {
      return store.selectedId === this.task.id;
    },
    leaving() {
      return Boolean(store.leaving[this.task.id]);
    },
    key() {
      return `row:${this.task.id}`;
    },
    /** when a done task was done: "14:05" today, "Yesterday", or "12 Nov" */
    finished() {
      const at = this.task.completedAt;
      if (!at) return null;
      const d = new Date(`${at.replace(' ', 'T')}Z`);
      const day = localDay(at);
      const short = day === store.today ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : day === addDays(store.today, -1) ? 'Yesterday'
        : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      return { short, full: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) };
    },
    cls() {
      return [
        'group relative flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors cursor-pointer select-none',
        this.selected ? 'bg-brand-soft' : 'hover:bg-surface-2',
        this.leaving ? 'row-done row-leaving' : '',
        this.task.status === 'done' ? 'row-done row-complete' : '',
        store.arrived[this.task.id] ? 'row-arrive' : '',
        drag.id === this.task.id ? 'dragging' : '',
        this.sortable ? dropClass(this.key) : '',
      ];
    },
  },
  methods: {
    open() {
      store.selectedId = this.task.id;
    },
    flag() {
      updateTask(this.task, { flagged: !this.task.flagged });
    },
    onStart(e) {
      start(e, this.task);
    },
    // a sortable row takes the drop itself (before or after it); otherwise its group does
    onOver(e) {
      if (!this.sortable || drag.id === this.task.id) return;
      overRow(e, this.key);
      e.stopPropagation();
    },
    onDrop(e) {
      if (!this.sortable || drag.over !== this.key) return;
      e.preventDefault();
      e.stopPropagation();
      this.$emit('drop-on', { target: this.task.id, where: drag.where });
      end();
    },
    leave,
    end,
  },
  template: /*html*/ `
    <div :class="cls" draggable="true" @dragstart="onStart" @dragend="end" @dragover="onOver" @dragleave="leave($event, key)" @drop="onDrop"
      @click="open" @keydown.enter.self="open" tabindex="0" role="button" :aria-label="'Open ' + task.title" :data-task="task.id">
      <span v-if="sortable" class="absolute -left-3 top-3 hidden text-ink-3 opacity-0 transition group-hover:opacity-100 lg:block" aria-hidden="true"><Icon name="grip-vertical" :size="14" /></span>
      <TaskCheck :task="task" class="-mt-px" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="title truncate text-[14.5px] leading-snug text-ink">{{ task.title }}</span>
          <span v-if="task.status === 'done' && finished" class="ml-auto shrink-0 text-[11.5px] text-ink-3" :title="'Done ' + finished.full">{{ finished.short }}</span>
        </div>
        <TaskMeta :task="task" :show-list="showList" />
      </div>
      <button type="button" @click.stop="flag" :aria-label="task.flagged ? 'Remove the flag' : 'Flag'" :title="task.flagged ? 'Flagged' : 'Flag'"
        :class="['mt-px rounded-md p-1 transition', task.flagged ? 'text-danger' : 'text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100']">
        <Icon name="flag" :size="15" />
      </button>
    </div>`,
};
