const jwt = require('jsonwebtoken');

// Shared auth helpers. Accepts "Authorization: Bearer <token>" or ?token=<token>
// (the query form is needed for <img>/<video>/<a download> URLs).
function readToken(request) {
  const header = request.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;
  return fromHeader || (request.query && request.query.token) || null;
}

async function verifyUser(request, reply) {
  try {
    const token = readToken(request);
    if (!token) throw new Error('No token');
    request.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

async function verifyAdmin(request, reply) {
  try {
    const token = readToken(request);
    if (!token) throw new Error('No token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Insufficient permissions');
    request.user = decoded;
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized access' });
  }
}

module.exports = { verifyUser, verifyAdmin, readToken };
