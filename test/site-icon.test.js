const test = require('node:test');
const assert = require('node:assert');
const { iconLinks, validIcon, priority } = require('../src/core/site-icon');

test('site icon: ranks like Bitwarden (32x32 first, unsized last)', () => {
  assert.equal(priority('32x32'), 1);
  assert.equal(priority('64x64'), 2);
  assert.equal(priority('48x48'), 3);
  assert.equal(priority('16x16'), 4);
  assert.equal(priority('180x180'), 100);
  assert.equal(priority(null), 200);
  assert.equal(priority('32X32'), 200);
});

test('site icon: reads the head’s icon links, best first', () => {
  const html = `<html><head><link rel="stylesheet" href="/x.css"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/favicon-32x32.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
    <link rel="preload" href="/big.png"></head><body><link rel="icon" href="/body.png"></body></html>`;
  const links = iconLinks(html, 'https://example.com/');
  assert.equal(links[0].href, 'https://example.com/favicon-32x32.png');
  assert.ok(!links.some((l) => /x\.css|big\.png|body\.png/.test(l.href)));
});

test('site icon: PNG, ICO and JPEG only, and a PNG must end', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.alloc(4)]);
  assert.equal(validIcon('image/png', png), null);
  assert.match(validIcon('image/png', png.subarray(0, 12)), /IEND/);
  assert.equal(validIcon('image/x-icon', Buffer.from([0, 0, 1, 0, 1, 0, 0])), null);
  assert.match(validIcon('image/svg+xml', Buffer.from('<svg/>')), /not a PNG/);
});
