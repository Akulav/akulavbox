// One view on screen: its header (with Today's progress), the layout switch (list, board, calendar),
// sort and grouping, the quick-add box and the tasks. Layout and grouping are remembered per view
// on this device; the sort order is saved with the account.
import { store, savePrefs, renameTag, removeTag } from '../store.js';
import { viewOf, sortTasks, SORTS, GROUPS, counts, doneToday, localDay } from '../views.js';
import { route, navigate } from '../router.js';
import { longDate } from '../dates.js';
import { QuickAdd } from '../components/quick-add.js';
import { ListView } from './list-view.js';
import { BoardView } from './board-view.js';
import { CalendarView } from './calendar-view.js';
import { DoneView } from './done-view.js';

const local = {
  get: (k, d) => {
    try {
      return localStorage.getItem(k) || d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};
const LAYOUTS = [
  { value: 'list', icon: 'list', label: 'List' },
  { value: 'board', icon: 'square-kanban', label: 'Board' },
  { value: 'calendar', icon: 'calendar', label: 'Calendar' },
];
const EMPTY = {
  inbox: ['inbox', 'Inbox zero', 'New tasks without a list land here. Add one above, or press N anywhere.'],
  today: ['sun', 'Nothing due today', 'Enjoy it, or plan something: “Call the bank today 3pm”.'],
  upcoming: ['calendar-days', 'Nothing planned', 'Tasks with a due date show up here, day by day.'],
  flagged: ['flag', 'No flagged tasks', 'Flag what matters most: the flag on a task, or * in quick add.'],
  all: ['layers', 'All clear', 'Every open task, from every list, shows up here.'],
  list: ['list-todo', 'This list is empty', 'Add the first task above.'],
  tag: ['hash', 'No open tasks with this tag', ''],
  search: ['search', 'No open tasks match', 'Search looks in titles, notes, tags and checklists.'],
};

export const PageView = {
  components: { QuickAdd, ListView, BoardView, CalendarView, DoneView },
  emits: ['edit-list'],
  data: () => ({ LAYOUTS, SORTS, GROUPS, options: false, layoutTick: 0 }),
  setup: () => ({ store, route, counts, doneToday }),
  computed: {
    view() {
      return viewOf(route.path, route.query);
    },
    isDone() {
      return this.view.key === 'done';
    },
    layout() {
      this.layoutTick; // eslint-disable-line no-unused-expressions
      return local.get(`tasks.layout.${this.view.key}`, 'list');
    },
    groupBy() {
      this.layoutTick; // eslint-disable-line no-unused-expressions
      return local.get(`tasks.group.${this.view.key}`, 'none');
    },
    fixedGroups() {
      return ['today', 'upcoming'].includes(this.view.key);
    },
    tasks() {
      // a task ticked a moment ago stays a little longer, struck through, while it leaves
      const leaving = store.done.items.filter((t) => store.leaving[t.id] && this.view.filter(t));
      return sortTasks([...store.tasks.filter(this.view.filter), ...leaving], store.prefs.sort);
    },
    /** done tasks of this view, newest first: under the list, and in the board's Done column. Today shows
     *  what was finished today (not every old task that was once due); a task still leaving the open
     *  ones isn't shown twice. */
    done() {
      const today = this.view.key === 'today';
      return store.done.items.filter((t) => !store.leaving[t.id] && (today ? t.completedAt && localDay(t.completedAt) === store.today : this.view.filter(t)));
    },
    subtitle() {
      const n = this.tasks.length;
      if (this.isDone) return `${store.done.total} done`;
      if (this.view.key === 'today') return `${longDate(store.today, store.today)}${n ? ` · ${n} to do` : ''}`;
      return n ? `${n} open task${n === 1 ? '' : 's'}` : '';
    },
    /** The progress ring: Today's (done today out of done today + still due), or a list's (done out of
     *  every task in it, as the server counts them) */
    ring() {
      let done;
      let total;
      if (this.view.key === 'today') {
        done = doneToday.value;
        total = done + counts.value.today;
      } else if (this.view.kind === 'list') {
        done = this.view.list.done;
        total = done + this.view.list.open;
      } else return null;
      const all = total && done === total;
      const note = this.view.key === 'today' ? (all ? 'All done today 🎉' : 'done today') : all ? 'All done 🎉' : 'done';
      return { done, total, note, pct: total ? done / total : 0, dash: 2 * Math.PI * 22 };
    },
    /** board and calendar fill the window on wide screens; the list and Completed scroll */
    fills() {
      return !this.isDone && ['board', 'calendar'].includes(this.layout);
    },
    empty() {
      return EMPTY[this.view.kind === 'smart' ? this.view.key : this.view.kind] || EMPTY.all;
    },
  },
  watch: {
    'view.key'() {
      this.options = false;
      if (this.$refs.body) this.$refs.body.scrollTop = 0;
    },
    // the window title follows the view
    'view.title': {
      handler(t) {
        document.title = `${t} · Tick`;
      },
      immediate: true,
    },
  },
  methods: {
    setLayout(v) {
      local.set(`tasks.layout.${this.view.key}`, v);
      this.layoutTick++;
    },
    setGroup(v) {
      local.set(`tasks.group.${this.view.key}`, v);
      this.layoutTick++;
    },
    savePrefs,
    async renameTag() {
      const name = prompt(`Rename #${this.view.tag} on every task to:`, this.view.tag);
      if (name && name.trim() && name.trim() !== this.view.tag && (await renameTag(this.view.tag, name.trim()))) navigate(`/tag/${encodeURIComponent(name.trim().replace(/^#/, ''))}`, { replace: true });
    },
    async removeTag() {
      if (confirm(`Remove #${this.view.tag} from every task? The tasks stay.`)) {
        await removeTag(this.view.tag);
        navigate('/all', { replace: true });
      }
    },
  },
  template: /*html*/ `
    <!-- wide screens: the header and quick add stay put and the tasks scroll under them, so the page
         itself never scrolls; phones scroll the page as before -->
    <div class="flex flex-col lg:h-full">
      <div class="mx-auto w-full max-w-[1100px] shrink-0 px-4 pt-5 sm:px-6 lg:px-10 lg:pt-6">
        <header class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" :style="{ background: view.color + '1f', color: view.color }"><Icon :name="view.icon" :size="22" :stroke="2.1" /></span>
          <div class="min-w-[220px] flex-1">
            <h1 class="truncate font-display text-[26px] font-bold leading-tight tracking-tight text-ink">{{ view.title }}</h1>
            <p v-if="subtitle" class="text-sm text-ink-3">{{ subtitle }}</p>
          </div>

          <div v-if="ring && ring.total" class="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2" :title="ring.done + ' of ' + ring.total + ' ' + ring.note">
            <svg width="52" height="52" viewBox="0 0 52 52" class="-rotate-90" aria-hidden="true">
              <circle cx="26" cy="26" r="22" fill="none" stroke-width="6" class="ring-track" />
              <circle cx="26" cy="26" r="22" fill="none" stroke-width="6" stroke-linecap="round" class="ring-bar" :stroke-dasharray="ring.dash" :stroke-dashoffset="ring.dash * (1 - ring.pct)" />
            </svg>
            <div class="leading-tight">
              <div class="num font-display text-lg font-bold text-ink">{{ ring.done }}<span class="text-ink-3">/{{ ring.total }}</span></div>
              <div class="text-xs text-ink-3">{{ ring.note }}</div>
            </div>
          </div>

          <div v-if="!isDone" class="flex items-center gap-2">
            <div class="inline-flex rounded-xl border border-line bg-surface-2 p-0.5" role="radiogroup" aria-label="Layout">
              <button v-for="l in LAYOUTS" :key="l.value" type="button" role="radio" :aria-checked="layout === l.value" @click="setLayout(l.value)" :title="l.label"
                :class="['flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium transition', layout === l.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink']">
                <Icon :name="l.icon" :size="15" /><span class="hidden sm:inline">{{ l.label }}</span>
              </button>
            </div>
            <div class="relative">
              <IconButton icon="sliders-horizontal" label="View options" @click.stop="options = !options" :class="options ? '!bg-surface-2 !text-ink' : ''" />
              <div v-if="options" class="animate-pop absolute right-0 top-10 z-30 w-64 space-y-3 rounded-2xl border border-line bg-surface p-3 shadow-xl" @click.stop>
                <Field label="Sort">
                  <select class="input !h-9" :value="store.prefs.sort" @change="savePrefs({ sort: $event.target.value })">
                    <option v-for="(s, k) in SORTS" :key="k" :value="k">{{ s.label }}</option>
                  </select>
                </Field>
                <Field v-if="layout === 'list' && !fixedGroups" label="Group by">
                  <select class="input !h-9" :value="groupBy" @change="setGroup($event.target.value)">
                    <option v-for="(g, k) in GROUPS" :key="k" :value="k">{{ g }}</option>
                  </select>
                </Field>
                <div v-if="view.kind === 'list'" class="border-t border-line pt-3"><Btn size="sm" variant="secondary" icon="pencil" class="w-full" @click="options = false; $emit('edit-list', view.list)">Edit or delete the list</Btn></div>
                <div v-if="view.kind === 'tag'" class="flex gap-2 border-t border-line pt-3">
                  <Btn size="sm" variant="secondary" icon="pencil" class="flex-1" @click="options = false; renameTag()">Rename</Btn>
                  <Btn size="sm" variant="danger-ghost" icon="trash-2" class="flex-1" @click="options = false; removeTag()">Remove</Btn>
                </div>
              </div>
            </div>
          </div>
        </header>
        <div v-if="!isDone" class="mb-5 lg:mb-4"><QuickAdd :defaults="view.defaults" /></div>
      </div>

      <div v-if="options" class="fixed inset-0 z-20" @click="options = false"></div>

      <div ref="body" class="scrollbar-thin lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div :class="['mx-auto w-full max-w-[1100px] px-4 pb-24 sm:px-6 lg:px-10', fills ? 'lg:h-full lg:min-h-[420px] lg:pb-6' : 'lg:pb-12']">
          <DoneView v-if="isDone" />
          <CalendarView v-else-if="layout === 'calendar'" :view="view" :tasks="tasks" />
          <BoardView v-else-if="layout === 'board'" :view="view" :tasks="tasks" :sort="store.prefs.sort" :done="done" />
          <template v-else>
            <EmptyState v-if="!tasks.length && view.key !== 'upcoming'" :icon="empty[0]" :title="empty[1]" :message="empty[2]" />
            <ListView v-if="tasks.length || done.length || view.key === 'upcoming'" :view="view" :tasks="tasks" :group-by="fixedGroups ? 'none' : groupBy" :sort="store.prefs.sort" :done="done" />
          </template>
        </div>
      </div>
    </div>`,
};
