// Tasks' pages: /tasks/today, /tasks/list/3, /tasks/tag/home, /tasks/search?q=… (the router is
// shared with the other Vue apps, hub/vue/router.js)
import { createRouter } from '/hub/vue/router.js';
import { BASE } from './api.js';

export const { route, navigate, RouterLink } = createRouter(BASE);
