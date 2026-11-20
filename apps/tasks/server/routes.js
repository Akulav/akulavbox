'use strict';
// Tasks' API (under /tasks/api, every route needs a signed-in account). The page sends its own
// date as ?today= or { today } so "today" and repeats follow the person's clock, not the server's.
const store = require('./store');
const v = require('./validate');
const { requireAuth } = require('./auth');

const serverToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayOf = (req) => v.date(req.body?.today ?? req.query?.today) || serverToday();

module.exports = async function routes(api) {
  api.addHook('preHandler', requireAuth);

  // the account, its preferences and everything the page shows at once
  api.get('/bootstrap', async (req) => ({
    user: req.user,
    prefs: store.prefs(req.user.id),
    lists: store.lists(req.user.id),
    tasks: store.openTasks(req.user.id),
  }));

  /* tasks */
  api.get('/tasks', async (req) => ({ tasks: store.openTasks(req.user.id) }));
  api.get('/tasks/done', async (req) => store.doneTasks(req.user.id, req.query));
  api.get('/tasks/:id', async (req) => ({ task: store.taskOf(req.user.id, req.params.id) }));
  api.post('/tasks', async (req, reply) => reply.code(201).send({ task: store.createTask(req.user.id, req.body || {}) }));
  api.patch('/tasks/:id', async (req) => store.updateTask(req.user.id, req.params.id, req.body || {}, todayOf(req)));
  api.delete('/tasks/:id', async (req) => {
    store.deleteTask(req.user.id, req.params.id);
    return { success: true };
  });
  api.post('/tasks/reorder', async (req) => {
    store.reorder(req.user.id, req.body?.ids);
    return { success: true };
  });
  api.post('/tasks/clear-done', async (req) => ({ removed: store.clearDone(req.user.id, req.body?.listId) }));

  /* lists */
  api.get('/lists', async (req) => ({ lists: store.lists(req.user.id) }));
  api.post('/lists', async (req, reply) => reply.code(201).send({ list: store.createList(req.user.id, req.body || {}) }));
  api.patch('/lists/:id', async (req) => ({ list: store.updateList(req.user.id, req.params.id, req.body || {}) }));
  api.delete('/lists/:id', async (req) => {
    store.deleteList(req.user.id, req.params.id, { keepTasks: req.query.tasks !== 'delete' });
    return { success: true };
  });
  api.post('/lists/reorder', async (req) => {
    store.reorder(req.user.id, req.body?.ids, 'lists');
    return { success: true };
  });

  /* tags */
  api.get('/tags', async (req) => ({ tags: store.tagsOf(req.user.id) }));
  api.patch('/tags/:tag', async (req) => ({ changed: store.renameTag(req.user.id, req.params.tag, req.body?.name ?? '') }));
  api.delete('/tags/:tag', async (req) => ({ changed: store.renameTag(req.user.id, req.params.tag, null) }));

  /* preferences */
  api.get('/prefs', async (req) => ({ prefs: store.prefs(req.user.id) }));
  api.patch('/prefs', async (req) => ({ prefs: store.setPrefs(req.user.id, req.body || {}) }));
};
