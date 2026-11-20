// Tasks' icons (for <Icon>, hub/vue/icon.js) and its logo.
import { Icon, addIcons } from '/hub/vue/icon.js';
import { PATHS, LIST_ICONS } from './icon-paths.js';

// the shared building blocks (hub/vue/ui.js) ask for these names
addIcons({ ...PATHS, 'loader-2': PATHS['loader-circle'], 'check-circle-2': PATHS['circle-check'], 'alert-circle': PATHS['circle-alert'], tag: PATHS.tag });
export { Icon, LIST_ICONS };

export const LIST_COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

export const Logo = {
  props: { size: { type: Number, default: 30 } },
  template: /*html*/ `
    <span class="inline-flex items-center gap-2.5">
      <img src="/tasks/favicon.svg" :width="size" :height="size" alt="" />
      <span class="font-display text-[19px] font-bold tracking-tight text-ink">Tick</span>
    </span>`,
};
