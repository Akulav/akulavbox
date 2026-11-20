// How AkulavBox and its apps tell each other what happened, inside the one server process.
//
//   bus.on('storage.changed', ({ userId, app }) => …)   returns a function that stops listening
//   bus.emit('storage.changed', { userId, app: 'documents' })
//
// Synchronous and in memory: no queue, no serialisation, nothing to keep running. Each listener runs
// on its own; one that throws is logged and never stops the others or the app that emitted.
//
// Events (keep this list current):
//   storage.changed   { userId, app }   an app stored or removed files: its usage is read again
//   account.deleted   { userId }        after every app removed the account's data (apps.deleteUser)
//   access.changed    { userId, app, enabled }   an admin turned an app on or off for an account
const listeners = new Map(); // event -> Set<fn>

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

function emit(event, data = {}) {
  const set = listeners.get(event);
  if (!set) return 0;
  for (const fn of [...set]) {
    try { fn(data); } catch (e) { console.error(`[bus] a listener of ${event} failed: ${e.message}`); }
  }
  return set.size;
}

module.exports = { on, emit };
