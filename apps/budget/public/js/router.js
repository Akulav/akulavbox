// A tiny history router: the page lives at /budget/<path>, and the server sends index.html for
// every such path, so links and reloads both work.
import { reactive, h } from 'vue';
import { BASE } from './api.js';

const strip = (p) => (p.startsWith(BASE) ? p.slice(BASE.length) : p).replace(/\/+$/, '') || '/';

export const route = reactive({ path: strip(location.pathname) });

export function navigate(to, { replace = false } = {}) {
  const url = BASE + (to === '/' ? '/' : to);
  if (replace) history.replaceState(null, '', url);
  else if (url !== location.pathname) history.pushState(null, '', url);
  route.path = strip(to);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => (route.path = strip(location.pathname)));

/** <RouterLink to="/transactions">: a real link (opens in a new tab with a modifier), routed in place otherwise */
export const RouterLink = {
  props: { to: { type: String, required: true }, end: Boolean, activeClass: String, inactiveClass: String },
  emits: ['navigate'],
  setup(props, { slots, emit, attrs }) {
    return () => {
      const active = props.end ? route.path === props.to : route.path === props.to || route.path.startsWith(`${props.to}/`);
      const cls = [attrs.class, active ? props.activeClass : props.inactiveClass];
      return h(
        'a',
        {
          ...attrs,
          class: cls,
          href: BASE + (props.to === '/' ? '/' : props.to),
          'aria-current': active ? 'page' : undefined,
          onClick: (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigate(props.to);
            emit('navigate');
          },
        },
        slots.default?.(),
      );
    };
  },
};
