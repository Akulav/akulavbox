// The round check in front of a task, in its priority's colour; ticking plays a small burst.
import { store, toggleDone } from '../store.js';

export const TaskCheck = {
  props: { task: { type: Object, required: true }, size: { type: Number, default: 20 } },
  computed: {
    on() {
      return this.task.status === 'done' || Boolean(store.leaving[this.task.id]);
    },
    label() {
      return this.on ? `Mark “${this.task.title}” as not done` : `Mark “${this.task.title}” as done`;
    },
  },
  methods: {
    toggle() {
      toggleDone(this.task);
    },
  },
  template: /*html*/ `
    <button type="button" :class="['check', { on }]" :style="{ '--c': task.status === 'done' ? 'var(--done)' : 'var(--p' + task.priority + ')', width: size + 'px', height: size + 'px' }"
      role="checkbox" :aria-checked="on" :aria-label="label" @click.stop="toggle">
      <Icon name="check" :size="size - 8" :stroke="3.2" />
    </button>`,
};
