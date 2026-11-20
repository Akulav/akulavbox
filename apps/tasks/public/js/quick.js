// Quick add: one line of text → a task. What it understands (anywhere in the line):
//   dates     today, tonight, tomorrow (tmr), the day after tomorrow, monday … sunday (mon, next fri, on wed),
//             this weekend, next week, next month, in 3 days / 2 weeks / a month, dec 5, 5 december, 2026-12-05
//   times     at 5pm, 9:30, 17:00, noon
//   repeats   daily, weekly, monthly, yearly, every day / weekday / 2 weeks / monday and thursday / month / year
//   priority  !1 … !3 (3 is high), !low, !medium, !high, !!!, !!
//   flag      *
//   tags      #errands
//   list      @work (the start of a list's name is enough; spaces may be left out or written as -)
// Each match leaves the title; `tokens` lists them for the chips under the box.
import { todayISO, addDays, addMonths, weekday, startOfWeek, MONTHS, DAYS } from './dates.js';

const DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const dayIndex = (s) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.slice(0, 3).toLowerCase());
const monthIndex = (s) => MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === s.slice(0, 3).toLowerCase());
const UNIT = { d: 'day', day: 'day', days: 'day', w: 'week', wk: 'week', week: 'week', weeks: 'week', m: 'month', mo: 'month', month: 'month', months: 'month', y: 'year', yr: 'year', year: 'year', years: 'year' };
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s) => NUM[s.toLowerCase()] ?? Number(s);
const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');

/** The next date after today that falls on weekday d (0 = Sunday) */
const nextWeekday = (today, d) => addDays(today, ((d - weekday(today) + 7) % 7) || 7);

/** The first time a rule falls on, starting today */
function firstDue(rule, today) {
  if (rule.unit === 'week' && rule.weekdays?.length) {
    for (let i = 0; i < 7; i++) if (rule.weekdays.includes(weekday(addDays(today, i)))) return addDays(today, i);
  }
  return today;
}

function to24(h, m, ap) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ap) {
    const pm = /^p/i.test(ap);
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * @param {string} text the line typed
 * @param {{ lists?: {id, name}[], today?: string, weekStart?: number }} ctx
 * @returns {{ title, dueDate, dueTime, priority, flagged, tags, listId, repeat, tokens: {type, text, label}[] }}
 */
export function parseQuick(text, { lists = [], today = todayISO(), weekStart = 1 } = {}) {
  const out = { title: '', dueDate: null, dueTime: null, priority: 0, flagged: false, tags: [], listId: null, repeat: null, tokens: [] };
  let s = ` ${String(text || '')} `;
  // each pattern matches whole words: it must start after a space and end before one
  const take = (re, fn) => {
    const full = new RegExp(`(\\s)(?:${re.source})(?=\\s)`, `g${re.flags.replace('g', '')}`);
    s = s.replace(full, (m, sp, ...groups) => {
      const raw = m.slice(1);
      const res = fn(raw, ...groups.slice(0, -2));
      return res === false ? m : ' ';
    });
  };
  const token = (type, raw, label) => out.tokens.push({ type, text: raw, label });

  // repeats first: "every monday" must not become a plain date
  take(/(?:every|each)\s+(?:(\d+|other)\s+)?(day|days|week|weeks|month|months|year|years)/i, (raw, n, unit) => {
    if (out.repeat) return false;
    out.repeat = { every: n === 'other' ? 2 : Number(n || 1), unit: UNIT[unit.toLowerCase()] };
    token('repeat', raw);
  });
  take(new RegExp(`(?:every|each)\\s+((?:${DAY_RE}(?:\\s*(?:,|and|&)\\s*)?)+)`, 'i'), (raw, days) => {
    if (out.repeat) return false;
    const list = days.split(/\s*(?:,|and|&)\s*|\s+/).filter(Boolean).map(dayIndex).filter((d) => d >= 0);
    out.repeat = { every: 1, unit: 'week', weekdays: [...new Set(list)].sort() };
    token('repeat', raw);
  });
  take(/(?:every|each)\s+weekday|weekdays/i, (raw) => {
    if (out.repeat) return false;
    out.repeat = { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] };
    token('repeat', raw);
  });
  take(/(?:every|each)\s+weekend/i, (raw) => {
    if (out.repeat) return false;
    out.repeat = { every: 1, unit: 'week', weekdays: [0, 6] };
    token('repeat', raw);
  });
  take(/daily|weekly|fortnightly|monthly|yearly|annually/i, (raw) => {
    if (out.repeat) return false;
    const w = raw.toLowerCase();
    out.repeat = w === 'fortnightly' ? { every: 2, unit: 'week' } : { every: 1, unit: { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year' }[w] };
    token('repeat', raw);
  });

  // dates
  const setDate = (raw, d, time) => {
    if (out.dueDate) return false;
    out.dueDate = d;
    if (time && !out.dueTime) out.dueTime = time;
    token('date', raw);
  };
  take(/(?:on\s+)?(\d{4})-(\d{2})-(\d{2})/i, (raw, y, m, d) => (Date.parse(`${y}-${m}-${d}`) ? setDate(raw, `${y}-${m}-${d}`) : false));
  take(/(?:the\s+)?day\s+after\s+tomorrow/i, (raw) => setDate(raw, addDays(today, 2)));
  take(/today/i, (raw) => setDate(raw, today));
  take(/tonight/i, (raw) => setDate(raw, today, '20:00'));
  take(/tomorrow|tmrw?|tmw/i, (raw) => setDate(raw, addDays(today, 1)));
  take(/this\s+weekend|on\s+the\s+weekend/i, (raw) => setDate(raw, weekday(today) === 6 || weekday(today) === 0 ? today : nextWeekday(today, 6)));
  take(/next\s+weekend/i, (raw) => setDate(raw, weekday(today) === 6 || weekday(today) === 0 ? nextWeekday(today, 6) : addDays(nextWeekday(today, 6), 7)));
  take(/next\s+week/i, (raw) => setDate(raw, addDays(startOfWeek(today, weekStart), 7)));
  take(/next\s+month/i, (raw) => setDate(raw, `${addMonths(today, 1).slice(0, 7)}-01`));
  take(/in\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?|months?|years?|d|w|m|y)/i, (raw, n, unit) => {
    const k = num(n);
    const u = UNIT[unit.toLowerCase()];
    if (!k) return false;
    return setDate(raw, u === 'day' ? addDays(today, k) : u === 'week' ? addDays(today, 7 * k) : addMonths(today, u === 'month' ? k : 12 * k));
  });
  // a weekday: written out ("friday"), or short after on/next/this ("on fri"); "sun cream" stays text
  take(new RegExp(`(?:on|next|this)\\s+${DAY_RE}`, 'i'), (raw, d) => setDate(raw, nextWeekday(today, dayIndex(d))));
  take(/(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i, (raw, d) => setDate(raw, nextWeekday(today, dayIndex(d))));
  const dated = (raw, m, d, y) => {
    const mi = monthIndex(m);
    const day = Number(d);
    if (mi < 0 || day < 1 || day > 31) return false;
    const year = y ? Number(y) : Number(today.slice(0, 4));
    let iso = `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(iso)) || new Date(year, mi, day).getMonth() !== mi) return false;
    if (!y && iso < today) iso = `${year + 1}${iso.slice(4)}`; // "jan 5" in December: next year's
    return setDate(raw, iso);
  };
  take(new RegExp(`(?:on\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i'), (raw, m, d, y) => dated(raw, m, d, y));
  take(new RegExp(`(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?`, 'i'), (raw, d, m, y) => dated(raw, m, d, y));

  // times: "at 5pm", "5:30pm", "17:00", "at 9", "noon"
  const setTime = (raw, t) => {
    if (out.dueTime || !t) return false;
    out.dueTime = t;
    token('time', raw);
  };
  take(/(?:at\s+)?noon|midday/i, (raw) => setTime(raw, '12:00'));
  take(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a|p)/i, (raw, h, m, ap) => setTime(raw, to24(h, m, ap)));
  take(/(?:at\s+)?(\d{1,2}):(\d{2})/i, (raw, h, m) => setTime(raw, to24(h, m)));
  take(/at\s+(\d{1,2})/i, (raw, h) => setTime(raw, to24(h, 0)));

  // priority, flag, tags, list
  take(/!([1-3])|!(low|l|medium|med|m|high|h)|(!{1,3})/i, (raw, n, word, bangs) => {
    if (out.priority) return false;
    out.priority = n ? Number(n) : word ? { l: 1, low: 1, m: 2, med: 2, medium: 2, h: 3, high: 3 }[word.toLowerCase()] : bangs.length;
    token('priority', raw, ['', 'Low', 'Medium', 'High'][out.priority]);
  });
  take(/\*/, (raw) => {
    out.flagged = true;
    token('flag', raw, 'Flagged');
  });
  // a tag starts with a letter: "#1 in series" stays text
  take(/#(\p{L}[\p{L}\p{N}_-]{0,39})/u, (raw, tag) => {
    if (!out.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) out.tags.push(tag);
    token('tag', raw, tag);
  });
  take(/@([\p{L}\p{N}_-]{1,80})/u, (raw, name) => {
    if (out.listId) return false;
    const n = norm(name);
    const list = lists.find((l) => norm(l.name) === n) || lists.find((l) => norm(l.name).startsWith(n));
    if (!list) return false;
    out.listId = list.id;
    token('list', raw, list.name);
  });

  if (out.repeat && !out.dueDate) out.dueDate = firstDue(out.repeat, today);
  if (out.repeat?.unit === 'month' && out.dueDate) out.repeat.day = Number(out.dueDate.slice(8, 10));
  if (out.dueTime && !out.dueDate) out.dueDate = out.dueTime > `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}` ? today : addDays(today, 1);
  out.title = s.replace(/\s+/g, ' ').trim() || String(text || '').trim();
  return out;
}

export { DAYS };
