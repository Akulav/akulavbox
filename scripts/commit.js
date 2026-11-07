#!/usr/bin/env node
// Commit everything, using the changelog as the commit message.
//
//   npm run commit                 stage all changes and commit
//   npm run commit -- --dry-run    only print the message that would be used
//   npm run commit -- --push       also push the branch (and the new tag)
//
// The message is built from the lines added to CHANGELOG.md since the last
// commit, so every commit says exactly what changed. A commit without a new
// changelog entry is refused. When package.json's version changed, the commit
// is tagged v<version>.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const push = args.has('--push');

// git may not be on PATH on Windows (e.g. only GitHub Desktop is installed)
function findGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch (e) { /* not on PATH */ }
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
  ];
  const desktop = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
  if (fs.existsSync(desktop)) {
    // newest GitHub Desktop first
    for (const d of fs.readdirSync(desktop).filter(n => n.startsWith('app-')).sort().reverse()) {
      candidates.push(path.join(desktop, d, 'resources', 'app', 'git', 'cmd', 'git.exe'));
    }
  }
  const hit = candidates.find(p => p && fs.existsSync(p));
  if (!hit) { console.error('git was not found. Install Git or add it to PATH.'); process.exit(1); }
  return hit;
}

const gitBin = findGit();
const git = (...a) => execFileSync(gitBin, a, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitShow = (spec) => { try { return git('show', spec); } catch (e) { return null; } };

const version = require(path.join(root, 'package.json')).version;
const prevPkg = gitShow('HEAD:package.json');
const prevVersion = prevPkg ? JSON.parse(prevPkg).version : null;
const versionChanged = prevVersion !== version;

// lines added to the changelog since the last commit (staged or not)
const diff = (() => { try { return git('diff', 'HEAD', '--unified=0', '--', 'CHANGELOG.md'); } catch (e) { return ''; } })();
const added = diff.split('\n')
  .filter(l => l.startsWith('+') && !l.startsWith('+++'))
  .map(l => l.slice(1))
  .filter(l => l.trim() && !/^#\s/.test(l));

if (!added.length) {
  console.error('No new CHANGELOG.md entry since the last commit. Describe the change in CHANGELOG.md first.');
  process.exit(1);
}

// Subject: the release heading when the version changed, otherwise the first entry
const firstEntry = (added.find(l => /^\s*-\s/.test(l)) || added[0]).replace(/^\s*-\s*/, '').replace(/\*\*/g, '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:]+\S*$/, '') + '…' : s);
const subject = versionChanged ? `v${version}: ${clip(firstEntry, 60)}` : clip(firstEntry, 72);
// "### Fixed" becomes a plain "Fixed:" line with a gap above it (git shows # lines as-is)
const body = added.filter(l => !/^##\s/.test(l)).map(l => (/^###\s/.test(l) ? `\n${l.replace(/^###\s*/, '')}:` : l))
  .join('\n').replace(/\n{3,}/g, '\n\n').trim();
const message = `${subject}\n\n${body}\n`;

if (dryRun) {
  console.log(`--- commit message (v${version}${versionChanged ? `, was v${prevVersion || 'none'}` : ''}) ---\n${message}`);
  process.exit(0);
}

git('add', '-A');
if (!git('diff', '--cached', '--name-only')) { console.error('Nothing to commit.'); process.exit(1); }
const msgFile = path.join(os.tmpdir(), `akulavbox-commit-${process.pid}.txt`);
fs.writeFileSync(msgFile, message);
try { git('commit', '-F', msgFile); } finally { fs.rmSync(msgFile, { force: true }); }
console.log(`Committed: ${subject}`);

if (versionChanged) {
  const tag = `v${version}`;
  try { git('tag', '-a', tag, '-m', `AkulavBox ${tag}`); console.log(`Tagged ${tag}`); }
  catch (e) { console.warn(`Tag ${tag} not created (it may already exist).`); }
}

if (push) {
  git('push', '--follow-tags');
  console.log('Pushed.');
}
