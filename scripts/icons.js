#!/usr/bin/env node
// Regenerates the PNG/ICO app icons from frontend/favicon.svg (needs `sharp`).
//   node scripts/icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.join(__dirname, '..', 'frontend');
const svg = fs.readFileSync(path.join(dir, 'favicon.svg'));

(async () => {
  // maskable icons keep the artwork inside the central ~80%, on a solid background
  const render = (size) => sharp(svg, { density: Math.ceil(72 * size / 64) * 2 }).resize(size, size).png().toBuffer();
  const tile = async (size, inner) => {
    const art = await render(inner);
    return sharp({ create: { width: size, height: size, channels: 4, background: '#0D1518' } })
      .composite([{ input: art, gravity: 'center' }]).png().toBuffer();
  };
  fs.writeFileSync(path.join(dir, 'icon-512.png'), await tile(512, 400));
  fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), await tile(180, 150));

  // favicon.ico holding 16, 32 and 48 px PNGs
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map(render));
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
  fs.writeFileSync(path.join(dir, 'favicon.ico'), Buffer.concat([header, ...pngs]));
  console.log('Icons written to frontend/: icon-512.png, apple-touch-icon.png, favicon.ico');
})().catch((e) => { console.error(e.message); process.exit(1); });
