// Extension -> MIME map used when the browser didn't send a useful type on upload,
// and when serving files so previews (PDF, audio, text...) work inline.
const MAP = {
  // images
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', heic: 'image/heic',
  // video
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  ogv: 'video/ogg', avi: 'video/x-msvideo',
  // audio
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm',
  // documents
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  gz: 'application/gzip', tar: 'application/x-tar',
  // text
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml',
};

// Types the browser would execute/render as active content if opened directly.
const ACTIVE = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/xml', 'text/xml']);

function extOf(filename = '') {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

// A plain "type/subtype" (the browser's upload type is client input; anything odd is ignored)
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

function guessMime(filename, provided) {
  const p = String(provided || '').split(';')[0].trim().toLowerCase();
  if (p && p !== 'application/octet-stream' && MIME_RE.test(p)) return p;
  return MAP[extOf(filename)] || 'application/octet-stream';
}

function isActiveContent(mime) {
  return ACTIVE.has((mime || '').split(';')[0].trim().toLowerCase());
}

/**
 * CSP for a user file opened directly on our origin. Everything is sandboxed (no
 * scripts, no same-origin access to the login token), not only the types known to
 * be active: a stored type is whatever the uploader's browser claimed. PDFs are the
 * exception, since browsers refuse to show a PDF in a sandboxed document; their
 * viewer runs in its own isolated origin anyway.
 */
function fileCsp(mime) {
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  if (m === 'application/pdf') return null;
  return "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'unsafe-inline'";
}

module.exports = { guessMime, isActiveContent, fileCsp, extOf };
