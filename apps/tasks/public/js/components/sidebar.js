// The sidebar (a drawer on phones): the views with their counts, the lists and the tags. Tasks can
// be dropped on Inbox, Today, Flagged, a list or a tag; lists can be dragged into another order.
import { store, taskById, updateTask, reorderLists } from '../store.js';
import { SMART, counts, listCounts, tagCounts } from '../views.js';
import { RouterLink, navigate, route } from '../router.js';
import { drag, overTarget, leave, end, draggedId, dropClass, reordered } from '../dnd.js';
import { Logo } from '../icons.js';

export const Sidebar = {
  components: { RouterLink, Logo },
  emits: ['navigate', 'new-list', 'edit-list', 'settings'],
  data: () => ({ store, q: '', listDrag: null, listOver: null, showTags: true }),
  setup: () => ({ counts, listCounts, tagCounts, dropClass, route }),
  computed: {
    smart: () => SMART,
  },
  watch: {
    // leaving search empties the box
    'route.path'(p) {
      if (p !== '/search') this.q = '';
    },
  },
  created() {
    if (route.path === '/search') this.q = route.query.get('q') || '';
  },
  methods: {
    count(id) {
      return this.counts[id] || 0;
    },
    search() {
      const q = this.q.trim();
      navigate(q ? `/search?q=${encodeURIComponent(q)}` : `/${store.prefs.startView}`, { replace: route.path === '/search' });
    },
    /* a task dropped on a view, a list or a tag */
    over(e, key) {
      if (this.listDrag) return;
      overTarget(e, key);
    },
    drop(e, what) {
      const id = draggedId(e);
      end();
      const task = id && taskById(id);
      if (!task) return;
      e.preventDefault();
      const fields = what.view === 'inbox' ? { listId: null } : what.view === 'today' ? { dueDate: store.today } : what.view === 'flagged' ? { flagged: true } : what.listId ? { listId: what.listId } : what.tag ? { tags: [...new Set([...task.tags, what.tag])] } : null;
      if (fields) updateTask(task, fields);
    },
    /* lists in another order */
    listStart(e, l) {
      this.listDrag = l.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-list', String(l.id));
    },
    listOverRow(e, l) {
      if (!this.listDrag || this.listDrag === l.id) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      this.listOver = { id: l.id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
    },
    listDrop(e, l) {
      if (!this.listDrag) return this.drop(e, { listId: l.id });
      e.preventDefault();
      const ids = reordered(store.lists.map((x) => x.id), this.listDrag, l.id, this.listOver?.where);
      this.listEnd();
      reorderLists(ids);
    },
    listEnd() {
      this.listDrag = this.listOver = null;
    },
    listCls(l) {
      if (this.listDrag && this.listOver?.id === l.id) return `drop-${this.listOver.where}`;
      return this.listDrag ? '' : dropClass(`list:${l.id}`);
    },
    leave,
  },
  template: /*html*/ `
    <div class="flex h-full flex-col gap-4 p-3">
      <div class="flex items-center justify-between px-2 pt-1.5"><Logo /></div>

      <form @submit.prevent="search" class="relative px-0.5">
        <Icon name="search" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" :size="15" />
        <input v-model="q" @input="search" type="search" placeholder="Search" class="input has-icon !h-9 !bg-surface-2 !border-transparent focus:!border-brand" aria-label="Search tasks" data-search />
      </form>

      <nav class="scrollbar-thin -mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        <div class="space-y-0.5">
          <RouterLink v-for="s in smart" :key="s.id" :to="'/' + s.id" @navigate="$emit('navigate')"
            @dragover="['inbox', 'today', 'flagged'].includes(s.id) && over($event, 'view:' + s.id)" @dragleave="leave($event, 'view:' + s.id)" @drop="drop($event, { view: s.id })"
            :class="['group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition', dropClass('view:' + s.id)]"
            active-class="bg-brand-soft text-ink" inactive-class="text-ink-2 hover:bg-surface-2 hover:text-ink">
            <span class="grid h-6 w-6 place-items-center rounded-lg" :style="{ background: s.color + '1f', color: s.color }"><Icon :name="s.icon" :size="14" :stroke="2.2" /></span>
            <span class="flex-1">{{ s.name }}</span>
            <span v-if="s.id === 'today' && counts.overdue" class="num rounded-md bg-danger/10 px-1.5 text-[11px] font-semibold text-danger" :title="counts.overdue + ' overdue'">{{ counts.overdue }}</span>
            <span v-if="s.id !== 'done' && count(s.id)" class="num text-xs text-ink-3">{{ count(s.id) }}</span>
          </RouterLink>
        </div>

        <div>
          <div class="mb-1 flex items-center justify-between px-3">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Lists</span>
            <button type="button" @click="$emit('new-list')" class="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="New list" title="New list"><Icon name="plus" :size="15" /></button>
          </div>
          <div class="space-y-0.5">
            <RouterLink v-for="l in store.lists" :key="l.id" :to="'/list/' + l.id" @navigate="$emit('navigate')" draggable="true"
              @dragstart="listStart($event, l)" @dragend="listEnd" @dragover="listDrag ? listOverRow($event, l) : over($event, 'list:' + l.id)" @dragleave="leave($event, 'list:' + l.id)" @drop="listDrop($event, l)"
              :class="['group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition', listCls(l), listDrag === l.id ? 'dragging' : '']"
              active-class="bg-brand-soft text-ink" inactive-class="text-ink-2 hover:bg-surface-2 hover:text-ink">
              <span class="grid h-6 w-6 place-items-center rounded-lg" :style="{ background: l.color + '22', color: l.color }"><Icon :name="l.icon" :size="14" :stroke="2.2" /></span>
              <span class="min-w-0 flex-1 truncate">{{ l.name }}</span>
              <button type="button" @click.prevent.stop="$emit('edit-list', l)" class="hidden rounded-md p-0.5 text-ink-3 hover:text-ink group-hover:block" :aria-label="'Edit ' + l.name"><Icon name="ellipsis" :size="15" /></button>
              <span v-if="listCounts[l.id]" class="num text-xs text-ink-3 group-hover:hidden">{{ listCounts[l.id] }}</span>
            </RouterLink>
            <button v-if="!store.lists.length" type="button" @click="$emit('new-list')" class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-3 hover:bg-surface-2 hover:text-ink">
              <span class="grid h-6 w-6 place-items-center rounded-lg border border-dashed border-line"><Icon name="plus" :size="13" /></span>New list
            </button>
          </div>
        </div>

        <div v-if="tagCounts.length">
          <button type="button" @click="showTags = !showTags" class="mb-1 flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3 hover:text-ink">
            Tags <Icon name="chevron-down" :size="14" :class="['transition', showTags ? '' : '-rotate-90']" />
          </button>
          <div v-if="showTags" class="flex flex-wrap gap-1 px-2">
            <RouterLink v-for="t in tagCounts" :key="t.name" :to="'/tag/' + encodeURIComponent(t.name)" @navigate="$emit('navigate')"
              @dragover="over($event, 'tag:' + t.name)" @dragleave="leave($event, 'tag:' + t.name)" @drop="drop($event, { tag: t.name })"
              :class="['rounded-lg px-2 py-1 text-[12.5px] font-medium transition', dropClass('tag:' + t.name)]" active-class="bg-brand text-white dark:text-[#160b2e]" inactive-class="bg-surface-2 text-ink-2 hover:text-ink">
              #{{ t.name }} <span class="num opacity-60">{{ t.count }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>

      <div class="space-y-2 border-t border-line pt-3">
        <button type="button" @click="$emit('settings')" class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Icon name="settings" :size="16" />Settings<kbd class="ml-auto">?</kbd>
        </button>
        <!-- the account menu every app shares (hub/account.js), with the AkulavBox profile picture and the theme -->
        <akb-account expanded up accent="#8b5cf6" :username="store.user?.username" :role="store.user?.role"></akb-account>
      </div>
    </div>`,
};
