const db = require('../core/db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { verifyAdmin } = require('../core/auth');
const thumbs = require('../core/thumbs');

module.exports = async function (fastify, opts) {

  // Create User & Provision Physical Encrypted Folder
  fastify.post('/api/admin/users', { preHandler: verifyAdmin }, async (request, reply) => {
    const username = (request.body?.username || '').trim();
    const { password, quota } = request.body || {};
    if (!username || !password) return reply.code(400).send({ error: 'Username and password are required' });

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 10);

    try {
      db.prepare('INSERT INTO users (id, username, password_hash, quota_bytes) VALUES (?, ?, ?, ?)')
        .run(id, username, hash, Number(quota) > 0 ? Math.floor(Number(quota)) : 5368709120);
      fs.mkdirSync(path.join(process.cwd(), 'storage', 'users', id), { recursive: true });
      return { success: true, id, username };
    } catch (err) {
      return reply.code(400).send({ error: 'User creation failed (username already taken?)' });
    }
  });

  // Delete User & Wipe Physical Data + all rows that belong to them
  fastify.delete('/api/admin/users/:id', { preHandler: verifyAdmin }, async (request, reply) => {
    const { id } = request.params;
    if (id === request.user.id) return reply.code(400).send({ error: 'You cannot delete your own account.' });
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!target) return reply.code(404).send({ error: 'User not found' });

    const cleanup = [
      'DELETE FROM album_images WHERE album_id IN (SELECT id FROM albums WHERE owner_id = ?)',
      'DELETE FROM albums WHERE owner_id = ?',
      'DELETE FROM collections WHERE owner_id = ?',
      'DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)',
      'DELETE FROM playlists WHERE owner_id = ?',
      'DELETE FROM song_covers WHERE file_id IN (SELECT id FROM files WHERE owner_id = ?)',
      'DELETE FROM media_meta WHERE owner_id = ?',
      'DELETE FROM files WHERE owner_id = ?',
      'DELETE FROM folders WHERE owner_id = ?',
    ];
    for (const sql of cleanup) { try { db.prepare(sql).run(id); } catch (e) { /* table may not exist */ } }
    try { db.prepare('DELETE FROM friends WHERE user_id = ? OR friend_id = ?').run(id, id); } catch (e) { /* ignore */ }
    try { db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(id, id); } catch (e) { /* ignore */ }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    const userDir = path.join(process.cwd(), 'storage', 'users', id);
    if (fs.existsSync(userDir)) fs.rmSync(userDir, { recursive: true, force: true });
    thumbs.purgeUser(id);

    return { success: true };
  });

  // Force Password Reset
  fastify.patch('/api/admin/users/:id/password', { preHandler: verifyAdmin }, async (request, reply) => {
    const { newPassword } = request.body || {};
    if (!newPassword) return reply.code(400).send({ error: 'Password is required' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, request.params.id);
    return { success: true };
  });

  // Update Quota
  fastify.patch('/api/admin/users/:id/quota', { preHandler: verifyAdmin }, async (request, reply) => {
    const quota = Math.floor(Number(request.body?.quota));
    if (!(quota > 0)) return reply.code(400).send({ error: 'Invalid quota' });
    db.prepare('UPDATE users SET quota_bytes = ? WHERE id = ?').run(quota, request.params.id);
    return { success: true };
  });

  // Get all users
  fastify.get('/api/admin/users', { preHandler: verifyAdmin }, async (request, reply) => {
    return db.prepare(`
      SELECT u.id, u.username, u.role, u.quota_bytes, u.used_bytes, u.profile_image,
        (SELECT COUNT(*) FROM files f WHERE f.owner_id = u.id) AS file_count
      FROM users u ORDER BY u.role = 'admin' DESC, u.username COLLATE NOCASE
    `).all();
  });
};
