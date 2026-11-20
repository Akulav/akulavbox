// The page's state: the account, its lists, every open task (the page sorts, groups and counts
// them itself, so switching views is instant), the done ones on demand, toasts and the open task.
// Changes show at once and are sent to the server; a failure puts things back and says why.
import { reactive } from 'vue';
import { api, qs } from './api.js';
import { todayISO, dayLabel } from './dates.js';

export const store = reactive({
  ready: false,
  user: null,
  error: null, // e.g. Tasks is turned off for this account
  prefs: { weekStart: 1, startView: 'today', showDoneInLists: false, sort: 'manual' },
  lists: [],
  tasks: [], // open tasks (to do and doing)
  done: { items: [], total: 0, loaded: false }, // the newest done tasks
  leaving: {}, // id → true while a ticked task plays its way out
  selectedId: null, // the task open in the details panel
  toasts: [],
  today: todayISO(),
  quickFocus: 0, // bumped to focus the quick-add box
});

// the date moves on at midnight even if the page stays open
setInterval(() => {
  const t = todayISO();
  if (t !== store.today) store.today = t;
}, 60_000);

/* ───────────── toasts ───────────── */
export function toast(message, { error = false, action = null, ms = error ? 6000 : 4500 } = {}) {
  const id = Math.random().toString(36).slice(2);
  store.toasts.push({ id, message, error, action });
  setTimeout(() => dismiss(id), ms);
}
export const dismiss = (id) => (store.toasts = store.toasts.filter((t) => t.id !== id));
const fail = (e) => toast(e.message, { error: true });

/* ───────────── loading ───────────── */
export async function load() {
  try {
    const d = await api.get('/bootstrap');
    Object.assign(store, { user: d.user, prefs: d.prefs, lists: d.lists, tasks: d.tasks });
    loadDone().catch(() => {});
  } catch (e) {
    if (e.status !== 401) store.error = e.message; // 401 already went to the sign-in page
  } finally {
    store.ready = true;
  }
}

export async function loadDone({ more = false } = {}) {
  const d = await api.get(`/tasks/done${qs({ limit: 100, offset: more ? store.done.items.length : 0 })}`);
  store.done = { items: more ? [...store.done.items, ...d.items] : d.items, total: d.total, loaded: true };
}

/** Done tasks due in a range, for the calendar */
export const doneBetween = (from, to) => api.get(`/tasks/done${qs({ from, to, limit: 500 })}`).then((d) => d.items);

/* ───────────── tasks ───────────── */
export const taskById = (id) => store.tasks.find((t) => t.id === id) || store.done.items.find((t) => t.id === id);

const replaceTask = (t) => {
  const i = store.tasks.findIndex((x) => x.id === t.id);
  const j = store.done.items.findIndex((x) => x.id === t.id);
  if (t.status === 'done') {
    if (i >= 0) store.tasks.splice(i, 1);
    if (j >= 0) store.done.items.splice(j, 1, t);
    else {
      store.done.items.unshift(t);
      store.done.total++;
    }
  } else {
    if (j >= 0) {
      store.done.items.splice(j, 1);
      store.done.total = Math.max(0, store.done.total - 1);
    }
    if (i >= 0) store.tasks.splice(i, 1, t);
    else store.tasks.unshift(t);
  }
};
const refreshCounts = () => api.get('/lists').then((d) => (store.lists = d.lists)).catch(() => {});

export async function addTask(fields) {
  try {
    const { task } = await api.post('/tasks', fields);
    store.tasks.unshift(task);
    refreshCounts();
    return task;
  } catch (e) {
    fail(e);
    return null;
  }
}

/** Changes a task; the change shows at once. Returns the server's answer, or null when it failed. */
export async function updateTask(task, fields) {
  const before = JSON.parse(JSON.stringify(task));
  Object.assign(task, fields);
  try {
    const r = await api.patch(`/tasks/${task.id}`, fields);
    replaceTask(r.task);
    if (r.next) store.tasks.unshift(r.next);
    if ('listId' in fields || 'status' in fields) refreshCounts();
    return r;
  } catch (e) {
    Object.assign(task, before);
    fail(e);
    return null;
  }
}

/** Ticks a task (it strikes through, then leaves, with Undo), or unticks a done one */
export async function toggleDone(task) {
  if (task.status === 'done') return reopen(task);
  store.leaving[task.id] = true;
  const r = await updateTask(task, { status: 'done' });
  setTimeout(() => delete store.leaving[task.id], 900);
  if (!r) return;
  if (store.selectedId === task.id) store.selectedId = null;
  const next = r.next;
  toast(next ? `Done. Next one: ${dayLabel(next.dueDate, store.today)}` : 'Done', { action: { label: 'Undo', run: () => reopen(r.task, next?.id) } });
}

async function reopen(task, undoNext) {
  const r = await updateTask(task, { status: 'todo', ...(undoNext ? { undoNext } : {}) });
  if (r && undoNext) store.tasks = store.tasks.filter((t) => t.id !== undoNext);
}

/** Deletes a task, with Undo (which makes it again: same fields, new id) */
export async function deleteTask(task) {
  const copy = JSON.parse(JSON.stringify(task));
  store.tasks = store.tasks.filter((t) => t.id !== task.id);
  store.done.items = store.done.items.filter((t) => t.id !== task.id);
  if (store.selectedId === task.id) store.selectedId = null;
  try {
    await api.del(`/tasks/${task.id}`);
    refreshCounts();
    toast('Task deleted', {
      action: {
        label: 'Undo',
        run: () => addTask({ title: copy.title, notes: copy.notes, listId: copy.listId, priority: copy.priority, flagged: copy.flagged, status: copy.status, dueDate: copy.dueDate, dueTime: copy.dueTime, repeat: copy.repeat, tags: copy.tags, checklist: copy.checklist }),
      },
    });
  } catch (e) {
    replaceTask(copy);
    fail(e);
  }
}

/** Saves a new order of tasks (the ones shown, top to bottom) */
export async function reorderTasks(ids) {
  ids.forEach((id, i) => {
    const t = store.tasks.find((x) => x.id === id);
    if (t) t.position = i;
  });
  try {
    await api.post('/tasks/reorder', { ids });
  } catch (e) {
    fail(e);
  }
}

export async function clearDone(listId) {
  try {
    const { removed } = await api.post('/tasks/clear-done', { listId });
    await loadDone();
    refreshCounts();
    toast(`Removed ${removed} done task${removed === 1 ? '' : 's'}`);
  } catch (e) {
    fail(e);
  }
}

/* ───────────── lists ───────────── */
export async function saveList(list, fields) {
  try {
    if (list) {
      const { list: l } = await api.patch(`/lists/${list.id}`, fields);
      store.lists.splice(store.lists.findIndex((x) => x.id === l.id), 1, l);
      return l;
    }
    const { list: l } = await api.post('/lists', fields);
    store.lists.push(l);
    return l;
  } catch (e) {
    fail(e);
    return null;
  }
}

export async function deleteList(list, { keepTasks = true } = {}) {
  try {
    await api.del(`/lists/${list.id}${keepTasks ? '' : '?tasks=delete'}`);
    store.lists = store.lists.filter((l) => l.id !== list.id);
    if (keepTasks) store.tasks.forEach((t) => t.listId === list.id && (t.listId = null));
    else store.tasks = store.tasks.filter((t) => t.listId !== list.id);
    toast(keepTasks ? `“${list.name}” deleted; its tasks are in the Inbox` : `“${list.name}” and its tasks deleted`);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

export async function reorderLists(ids) {
  store.lists.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  try {
    await api.post('/lists/reorder', { ids });
  } catch (e) {
    fail(e);
  }
}

/* ───────────── tags and preferences ───────────── */
export async function renameTag(from, to) {
  try {
    await api.patch(`/tags/${encodeURIComponent(from)}`, { name: to });
    const d = await api.get('/tasks');
    store.tasks = d.tasks;
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
export async function removeTag(tag) {
  try {
    await api.del(`/tags/${encodeURIComponent(tag)}`);
    store.tasks.forEach((t) => (t.tags = t.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase())));
    toast(`#${tag} removed from every task`);
  } catch (e) {
    fail(e);
  }
}

export async function savePrefs(fields) {
  Object.assign(store.prefs, fields);
  try {
    store.prefs = (await api.patch('/prefs', fields)).prefs;
  } catch (e) {
    fail(e);
  }
}

export const listById = (id) => store.lists.find((l) => l.id === id) || null;
