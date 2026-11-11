#!/usr/bin/env node
// Stand-in for ffmpeg and ffprobe used by `npm run check` (FFMPEG_PATH points here;
// a .js ffmpeg is also used as ffprobe). No real media work: it answers the
// probes AkulavBox makes and writes small output files.
//
// The AV1 encoder is only offered once <STORAGE_DIR>/fake-av1 exists, so the test
// can switch it on after the download checks (which expect no AV1 re-encode).
// Files it "encodes" to AV1 start with AV1F, and probing them answers av1.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const av1On = !!process.env.STORAGE_DIR && fs.existsSync(path.join(process.env.STORAGE_DIR, 'fake-av1'));
const head = (src) => {
  try {
    const b = Buffer.alloc(4);
    const fd = src === 'pipe:0' ? 0 : fs.openSync(src, 'r');
    const n = fs.readSync(fd, b, 0, 4, src === 'pipe:0' ? null : 0);
    return b.subarray(0, n).toString('latin1');
  } catch (e) { return ''; }
};
if (args.includes('-version')) { console.log('ffmpeg version 9.9-fake Copyright (c) the stand-in'); process.exit(0); }
if (args.includes('-encoders')) { console.log(` A....D aac   AAC (Advanced Audio Coding)\n V....D libx264   H.264${av1On ? '\n V....D libsvtav1   SVT-AV1' : ''}`); process.exit(0); }
if (args.includes('-show_entries')) {
  // ffprobe: codec of the first audio or video stream
  const sel = args[args.indexOf('-select_streams') + 1] || '';
  const codec = sel.startsWith('a') ? 'aac' : head(args[args.length - 1]) === 'AV1F' ? 'av1' : 'h264';
  const what = args[args.indexOf('-show_entries') + 1] || '';
  console.log(what === 'stream=codec_name,width,height' ? `${codec},640,360` : codec);
  process.exit(0);
}
const out = args[args.length - 1];
if (args.includes('-frames:v')) { fs.writeFileSync(out, Buffer.from('ffd8ffe000104a464946000101', 'hex')); process.exit(0); }
// a conversion: report progress the way `-progress pipe:1` does, then write the result
console.log('out_time_us=21000000\nprogress=continue');
console.log('out_time_us=42000000\nprogress=end');
const body = Buffer.alloc(8 * 1024, 3);
if (args.includes('libsvtav1')) body.write('AV1F', 0, 'latin1');
fs.writeFileSync(out, body);
process.exit(0);
