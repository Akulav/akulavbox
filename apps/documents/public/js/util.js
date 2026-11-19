// e-Management: Formatări și utilitare.
import { store } from '/docs/js/state.js';

// ---------- utilitare ----------
export const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
export const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
export const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
export function tagIndex() {
  const map = new Map();
  for (const c of store.categories) for (const t of c.tags) map.set(t.id, { ...t, color: c.color, category: c.name });
  return map;
}
export const chipStyle = (color) => ({ color, borderColor: color, background: color + '14' });

export const docDay = (d) => Number(d.doc_date.slice(8));
export const docMon = (d) => MONTHS[Number(d.doc_date.slice(5, 7)) - 1].slice(0, 3) + ' ' + d.doc_date.slice(0, 4);
export const fmtDateTime = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
export const yesterday = () => {
  const d = new Date(Date.now() - 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
