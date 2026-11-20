// <Icon name="plus" :size="16" />: Lucide icons (ISC) as inline SVG. Shared by the Vue apps (Florin,
// Tasks); each registers the icons it uses with addIcons() before mounting.
import { h } from 'vue';

const PATHS = {};
/** { name: '<path …/>' } */
export const addIcons = (paths) => Object.assign(PATHS, paths);

export const Icon = {
  props: { name: { type: String, required: true }, size: { type: [Number, String], default: 16 }, stroke: { type: [Number, String], default: 2 } },
  setup(props) {
    return () =>
      h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: props.size,
        height: props.size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': props.stroke,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        class: 'shrink-0',
        innerHTML: PATHS[props.name] ?? PATHS.tag ?? '',
      });
  },
};
