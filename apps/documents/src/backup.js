'use strict';
// Export / import al unui spațiu de stocare (personal sau serviciu): documentele, categoriile și toate
// fișierele într-o singură arhivă comprimată Brotli. Contul și jurnalul nu fac parte din arhivă.
//
// Formatul (după decomprimare):
//   ANSC-BACKUP 1\n
//   {"name":"db.json","size":N}\n <N octeți> {"sha256":"…"}\n
//   {"name":"files/<nume stocat>","size":N}\n <N octeți> {"sha256":"…"}\n   (pentru fiecare fișier)
//   {"end":true,"count":K}\n
// Fiecare intrare are sumă de control, iar marcajul final dovedește că arhiva este întreagă.
// Importul verifică totul într-un folder temporar și abia apoi înlocuiește datele, într-o singură tranzacție.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline, finished } = require('node:stream/promises');
const { once } = require('node:events');
const { tx } = require('./db');

const MAGIC = 'ANSC-BACKUP 1';
const STORED = /^[0-9a-f]{32}$/;
// Ordinea contează doar la ștergere (copiii înaintea părinților). Backupurile vechi (complete, cu utilizatori
// și organigramă) se pot importa în continuare: se iau doar aceste tabele.
const TABLES = ['categories', 'tags', 'documents', 'document_files', 'document_tags'];
// Coloanele care leagă un document de alți utilizatori nu au sens într-o aplicație cu un singur cont.
const SKIP_COLUMNS = new Set(['created_by', 'signed_by']);
const bad = (message) => Object.assign(new Error(message), { expose: true });
const line = (obj) => Buffer.from(JSON.stringify(obj) + '\n');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function* archive({ db, uploadDir: UPLOAD_DIR, key }) {
  // Instantaneu sincron al bazei de date: nicio altă cerere nu se poate intercala aici.
  const tables = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  const stored = tables.document_files.map((f) => f.stored);
  const missing = new Set(stored.filter((s) => !fs.existsSync(path.join(UPLOAD_DIR, s))));
  const json = Buffer.from(JSON.stringify({ format: 1, store: key, created_at: new Date().toISOString(), missing: [...missing], tables }));

  yield Buffer.from(MAGIC + '\n');
  yield line({ name: 'db.json', size: json.length });
  yield json;
  yield line({ sha256: sha(json) });
  let count = 1;
  for (const s of stored) {
    if (missing.has(s)) continue;
    const file = path.join(UPLOAD_DIR, s);
    const size = fs.statSync(file).size;
    const hash = crypto.createHash('sha256');
    let read = 0;
    yield line({ name: 'files/' + s, size });
    for await (const chunk of fs.createReadStream(file)) {
      hash.update(chunk);
      read += chunk.length;
      yield chunk;
    }
    if (read !== size) throw new Error('Fișier modificat în timpul exportului: ' + s);
    yield line({ sha256: hash.digest('hex') });
    count++;
  }
  yield line({ end: true, count });
}

function createExportStream(store) {
  const out = zlib.createBrotliCompress({
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 },
  });
  // la eroare fluxul este distrus, deci descărcarea eșuează vizibil în loc să producă o arhivă trunchiată
  pipeline(Readable.from(archive(store)), out).catch(() => {});
  return out;
}

// Citește arhiva în folderul `stage`; întoarce conținutul db.json și numele fișierelor primite.
async function readArchive(input, stage) {
  const src = zlib.createBrotliDecompress();
  input.on('error', (e) => src.destroy(e));
  input.pipe(src);
  try {
    return await parseArchive(src, stage);
  } catch (e) {
    // Citim restul încărcării până la capăt, altfel browserul vede o conexiune întreruptă în loc de mesajul de eroare.
    input.unpipe(src);
    if (!input.readableEnded && !input.destroyed) {
      input.resume();
      await once(input, 'end').catch(() => {});
    }
    throw e;
  }
}

async function parseArchive(src, stage) {

  let pendingLine = Buffer.alloc(0);
  let cur = null; // intrarea ale cărei date se citesc
  let awaitingHash = null; // intrarea terminată, care își așteaptă suma de control
  let sawMagic = false;
  let ended = false;
  let dbJson = null;
  const files = new Set();

  const finish = async () => {
    if (cur.out) {
      cur.out.end();
      await finished(cur.out);
    }
    awaitingHash = cur;
    cur = null;
  };
  const handle = async (text) => {
    if (ended) throw bad('Date după sfârșitul arhivei.');
    if (!sawMagic) {
      if (text !== MAGIC) throw bad('Fișierul nu este un backup e-Management ANSC.');
      sawMagic = true;
      return;
    }
    const obj = JSON.parse(text);
    if (awaitingHash) {
      if (obj.sha256 !== awaitingHash.hash.digest('hex')) throw bad('Sumă de control greșită pentru ' + awaitingHash.name + '. Arhiva este deteriorată.');
      if (awaitingHash.parts) dbJson = Buffer.concat(awaitingHash.parts);
      else files.add(awaitingHash.name.slice(6));
      awaitingHash = null;
      return;
    }
    if (obj.end) {
      if (obj.count !== files.size + (dbJson ? 1 : 0)) throw bad('Arhiva este incompletă.');
      ended = true;
      return;
    }
    if (!Number.isSafeInteger(obj.size) || obj.size < 0) throw bad('Arhivă invalidă.');
    cur = { name: String(obj.name), remaining: obj.size, hash: crypto.createHash('sha256') };
    if (cur.name === 'db.json' && !dbJson) {
      // db.json este ținut în memorie; o arhivă falsă nu trebuie să poată epuiza memoria serverului
      if (cur.remaining > 512 * 1024 * 1024) throw bad('Arhivă invalidă.');
      cur.parts = [];
    }
    else if (cur.name.startsWith('files/') && STORED.test(cur.name.slice(6)) && !files.has(cur.name.slice(6))) {
      cur.out = fs.createWriteStream(path.join(stage, cur.name.slice(6)));
    } else throw bad('Arhivă invalidă: intrare neașteptată.');
    if (!cur.remaining) await finish();
  };

  try {
  for await (let chunk of src) {
    while (chunk.length) {
      if (cur) {
        const part = chunk.subarray(0, cur.remaining);
        chunk = chunk.subarray(part.length);
        cur.hash.update(part);
        cur.remaining -= part.length;
        if (cur.parts) cur.parts.push(Buffer.from(part));
        else if (!cur.out.write(part)) await once(cur.out, 'drain');
        if (!cur.remaining) await finish();
      } else {
        const nl = chunk.indexOf(10);
        if (nl < 0) {
          pendingLine = Buffer.concat([pendingLine, chunk]);
          if (pendingLine.length > 65536) throw bad('Fișierul nu este un backup e-Management ANSC.');
          break;
        }
        const text = Buffer.concat([pendingLine, chunk.subarray(0, nl)]).toString();
        pendingLine = Buffer.alloc(0);
        chunk = chunk.subarray(nl + 1);
        await handle(text);
      }
    }
  }
  } finally {
    // un fișier rămas deschis ar împiedica ștergerea folderului temporar pe Windows
    if (cur && cur.out) {
      cur.out.destroy();
      await once(cur.out, 'close').catch(() => {});
    }
  }
  if (!ended || cur || awaitingHash || pendingLine.length || !dbJson) throw bad('Arhiva este incompletă (descărcare sau copiere întreruptă). Nimic nu a fost modificat.');
  return { data: JSON.parse(dbJson.toString()), files };
}

async function importArchive(input, { db, uploadDir: UPLOAD_DIR, dir }) {
  const stage = fs.mkdtempSync(path.join(dir, 'import-'));
  try {
    const { data, files } = await readArchive(input, stage);
    if (data.format !== 1 || !data.tables || !TABLES.every((t) => Array.isArray(data.tables[t]))) {
      throw bad('Versiune de backup necunoscută.');
    }
    const missing = new Set(data.missing || []);
    for (const f of data.tables.document_files) {
      if (!STORED.test(f.stored) || (!files.has(f.stored) && !missing.has(f.stored))) throw bad('Arhiva nu conține toate fișierele documentelor.');
    }

    // 1. Fișierele noi intră lângă cele vechi (numele sunt aleatorii, nu se suprapun cu altele).
    //    Dacă procesul se oprește aici, baza veche rămâne intactă.
    for (const s of files) fs.renameSync(path.join(stage, s), path.join(UPLOAD_DIR, s));

    // 2. Baza de date se înlocuiește într-o singură tranzacție: ori tot, ori nimic.
    tx(db, () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      // ștergerea documentelor golește prin cascadă și tabelele vechi legate de ele (semnături, partajări)
      for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        const rows = data.tables[t] || [];
        if (!rows.length) continue;
        // doar coloanele pe care le cunoaște schema curentă, ca backupurile vechi să rămână compatibile
        const known = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        const cols = known.filter((c) => c in rows[0] && !SKIP_COLUMNS.has(c));
        const ins = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
        for (const r of rows) ins.run(...cols.map((c) => r[c] ?? null));
      }
    });

    // 3. Fișierele care nu mai aparțin niciunui document se șterg.
    const keep = new Set(data.tables.document_files.map((f) => f.stored));
    for (const name of fs.readdirSync(UPLOAD_DIR)) if (!keep.has(name)) fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });

    return {
      documents: data.tables.documents.length,
      files: files.size,
      missing: missing.size,
      created_at: data.created_at,
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { createExportStream, importArchive };
