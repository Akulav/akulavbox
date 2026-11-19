'use strict';
// Formularele multipart ale documentelor: câmpul „data” (JSON) și fișierele, scrise direct pe disc.
// Spațiul alocat contului (Consola de administrare) se verifică pe măsură ce sosesc fișierele.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { fail, str, readDoc, fmtMb } = require('./validate');

// Pe loc, nu în fundal: după un refuz (cota, o eroare) nu trebuie să rămână nimic pe disc.
function removeStored(store, names) {
  for (const n of names) {
    try { fs.rmSync(path.join(store.uploadDir, n), { force: true }); } catch {}
  }
}

/** `room`: câți octeți mai încap (Infinity fără cotă); `quota`: cota, pentru mesaj */
async function readUploads(req, { room, quota }) {
  const dir = req.store.uploadDir;
  let data = null;
  const saved = [];
  let incoming = 0;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!part.filename) {
          part.file.resume();
          continue;
        }
        const stored = crypto.randomBytes(16).toString('hex');
        saved.push({ stored, name: str(path.basename(part.filename), 200) || 'fisier', size: 0 });
        await pipeline(part.file, fs.createWriteStream(path.join(dir, stored)));
        if (part.file.truncated) throw fail(413, 'Fișierul depășește limita de 50 MB.');
        const size = fs.statSync(path.join(dir, stored)).size;
        saved[saved.length - 1].size = size;
        incoming += size;
        if (incoming > room) throw fail(413, `Spațiul alocat documentelor este plin (${fmtMb(quota)}). Ștergeți fișiere sau cereți administratorului mai mult spațiu.`);
      } else if (part.fieldname === 'data') {
        try {
          data = JSON.parse(part.value);
        } catch {
          throw fail(400, 'Date invalide.');
        }
      }
    }
    return { data, saved };
  } catch (e) {
    removeStored(req.store, saved.map((f) => f.stored));
    throw e;
  }
}

async function readDocForm(req, limits) {
  const { data, saved } = await readUploads(req, limits);
  try {
    return { doc: readDoc(req.store, data), saved };
  } catch (e) {
    removeStored(req.store, saved.map((f) => f.stored));
    throw e;
  }
}

// Cererea este refuzată oricum: citim corpul până la capăt (fără a scrie nimic pe disc),
// altfel browserul vede o conexiune întreruptă în loc de mesajul de eroare.
async function discardUploads(req) {
  try {
    for await (const part of req.parts()) if (part.type === 'file') part.file.resume();
  } catch {}
}

module.exports = { readDocForm, discardUploads, removeStored };
