#!/usr/bin/env node
// Builds Ironveil's browser version and copies it into apps/ironveil/public/game/.
//   npm run ironveil                       (the game's folder next to this one: ../strategy-game)
//   npm run ironveil -- --src <folder>     (or IRONVEIL_SRC=<folder>)
//   npm run ironveil -- --no-build         (copy what the game's web/ folder already has)
// Needs Rust with the wasm32 target (rustup target add wasm32-unknown-unknown).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const at = args.indexOf('--src');
const src = path.resolve(at >= 0 ? args[at + 1] : process.env.IRONVEIL_SRC || path.join(__dirname, '..', '..', 'strategy-game'));
const out = path.join(__dirname, '..', 'apps', 'ironveil', 'public', 'game');

if (!fs.existsSync(path.join(src, 'Cargo.toml'))) {
  console.error(`No Ironveil source in ${src}. Pass --src <folder> or set IRONVEIL_SRC.`);
  process.exit(1);
}

const built = path.join(src, 'target', 'wasm32-unknown-unknown', 'release', 'ironveil.wasm');
if (!args.includes('--no-build')) {
  console.log(`Building Ironveil for the browser in ${src}…`);
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: src, stdio: 'inherit' });
}
const wasm = fs.existsSync(built) ? built : path.join(src, 'web', 'ironveil.wasm');
if (!fs.existsSync(wasm)) {
  console.error('No ironveil.wasm: build it first (leave out --no-build).');
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
const copied = [];
for (const f of ['gl.js', 'audio.js', 'storage.js']) {
  fs.copyFileSync(path.join(src, 'web', f), path.join(out, f));
  copied.push(f);
}
fs.copyFileSync(wasm, path.join(out, 'ironveil.wasm'));
copied.push(`ironveil.wasm (${(fs.statSync(wasm).size / 1024 / 1024).toFixed(1)} MB)`);

// the game's version, shown in the page
let version = null;
try { version = /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(src, 'Cargo.toml'), 'utf-8'))[1]; } catch (e) { /* no version */ }
fs.writeFileSync(path.join(out, 'meta.json'), `${JSON.stringify({ version }, null, 2)}\n`);
console.log(`Ironveil ${version || ''} copied to apps/ironveil/public/game: ${copied.join(', ')}`);
