// Dates as 'YYYY-MM-DD' strings in the person's own time zone, and how Tasks shows them.

const pad = (n) => String(n).padStart(2, '0');
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A local Date → 'YYYY-MM-DD' */
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'YYYY-MM-DD' → a local Date at midnight */
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = (now = new Date()) => isoOf(now);
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
export const addMonths = (s, n) => {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return isoOf(d);
};
/** Whole days from a to b (b later: positive) */
export const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86_400_000);
export const weekday = (s) => parseISO(s).getDay();
/** The first day of the week s is in; weekStart 1 = Monday, 0 = Sunday */
export const startOfWeek = (s, weekStart = 1) => addDays(s, -((weekday(s) - weekStart + 7) % 7));
export const startOfMonth = (s) => `${s.slice(0, 7)}-01`;

/** "Today", "Tomorrow", "Yesterday", "Friday" (this week), "Mon 5 Jan" (with the year when it's another one) */
export function dayLabel(s, today = todayISO(), { long = false } = {}) {
  const diff = diffDays(today, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parseISO(s);
  if (diff > 1 && diff < 7) return DAYS[d.getDay()];
  const year = d.getFullYear() !== parseISO(today).getFullYear() ? ` ${d.getFullYear()}` : '';
  return long ? `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${year}` : `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${year}`;
}

/** "Friday, 20 November" (with the year when it's another one) */
export function longDate(s, today = todayISO()) {
  const d = parseISO(s);
  const year = d.getFullYear() !== parseISO(today).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** "09:30" → "9:30" in 24-hour form, or "9:30 AM" where the person's locale uses it */
export function timeLabel(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** How a due date reads and looks: { label, tone: overdue | today | tomorrow | soon | later } */
export function dueInfo(dueDate, dueTime, today = todayISO()) {
  if (!dueDate) return null;
  const diff = diffDays(today, dueDate);
  const tone = diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? 'soon' : 'later';
  const label = dayLabel(dueDate, today) + (dueTime ? ` ${timeLabel(dueTime)}` : '');
  return { label, tone, diff };
}

const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A repeat rule in words: "Every day", "Every 2 weeks on Mon, Wed", "Monthly on the 5th" */
export function repeatLabel(r) {
  if (!r) return '';
  const n = r.every || 1;
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[r.unit];
  if (r.unit === 'week' && r.weekdays?.length) {
    const days = [...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const weekdaysOnly = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
    const names = weekdaysOnly ? 'weekdays' : days.map((d) => SHORT_DAYS[d]).join(', ');
    return n === 1 ? (weekdaysOnly ? 'Every weekday' : `Every ${names}`) : `Every ${n} weeks on ${names}`;
  }
  if (r.unit === 'month' && r.day) return n === 1 ? `Monthly on the ${ORD(r.day)}` : `Every ${n} months on the ${ORD(r.day)}`;
  if (n === 1) return { day: 'Every day', week: 'Every week', month: 'Every month', year: 'Every year' }[r.unit];
  return `Every ${n} ${unit}s`;
}
