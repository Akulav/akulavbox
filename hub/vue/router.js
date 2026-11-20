// A tiny history router for the Vue apps: the page lives at <base>/<path>, and the server sends its
// index.html for every such path, so links and reloads both work.
//   const { route, navigate, RouterLink } = createRouter('/tasks');
import { reactive, h } from 'vue';

export function createRouter(base) {
  const strip = (p) => (p.startsWith(base) ? p.slice(base.length) : p).replace(/\/+$/, '') || '/';
  const route = reactive({ path: strip(location.pathname), query: new URLSearchParams(location.search) });
  const href = (to) => base + (to === '/' ? '/' : to);

  function navigate(to, { replace = false } = {}) {
    const url = href(to);
    if (replace) history.replaceState(null, '', url);
    else if (url !== location.pathname + location.search) history.pushState(null, '', url);
    route.path = strip(to.split('?')[0]);
    route.query = new URLSearchParams(to.split('?')[1] || '');
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', () => {
    route.path = strip(location.pathname);
    route.query = new URLSearchParams(location.search);
  });

  /** <RouterLink to="/x">: a real link (opens in a new tab with a modifier), routed in place otherwise */
  const RouterLink = {
    props: { to: { type: String, required: true }, end: Boolean, activeClass: String, inactiveClass: String },
    emits: ['navigate'],
    setup(props, { slots, emit, attrs }) {
      return () => {
        const path = props.to.split('?')[0];
        const active = props.end ? route.path === path : route.path === path || route.path.startsWith(`${path}/`);
        return h(
          'a',
          {
            ...attrs,
            class: [attrs.class, active ? props.activeClass : props.inactiveClass],
            href: href(props.to),
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

  return { route, navigate, RouterLink };
}
