'use strict';
// Copia de rezervă a unui spațiu (/docs/api/s/:store/export, /import) și jurnalul de activitate al
// contului (/docs/api/audit). Copia completă a serverului (Admin → Backup) le include oricum pe toate.
const backup = require('../backup');
const { fail, str, validDate, today } = require('../validate');

const AUDIT_RETENTION_DAYS = 90;

module.exports = async function backupAndAudit(app, { auth, requireUser, audit }) {
  const S = '/api/s/:store';

  app.get(S + '/export', auth, async (req, reply) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    audit(req, 'export complet');
    reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="backup-${req.store.key}-${stamp}.anscbackup"`);
    return reply.send(backup.createExportStream(req.store));
  });

  // Corpul cererii este chiar arhiva, citită ca flux (poate avea mulți GB).
  const importing = new Set();
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));
  app.post(S + '/import', { preHandler: requireUser, bodyLimit: 1024 ** 4 }, async (req) => {
    if (!req.body || typeof req.body.pipe !== 'function') throw fail(400, 'Încărcați fișierul de backup.');
    if (importing.has(req.user.id)) {
      req.body.resume();
      throw fail(409, 'Un import este deja în curs.');
    }
    importing.add(req.user.id);
    try {
      const r = await backup.importArchive(req.body, req.store);
      audit(req, 'import complet', `${r.documents} documente, backup din ${r.created_at}`);
      return r;
    } catch (e) {
      req.log.warn(e);
      audit(req, 'import eșuat', e.message);
      throw fail(400, e.expose ? e.message : 'Arhiva este deteriorată sau nu este un backup e-Management. Nimic nu a fost modificat.');
    } finally {
      importing.delete(req.user.id);
    }
  });

  // Jurnalul păstrează ultimele 90 de zile; ce este mai vechi se șterge la fiecare citire.
  app.get('/api/audit', auth, async (req) => {
    const { db } = req.stores.work;
    db.prepare("DELETE FROM audit_log WHERE at < datetime('now', ?)").run(`-${AUDIT_RETENTION_DAYS} days`);
    return {
      rows: db.prepare('SELECT id, at, username, ip, action, details FROM audit_log ORDER BY id DESC LIMIT 2000').all(),
      total: db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,
      oldest: db.prepare('SELECT MIN(at) AS at FROM audit_log').get().at,
      retentionDays: AUDIT_RETENTION_DAYS,
    };
  });

  // Șterge înregistrările până la data indicată, inclusiv. Ziua de azi rămâne întotdeauna în jurnal,
  // iar ștergerea însăși este înregistrată, ca să nu poată trece neobservată.
  app.post('/api/audit/prune', auth, async (req) => {
    const until = str(req.body?.until, 10);
    if (!validDate(until)) throw fail(400, 'Alegeți o dată validă.');
    if (until >= today()) throw fail(400, 'Se pot șterge doar înregistrările din zilele anterioare celei de azi.');
    const r = req.stores.work.db.prepare("DELETE FROM audit_log WHERE at < date(?, '+1 day')").run(until);
    audit(req, 'jurnal curățat', `${r.changes} înregistrări până la ${until.split('-').reverse().join('.')} inclusiv`);
    return { deleted: Number(r.changes) };
  });
};
