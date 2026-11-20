// Small building blocks shared by the pages (buttons, cards, dialogs, …).
import { Icon } from './icons.js';

const BTN_BASE = 'inline-flex items-center justify-center gap-2 font-medium transition-all disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap';
const BTN_SIZES = { sm: 'h-8 px-3 text-[13px] rounded-lg', md: 'h-10 px-4 text-sm rounded-xl', lg: 'h-11 px-5 text-[15px] rounded-xl' };
const BTN_VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-strong shadow-sm shadow-brand/20 active:scale-[0.98] dark:text-[#04140f]',
  secondary: 'bg-surface border border-line text-ink hover:bg-surface-2 active:scale-[0.98]',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90 active:scale-[0.98]',
  'danger-ghost': 'text-danger hover:bg-danger/10',
};

export const Btn = {
  components: { Icon },
  props: { variant: { type: String, default: 'primary' }, size: { type: String, default: 'md' }, loading: Boolean, icon: String, disabled: Boolean, type: { type: String, default: 'button' } },
  computed: {
    cls() {
      return [BTN_BASE, BTN_SIZES[this.size], BTN_VARIANTS[this.variant]];
    },
  },
  template: /*html*/ `
    <button :type="type" :class="cls" :disabled="loading || disabled">
      <Icon v-if="loading" name="loader-2" class="animate-spin" />
      <Icon v-else-if="icon" :name="icon" :stroke="2.2" />
      <slot />
    </button>`,
};

export const IconButton = {
  components: { Icon },
  props: { icon: { type: String, required: true }, label: { type: String, required: true }, size: { type: Number, default: 16 } },
  template: /*html*/ `
    <button type="button" :aria-label="label" :title="label" class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-ink">
      <Icon :name="icon" :size="size" />
    </button>`,
};

export const Field = {
  props: { label: String, hint: String, error: String },
  template: /*html*/ `
    <label class="block">
      <span v-if="label" class="mb-1.5 block text-[13px] font-medium text-ink-2">{{ label }}</span>
      <slot />
      <span v-if="error" class="mt-1 block text-xs text-danger">{{ error }}</span>
      <span v-else-if="hint" class="mt-1 block text-xs text-ink-3">{{ hint }}</span>
    </label>`,
};

export const Card = {
  props: { title: String, subtitle: String, bodyClass: { type: String, default: 'p-5' } },
  template: /*html*/ `
    <section class="card animate-in">
      <header v-if="title || $slots.action" class="flex items-start justify-between gap-3 px-5 pt-5">
        <div class="min-w-0">
          <h2 v-if="title" class="font-display text-[15px] font-bold text-ink">{{ title }}</h2>
          <p v-if="subtitle" class="mt-0.5 text-[13px] text-ink-3">{{ subtitle }}</p>
        </div>
        <slot name="action" />
      </header>
      <div :class="bodyClass"><slot /></div>
    </section>`,
};

const MODAL_WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/** A dialog over the page: Escape or the backdrop closes it, focus goes to the first field */
export const Modal = {
  components: { IconButton },
  props: { title: String, size: { type: String, default: 'md' } },
  emits: ['close'],
  computed: {
    width() {
      return MODAL_WIDTHS[this.size];
    },
  },
  mounted() {
    this.prev = document.activeElement;
    this.onKey = (e) => e.key === 'Escape' && this.$emit('close');
    document.addEventListener('keydown', this.onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const box = this.$refs.box;
      if (!box || box.contains(document.activeElement)) return;
      (box.querySelector('input,select,textarea') ?? box.querySelector('button'))?.focus();
    }, 30);
  },
  unmounted() {
    document.removeEventListener('keydown', this.onKey);
    document.body.style.overflow = '';
    this.prev?.focus?.();
  },
  template: /*html*/ `
    <Teleport to="body">
      <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" :aria-label="title">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="$emit('close')"></div>
        <div ref="box" :class="['animate-pop relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl', width]">
          <div class="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 class="font-display text-base font-bold">{{ title }}</h2>
            <IconButton icon="x" label="Close" @click="$emit('close')" />
          </div>
          <div class="scrollbar-thin overflow-y-auto px-5 py-5"><slot /></div>
          <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-5 py-3.5"><slot name="footer" /></div>
        </div>
      </div>
    </Teleport>`,
};

/** Asks before something that can't be undone; `confirm` may return a promise */
export const ConfirmDialog = {
  components: { Modal, Btn },
  props: { title: String, message: String, confirmLabel: { type: String, default: 'Delete' }, danger: { type: Boolean, default: true }, confirm: { type: Function, required: true } },
  emits: ['close'],
  data: () => ({ busy: false }),
  methods: {
    async run() {
      this.busy = true;
      try {
        await this.confirm();
        this.$emit('close');
      } catch {
        /* the caller showed the error */
      } finally {
        this.busy = false;
      }
    },
  },
  template: /*html*/ `
    <Modal :title="title" size="sm" @close="$emit('close')">
      <p class="text-sm text-ink-2">{{ message }}</p>
      <template #footer>
        <Btn variant="secondary" @click="$emit('close')">Cancel</Btn>
        <Btn :variant="danger ? 'danger' : 'primary'" :loading="busy" @click="run">{{ confirmLabel }}</Btn>
      </template>
    </Modal>`,
};

const TONES = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-soft text-brand-strong',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/12 text-warning',
  gold: 'bg-gold/15 text-[#9a6a00] dark:text-gold',
};
export const Badge = {
  props: { tone: { type: String, default: 'neutral' } },
  computed: {
    cls() {
      return TONES[this.tone];
    },
  },
  template: /*html*/ `<span :class="['inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold', cls]"><slot /></span>`,
};

/** Up/down change pill. `inverse` = higher is worse (spending). */
export const Delta = {
  components: { Icon },
  props: { value: Number, inverse: { type: Boolean, default: true }, suffix: { type: String, default: 'vs last month' } },
  computed: {
    known() {
      return this.value !== null && this.value !== undefined && Number.isFinite(this.value);
    },
    good() {
      return this.inverse ? this.value <= 0 : this.value > 0;
    },
  },
  template: /*html*/ `
    <span v-if="!known" class="text-xs text-ink-3">No prior data</span>
    <span v-else class="inline-flex items-center gap-1 text-xs">
      <span :class="['inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold', good ? 'bg-brand-soft text-brand-strong' : 'bg-danger/10 text-danger']">
        <Icon :name="value > 0 ? 'arrow-up-right' : 'arrow-down-right'" :size="12" :stroke="2.5" />
        {{ Math.abs(value).toFixed(0) }}%
      </span>
      <span class="text-ink-3">{{ suffix }}</span>
    </span>`,
};

export const EmptyState = {
  components: { Icon },
  props: { icon: String, title: String, message: String },
  template: /*html*/ `
    <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div v-if="icon" class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Icon :name="icon" :size="22" />
      </div>
      <h3 class="font-display text-[15px] font-bold">{{ title }}</h3>
      <p v-if="message" class="mt-1 max-w-sm text-sm text-ink-3">{{ message }}</p>
      <div v-if="$slots.default" class="mt-5"><slot /></div>
    </div>`,
};

export const Skeleton = { template: /*html*/ `<div class="animate-pulse rounded-lg bg-surface-2"></div>` };

/** A row of options, one chosen: v-model */
export const Segmented = {
  props: { options: { type: Array, required: true }, modelValue: String },
  emits: ['update:modelValue'],
  template: /*html*/ `
    <div class="inline-flex rounded-xl border border-line bg-surface-2 p-0.5" role="tablist">
      <button v-for="o in options" :key="o.value" type="button" role="tab" :aria-selected="modelValue === o.value" @click="$emit('update:modelValue', o.value)"
        :class="['whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition', modelValue === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink']">
        {{ o.label }}
      </button>
    </div>`,
};

export const ProgressBar = {
  props: { value: Number, max: Number, color: String },
  computed: {
    style() {
      const ratio = this.max > 0 ? this.value / this.max : 0;
      return { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: ratio > 1 ? 'var(--danger)' : this.color };
    },
  },
  template: /*html*/ `
    <div class="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div class="h-full rounded-full transition-all duration-500" :style="style"></div>
    </div>`,
};

export const PageHeader = {
  props: { title: String, subtitle: String },
  template: /*html*/ `
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 text-sm text-ink-3">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.default" class="flex flex-wrap items-center gap-2"><slot /></div>
    </div>`,
};

/** Color swatches with labels, for charts */
export const Legend = {
  props: { items: { type: Array, required: true } },
  template: /*html*/ `
    <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
      <span v-for="i in items" :key="i.label" class="inline-flex items-center gap-1.5">
        <span class="inline-block h-2.5 w-2.5 rounded-sm" :style="i.dashed ? { border: '1.5px dashed ' + i.color, background: 'transparent' } : { backgroundColor: i.color }"></span>
        {{ i.label }}
      </span>
    </div>`,
};

/** Everything above, for app.component() */
export const UI = { Btn, IconButton, Field, Card, Modal, ConfirmDialog, Badge, Delta, EmptyState, Skeleton, Segmented, ProgressBar, PageHeader, Legend, Icon };
