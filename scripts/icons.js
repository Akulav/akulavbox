#!/usr/bin/env node
// Regenerates the PNG/ICO icons from the SVG marks (needs `sharp`).
//   node scripts/icons.js
// hub/brand/favicon.svg is AkulavBox's mark (the sign-in page, the launcher, the site icon password managers
// such as Bitwarden pick up); apps/trove/public/trove.svg is Trove's; Tick's is in apps/tasks/public.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.join(__dirname, '..', 'hub', 'brand');
const troveDir = path.join(__dirname, '..', 'apps', 'trove', 'public');

/** An .ico holding PNGs of the given sizes */
function ico(pngs, sizes) {
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

async function icons(svgName, out, where = dir) {
  const svg = fs.readFileSync(path.join(where, svgName));
  const render = (size) => sharp(svg, { density: Math.ceil(72 * size / 64) * 2 }).resize(size, size).png().toBuffer();
  // maskable icons keep the artwork inside the central ~80%, on a solid background
  const tile = async (size, inner) => sharp({ create: { width: size, height: size, channels: 4, background: '#0D1518' } })
    .composite([{ input: await render(inner), gravity: 'center' }]).png().toBuffer();
  const written = [];
  const write = (name, buf) => { fs.writeFileSync(path.join(where, name), buf); written.push(path.relative(path.join(__dirname, '..'), path.join(where, name)).split(path.sep).join('/')); };
  for (const [name, size] of Object.entries(out.png || {})) write(name, await render(size));
  for (const [name, [size, inner]] of Object.entries(out.tile || {})) write(name, await tile(size, inner));
  const sizes = [16, 32, 48];
  write(out.ico, ico(await Promise.all(sizes.map(render)), sizes));
  return written;
}

(async () => {
  const a = await icons('favicon.svg', {
    png: { 'favicon-32x32.png': 32, 'favicon-96x96.png': 96, 'icon-192.png': 192 },
    tile: { 'icon-512.png': [512, 400], 'apple-touch-icon.png': [180, 150] },
    ico: 'favicon.ico',
  });
  const t = await icons('trove.svg', {
    png: { 'trove-32.png': 32, 'trove-192.png': 192 },
    tile: { 'trove-512.png': [512, 400], 'trove-touch.png': [180, 150] },
    ico: 'trove.ico',
  }, troveDir);
  // Tick (apps/tasks) draws its own mark; the other apps keep the icons in their folders as they are
  const k = await icons('favicon.svg', {
    png: { 'favicon-32x32.png': 32, 'icon-192.png': 192 },
    tile: { 'icon-512.png': [512, 400], 'apple-touch-icon.png': [180, 150] },
    ico: 'favicon.ico',
  }, path.join(__dirname, '..', 'apps', 'tasks', 'public'));
  // Ironveil (apps/ironveil)
  const v = await icons('favicon.svg', {
    png: { 'favicon-32x32.png': 32, 'icon-192.png': 192 },
    tile: { 'icon-512.png': [512, 400], 'apple-touch-icon.png': [180, 150] },
    ico: 'favicon.ico',
  }, path.join(__dirname, '..', 'apps', 'ironveil', 'public'));
  console.log(`Icons written: ${[...a, ...t, ...k, ...v].join(', ')}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
