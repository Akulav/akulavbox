// Trove's brand: the mark (a brass tile with stacked layers) and the word mark. Trove is the files app
// of AkulavBox (the account and the server, whose own mark is on the sign-in page and the launcher).
let seq = 0;

export const APP_NAME = 'Trove';
export const SUITE_NAME = 'AkulavBox';
export const AUTHOR = 'Akulav';

export const BrandMark = {
  props: { size: { type: Number, default: 32 }, animated: Boolean },
  template: /*html*/`
    <svg :width="size" :height="size" viewBox="0 0 64 64" class="shrink-0 brand-mark" :class="{ 'brand-mark-animated': animated }" aria-hidden="true">
      <defs>
        <linearGradient :id="'bg' + uid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#F7C766" />
          <stop offset=".55" stop-color="#E8A33D" />
          <stop offset="1" stop-color="#C9711F" />
        </linearGradient>
        <linearGradient :id="'hi' + uid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".45" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" :fill="'url(#bg' + uid + ')'" />
      <rect x="2" y="2" width="60" height="30" rx="15" :fill="'url(#hi' + uid + ')'" opacity=".55" />
      <g fill="none" stroke="#21170A" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round">
        <path class="brand-lid" d="M32 14 50 22.5 32 31 14 22.5Z" fill="#FFF3D6" fill-opacity=".6" />
        <path d="M14 31.5 32 40 50 31.5" />
        <path d="M14 40.5 32 49 50 40.5" />
      </g>
    </svg>`,
  setup() { return { uid: ++seq }; },
};

export const BrandLockup = {
  components: { BrandMark },
  props: { size: { type: Number, default: 32 }, version: String, animated: Boolean },
  template: /*html*/`
    <span class="inline-flex items-center gap-2.5 min-w-0">
      <BrandMark :size="size" :animated="animated" />
      <span class="min-w-0 leading-none">
        <span class="title brand-text block" :style="{ fontSize: Math.round(size * 0.6) + 'px' }">Trove</span>
        <span v-if="version" class="block text-[10.5px] text-faint font-mono mt-1">v{{ version }}</span>
      </span>
    </span>`,
};

/** "Made by Akulav" credit */
export const MadeBy = {
  props: { version: String },
  template: /*html*/`
    <p class="text-[11.5px] text-faint flex items-center gap-1.5 flex-wrap">
      <span>Made with</span><span class="heart" aria-label="love">&#9829;</span><span>by <b class="font-semibold text-muted">Akulav</b></span>
      <template v-if="version"><span class="text-line">·</span><span class="font-mono">v{{ version }}</span></template>
    </p>`,
};
