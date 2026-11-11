#!/usr/bin/env node
// Fast static checks (CI runs them before the end-to-end test; run them yourself with `npm run lint`):
//   - every backend and frontend file parses
//   - the frontend's index.html keeps the import map above the module preloads,
//     and every frontend module has a <link rel="modulepreload">
//   - package.json, package-lock.json and CHANGELOG.md agree on the version
// No dependencies and no network.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const problems = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// 1. syntax. Frontend files are ES modules in a CommonJS package: check a .mjs copy so
//    every Node version parses them as modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akulavbox-lint-'));
const check = (file, asModule) => {
  let target = file;
  if (asModule) { target = path.join(tmp, rel(file).replace(/[\\/]/g, '__') + '.mjs'); fs.copyFileSync(file, target); }
  try { execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' }); }
  catch (e) { problems.push(`${rel(file)} doesn't parse:\n${String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')}`); }
};
const backend = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))];
const frontend = walk(path.join(root, 'frontend'));
for (const f of backend) check(f, false);
for (const f of frontend) check(f, true);
fs.rmSync(tmp, { recursive: true, force: true });

// 1b. SQL: no numbered placeholders (?1). Node 22's node:sqlite can't bind them
//     ("column index out of range"), while newer Node versions can, so tests on a new Node miss it.
for (const f of backend) {
  if (rel(f) === 'scripts/lint.js') continue;
  fs.readFileSync(f, 'utf-8').split('\n').forEach((line, i) => {
    if (/\b(SELECT|INSERT|UPDATE|DELETE|WHERE|VALUES)\b.*\?\d/.test(line)) problems.push(`${rel(f)}:${i + 1} uses a numbered SQL placeholder (?1). Use plain ? and pass the value again.`);
  });
}

// 2. index.html: the import map must come first, and every module needs a preload
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf-8');
const mapAt = html.indexOf('<script type="importmap">');
const firstPreload = html.indexOf('rel="modulepreload"');
if (mapAt === -1) problems.push('frontend/index.html has no import map.');
else if (firstPreload !== -1 && firstPreload < mapAt) problems.push('frontend/index.html: the import map must stay above every <link rel="modulepreload">.');
const preloaded = new Set([...html.matchAll(/rel="modulepreload" href="\/([^"]+)"/g)].map(m => m[1]));
for (const f of frontend) {
  const r = rel(f).replace(/^frontend\//, '');
  if (!preloaded.has(r)) problems.push(`frontend/${r} has no <link rel="modulepreload" href="/${r}"> in index.html.`);
}
for (const r of preloaded) if (!fs.existsSync(path.join(root, 'frontend', r))) problems.push(`index.html preloads /${r}, which doesn't exist.`);

// 3. one version everywhere
const pkg = require(path.join(root, 'package.json'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf-8'));
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) problems.push(`package-lock.json says ${lock.version}, package.json says ${pkg.version}. Run: npm install --package-lock-only --ignore-scripts`);
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8');
const top = /^## (\d+\.\d+\.\d+)/m.exec(changelog)?.[1];
if (top !== pkg.version) problems.push(`The newest CHANGELOG.md entry is ${top || 'missing'}, but package.json is ${pkg.version}.`);

const files = backend.length + frontend.length;
if (problems.length) {
  console.error(`✗ ${problems.length} problem${problems.length === 1 ? '' : 's'} (${files} files checked):\n`);
  for (const p of problems) console.error(`- ${p}\n`);
  process.exit(1);
}
console.log(`✓ ${files} files parse, index.html preloads every module, version ${pkg.version} everywhere`);
