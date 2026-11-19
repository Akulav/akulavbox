import { format as fmtDate, parseISO } from 'date-fns';

const cache = new Map();
function nf(currency, opts = {}) {
  const key = currency + JSON.stringify(opts);
  if (!cache.has(key)) {
    cache.set(key, new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }));
  }
  return cache.get(key);
}

export const money = (value, currency = 'EUR', opts) => nf(currency, opts).format(value ?? 0);

/** Short form for chart axes and dense labels: €1.2K */
export const moneyCompact = (value, currency = 'EUR') =>
  nf(currency, { notation: 'compact', maximumFractionDigits: 1 }).format(value ?? 0);

/** Whole units, no decimals: €1,234 */
export const moneyRound = (value, currency = 'EUR') =>
  nf(currency, { maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(value ?? 0);

export const pct = (value, digits = 0) =>
  `${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;

export const currencySymbol = (currency) =>
  nf(currency).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;

export const dateLabel = (iso, pattern = 'd MMM yyyy') => (iso ? fmtDate(parseISO(iso), pattern) : '');
export const monthLabel = (ym, pattern = 'MMM yyyy') => (ym ? fmtDate(parseISO(`${ym}-01`), pattern) : '');

export const todayISO = () => fmtDate(new Date(), 'yyyy-MM-dd');
export const thisMonth = () => fmtDate(new Date(), 'yyyy-MM');

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return fmtDate(d, 'yyyy-MM');
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
