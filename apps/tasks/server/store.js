'use strict';
// Tasks' data: every query is scoped to the account (user_id = the AkulavBox account id).
const { tx, get, all, run } = require('./db');
const repeat = require('./repeat');
const v = require('./validate');

const MAX_OPEN = 5000;
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/* ───────────── tasks ───────────── */

const shape = (t, tags, items) => ({
  id: t.id,
  listId: t.list_id,
  title: t.title,
  notes: t.notes,
  status: t.status,
  priority: t.priority,
  flagged: Boolean(t.flagged),
  dueDate: t.due_date,
  dueTime: t.due_time,
  repeat: t.repeat ? JSON.parse(t.repeat) : null,
  position: t.position,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  completedAt: t.completed_at,
  tags: tags.get(t.id) || [],
  checklist: items.get(t.id) || [],
});

/** Tasks with their tags and checklists, fetched in two queries whatever their number */
function withDetails(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const tags = new Map();
  for (const r of all(`SELECT task_id, tag FROM task_tags WHERE task_id IN (${marks}) ORDER BY tag`, ...ids)) {
    if (!tags.has(r.task_id)) tags.set(r.task_id, []);
    tags.get(r.task_id).push(r.tag);
  }
  const items = new Map();
  for (const r of all(`SELECT id, task_id, text, done FROM checklist WHERE task_id IN (${marks}) ORDER BY position, id`, ...ids)) {
    if (!items.has(r.task_id)) items.set(r.task_id, []);
    items.get(r.task_id).push({ id: r.id, text: r.text, done: Boolean(r.done) });
  }
  return rows.map((t) => shape(t, tags, items));
}

// large IN lists are split so SQLite's variable limit is never reached
function inChunks(rows, size = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(...withDetails(rows.slice(i, i + size)));
  return out;
}

/** Every open task (to do and doing): the page sorts, groups and counts them itself */
const openTasks = (uid) => inChunks(all(`SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY position, id LIMIT ${MAX_OPEN}`, uid));

/** Done tasks, newest first; or those due between from and to (the calendar) */
function doneTasks(uid, { offset = 0, limit = 50, listId, from, to } = {}) {
  const where = ["user_id = ?", "status = 'done'"];
  const params = [uid];
  if (listId === 'inbox') where.push('list_id IS NULL');
  else if (listId) { where.push('list_id = ?'); params.push(v.id(listId)); }
  if (from) { where.push('due_date >= ?'); params.push(v.date(from, 'From')); }
  if (to) { where.push('due_date <= ?'); params.push(v.date(to, 'To')); }
  const w = where.join(' AND ');
  const total = get(`SELECT COUNT(*) AS n FROM tasks WHERE ${w}`, ...params).n;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = all(`SELECT * FROM tasks WHERE ${w} ORDER BY completed_at DESC, id DESC LIMIT ${lim} OFFSET ${off}`, ...params);
  return { total, items: withDetails(rows) };
}

const rowOf = (uid, id) => {
  const t = get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', v.id(id), uid);
  if (!t) throw new v.HttpError(404, 'That task doesn’t exist any more.');
  return t;
};
const taskOf = (uid, id) => withDetails([rowOf(uid, id)])[0];

const ownList = (uid, listId) => {
  if (listId === null || listId === undefined || listId === '') return null;
  const id = v.id(listId);
  if (!get('SELECT 1 FROM lists WHERE id = ? AND user_id = ?', id, uid)) throw v.bad('That list doesn’t exist any more.');
  return id;
};

function setTags(taskId, tags) {
  run('DELETE FROM task_tags WHERE task_id = ?', taskId);
  for (const t of tags) run('INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)', taskId, t);
}
function setChecklist(taskId, items) {
  run('DELETE FROM checklist WHERE task_id = ?', taskId);
  items.forEach((i, n) => run('INSERT INTO checklist (task_id, text, done, position) VALUES (?, ?, ?, ?)', taskId, i.text, i.done ? 1 : 0, n));
}

/** The fields of a task from input; `base` is the task as it is, for a change */
function fields(uid, body, base = null) {
  const f = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!base || has('title')) f.title = v.text(body.title, 'The title', 500, { required: true });
  if (has('notes')) f.notes = v.notes(body.notes);
  if (has('listId')) f.list_id = ownList(uid, body.listId);
  if (has('priority')) f.priority = v.priority(body.priority);
  if (has('flagged')) f.flagged = body.flagged ? 1 : 0;
  if (has('status')) f.status = v.status(body.status);
  if (has('dueDate')) f.due_date = v.date(body.dueDate, 'The due date');
  if (has('dueTime')) f.due_time = v.time(body.dueTime);
  const due = has('dueDate') ? f.due_date : base?.due_date;
  if (has('repeat')) f.repeat = v.rule(body.repeat, due);
  if (f.due_date === null) f.due_time = null; // a time needs a day
  const out = { f, tags: has('tags') ? v.tags(body.tags) : null, checklist: has('checklist') ? v.checklist(body.checklist) : null };
  if (out.f.repeat !== undefined) out.f.repeat = out.f.repeat ? JSON.stringify(out.f.repeat) : null;
  return out;
}

function createTask(uid, body) {
  const { f, tags, checklist } = fields(uid, body);
  if (get("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status != 'done'", uid).n >= MAX_OPEN) throw v.bad(`You have ${MAX_OPEN} open tasks, the most Tick keeps. Finish or delete some first.`);
  return tx(() => {
    // new tasks go to the top of their list
    const top = get('SELECT MIN(position) AS p FROM tasks WHERE user_id = ?', uid).p;
    const status = f.status || 'todo';
    const r = run(
      `INSERT INTO tasks (user_id, list_id, title, notes, status, priority, flagged, due_date, due_time, repeat, position, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid, f.list_id ?? null, f.title, f.notes ?? '', status, f.priority ?? 0, f.flagged ?? 0, f.due_date ?? null, f.due_time ?? null, f.repeat ?? null,
      (top ?? 1) - 1, status === 'done' ? now() : null,
    );
    const id = Number(r.lastInsertRowid);
    if (tags) setTags(id, tags);
    if (checklist) setChecklist(id, checklist);
    return taskOf(uid, id);
  });
}

/**
 * Changes a task. Marking a repeating task done also creates its next copy (same list, tags and
 * checklist, unticked), returned as `next`. `undoNext` (the id of such a copy) with a reopen takes
 * that copy back again, for Undo.
 */
function updateTask(uid, id, body, today) {
  const base = rowOf(uid, id);
  const { f, tags, checklist } = fields(uid, body, base);
  return tx(() => {
    let next = null;
    if (f.status === 'done' && base.status !== 'done') {
      f.completed_at = now();
      const rule = f.repeat !== undefined ? (f.repeat ? JSON.parse(f.repeat) : null) : base.repeat ? JSON.parse(base.repeat) : null;
      if (rule) next = spawnNext({ ...base, ...f }, rule, today, tags, checklist);
    } else if (f.status && f.status !== 'done' && base.status === 'done') {
      f.completed_at = null;
      if (body.undoNext) run("DELETE FROM tasks WHERE id = ? AND user_id = ? AND status != 'done'", v.id(body.undoNext), uid);
    }
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`, ...keys.map((k) => f[k]), now(), base.id, uid);
    else run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), base.id);
    if (tags) setTags(base.id, tags);
    if (checklist) setChecklist(base.id, checklist);
    return { task: taskOf(uid, base.id), next: next && taskOf(uid, next) };
  });
}

function spawnNext(t, rule, today, tags, checklist) {
  const due = repeat.nextDue(t.due_date, rule, today);
  const r = run(
    `INSERT INTO tasks (user_id, list_id, title, notes, status, priority, flagged, due_date, due_time, repeat, position)
     VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
    t.user_id, t.list_id, t.title, t.notes, t.priority, t.flagged, due, t.due_time, JSON.stringify(rule), t.position,
  );
  const id = Number(r.lastInsertRowid);
  const oldTags = tags || all('SELECT tag FROM task_tags WHERE task_id = ?', t.id).map((x) => x.tag);
  setTags(id, oldTags);
  const items = (checklist || all('SELECT text FROM checklist WHERE task_id = ? ORDER BY position, id', t.id)).map((i) => ({ text: i.text, done: false }));
  setChecklist(id, items);
  return id;
}

const deleteTask = (uid, id) => run('DELETE FROM tasks WHERE id = ? AND user_id = ?', rowOf(uid, id).id, uid);

/** Puts tasks in this order (the ones given; the rest keep theirs) */
function reorder(uid, ids, table = 'tasks') {
  if (!Array.isArray(ids) || ids.length > 5000) throw v.bad('Send the ids in their new order.');
  tx(() => ids.forEach((id, i) => run(`UPDATE ${table} SET position = ? WHERE id = ? AND user_id = ?`, i, v.id(id), uid)));
}

/** Removes done tasks (of one list, or all): "Clear completed" */
function clearDone(uid, listId) {
  if (listId === 'inbox') return run("DELETE FROM tasks WHERE user_id = ? AND status = 'done' AND list_id IS NULL", uid).changes;
  if (listId) return run("DELETE FROM tasks WHERE user_id = ? AND status = 'done' AND list_id = ?", uid, v.id(listId)).changes;
  return run("DELETE FROM tasks WHERE user_id = ? AND status = 'done'", uid).changes;
}

/* ───────────── lists ───────────── */

const listShape = (l) => ({ id: l.id, name: l.name, color: l.color, icon: l.icon, position: l.position, open: l.open ?? 0, done: l.done ?? 0 });

const lists = (uid) =>
  all(
    `SELECT l.*, COALESCE(SUM(t.status != 'done'), 0) AS open, COALESCE(SUM(t.status = 'done'), 0) AS done
     FROM lists l LEFT JOIN tasks t ON t.list_id = l.id WHERE l.user_id = ? GROUP BY l.id ORDER BY l.position, l.id`,
    uid,
  ).map(listShape);

const listOf = (uid, id) => {
  const l = get('SELECT * FROM lists WHERE id = ? AND user_id = ?', v.id(id), uid);
  if (!l) throw new v.HttpError(404, 'That list doesn’t exist any more.');
  return l;
};

function createList(uid, body) {
  if (get('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?', uid).n >= 200) throw v.bad('You can have at most 200 lists.');
  const pos = (get('SELECT MAX(position) AS p FROM lists WHERE user_id = ?', uid).p ?? -1) + 1;
  const r = run('INSERT INTO lists (user_id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)', uid, v.text(body.name, 'The name', 80, { required: true }), v.color(body.color ?? '#8b5cf6'), v.icon(body.icon), pos);
  return listShape(listOf(uid, Number(r.lastInsertRowid)));
}

function updateList(uid, id, body) {
  const l = listOf(uid, id);
  const name = body.name !== undefined ? v.text(body.name, 'The name', 80, { required: true }) : l.name;
  const color = body.color !== undefined ? v.color(body.color) : l.color;
  const icon = body.icon !== undefined ? v.icon(body.icon) : l.icon;
  run('UPDATE lists SET name = ?, color = ?, icon = ? WHERE id = ?', name, color, icon, l.id);
  return lists(uid).find((x) => x.id === l.id);
}

/** Deletes a list; its tasks go to the Inbox, or with it (keepTasks: false) */
function deleteList(uid, id, { keepTasks = true } = {}) {
  const l = listOf(uid, id);
  tx(() => {
    if (!keepTasks) run('DELETE FROM tasks WHERE list_id = ? AND user_id = ?', l.id, uid);
    run('DELETE FROM lists WHERE id = ?', l.id); // the rest: list_id becomes NULL (ON DELETE SET NULL)
  });
}

/* ───────────── tags and preferences ───────────── */

const tagsOf = (uid) =>
  all(
    `SELECT tt.tag AS name, COUNT(*) AS count, SUM(t.status != 'done') AS open FROM task_tags tt
     JOIN tasks t ON t.id = tt.task_id WHERE t.user_id = ? GROUP BY tt.tag COLLATE NOCASE ORDER BY tt.tag COLLATE NOCASE`,
    uid,
  );

/** Renames a tag on every task of the account (merging with an existing one), or removes it (to = null) */
function renameTag(uid, from, to) {
  const ids = all('SELECT tt.task_id AS id FROM task_tags tt JOIN tasks t ON t.id = tt.task_id WHERE t.user_id = ? AND tt.tag = ?', uid, from).map((r) => r.id);
  const target = to === null ? null : v.tags([to])[0];
  if (to !== null && !target) throw v.bad('The new name can’t be empty.');
  tx(() => {
    for (const id of ids) {
      run('DELETE FROM task_tags WHERE task_id = ? AND tag = ?', id, from);
      if (target) run('INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)', id, target);
    }
  });
  return ids.length;
}

const PREF_DEFAULTS = { weekStart: 1, startView: 'today', showDoneInLists: false, sort: 'manual' };
function prefs(uid) {
  const row = get('SELECT value FROM prefs WHERE user_id = ?', uid);
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { /* reset below */ }
  return { ...PREF_DEFAULTS, ...saved };
}
function setPrefs(uid, body) {
  const p = prefs(uid);
  if (body.weekStart !== undefined) {
    if (![0, 1].includes(Number(body.weekStart))) throw v.bad('The week starts on Sunday (0) or Monday (1).');
    p.weekStart = Number(body.weekStart);
  }
  if (body.startView !== undefined) {
    if (!['inbox', 'today', 'upcoming', 'all'].includes(body.startView)) throw v.bad('Start in Inbox, Today, Upcoming or All.');
    p.startView = body.startView;
  }
  if (body.showDoneInLists !== undefined) p.showDoneInLists = Boolean(body.showDoneInLists);
  if (body.sort !== undefined) {
    if (!['manual', 'due', 'priority', 'title', 'created'].includes(body.sort)) throw v.bad('Unknown sort order.');
    p.sort = body.sort;
  }
  run('INSERT INTO prefs (user_id, value) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET value = excluded.value', uid, JSON.stringify(p));
  return p;
}

/* ───────────── for the rest of the server ───────────── */

const deleteUser = (uid) =>
  tx(() => {
    run('DELETE FROM tasks WHERE user_id = ?', uid); // tags and checklists go along (ON DELETE CASCADE)
    run('DELETE FROM lists WHERE user_id = ?', uid);
    run('DELETE FROM prefs WHERE user_id = ?', uid);
  });
const openCount = (uid) => get("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status != 'done'", uid).n;
const totalCount = () => get('SELECT COUNT(*) AS n FROM tasks').n;

module.exports = {
  openTasks, doneTasks, taskOf, createTask, updateTask, deleteTask, reorder, clearDone,
  lists, createList, updateList, deleteList,
  tagsOf, renameTag, prefs, setPrefs,
  deleteUser, openCount, totalCount,
};
