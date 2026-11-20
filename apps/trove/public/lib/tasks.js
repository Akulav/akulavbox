// Markdown checklists ("- [ ] milk", "- [x] bread"): numbering the rendered checkboxes and
// toggling the matching item in the source, so a click in the preview can be saved back to the file.

// A list item that starts with a task box: bullet or number, spaces, then [ ], [x] or [X].
const TASK_LINE = /^(\s{0,3}(?:>\s*)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](?=\s|$)/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Number the rendered task checkboxes in document order (the same order as in the source). */
export function decorateTasks(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const boxes = tpl.content.querySelectorAll('li input[type="checkbox"]');
  if (!boxes.length) return html;
  boxes.forEach((box, i) => {
    box.dataset.task = String(i);
    box.setAttribute('aria-label', 'Done');
    box.closest('li')?.classList.add('task', ...(box.checked ? ['done'] : []));
    box.closest('ul, ol')?.classList.add('task-list');
  });
  return tpl.innerHTML;
}

/** Enable (or keep disabled) every numbered checkbox. */
export function setTasksEditable(html, editable) {
  if (!html || !html.includes('data-task')) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('input[data-task]').forEach((box) => box.toggleAttribute('disabled', !editable));
  return tpl.innerHTML;
}

/** The source with task number `n` set to `done`, or null when it can't be found. Code blocks are skipped. */
export function toggleTask(src, n, done) {
  const lines = src.split('\n');
  let fence = null;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = TASK_LINE.exec(lines[i]);
    if (!m) continue;
    if (seen++ === n) {
      lines[i] = m[1] + (done ? '[x]' : '[ ]') + lines[i].slice(m[0].length);
      return lines.join('\n');
    }
  }
  return null;
}
