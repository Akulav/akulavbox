#!/usr/bin/env node
// Stand-in for yt-dlp used by `npm run check` (set YTDLP_PATH to this file).
// Answers the few commands AkulavBox uses, with no network access:
//   --version, -J (details; URLs containing "playlist" list two entries),
//   and a download that writes a small media file and a cover.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const url = args[args.indexOf('--') + 1] || args[args.length - 1];
if (args.includes('--version')) { console.log('2099.01.01-fake'); process.exit(0); }
if (/fail/.test(url)) { console.error('ERROR: [generic] This video is unavailable'); process.exit(1); }
// a video with unusual formats: only "best available" (-f bv*+ba/b, or no -f) works
if (/noformat/.test(url) && !args.includes('-J')) {
  const f = args.indexOf('-f');
  if (f !== -1 && args[f + 1] !== 'bv*+ba/b') { console.error(`ERROR: [youtube] ${url.split('=').pop()}: Requested format is not available. Use --list-formats for a list of available formats`); process.exit(1); }
}
// an age-restricted video works only with a cookie file that has youtube.com in it
if (/agegate/.test(url)) {
  const c = args.indexOf('--cookies');
  if (c === -1 || !/youtube\.com/.test(fs.readFileSync(args[c + 1], 'utf-8'))) {
    console.error('ERROR: [youtube] agegate: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ for how to manually pass cookies');
    process.exit(1);
  }
}
const id = (url.split('/').pop() || 'x').replace(/[^\w-]/g, '') || 'x';

if (args.includes('-J')) {
  if (/playlist/.test(url)) {
    console.log(JSON.stringify({ _type: 'playlist', title: 'Test playlist', uploader: 'List Maker',
      entries: [{ url: 'https://example.com/v/first', title: 'First', id: 'first', ie_key: 'Fake' }, { url: 'https://example.com/v/second', title: 'Second', id: 'second', ie_key: 'Fake' },
        ...(/p2/.test(url) ? [{ url: 'https://example.com/v/third', title: 'Third', id: 'third', ie_key: 'Fake' }] : [])] }));
  } else {
    console.log(JSON.stringify({ id, title: `Test video ${id}`, track: `Test song ${id}`, uploader: 'Test Creator', channel: 'Test Creator',
      artist: 'Test Artist', album: 'Test Album', duration: 42, upload_date: '20260102', tags: ['demo', 'test'],
      description: 'A test download. #Cooking #2026 more at https://example.com/#anchor', categories: ['Education'], extractor_key: 'Fake', webpage_url: url }));
  }
  process.exit(0);
}

// download: "-o <dir>/media.%(ext)s" and "-o thumbnail:<dir>/thumb.%(ext)s"
const outs = args.map((a, i) => (a === '-o' ? args[i + 1] : null)).filter(Boolean);
// "flaky" drops the connection once, "stall" goes silent once (a marker in the job's folder remembers)
if (/flaky|stall/.test(url)) {
  const marker = require('path').join(require('path').dirname(outs[0]), 'tried.marker');
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, '1');
    if (/flaky/.test(url)) { console.error('ERROR: [download] Got error: Connection reset by peer'); process.exit(1); }
    setInterval(() => {}, 1000); // say nothing until AkulavBox gives up on us
    return;
  }
}
const media = outs.find(o => !o.startsWith('thumbnail:'));
const thumb = (outs.find(o => o.startsWith('thumbnail:')) || '').replace(/^thumbnail:/, '');
const audio = args.includes('-x') || args.some(a => /^ba\[/.test(a));
const ext = audio ? 'm4a' : 'mp4';
const total = 64 * 1024;
console.log(`AKP ${total / 2} ${total} NA 1000`);
console.log(`AKP ${total} ${total} NA 1000`);
fs.writeFileSync(media.replace('%(ext)s', ext), Buffer.alloc(total, 7));
if (thumb) {
  // 1×1 PNG
  fs.writeFileSync(thumb.replace('%(ext)s', 'png'), Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005fe02fea72c2d9c0000000049454e44ae426082', 'hex'));
}
process.exit(0);
