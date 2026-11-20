// The views: smart ones (Inbox, Today, Upcoming, Flagged, All, Completed), one per list, one per
// tag, and search. Each says which open tasks it shows and what a task added there gets.
import { computed } from 'vue';
import { store, listById } from './store.js';
import { addDays, diffDays, dayLabel, MONTHS, DAYS, parseISO } from './dates.js';

/** "Sat 21 Nov" */
const shortDate = (s) => {
  const d = parseISO(s);
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};

export const SMART = [
  { id: 'inbox', name: 'Inbox', icon: 'inbox', color: '#3b82f6' },
  { id: 'today', name: 'Today', icon: 'sun', color: '#e7a727' },
  { id: 'upcoming', name: 'Upcoming', icon: 'calendar-days', color: '#f97316' },
  { id: 'flagged', name: 'Flagged', icon: 'flag', color: '#e5484d' },
  { id: 'all', name: 'All tasks', icon: 'layers', color: '#64748b' },
  { id: 'done', name: 'Completed', icon: 'circle-check', color: '#22a06b' },
];

const FILTERS = {
  inbox: (t) => t.listId === null,
  today: (t) => t.dueDate && t.dueDate <= store.today,
  upcoming: (t) => t.dueDate && t.dueDate >= store.today,
  flagged: (t) => t.flagged,
  all: () => true,
};

/** What a path shows: { kind, key, title, icon, color, filter, defaults, list? } */
export function viewOf(path, query) {
  const [, a, b] = path.split('/');
  if (a === 'list' && b) {
    const list = listById(Number(b));
    if (list) return { kind: 'list', key: `list:${list.id}`, title: list.name, icon: list.icon, color: list.color, list, filter: (t) => t.listId === list.id, defaults: { listId: list.id } };
  }
  if (a === 'tag' && b) {
    const tag = decodeURIComponent(b);
    return { kind: 'tag', key: `tag:${tag.toLowerCase()}`, title: `#${tag}`, icon: 'hash', color: '#8b5cf6', tag, filter: (t) => t.tags.some((x) => x.toLowerCase() === tag.toLowerCase()), defaults: { tags: [tag] } };
  }
  if (a === 'search') {
    const q = (query.get('q') || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const hay = (t) => `${t.title} ${t.notes} ${t.tags.map((x) => `#${x}`).join(' ')} ${t.checklist.map((i) => i.text).join(' ')}`.toLowerCase();
    return { kind: 'search', key: 'search', title: q ? `“${query.get('q')}”` : 'Search', icon: 'search', color: '#64748b', q, filter: (t) => words.every((w) => hay(t).includes(w)), defaults: {} };
  }
  const smart = SMART.find((s) => s.id === a) || SMART.find((s) => s.id === store.prefs.startView) || SMART[1];
  const defaults = smart.id === 'today' ? { dueDate: store.today } : smart.id === 'flagged' ? { flagged: true } : {};
  return { kind: 'smart', key: smart.id, title: smart.name, icon: smart.icon, color: smart.color, filter: FILTERS[smart.id] || (() => false), defaults };
}

/* ───────────── sorting and grouping ───────────── */
const byPosition = (a, b) => a.position - b.position || b.id - a.id;
const byDue = (a, b) => (a.dueDate || '9999') .localeCompare(b.dueDate || '9999') || (a.dueTime || '99').localeCompare(b.dueTime || '99') || b.priority - a.priority || byPosition(a, b);
export const SORTS = {
  manual: { label: 'Manual (drag to order)', fn: byPosition },
  due: { label: 'Due date', fn: byDue },
  priority: { label: 'Priority', fn: (a, b) => b.priority - a.priority || byDue(a, b) },
  title: { label: 'Title', fn: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || byPosition(a, b) },
  created: { label: 'Newest first', fn: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id },
};
export const sortTasks = (tasks, sort) => [...tasks].sort((SORTS[sort] || SORTS.manual).fn);

export const GROUPS = { none: 'No groups', due: 'Due date', priority: 'Priority', list: 'List', status: 'Status' };
const PRIORITY_NAMES = ['No priority', 'Low', 'Medium', 'High'];

/** Groups for the list layout: [{ key, label, tone, tasks, defaults }] (defaults: what a task added there gets) */
export function groupTasks(tasks, by, view) {
  const today = store.today;
  if (view.key === 'today') {
    const overdue = tasks.filter((t) => t.dueDate < today);
    return [
      ...(overdue.length ? [{ key: 'overdue', label: 'Overdue', tone: 'overdue', tasks: overdue }] : []),
      { key: 'today', label: 'Today', sub: shortDate(today), tasks: tasks.filter((t) => t.dueDate === today), defaults: { dueDate: today } },
    ];
  }
  if (view.key === 'upcoming') {
    // the next seven days one by one (also empty ones, to add to), then the rest by month
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    const groups = days.map((d, i) => ({ key: d, label: dayLabel(d, today), sub: i < 2 ? shortDate(d) : shortDate(d).slice(4), tasks: tasks.filter((t) => t.dueDate === d), defaults: { dueDate: d }, day: d }));
    const later = tasks.filter((t) => t.dueDate > days[6]);
    const months = new Map();
    for (const t of later) {
      const k = t.dueDate.slice(0, 7);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(t);
    }
    for (const [k, list] of months) {
      const d = parseISO(`${k}-01`);
      groups.push({ key: k, label: `${MONTHS[d.getMonth()]}${d.getFullYear() !== parseISO(today).getFullYear() ? ` ${d.getFullYear()}` : ''}`, tasks: list });
    }
    return groups;
  }
  if (by === 'due') {
    const buckets = [
      ['overdue', 'Overdue', (t) => t.dueDate && t.dueDate < today, 'overdue'],
      ['today', 'Today', (t) => t.dueDate === today],
      ['tomorrow', 'Tomorrow', (t) => t.dueDate === addDays(today, 1)],
      ['week', 'Next 7 days', (t) => t.dueDate && diffDays(today, t.dueDate) > 1 && diffDays(today, t.dueDate) < 7],
      ['later', 'Later', (t) => t.dueDate && diffDays(today, t.dueDate) >= 7],
      ['none', 'No date', (t) => !t.dueDate],
    ];
    const dates = { today, tomorrow: addDays(today, 1), none: null };
    return buckets.map(([key, label, fn, tone]) => ({ key, label, tone, tasks: tasks.filter(fn), defaults: key in dates ? { dueDate: dates[key] } : undefined })).filter((g) => g.tasks.length);
  }
  if (by === 'priority') return [3, 2, 1, 0].map((p) => ({ key: `p${p}`, label: PRIORITY_NAMES[p], priority: p, tasks: tasks.filter((t) => t.priority === p), defaults: { priority: p } })).filter((g) => g.tasks.length);
  if (by === 'list') {
    const groups = [{ key: 'inbox', label: 'Inbox', tasks: tasks.filter((t) => !t.listId), defaults: { listId: null } }];
    for (const l of store.lists) groups.push({ key: `l${l.id}`, label: l.name, color: l.color, tasks: tasks.filter((t) => t.listId === l.id), defaults: { listId: l.id } });
    return groups.filter((g) => g.tasks.length);
  }
  if (by === 'status') return [['doing', 'In progress'], ['todo', 'To do']].map(([s, label]) => ({ key: s, label, tasks: tasks.filter((t) => t.status === s), defaults: { status: s } })).filter((g) => g.tasks.length);
  return [{ key: 'all', label: '', tasks }];
}

/* ───────────── counts for the sidebar ───────────── */
export const counts = computed(() => {
  const c = { inbox: 0, today: 0, overdue: 0, upcoming: 0, flagged: 0, all: store.tasks.length, done: store.done.total };
  for (const t of store.tasks) {
    if (t.listId === null) c.inbox++;
    if (t.dueDate && t.dueDate <= store.today) c.today++;
    if (t.dueDate && t.dueDate < store.today) c.overdue++;
    if (t.dueDate && t.dueDate >= store.today) c.upcoming++;
    if (t.flagged) c.flagged++;
  }
  return c;
});

export const tagCounts = computed(() => {
  const m = new Map();
  for (const t of store.tasks) for (const tag of t.tags) {
    const k = tag.toLowerCase();
    const e = m.get(k) || { name: tag, count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
});

export const listCounts = computed(() => {
  const m = {};
  for (const t of store.tasks) if (t.listId) m[t.listId] = (m[t.listId] || 0) + 1;
  return m;
});

/** Tasks done today (for Today's progress ring) */
export const doneToday = computed(() => store.done.items.filter((t) => t.completedAt && localDay(t.completedAt) === store.today).length);
const localDay = (utc) => {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { localDay };
