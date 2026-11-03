const db = require('../core/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

module.exports = async function (fastify, opts) {
  fastify.post('/api/login', async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password) return reply.code(400).send({ error: 'Username and password are required' });
    
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    const user = stmt.get(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } 
    );

    return { token, role: user.role, id: user.id, username: user.username };
  });
};