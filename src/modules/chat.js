const db = require('../core/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const config = require('../core/config');
const { verifyUser, authenticate } = require('../core/auth');
const { guessMime, fileCsp } = require('../core/mime');
const store = require('../core/storage');

const chatDir = config.chatDir;
const MAX_CHAT_FILE = 50 * 1024 * 1024;
const MSG_COLS = 'id, sender_id, receiver_id, content, type, file_size, file_mime, created_at';

module.exports = async function (fastify) {
  fastify.register(require('@fastify/multipart'), { limits: { fileSize: MAX_CHAT_FILE } });

  // --- SOCKET.IO (REAL-TIME ENGINE & WEBRTC SIGNALING) ---
  // same origin only, like the API (CORS_ORIGIN adds others)
  const io = require('socket.io')(fastify.server, { cors: { origin: config.corsOrigins.length ? config.corsOrigins : false } });
  // user_id -> number of open sockets (a user can have several tabs open)
  const connectionCounts = new Map();
  const roomOf = (userId) => `user:${userId}`;
  const emitToUser = (userId, event, payload) => io.to(roomOf(userId)).emit(event, payload);

  // ids come straight from socket events: anything but a string (an object, an array) would make
  // SQLite throw inside the event handler, which nothing catches
  const areFriends = (a, b) => typeof a === 'string' && typeof b === 'string' && !!db.prepare(`
    SELECT 1 FROM friends WHERE status = 'accepted' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
  `).get(a, b, b, a);
  const friendIdsOf = (me) => db.prepare(`
    SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS id FROM friends WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)
  `).all(me, me, me).map(r => r.id);

  // --- GARBAGE COLLECTOR (10 Min Temporary Files) ---
  const expire = () => {
    const expired = db.prepare(`SELECT id, sender_id, receiver_id, file_path, file_size FROM messages WHERE type = 'file' AND created_at < datetime('now', '-10 minutes')`).all();
    for (const msg of expired) {
      if (msg.file_path) { try { fs.unlinkSync(msg.file_path); } catch (e) { /* gone */ } }
      db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?').run(msg.file_size, msg.sender_id);
      db.prepare(`UPDATE messages SET type = 'deleted_file', content = 'File expired (10 min limit)', file_path = NULL, file_size = 0 WHERE id = ?`).run(msg.id);
      emitToUser(msg.sender_id, 'file_expired', { message_id: msg.id });
      emitToUser(msg.receiver_id, 'file_expired', { message_id: msg.id });
    }
  };
  setInterval(expire, 60000).unref();
  // Files whose message is gone (trimmed by the 1,000-message limit, or the server stopped mid-upload)
  try {
    const known = new Set(db.prepare("SELECT file_path FROM messages WHERE type = 'file' AND file_path IS NOT NULL").all().map(r => path.resolve(r.file_path)));
    for (const name of fs.readdirSync(chatDir)) {
      const p = path.resolve(chatDir, name);
      if (!known.has(p)) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } }
    }
  } catch (e) { fastify.log.warn(e, 'chat file sweep failed'); }
  expire();

  // --- ICE servers for calls ---------------------------------------------
  // Hardened browsers (Brave, Helium, LibreWolf…) hide local IPs / block direct
  // UDP, so peer-to-peer fails without a TURN relay. Configure one in .env:
  //   TURN_URLS=turn:your.host:3478,turns:your.host:5349
  //   TURN_USERNAME=... TURN_CREDENTIAL=...      (static credentials), or
  //   TURN_SECRET=...                             (coturn "static-auth-secret": short-lived credentials)
  //   CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...    (Cloudflare Realtime TURN, free tier)
  //   STUN_URLS=stun:stun.cloudflare.com:3478     (optional override)
  let cfCache = null;
  async function cloudflareIce() {
    const { CF_TURN_KEY_ID: id, CF_TURN_API_TOKEN: token } = process.env;
    if (!id || !token) return [];
    if (cfCache && cfCache.until > Date.now()) return cfCache.servers;
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const servers = [].concat(data.iceServers || []);
      cfCache = { servers, until: Date.now() + 6 * 3600 * 1000 };
      return servers;
    } catch (e) { fastify.log.warn(`Cloudflare TURN credentials failed: ${e.message}`); return []; }
  }

  fastify.get('/api/rtc/config', { preHandler: verifyUser }, async (request) => {
    const list = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
    const iceServers = [];
    const stun = list(process.env.STUN_URLS);
    iceServers.push({ urls: stun.length ? stun : ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] });

    const turn = list(process.env.TURN_URLS);
    if (turn.length) {
      if (process.env.TURN_SECRET) {
        const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:${request.user.id}`;
        const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
        iceServers.push({ urls: turn, username, credential });
      } else {
        iceServers.push({ urls: turn, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
      }
    }
    iceServers.push(...await cloudflareIce());
    const hasRelay = iceServers.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
    return { iceServers, hasRelay };
  });

  // --- REST ENDPOINTS (Friends & Uploads) ---
  fastify.get('/api/chat/users', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`
      SELECT u.id, u.username, u.profile_image,
        (SELECT status FROM friends f WHERE (f.user_id = ? AND f.friend_id = u.id) OR (f.user_id = u.id AND f.friend_id = ?) LIMIT 1) AS relation
      FROM users u WHERE u.id != ? ORDER BY u.username COLLATE NOCASE
    `).all(request.user.id, request.user.id, request.user.id);
  });

  fastify.get('/api/chat/friends', { preHandler: verifyUser }, async (request) => {
    const me = request.user.id;
    const rows = db.prepare(`
      SELECT f.status, f.user_id AS requester, u.id, u.username, u.profile_image
      FROM friends f
      JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
      WHERE f.user_id = ? OR f.friend_id = ?
    `).all(me, me, me);

    const lastMsg = db.prepare(`
      SELECT content, type, sender_id, created_at FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `);
    const unread = db.prepare(`
      SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND receiver_id = ?
        AND created_at > COALESCE((SELECT last_read_at FROM chat_reads WHERE user_id = ? AND friend_id = ?), '')
    `);

    // Deduplicate (both users may have sent each other a request) – accepted wins
    const byId = new Map();
    for (const r of rows) {
      const entry = {
        id: r.id, username: r.username, profile_image: r.profile_image, status: r.status,
        direction: r.status === 'accepted' ? null : (r.requester === me ? 'outgoing' : 'incoming'),
      };
      const prev = byId.get(r.id);
      if (!prev || entry.status === 'accepted') byId.set(r.id, entry);
    }
    for (const f of byId.values()) {
      if (f.status !== 'accepted') continue;
      f.last_message = lastMsg.get(me, f.id, f.id, me) || null;
      f.unread = unread.get(f.id, me, me, f.id).n;
      f.online = connectionCounts.has(f.id);
    }
    return [...byId.values()];
  });

  // Remember that I've read my chat with someone (so unread counts survive a reload)
  fastify.post('/api/chat/read/:friendId', { preHandler: verifyUser }, async (request) => {
    db.prepare(`INSERT INTO chat_reads (user_id, friend_id, last_read_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id, friend_id) DO UPDATE SET last_read_at = excluded.last_read_at`).run(request.user.id, request.params.friendId);
    return { success: true };
  });

  const presenceChanged = (a, b) => {
    // tell both sides about each other's presence after they become friends
    if (connectionCounts.has(a)) emitToUser(b, 'user_online', a);
    if (connectionCounts.has(b)) emitToUser(a, 'user_online', b);
  };

  fastify.post('/api/chat/friends/add', { preHandler: verifyUser }, async (request, reply) => {
    const me = request.user.id;
    const other = request.body?.friend_id;
    if (!other || other === me) return reply.code(400).send({ error: 'Invalid user' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(other)) return reply.code(404).send({ error: 'User not found' });

    // If they already asked us, adding them back simply accepts their request
    const reverse = db.prepare('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(other, me);
    if (reverse) {
      db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(other, me);
      emitToUser(other, 'friends_changed', {});
      presenceChanged(me, other);
      return { success: true, accepted: true };
    }
    db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')").run(me, other);
    emitToUser(other, 'friends_changed', {});
    return { success: true };
  });

  fastify.post('/api/chat/friends/accept', { preHandler: verifyUser }, async (request, reply) => {
    const other = request.body?.friend_id;
    const r = db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(other, request.user.id);
    if (!r.changes) return reply.code(404).send({ error: 'No friend request from that person' });
    emitToUser(other, 'friends_changed', {});
    presenceChanged(request.user.id, other);
    return { success: true };
  });

  // Decline an incoming request, cancel an outgoing one, or remove a friend
  fastify.post('/api/chat/friends/remove', { preHandler: verifyUser }, async (request) => {
    const me = request.user.id, other = request.body?.friend_id;
    db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(me, other, other, me);
    emitToUser(other, 'friends_changed', {});
    return { success: true };
  });

  fastify.get('/api/chat/messages/:friendId', { preHandler: verifyUser }, async (request) => {
    const friendId = request.params.friendId;
    return db.prepare(`
      SELECT ${MSG_COLS} FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at ASC, rowid ASC
    `).all(request.user.id, friendId, friendId, request.user.id);
  });

  // Delete one of my own messages (for both people)
  fastify.delete('/api/chat/messages/:id', { preHandler: verifyUser }, async (request, reply) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(request.params.id, request.user.id);
    if (!msg) return reply.code(404).send({ error: 'Message not found' });
    if (msg.type === 'file' && msg.file_path) {
      try { fs.unlinkSync(msg.file_path); } catch (e) { /* gone */ }
      db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?').run(msg.file_size, msg.sender_id);
    }
    db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
    emitToUser(msg.receiver_id, 'message_deleted', { message_id: msg.id });
    emitToUser(msg.sender_id, 'message_deleted', { message_id: msg.id });
    return { success: true };
  });

  fastify.post('/api/chat/upload', { preHandler: verifyUser }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });
    const receiverId = data.fields.receiver_id?.value;
    const expectedSize = parseInt(request.headers['content-length'] || 0, 10);

    if (!receiverId || !areFriends(request.user.id, receiverId)) {
      data.file.resume();
      return reply.code(403).send({ error: 'You can only send files to friends.' });
    }
    if (expectedSize > MAX_CHAT_FILE + 1024 * 64) {
      data.file.resume();
      return reply.code(400).send({ error: 'Max 50MB per temporary file.' });
    }

    const user = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(request.user.id);
    if (user.used_bytes + expectedSize > user.quota_bytes) {
      data.file.resume();
      return reply.code(400).send({ error: 'Storage quota exceeded.' });
    }
    if (!store.hasRoomFor(expectedSize)) {
      data.file.resume();
      return reply.code(507).send({ error: 'The server’s disk is full.' });
    }

    const fileId = crypto.randomUUID();
    const destPath = path.join(chatDir, fileId);
    // a dropped connection must not leave a half-written file behind until the next restart
    try { await pipeline(data.file, fs.createWriteStream(destPath)); }
    catch (e) { try { fs.unlinkSync(destPath); } catch (err) { /* never written */ } return reply.code(400).send({ error: 'The upload was interrupted. Try again.' }); }

    if (data.file.truncated) {
      fs.unlinkSync(destPath);
      return reply.code(400).send({ error: 'Max 50MB per temporary file.' });
    }

    const stats = fs.statSync(destPath);
    db.prepare('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?').run(stats.size, request.user.id);

    const msgId = crypto.randomUUID();
    const name = String(data.filename || 'file').replace(/[\\/]/g, '_').slice(0, 255);
    db.prepare(`INSERT INTO messages (id, sender_id, receiver_id, content, type, file_path, file_size, file_mime) VALUES (?, ?, ?, ?, 'file', ?, ?, ?)`).run(
      msgId, request.user.id, receiverId, name, destPath, stats.size, guessMime(name, data.mimetype)
    );

    const saved = db.prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`).get(msgId);
    // Delivered by the server, so clients can't spoof file messages
    emitToUser(receiverId, 'receive_message', saved);
    emitToUser(request.user.id, 'receive_message', saved);
    return saved;
  });

  fastify.get('/api/chat/download/:msgId', { preHandler: verifyUser }, async (request, reply) => {
    const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND type = 'file'").get(request.params.msgId);
    if (!msg || (msg.sender_id !== request.user.id && msg.receiver_id !== request.user.id)) {
      return reply.code(404).send({ error: 'File expired or not found.' });
    }
    if (!msg.file_path || !fs.existsSync(msg.file_path)) return reply.code(404).send({ error: 'File expired or not found.' });

    const mime = guessMime(msg.content, msg.file_mime);
    const download = request.query.download === '1';
    reply.header('Content-Type', mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Length', fs.statSync(msg.file_path).size);
    const csp = fileCsp(mime);
    if (csp) reply.header('Content-Security-Policy', csp);
    reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(msg.content || 'file')}`);
    return reply.send(fs.createReadStream(msg.file_path));
  });

  io.use((socket, next) => {
    try {
      const { user } = authenticate(socket.handshake.auth.token);
      socket.user = { id: user.id, username: user.username, role: user.role };
      next();
    } catch (err) {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.user.id;
    socket.join(roomOf(me));
    const wasOnline = connectionCounts.has(me);
    connectionCounts.set(me, (connectionCounts.get(me) || 0) + 1);

    // Presence is only shared with friends
    const friends = friendIdsOf(me);
    socket.emit('online_list', friends.filter(id => connectionCounts.has(id)));
    if (!wasOnline) for (const f of friends) emitToUser(f, 'user_online', me);

    socket.on('send_message', (data, ack) => {
      const content = typeof data?.content === 'string' ? data.content.trim().substring(0, 2000) : '';
      const done = typeof ack === 'function' ? ack : () => {};
      if (!content || !areFriends(me, data.receiver_id)) return done({ ok: false, error: 'You can only message friends.' });
      const msgId = crypto.randomUUID();
      db.prepare(`INSERT INTO messages (id, sender_id, receiver_id, content, type) VALUES (?, ?, ?, ?, 'text')`).run(msgId, me, data.receiver_id, content);
      const savedMsg = db.prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`).get(msgId);
      emitToUser(data.receiver_id, 'receive_message', savedMsg);
      emitToUser(me, 'receive_message', savedMsg);
      done({ ok: true, id: msgId });
    });

    socket.on('typing', (data) => {
      if (data?.target_id && areFriends(me, data.target_id)) emitToUser(data.target_id, 'typing', { user_id: me });
    });

    // WebRTC voice signaling – relayed only between friends
    const relay = (event, outEvent, build) => {
      socket.on(event, (data) => {
        if (!data?.target_id || !areFriends(me, data.target_id)) return;
        emitToUser(data.target_id, outEvent, build(data));
      });
    };
    relay('call_user', 'incoming_call', () => ({ caller_id: me, caller_name: socket.user.username }));
    relay('answer_call', 'call_answered', () => ({ answerer_id: me }));
    relay('reject_call', 'call_rejected', () => ({ rejecter_id: me }));
    relay('end_call', 'call_ended', () => ({ ender_id: me }));
    relay('webrtc_offer', 'webrtc_offer', (d) => ({ sdp: d.sdp, sender_id: me }));
    relay('webrtc_answer', 'webrtc_answer', (d) => ({ sdp: d.sdp, sender_id: me }));
    relay('webrtc_ice_candidate', 'webrtc_ice_candidate', (d) => ({ candidate: d.candidate, sender_id: me }));

    socket.on('disconnect', () => {
      const n = (connectionCounts.get(me) || 1) - 1;
      if (n <= 0) {
        connectionCounts.delete(me);
        for (const f of friendIdsOf(me)) emitToUser(f, 'user_offline', me);
      } else {
        connectionCounts.set(me, n);
      }
    });
  });

  fastify.addHook('preClose', (done) => { io.local.disconnectSockets(true); done(); });
};
