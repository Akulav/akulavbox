const { verifyUser } = require('../core/auth');
const trash = require('../core/trash');

const list = (v) => [].concat(v || []).map(String).slice(0, 5000);

module.exports = async function (fastify) {
  fastify.get('/api/trash', { preHandler: verifyUser }, async (request) => trash.listTrash(request.user.id));

  // { files: [], folders: [] }
  fastify.post('/api/trash/restore', { preHandler: verifyUser }, async (request) => {
    const uid = request.user.id;
    let n = 0;
    for (const id of list(request.body?.folders)) if (trash.restoreFolder(id, uid)) n++;
    for (const id of list(request.body?.files)) if (trash.restoreFile(id, uid)) n++;
    return { success: true, restored: n };
  });

  // Delete for good: { files: [], folders: [] }
  fastify.post('/api/trash/delete', { preHandler: verifyUser }, async (request) => {
    const uid = request.user.id;
    let n = 0;
    for (const id of list(request.body?.folders)) if (trash.purgeTrashedFolder(id, uid)) n++;
    for (const id of list(request.body?.files)) if (trash.purgeTrashedFile(id, uid)) n++;
    return { success: true, deleted: n };
  });

  fastify.delete('/api/trash', { preHandler: verifyUser }, async (request) => ({ success: true, deleted: trash.emptyTrash(request.user.id) }));
};
