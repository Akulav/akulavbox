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

function guessMime(filename, provided) {
  if (provided && provided !== 'application/octet-stream') return provided;
  return MAP[extOf(filename)] || provided || 'application/octet-stream';
}

function isActiveContent(mime) {
  return ACTIVE.has((mime || '').split(';')[0].trim().toLowerCase());
}

module.exports = { guessMime, isActiveContent, extOf };
