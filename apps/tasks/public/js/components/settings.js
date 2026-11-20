// Preferences (saved with the account, so they follow it to every device) and the shortcuts.
import { store, savePrefs, clearDone } from '../store.js';
import { SMART, SORTS } from '../views.js';

const SHORTCUTS = [
  ['N', 'Add a task'],
  ['/', 'Search'],
  ['Esc', 'Close the details'],
  ['?', 'This window'],
];

export const Settings = {
  emits: ['close'],
  data: () => ({ store, SHORTCUTS, SORTS, views: SMART.filter((s) => ['inbox', 'today', 'upcoming', 'all'].includes(s.id)) }),
  methods: {
    savePrefs,
    async clear() {
      if (confirm('Remove every done task? This can’t be undone.')) await clearDone();
    },
  },
  template: /*html*/ `
    <Modal title="Settings" @close="$emit('close')">
      <div class="space-y-6">
        <section class="grid gap-4 sm:grid-cols-2">
          <Field label="Open on">
            <select class="input" :value="store.prefs.startView" @change="savePrefs({ startView: $event.target.value })">
              <option v-for="v in views" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
          </Field>
          <Field label="Weeks start on">
            <select class="input" :value="store.prefs.weekStart" @change="savePrefs({ weekStart: Number($event.target.value) })">
              <option :value="1">Monday</option>
              <option :value="0">Sunday</option>
            </select>
          </Field>
          <Field label="Sort tasks by" hint="Manual lets you drag tasks into your own order.">
            <select class="input" :value="store.prefs.sort" @change="savePrefs({ sort: $event.target.value })">
              <option v-for="(s, k) in SORTS" :key="k" :value="k">{{ s.label }}</option>
            </select>
          </Field>
          <Field label="Done tasks in lists" hint="Show the done ones under a list's open tasks.">
            <select class="input" :value="store.prefs.showDoneInLists ? '1' : ''" @change="savePrefs({ showDoneInLists: Boolean($event.target.value) })">
              <option value="">Hide them</option>
              <option value="1">Show them</option>
            </select>
          </Field>
        </section>

        <section>
          <h3 class="mb-2 text-[13px] font-medium text-ink-2">Keyboard</h3>
          <ul class="grid gap-1.5 sm:grid-cols-2">
            <li v-for="[k, what] in SHORTCUTS" :key="k" class="flex items-center gap-3 text-sm text-ink-2"><kbd class="min-w-[34px] text-center">{{ k }}</kbd>{{ what }}</li>
          </ul>
        </section>

        <section>
          <h3 class="mb-2 text-[13px] font-medium text-ink-2">Quick add understands</h3>
          <ul class="space-y-1 text-[13px] text-ink-3">
            <li><b class="text-ink-2">Dates:</b> today, tomorrow, friday, on mon, next week, in 3 days, dec 5, 2026-12-05</li>
            <li><b class="text-ink-2">Times:</b> at 5pm, 9:30, noon · <b class="text-ink-2">Repeats:</b> daily, every weekday, every 2 weeks, every mon and thu, monthly</li>
            <li><b class="text-ink-2">Priority:</b> !1 to !3, !high, !! · <b class="text-ink-2">Flag:</b> * · <b class="text-ink-2">Tags:</b> #errands · <b class="text-ink-2">List:</b> @work</li>
          </ul>
        </section>

        <section class="flex items-center justify-between gap-3 rounded-xl border border-line p-4">
          <div>
            <div class="text-sm font-semibold">Done tasks</div>
            <div class="text-xs text-ink-3">{{ store.done.total }} kept. Removing them can’t be undone.</div>
          </div>
          <Btn variant="secondary" size="sm" icon="eraser" @click="clear" :disabled="!store.done.total">Remove all</Btn>
        </section>
      </div>
      <template #footer><Btn @click="$emit('close')">Done</Btn></template>
    </Modal>`,
};
