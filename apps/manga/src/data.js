'use strict';
// Koma Shelf's data, without the site: the database and folders, and the hooks the rest of the server
// uses (quotas, the Admin console, delete-user). Kept apart from the site so they work even when the
// site can't start (no sharp): an account is still deleted everywhere, and its usage still shows.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../../src/core/config');
const { openDb } = require('./db');

let data = null;

function openData() {
  if (data) return data;
  const dataDir = config.appDir('manga');
  const worksDir = path.join(dataDir, 'works');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(worksDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const db = openDb(dataDir);
  const usedBy = (localId) => db.get('SELECT COALESCE(SUM(bytes), 0) AS n FROM works WHERE user_id = ?', localId).n;
  const localOf = (boxId) => db.get('SELECT id FROM users WHERE box_id = ?', boxId);

  const hooks = {
    usage: (boxId) => {
      const u = localOf(boxId);
      return u ? usedBy(u.id) : 0;
    },
    summary: (boxId) => {
      const u = localOf(boxId);
      const n = u ? db.get('SELECT COUNT(*) AS n FROM works WHERE user_id = ?', u.id).n : 0;
      return `${n} webtoon${n === 1 ? '' : 's'}`;
    },
    totals: () => {
      const r = db.get('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM works');
      return { bytes: r.b, items: r.n, label: 'webtoons' };
    },
    // the account's works and images go; its likes on other people's works are taken back
    deleteUser: (boxId) => {
      const u = localOf(boxId);
      if (!u) return;
      const ids = db.all('SELECT id FROM works WHERE user_id = ?', u.id).map((w) => w.id);
      const liked = db.all('SELECT work_id FROM likes WHERE user_id = ?', u.id).map((l) => l.work_id);
      db.tx(() => {
        db.run('DELETE FROM users WHERE id = ?', u.id); // cascades to works, chapters, likes, tokens
        for (const w of liked) db.run('UPDATE works SET likes = (SELECT COUNT(*) FROM likes WHERE work_id = ?) WHERE id = ?', w, w);
      });
      for (const id of ids) fs.rmSync(path.join(worksDir, id), { recursive: true, force: true });
    },
  };

  data = { db, dataDir, worksDir, tmpDir, usedBy, hooks, close: () => db.close() };
  return data;
}

module.exports = { openData };
