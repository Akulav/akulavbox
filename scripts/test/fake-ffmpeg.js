#!/usr/bin/env node
// Stand-in for ffmpeg and ffprobe used by `npm run check` (FFMPEG_PATH points here;
// a .js ffmpeg is also used as ffprobe). No real media work: it answers the
// probes AkulavBox makes and writes small output files.
const fs = require('fs');

const args = process.argv.slice(2);
if (args.includes('-version')) { console.log('ffmpeg version 9.9-fake Copyright (c) the stand-in'); process.exit(0); }
if (args.includes('-encoders')) { console.log(' A....D aac   AAC (Advanced Audio Coding)\n V....D libx264   H.264'); process.exit(0); }
if (args.includes('-show_entries')) {
  // ffprobe: codec of the first audio or video stream
  const sel = args[args.indexOf('-select_streams') + 1] || '';
  console.log(sel.startsWith('a') ? 'aac' : 'h264');
  process.exit(0);
}
const out = args[args.length - 1];
if (args.includes('-frames:v')) { fs.writeFileSync(out, Buffer.from('ffd8ffe000104a464946000101', 'hex')); process.exit(0); }
// a conversion: report progress the way `-progress pipe:1` does, then write the result
console.log('out_time_us=21000000\nprogress=continue');
console.log('out_time_us=42000000\nprogress=end');
fs.writeFileSync(out, Buffer.alloc(8 * 1024, 3));
process.exit(0);
