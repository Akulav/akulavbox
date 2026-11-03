export const extOf = (name = '') => {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
};

const SETS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'weba'],
  pdf: ['pdf'],
  markdown: ['md', 'markdown', 'mdx'],
  csv: ['csv', 'tsv'],
  json: ['json', 'geojson', 'jsonc', 'webmanifest'],
  html: ['html', 'htm', 'xhtml'],
  docx: ['docx'],
  sheet: ['xlsx', 'xls', 'xlsm', 'ods'],
  epub: ['epub'],
  zip: ['zip', 'jar', 'apk', 'cbz'],
  archive: ['7z', 'rar', 'gz', 'tgz', 'tar', 'bz2', 'xz'],
  code: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'py', 'rb', 'php', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'swift', 'scala',
    'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'css', 'scss', 'sass', 'less', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'dockerfile',
    'gradle', 'lua', 'r', 'dart', 'pl', 'hs', 'ex', 'exs', 'clj', 'graphql', 'gql', 'proto', 'tf', 'nix', 'makefile', 'cmake', 'diff', 'patch'],
  text: ['txt', 'log', 'text', 'rtf', 'nfo', 'srt', 'vtt', 'readme', 'license', 'gitignore', 'gitattributes', 'editorconfig', 'properties', 'lock'],
};

const BY_EXT = {};
for (const [kind, exts] of Object.entries(SETS)) for (const e of exts) BY_EXT[e] = kind;

const BARE_NAMES = { dockerfile: 'code', makefile: 'code', readme: 'text', license: 'text', '.gitignore': 'text', '.env': 'code' };

/** Broad preview category for a file record ({ filename, mime_type }) */
export function kindOf(file) {
  const name = (file.filename || file.name || '').toLowerCase();
  const ext = extOf(name);
  if (ext === 'svg') return 'svg';
  if (BY_EXT[ext]) return BY_EXT[ext];
  if (BARE_NAMES[name]) return BARE_NAMES[name];
  const m = (file.mime_type || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/')) return 'text';
  if (m === 'application/json') return 'json';
  return 'other';
}

export const isTextual = (k) => ['markdown', 'csv', 'json', 'html', 'code', 'text'].includes(k);
export const isImageKind = (k) => k === 'image' || k === 'svg';

const ICONS = {
  image: 'image', svg: 'image', video: 'film', audio: 'music', pdf: 'file-pdf', markdown: 'file-text', text: 'file-text',
  csv: 'file-sheet', sheet: 'file-sheet', json: 'file-code', code: 'file-code', html: 'file-code', docx: 'file-text',
  zip: 'file-archive', archive: 'file-archive', epub: 'file-text', other: 'file',
};
// Hue per kind, used as a tinted tile behind the icon
const TINTS = {
  image: '#5fb3a1', svg: '#5fb3a1', video: '#d0806b', audio: '#c78bd8', pdf: '#e0655a', markdown: '#8ea1a4', text: '#8ea1a4',
  csv: '#59b97f', sheet: '#59b97f', json: '#e8a33d', code: '#6fa8e6', html: '#e08a4f', docx: '#5b8ee6',
  zip: '#b39b6b', archive: '#b39b6b', epub: '#c9925a', other: '#8ea1a4',
};
export const iconFor = (kind) => ICONS[kind] || 'file';
export const tintFor = (kind) => TINTS[kind] || TINTS.other;

const KIND_LABEL = {
  image: 'Image', svg: 'SVG image', video: 'Video', audio: 'Audio', pdf: 'PDF document', markdown: 'Markdown', text: 'Text',
  csv: 'Spreadsheet (CSV)', sheet: 'Spreadsheet', json: 'JSON', code: 'Source code', html: 'HTML', docx: 'Word document',
  zip: 'Zip archive', archive: 'Archive', epub: 'EPUB book', other: 'File',
};
export const kindLabel = (k) => KIND_LABEL[k] || 'File';

// highlight.js language names by extension
const LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', vue: 'xml', svelte: 'xml',
  py: 'python', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', kts: 'kotlin', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', scala: 'scala', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', bat: 'dos', cmd: 'dos', sql: 'sql',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', xml: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  cfg: 'ini', conf: 'ini', env: 'bash', dockerfile: 'dockerfile', gradle: 'gradle', lua: 'lua', r: 'r', dart: 'dart', pl: 'perl', hs: 'haskell',
  ex: 'elixir', exs: 'elixir', clj: 'clojure', graphql: 'graphql', gql: 'graphql', proto: 'protobuf', tf: 'ini', makefile: 'makefile', cmake: 'cmake',
  diff: 'diff', patch: 'diff', json: 'json', geojson: 'json', jsonc: 'json', webmanifest: 'json', md: 'markdown', markdown: 'markdown', properties: 'properties',
};
export const languageFor = (name = '') => {
  const lower = name.toLowerCase();
  return LANG[extOf(lower)] || LANG[lower] || null;
};
