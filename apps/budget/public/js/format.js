// Money and date formatting. Dates are "YYYY-MM-DD" strings in local time, shown in English.

const cache = new Map();
function nf(currency, opts = {}) {
  const key = currency + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }));
  return cache.get(key);
}

export const money = (value, currency = 'EUR', opts) => nf(currency, opts).format(value ?? 0);

/** Short form for chart axes and dense labels: €1.2K */
export const moneyCompact = (value, currency = 'EUR') => nf(currency, { notation: 'compact', maximumFractionDigits: 1 }).format(value ?? 0);

/** Whole units: €1,234 */
export const money0 = (value, currency = 'EUR') => nf(currency, { maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(value ?? 0);

export const pct = (value, digits = 0) =>
  `${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;

export const currencySymbol = (currency) => nf(currency).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');

/** "2026-03-07" → a local Date */
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The date-fns patterns Florin uses: yyyy yy MMMM MMM MM dd d EEEE EEE */
export function formatDate(d, pattern) {
  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|dd|d|EEEE|EEE/g, (t) => {
    switch (t) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return String(d.getFullYear()).slice(-2);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'dd': return pad(d.getDate());
      case 'd': return String(d.getDate());
      case 'EEEE': return DAYS[d.getDay()];
      default: return DAYS[d.getDay()].slice(0, 3);
    }
  });
}

export const dateLabel = (iso, pattern = 'd MMM yyyy') => (iso ? formatDate(parseDate(iso), pattern) : '');
export const monthLabel = (ym, pattern = 'MMM yyyy') => (ym ? formatDate(parseDate(`${ym}-01`), pattern) : '');

export const todayISO = () => isoDate(new Date());
export const thisMonth = () => todayISO().slice(0, 7);

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return isoDate(d).slice(0, 7);
}

/** First day of the month `back` months ago, as "YYYY-MM-DD" */
export const monthStart = (back = 0) => `${shiftMonth(thisMonth(), -back)}-01`;
/** Last day of the month `back` months ago */
export function monthEnd(back = 0) {
  const now = new Date();
  return isoDate(new Date(now.getFullYear(), now.getMonth() - back + 1, 0));
}
export const yearStart = () => `${new Date().getFullYear()}-01-01`;

/** Every date from `from` to `to`, inclusive */
export function eachDay(from, to) {
  const out = [];
  const end = parseDate(to);
  for (let d = parseDate(from); d <= end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

export function changePct(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
