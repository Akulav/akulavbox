// Florin's icons (for <Icon>, hub/vue/icon.js), <CategoryIcon icon="coffee" color="#2a78d6" /> and the logo.
import { Icon, addIcons } from '/hub/vue/icon.js';
import { PATHS, CATEGORY_ICON_NAMES } from './icon-paths.js';

addIcons(PATHS);
export { Icon, CATEGORY_ICON_NAMES };

const DIMS = { sm: ['h-7 w-7 rounded-lg', 14], md: ['h-9 w-9 rounded-xl', 17], lg: ['h-11 w-11 rounded-xl', 20] };

export const CategoryIcon = {
  components: { Icon },
  props: { icon: { type: String, default: 'tag' }, color: { type: String, default: '#7f8882' }, size: { type: String, default: 'md' } },
  computed: {
    dims() {
      return DIMS[this.size] ?? DIMS.md;
    },
    known() {
      return CATEGORY_ICON_NAMES.includes(this.icon) ? this.icon : 'tag';
    },
  },
  template: /*html*/ `
    <span :class="['inline-flex shrink-0 items-center justify-center', dims[0]]" :style="{ backgroundColor: color + '1f', color }" aria-hidden="true">
      <Icon :name="known" :size="dims[1]" :stroke="2.1" />
    </span>`,
};

// Each logo needs its own gradient id: a shared one breaks when the first copy is hidden.
let logoSeq = 0;
export const LogoMark = {
  props: { size: { type: Number, default: 32 } },
  data: () => ({ gid: `florin-g-${++logoSeq}` }),
  template: /*html*/ `
    <svg :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#15b386" />
          <stop offset="1" stop-color="#076b50" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" :fill="'url(#' + gid + ')'" />
      <circle cx="49.5" cy="14.5" r="5.5" fill="#f3b93b" />
      <path d="M41 16.5c-2.6-2.4-8.6-2.6-10.4 3.4L24.4 46c-1.4 5.6-6.4 6.2-9 4" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round" />
      <path d="M20 31.5h17" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round" />
    </svg>`,
};

export const Logo = {
  components: { LogoMark },
  props: { size: { type: Number, default: 32 } },
  template: /*html*/ `
    <span class="inline-flex items-center gap-2.5">
      <LogoMark :size="size" />
      <span class="font-display text-[19px] font-extrabold tracking-tight text-ink">Florin</span>
    </span>`,
};

// Validated categorical palette (fixed order) followed by a few extra hues for larger sets.
export const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#0e8a9c', '#8a6d3b', '#b84fc2', '#6b7280'];
