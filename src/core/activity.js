const db = require('./db');

// ---------------------------------------------------------------------------
// Activity log: sign-ins, account changes, shares, backups and admin actions,
// shown in Admin → Activity. Rows older than ACTIVITY_DAYS (default 180) are
// dropped, and at most MAX_ROWS are kept, so the table can't grow without end.
// Logging must never break the action it records, so every write is guarded.
// ---------------------------------------------------------------------------

const DAYS = Math.max(1, Number(process.env.ACTIVITY_DAYS) || 180);
const MAX_ROWS = 50000;
const cap = (s, n) => (s == null || s === '' ? null : String(s).slice(0, n));

const insert = db.prepare('INSERT INTO activity (at, user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)');

/**
 * Record one action. `request` supplies who (request.user) and the IP; pass
 * `user: { id, username }` for actions without a signed-in user (a failed sign-in).
 */
function log(request, action, { target, detail, user } = {}) {
  try {
    const who = user || request?.user || null;
    insert.run(new Date().toISOString(), who?.id || null, cap(who?.username, 64), action, cap(target, 300), cap(detail, 1000), cap(request?.ip, 64));
  } catch (e) { console.warn(`[activity] couldn’t record ${action}: ${e.message}`); }
}

function prune() {
  try {
    db.prepare('DELETE FROM activity WHERE at < ?').run(new Date(Date.now() - DAYS * 86400e3).toISOString());
    db.prepare('DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX_ROWS);
  } catch (e) { console.warn(`[activity] prune failed: ${e.message}`); }
}
setTimeout(prune, 60e3).unref();
setInterval(prune, 6 * 3600e3).unref();

// The groups the Admin filter offers, by action prefix
const KINDS = { signin: ['auth.'], account: ['account.', 'admin.user'], share: ['share.'], backup: ['backup.'], server: ['admin.server', 'admin.update', 'admin.storage'] };

/** Newest first; `before` is the id to continue after. Failed sign-ins: kind=failed. */
function list({ before, userId, kind, q, limit = 100 } = {}) {
  const where = [], args = [];
  if (Number.isInteger(before) && before > 0) { where.push('id < ?'); args.push(before); }
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (kind === 'failed') where.push("action IN ('auth.login_failed', 'backup.scheduled_failed', 'backup.restore_failed', 'backup.import_failed')");
  else if (KINDS[kind]) { where.push(`(${KINDS[kind].map(() => 'action LIKE ?').join(' OR ')})`); args.push(...KINDS[kind].map(p => `${p}%`)); }
  if (q) {
    // the search text is literal: % and _ are escaped with !
    const like = `%${String(q).slice(0, 100).replace(/[!%_]/g, '!$&')}%`;
    where.push(`(${['username', 'target', 'detail', 'ip'].map(c => `${c} LIKE ? ESCAPE '!'`).join(' OR ')})`);
    args.push(like, like, like, like);
  }
  const n = Math.min(500, Math.max(1, limit | 0));
  const sql = `SELECT id, at, user_id, username, action, target, detail, ip FROM activity
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
  const items = db.prepare(sql).all(...args, n + 1);
  return { items: items.slice(0, n), next: items.length > n ? items[n - 1].id : null };
}

/** Delete-user: their own rows go with the account */
const forgetUser = (userId) => db.prepare('DELETE FROM activity WHERE user_id = ?').run(userId);

module.exports = { log, list, prune, forgetUser, DAYS };
