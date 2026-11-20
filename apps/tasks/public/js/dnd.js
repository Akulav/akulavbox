// Drag and drop of tasks with the browser's own drag events (mouse and pen; on phones the details
// panel moves things instead). The dragged task's id travels as text/x-task.
import { reactive } from 'vue';

export const drag = reactive({ id: null, over: null, where: null }); // where: 'before' | 'after' | 'into'

export function start(e, task) {
  drag.id = task.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-task', String(task.id));
  e.dataTransfer.setData('text/plain', task.title);
}
export function end() {
  drag.id = drag.over = drag.where = null;
}
/** The id being dragged, if this drag carries a task */
export const draggedId = (e) => (drag.id ?? (Number(e.dataTransfer?.getData('text/x-task')) || null));
export const carriesTask = (e) => drag.id !== null || [...(e.dataTransfer?.types || [])].includes('text/x-task');

/** Over a row: before or after it, by the pointer's height on the row */
export function overRow(e, key) {
  if (!carriesTask(e)) return;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  drag.over = key;
  drag.where = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}
/** Over a target that takes the task as a whole (a list, a day, a column) */
export function overTarget(e, key) {
  if (!carriesTask(e)) return;
  e.preventDefault();
  drag.over = key;
  drag.where = 'into';
}
export function leave(e, key) {
  if (drag.over === key && !e.currentTarget.contains(e.relatedTarget)) drag.over = drag.where = null;
}
/** The class a row or target shows while something is dragged over it */
export const dropClass = (key) => (drag.over === key ? `drop-${drag.where}` : '');

/** A new order: `ids` with `moved` put before or after `target` */
export function reordered(ids, moved, target, where) {
  const out = ids.filter((id) => id !== moved);
  const i = out.indexOf(target);
  out.splice(i < 0 ? out.length : where === 'after' ? i + 1 : i, 0, moved);
  return out;
}
