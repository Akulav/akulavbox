// Making, changing and deleting a list: its name, colour and icon.
import { saveList, deleteList } from '../store.js';
import { LIST_ICONS, LIST_COLORS } from '../icons.js';
import { navigate } from '../router.js';

export const ListEditor = {
  props: { list: Object }, // null: a new list
  emits: ['close'],
  data() {
    return {
      name: this.list?.name || '',
      color: this.list?.color || LIST_COLORS[Math.floor(Math.random() * LIST_COLORS.length)],
      icon: this.list?.icon || 'list',
      busy: false,
      deleting: false,
      LIST_ICONS,
      LIST_COLORS,
    };
  },
  methods: {
    async save() {
      if (!this.name.trim() || this.busy) return;
      this.busy = true;
      const l = await saveList(this.list, { name: this.name, color: this.color, icon: this.icon });
      this.busy = false;
      if (!l) return;
      if (!this.list) navigate(`/list/${l.id}`);
      this.$emit('close');
    },
    async remove(keepTasks) {
      this.busy = true;
      const ok = await deleteList(this.list, { keepTasks });
      this.busy = false;
      if (!ok) return;
      navigate('/inbox', { replace: true });
      this.$emit('close');
    },
  },
  template: /*html*/ `
    <Modal :title="list ? 'Edit list' : 'New list'" @close="$emit('close')">
      <form @submit.prevent="save" class="space-y-5">
        <div class="flex items-center gap-3">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl" :style="{ background: color + '22', color }"><Icon :name="icon" :size="20" /></span>
          <Field label="Name" class="flex-1"><input class="input" v-model="name" maxlength="80" required placeholder="e.g. Work, Groceries, Trip to Rome" /></Field>
        </div>
        <div>
          <span class="mb-2 block text-[13px] font-medium text-ink-2">Colour</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in LIST_COLORS" :key="c" type="button" @click="color = c" :aria-label="'Colour ' + c" :aria-pressed="color === c"
              :class="['h-8 w-8 rounded-full transition', color === c ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110']" :style="{ background: c, '--tw-ring-color': c }"></button>
          </div>
        </div>
        <div>
          <span class="mb-2 block text-[13px] font-medium text-ink-2">Icon</span>
          <div class="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
            <button v-for="name in LIST_ICONS" :key="name" type="button" @click="icon = name" :aria-label="name" :aria-pressed="icon === name"
              :class="['flex h-9 items-center justify-center rounded-lg border transition', icon === name ? 'border-transparent text-white' : 'border-line text-ink-2 hover:bg-surface-2']"
              :style="icon === name ? { background: color } : null"><Icon :name="name" /></button>
          </div>
        </div>
        <div v-if="list && deleting" class="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <p class="mb-3 text-sm text-ink-2">Delete “{{ list.name }}”? Its {{ list.open + list.done }} task{{ list.open + list.done === 1 ? '' : 's' }} can move to the Inbox or go with it.</p>
          <div class="flex flex-wrap gap-2">
            <Btn size="sm" variant="secondary" @click="remove(true)" :disabled="busy">Delete, keep the tasks</Btn>
            <Btn size="sm" variant="danger" @click="remove(false)" :disabled="busy">Delete with its tasks</Btn>
            <Btn size="sm" variant="ghost" @click="deleting = false">Cancel</Btn>
          </div>
        </div>
        <button type="submit" class="hidden"></button>
      </form>
      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <Btn v-if="list && !deleting" variant="danger-ghost" icon="trash-2" @click="deleting = true">Delete list</Btn><span v-else></span>
          <div class="flex gap-2">
            <Btn variant="secondary" @click="$emit('close')">Cancel</Btn>
            <Btn @click="save" :loading="busy" :disabled="!name.trim()">{{ list ? 'Save' : 'Create list' }}</Btn>
          </div>
        </div>
      </template>
    </Modal>`,
};
