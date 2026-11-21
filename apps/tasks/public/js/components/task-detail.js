// The details of one task, beside the list (a sheet on phones). Everything saves by itself: choices
// at once, text a moment after typing stops (or when leaving the field).
import { store, taskById, updateTask, deleteTask, toggleDone } from '../store.js';
import { TaskCheck } from './checkbox.js';
import { DueEditor, RepeatEditor, PriorityPicker, TagInput } from './pickers.js';

const when = (utc) => (utc ? new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const TaskDetail = {
  components: { TaskCheck, DueEditor, RepeatEditor, PriorityPicker, TagInput },
  data: () => ({ title: '', notes: '', newItem: '', confirmDelete: false }),
  setup: () => ({ store }),
  computed: {
    task() {
      return store.selectedId ? taskById(store.selectedId) : null;
    },
    done() {
      return this.task?.checklist.filter((i) => i.done).length || 0;
    },
    created() {
      return when(this.task?.createdAt);
    },
    finished() {
      return when(this.task?.completedAt);
    },
  },
  watch: {
    // another task opened (or this one came back from the server): show its text
    'task.id': { handler: 'fill', immediate: true },
  },
  mounted() {
    this.onKey = (e) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]') && this.close();
    document.addEventListener('keydown', this.onKey);
  },
  unmounted() {
    document.removeEventListener('keydown', this.onKey);
    this.flush();
  },
  methods: {
    fill() {
      this.flush();
      this.title = this.task?.title || '';
      this.notes = this.task?.notes || '';
      this.confirmDelete = false;
      this.$nextTick(() => this.grow());
    },
    close() {
      this.flush();
      store.selectedId = null;
    },
    save(fields) {
      if (this.task) updateTask(this.task, fields);
    },
    // text: saved a moment after typing stops, and when the field is left
    later(field) {
      clearTimeout(this.timer);
      this.pending = field;
      this.timer = setTimeout(() => this.flush(), 700);
    },
    flush() {
      clearTimeout(this.timer);
      const t = this.task;
      if (!t || !this.pending) return (this.pending = null);
      this.pending = null;
      const title = this.title.replace(/\s+/g, ' ').trim();
      const fields = {};
      if (title && title !== t.title) fields.title = title;
      if (this.notes.trim() !== t.notes) fields.notes = this.notes;
      if (Object.keys(fields).length) updateTask(t, fields);
    },
    grow() {
      for (const el of [this.$refs.title, this.$refs.notes]) {
        if (!el) continue;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    },
    toggleDone() {
      toggleDone(this.task);
    },
    /* the checklist: saved whole each time */
    items() {
      return this.task.checklist.map((i) => ({ text: i.text, done: i.done }));
    },
    addItem() {
      const text = this.newItem.trim();
      if (!text) return;
      this.newItem = '';
      this.save({ checklist: [...this.items(), { text, done: false }] });
    },
    toggleItem(i) {
      const list = this.items();
      list[i].done = !list[i].done;
      this.save({ checklist: list });
    },
    editItem(i, text) {
      const list = this.items();
      if (list[i].text === text.trim()) return;
      if (!text.trim()) list.splice(i, 1);
      else list[i].text = text.trim();
      this.save({ checklist: list });
    },
    removeItem(i) {
      const list = this.items();
      list.splice(i, 1);
      this.save({ checklist: list });
    },
    moveItem(i, d) {
      const list = this.items();
      const j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      this.save({ checklist: list });
    },
    remove() {
      deleteTask(this.task);
    },
  },
  template: /*html*/ `
    <!-- wide screens: beside the list and sticky, so it opens in view wherever the page is scrolled -->
    <aside v-if="task" class="panel-in fixed inset-0 z-40 flex flex-col bg-surface sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[440px] sm:border-l sm:border-line sm:shadow-2xl lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[420px] lg:shrink-0 lg:self-start lg:shadow-none" aria-label="Task details">
      <header class="flex items-center gap-2 border-b border-line px-4 py-3">
        <Btn size="sm" :variant="task.status === 'done' ? 'secondary' : 'primary'" :icon="task.status === 'done' ? 'undo-2' : 'check'" @click="toggleDone">{{ task.status === 'done' ? 'Mark as not done' : 'Mark done' }}</Btn>
        <div class="flex-1"></div>
        <IconButton :icon="'flag'" :label="task.flagged ? 'Remove the flag' : 'Flag'" @click="save({ flagged: !task.flagged })" :class="task.flagged ? '!text-danger' : ''" />
        <IconButton icon="x" label="Close (Esc)" @click="close" />
      </header>

      <div class="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div class="flex items-start gap-3">
          <TaskCheck :task="task" :size="24" class="mt-1" />
          <textarea ref="title" v-model="title" rows="1" maxlength="500" @input="grow(); later('title')" @blur="flush" @keydown.enter.prevent="$event.target.blur()"
            :class="['min-w-0 flex-1 resize-none overflow-hidden bg-transparent font-display text-[21px] font-semibold leading-snug text-ink outline-none', task.status === 'done' ? 'line-through decoration-ink-3' : '']" aria-label="Title"></textarea>
        </div>

        <div class="grid gap-4">
          <Field label="List">
            <select class="input" :value="task.listId ?? ''" @change="save({ listId: $event.target.value ? Number($event.target.value) : null })">
              <option value="">Inbox</option>
              <option v-for="l in store.lists" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </Field>
          <Field label="Due">
            <DueEditor :date="task.dueDate" :time="task.dueTime" @update:date="save({ dueDate: $event })" @update:time="save({ dueTime: $event })" />
          </Field>
          <Field label="Repeat">
            <RepeatEditor :model-value="task.repeat" :due-date="task.dueDate" @update:model-value="save({ repeat: $event })" />
          </Field>
          <Field label="Priority">
            <PriorityPicker :model-value="task.priority" @update:model-value="save({ priority: $event })" />
          </Field>
          <Field label="Tags">
            <TagInput :model-value="task.tags" @update:model-value="save({ tags: $event })" />
          </Field>
        </div>

        <section>
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-[13px] font-medium text-ink-2">Checklist</h3>
            <span v-if="task.checklist.length" class="num text-xs text-ink-3">{{ done }} of {{ task.checklist.length }}</span>
          </div>
          <ProgressBar v-if="task.checklist.length" :value="done" :max="task.checklist.length" color="var(--brand)" class="mb-2" />
          <ul class="space-y-0.5">
            <li v-for="(item, i) in task.checklist" :key="item.id ?? i" class="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
              <button type="button" @click="toggleItem(i)" role="checkbox" :aria-checked="item.done" :aria-label="item.text"
                :class="['grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border-2 transition', item.done ? 'border-brand bg-brand text-white dark:text-[#160b2e]' : 'border-line hover:border-brand']">
                <Icon v-if="item.done" name="check" :size="11" :stroke="3.5" />
              </button>
              <input :value="item.text" @change="editItem(i, $event.target.value)" @keydown.enter="$event.target.blur()" maxlength="500"
                :class="['min-w-0 flex-1 bg-transparent text-sm outline-none', item.done ? 'text-ink-3 line-through' : 'text-ink']" :aria-label="'Checklist item ' + (i + 1)" />
              <span class="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button type="button" @click="moveItem(i, -1)" :disabled="i === 0" class="rounded p-0.5 text-ink-3 hover:text-ink disabled:opacity-30" aria-label="Move up"><Icon name="chevron-left" :size="14" class="rotate-90" /></button>
                <button type="button" @click="moveItem(i, 1)" :disabled="i === task.checklist.length - 1" class="rounded p-0.5 text-ink-3 hover:text-ink disabled:opacity-30" aria-label="Move down"><Icon name="chevron-right" :size="14" class="rotate-90" /></button>
                <button type="button" @click="removeItem(i)" class="rounded p-0.5 text-ink-3 hover:text-danger" aria-label="Remove"><Icon name="x" :size="14" /></button>
              </span>
            </li>
          </ul>
          <form @submit.prevent="addItem" class="mt-1 flex items-center gap-2 px-1">
            <Icon name="plus" :size="16" class="text-ink-3" />
            <input v-model="newItem" placeholder="Add a step" maxlength="500" class="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" aria-label="Add a checklist step" />
          </form>
        </section>

        <section>
          <h3 class="mb-2 text-[13px] font-medium text-ink-2">Notes</h3>
          <textarea ref="notes" v-model="notes" rows="4" maxlength="20000" @input="grow(); later('notes')" @blur="flush" placeholder="Details, links, ideas…" class="input min-h-[110px] resize-none leading-relaxed" aria-label="Notes"></textarea>
        </section>
      </div>

      <footer class="flex items-center gap-3 border-t border-line px-5 py-3 text-xs text-ink-3">
        <span class="min-w-0 flex-1 truncate">{{ finished ? 'Done ' + finished : 'Added ' + created }}</span>
        <template v-if="confirmDelete">
          <span class="text-ink-2">Delete this task?</span>
          <Btn size="sm" variant="secondary" @click="confirmDelete = false">Keep</Btn>
          <Btn size="sm" variant="danger" @click="remove">Delete</Btn>
        </template>
        <Btn v-else size="sm" variant="danger-ghost" icon="trash-2" @click="confirmDelete = true">Delete</Btn>
      </footer>
    </aside>`,
};
