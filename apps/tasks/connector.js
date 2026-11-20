'use strict';
// Tick's tools for the AI connector (src/core/connector/tools.js). They go through Tick's own API
// (/tasks/api), so validation, repeats and ownership work exactly as in the page.
const { ToolError, helpers: { str, int, need } } = require('../../src/core/connector/tools');

const API = '/tasks/api';
const today = () => new Date().toISOString().slice(0, 10);

const task = (t, lists) => ({
  id: t.id, title: t.title, status: t.status, ...(t.notes ? { notes: t.notes } : {}),
  list: t.listId ? lists.get(t.listId) || t.listId : 'Inbox', ...(t.listId ? { list_id: t.listId } : {}),
  ...(t.dueDate ? { due: t.dueTime ? `${t.dueDate} ${t.dueTime}` : t.dueDate } : {}),
  ...(t.priority ? { priority: ['none', 'low', 'medium', 'high'][t.priority] || t.priority } : {}),
  ...(t.flagged ? { flagged: true } : {}), ...(t.tags.length ? { tags: t.tags } : {}),
  ...(t.checklist.length ? { checklist: t.checklist.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`) } : {}),
  ...(t.repeat ? { repeats: t.repeat } : {}), ...(t.completedAt ? { completed_at: t.completedAt } : {}),
});

const PRIORITY = { none: 0, low: 1, medium: 2, high: 3 };
/** The fields a tool may set, in Tick's API names */
function body(a) {
  const b = {};
  if (a.title !== undefined) b.title = str(a.title, 500);
  if (a.notes !== undefined) b.notes = typeof a.notes === 'string' ? a.notes : '';
  if (a.list_id !== undefined) b.listId = a.list_id === null || a.list_id === '' ? null : a.list_id;
  if (a.due_date !== undefined) b.dueDate = a.due_date || null;
  if (a.due_time !== undefined) b.dueTime = a.due_time || null;
  if (a.priority !== undefined) b.priority = typeof a.priority === 'number' ? a.priority : PRIORITY[a.priority] ?? 0;
  if (a.flagged !== undefined) b.flagged = !!a.flagged;
  if (a.tags !== undefined) b.tags = [].concat(a.tags || []);
  if (a.checklist !== undefined) b.checklist = [].concat(a.checklist || []).map((i) => (typeof i === 'string' ? { text: i } : i));
  if (a.repeat !== undefined) b.repeat = a.repeat || null;
  if (a.status !== undefined) b.status = a.status;
  return b;
}

const FIELDS = {
  title: { type: 'string' },
  notes: { type: 'string', description: 'Markdown is fine' },
  list_id: { type: ['integer', 'null'], description: 'A list id from tick_lists; null for the Inbox' },
  due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  due_time: { type: ['string', 'null'], description: 'HH:MM, 24-hour (needs a due date)' },
  priority: { type: 'string', enum: Object.keys(PRIORITY) },
  flagged: { type: 'boolean' },
  tags: { type: 'array', items: { type: 'string' } },
  checklist: { type: 'array', items: { type: 'string' }, description: 'Steps, as plain text' },
  repeat: { type: ['object', 'null'], description: 'e.g. { "every": 1, "unit": "week", "weekdays": [1,3] } or { "every": 2, "unit": "day" }; units: day, week, month, year' },
};

async function listsOf(ctx) {
  const r = await ctx.call('tasks', 'GET', `${API}/lists`);
  return r.lists;
}

const tools = [
  {
    name: 'tick_lists', write: false, title: 'Tick lists and tags',
    description: 'The lists (with how many open and done tasks each has) and the tags in use.',
    input: {},
    run: async (ctx) => {
      const [lists, tags] = await Promise.all([listsOf(ctx), ctx.call('tasks', 'GET', `${API}/tags`)]);
      return { lists: lists.map((l) => ({ id: l.id, name: l.name, open: l.open, done: l.done })), tags: tags.tags };
    },
  },
  {
    name: 'tick_list_tasks', write: false, title: 'List Tick tasks',
    description: 'Open tasks (to do and doing), optionally only one list, one tag, those due by a date, or matching a text. With done: true, recently completed tasks instead.',
    input: {
      list_id: { type: ['integer', 'string'], description: 'A list id, or "inbox"' },
      tag: { type: 'string' },
      due_by: { type: 'string', description: 'YYYY-MM-DD: only tasks due on or before it (overdue included)' },
      query: { type: 'string', description: 'Text in the title or notes' },
      done: { type: 'boolean', description: 'Completed tasks instead of open ones' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    },
    run: async (ctx, a) => {
      const lists = new Map((await listsOf(ctx)).map((l) => [l.id, l.name]));
      const limit = int(a.limit, 100, 1, 500);
      let items;
      if (a.done) {
        const q = new URLSearchParams({ limit: String(limit) });
        if (a.list_id !== undefined && a.list_id !== null && a.list_id !== '') q.set('listId', String(a.list_id));
        items = (await ctx.call('tasks', 'GET', `${API}/tasks/done?${q}`)).items;
      } else {
        items = (await ctx.call('tasks', 'GET', `${API}/tasks`)).tasks;
        if (a.list_id === 'inbox') items = items.filter((t) => !t.listId);
        else if (a.list_id !== undefined && a.list_id !== null && a.list_id !== '') items = items.filter((t) => String(t.listId) === String(a.list_id));
        if (a.due_by) items = items.filter((t) => t.dueDate && t.dueDate <= str(a.due_by, 10));
        items.sort((x, y) => (x.dueDate || '9999').localeCompare(y.dueDate || '9999') || y.priority - x.priority || x.position - y.position);
      }
      if (a.tag) { const tag = str(a.tag, 60).replace(/^#/, '').toLowerCase(); items = items.filter((t) => t.tags.some((x) => x.toLowerCase() === tag)); }
      if (a.query) { const q = str(a.query, 200).toLowerCase(); items = items.filter((t) => `${t.title}\n${t.notes}`.toLowerCase().includes(q)); }
      return { today: today(), total: items.length, tasks: items.slice(0, limit).map((t) => task(t, lists)) };
    },
  },
  {
    name: 'tick_add_task', write: true, title: 'Add a Tick task',
    description: 'A new task (in the Inbox unless a list is given), with an optional due date and time, priority, tags, checklist and repeat.',
    input: FIELDS, required: ['title'],
    run: async (ctx, a) => {
      need(str(a.title, 500), 'title');
      const lists = new Map((await listsOf(ctx)).map((l) => [l.id, l.name]));
      return { task: task((await ctx.call('tasks', 'POST', `${API}/tasks`, { json: body(a) })).task, lists) };
    },
  },
  {
    name: 'tick_update_task', write: true, title: 'Change a Tick task',
    description: 'Change any of a task’s fields; the ones left out stay as they are. Use tick_complete_task to tick it off.',
    input: { id: { type: 'integer' }, ...FIELDS, status: { type: 'string', enum: ['todo', 'doing', 'done'] } }, required: ['id'],
    run: async (ctx, a) => {
      const lists = new Map((await listsOf(ctx)).map((l) => [l.id, l.name]));
      const r = await ctx.call('tasks', 'PATCH', `${API}/tasks/${int(a.id, 0, 0, Number.MAX_SAFE_INTEGER)}`, { json: { ...body(a), today: today() } });
      return { task: task(r.task, lists), ...(r.next ? { next_repeat: task(r.next, lists) } : {}) };
    },
  },
  {
    name: 'tick_complete_task', write: true, title: 'Tick off a task',
    description: 'Mark a task done (a repeating one gets its next copy), or open it again with done: false.',
    input: { id: { type: 'integer' }, done: { type: 'boolean', default: true } }, required: ['id'],
    run: async (ctx, a) => {
      const lists = new Map((await listsOf(ctx)).map((l) => [l.id, l.name]));
      const r = await ctx.call('tasks', 'PATCH', `${API}/tasks/${int(a.id, 0, 0, Number.MAX_SAFE_INTEGER)}`, { json: { status: a.done === false ? 'todo' : 'done', today: today() } });
      return { task: task(r.task, lists), ...(r.next ? { next_repeat: task(r.next, lists) } : {}) };
    },
  },
  {
    name: 'tick_delete_task', write: true, destructive: true, title: 'Delete a Tick task',
    description: 'Delete a task for good (there is no trash in Tick). Prefer tick_complete_task for finished work.',
    input: { id: { type: 'integer' } }, required: ['id'],
    run: async (ctx, a) => ctx.call('tasks', 'DELETE', `${API}/tasks/${int(a.id, 0, 0, Number.MAX_SAFE_INTEGER)}`),
  },
  {
    name: 'tick_create_list', write: true, title: 'Create a Tick list',
    description: 'A new list for tasks.',
    input: { name: { type: 'string' }, color: { type: 'string', description: '#rrggbb (optional)' } }, required: ['name'],
    run: async (ctx, a) => {
      const r = await ctx.call('tasks', 'POST', `${API}/lists`, { json: { name: need(str(a.name, 80), 'name'), color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '#8b5cf6', icon: 'list' } });
      if (!r?.list) throw new ToolError('The list could not be made.');
      return { list: { id: r.list.id, name: r.list.name } };
    },
  },
];

module.exports = { tools };
