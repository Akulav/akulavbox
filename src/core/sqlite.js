// SQLite helpers shared by AkulavBox and the apps (node:sqlite is synchronous, so a transaction is
// just BEGIN / COMMIT around a function).

/** Run fn inside a transaction; it rolls back if fn throws */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/** Adds a column when it is missing, so a step can run again on a database that already has it */
function addColumn(db, table, column, definition) {
  if (!columnsOf(db, table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Numbered schema steps, counted with `PRAGMA user_version`: runs the ones a database hasn't had
 * yet, in order, each in its own transaction. A step is SQL, a function (db) => void, or
 * { name, up(db) }. Append new steps at the end; never change one that has shipped.
 * `before(from)` runs once before the first pending step (e.g. to back the database up).
 */
function runSteps(db, steps, { before, onStep, describe = (i) => `step ${i}` } = {}) {
  const from = db.prepare('PRAGMA user_version').get().user_version;
  if (from >= steps.length) return { from, to: from, ran: 0 };
  const extra = before ? before(from) : undefined;
  for (let v = from; v < steps.length; v++) {
    const step = steps[v];
    const up = typeof step === 'string' ? (d) => d.exec(step) : typeof step === 'function' ? step : step.up;
    try {
      tx(db, () => {
        up(db);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } catch (e) {
      e.message = `${describe(v + 1, step)} failed: ${e.message}`;
      e.extra = extra;
      throw e;
    }
    onStep?.(v + 1, step);
  }
  return { from, to: steps.length, ran: steps.length - from, extra };
}

module.exports = { tx, columnsOf, addColumn, runSteps };
