// Completed: the done tasks, newest first, by the day they were done. Untick one to bring it back.
import { store, loadDone, clearDone } from '../store.js';
import { localDay } from '../views.js';
import { dayLabel } from '../dates.js';
import { TaskRow } from '../components/task-row.js';

export const DoneView = {
  components: { TaskRow },
  data: () => ({ busy: false }),
  setup: () => ({ store }),
  computed: {
    groups() {
      const m = new Map();
      for (const t of store.done.items) {
        const d = t.completedAt ? localDay(t.completedAt) : '';
        if (!m.has(d)) m.set(d, []);
        m.get(d).push(t);
      }
      return [...m.entries()].map(([d, tasks]) => ({ key: d, label: d ? dayLabel(d, store.today, { long: true }) : 'Earlier', tasks }));
    },
  },
  created() {
    if (!store.done.loaded) loadDone().catch(() => {});
  },
  methods: {
    async more() {
      this.busy = true;
      try {
        await loadDone({ more: true });
      } finally {
        this.busy = false;
      }
    },
    async clear() {
      if (confirm('Remove every done task? This can’t be undone.')) await clearDone();
    },
  },
  template: /*html*/ `
    <div>
      <div v-if="store.done.items.length" class="mb-4 flex justify-end"><Btn size="sm" variant="secondary" icon="eraser" @click="clear">Remove all done tasks</Btn></div>
      <EmptyState v-if="store.done.loaded && !store.done.items.length" icon="circle-check" title="Nothing done yet" message="Ticked-off tasks gather here, newest first." />
      <div class="space-y-6">
        <section v-for="g in groups" :key="g.key">
          <h2 class="mb-1 border-b border-line px-2.5 pb-2 font-display text-[15px] font-semibold text-ink">{{ g.label }} <span class="num text-xs font-normal text-ink-3">{{ g.tasks.length }}</span></h2>
          <div class="space-y-px"><TaskRow v-for="t in g.tasks" :key="t.id" :task="t" show-list /></div>
        </section>
      </div>
      <div v-if="store.done.items.length < store.done.total" class="mt-6 flex justify-center">
        <Btn variant="secondary" :loading="busy" @click="more">Show more ({{ store.done.total - store.done.items.length }})</Btn>
      </div>
    </div>`,
};
