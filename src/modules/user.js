const db = require('../core/db');
const bcrypt = require('../core/hash');
const { verifyUser, signToken, setPassword, revokeSessions, PASSWORD_MIN } = require('../core/auth');
const activity = require('../core/activity');
const session = require('../core/session');
const apps = require('../core/apps');

// The signed-in account: profile, settings, password, other sessions, recent sign-ins.

module.exports = async function (fastify) {
  fastify.get('/api/user/profile', { preHandler: verifyUser }, async (request) => {
    const p = db.prepare('SELECT id, username, role, quota_bytes, used_bytes, profile_image, created_at, show_xxx FROM users WHERE id = ?').get(request.user.id);
    const t = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM files WHERE owner_id = ? AND trashed_at IS NOT NULL').get(request.user.id);
    // used_bytes is the whole account's storage (every app); trove_bytes Trove's part of it
    const space = apps.space(request.user.id);
    return { ...p, show_xxx: !!p.show_xxx, trash_bytes: t.bytes, trove_bytes: p.used_bytes, used_bytes: space?.used_bytes ?? p.used_bytes, space: apps.describeSpace(space) };
  });

  // Account settings that follow the user to every device: { show_xxx }
  fastify.patch('/api/user/settings', { preHandler: verifyUser }, async (request, reply) => {
    const b = request.body || {};
    if (b.show_xxx === undefined) return reply.code(400).send({ error: 'Nothing to change' });
    db.prepare('UPDATE users SET show_xxx = ? WHERE id = ?').run(b.show_xxx ? 1 : 0, request.user.id);
    return { success: true, show_xxx: !!b.show_xxx };
  });

  fastify.patch('/api/user/profile', { preHandler: verifyUser }, async (request, reply) => {
    const img = request.body?.profile_image;
    // raster images only: an SVG avatar could carry script if it were ever opened directly
    if (img && (typeof img !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(img) || img.length > 2_000_000)) {
      return reply.code(400).send({ error: 'Invalid image' });
    }
    db.prepare('UPDATE users SET profile_image = ? WHERE id = ?').run(img || null, request.user.id);
    return { success: true };
  });

  const tokenUser = db.prepare('SELECT id, username, role, token_version FROM users WHERE id = ?');

  // Changing the password signs out every other session; this one gets a fresh token
  fastify.patch('/api/user/password', { preHandler: verifyUser }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (!newPassword || String(newPassword).length < PASSWORD_MIN) return reply.code(400).send({ error: `New password must be at least ${PASSWORD_MIN} characters.` });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.user.id);
    if (!user || !(await bcrypt.compare(String(currentPassword || ''), user.password_hash))) {
      activity.log(request, 'account.password_change_failed', { detail: 'Wrong current password' });
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }
    setPassword(request.user.id, await bcrypt.hash(String(newPassword), 10));
    activity.log(request, 'account.password_changed');
    const token = signToken(tokenUser.get(request.user.id));
    session.addCookie(reply, session.cookieFor(request, token)); // the other apps stay signed in here
    return { success: true, token };
  });

  // Sign out every other browser and device (a lost phone, a shared computer); this one gets a fresh token
  fastify.post('/api/user/signout-others', { preHandler: verifyUser }, async (request, reply) => {
    revokeSessions(request.user.id);
    activity.log(request, 'account.signed_out_others');
    const token = signToken(tokenUser.get(request.user.id));
    session.addCookie(reply, session.cookieFor(request, token));
    return { success: true, token };
  });

  // My recent sign-ins, failed ones included, so a stranger's attempt stands out
  fastify.get('/api/user/activity', { preHandler: verifyUser }, async (request) => {
    const { items } = activity.list({ userId: request.user.id, kind: 'signin', limit: 25 });
    return items.map(({ at, action, detail, ip }) => ({ at, action, detail, ip }));
  });
};
