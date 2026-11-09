#!/usr/bin/env node
// Full backups and the storage check from the command line, for servers without
// a browser handy or backups too big to upload through one.
//
//   node scripts/backup.js export <file.akbx>      passphrase from AKB_PASSPHRASE
//   node scripts/backup.js import <file.akbx>      stages it; the next `npm start` applies it
//   node scripts/backup.js check [--fix]           files on disk vs. the database
//
// Uses the same .env and STORAGE_DIR as the server. Stop the server before an
// import, or restart it afterwards.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

// the server applies staged restores; this tool may run next to it and must not
process.env.AKB_NO_RESTORE = '1';

const [cmd, arg] = process.argv.slice(2);
const pass = process.env.AKB_PASSPHRASE || '';
const gb = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;

async function main() {
  const config = require('../src/core/config');
  const { problems } = config.validate();
  if (problems.length) throw new Error(problems.join('\n'));
  const db = require('../src/core/db');
  const backup = require('../src/core/backup');

  if (cmd === 'export') {
    if (!arg) throw new Error('Usage: node scripts/backup.js export <file.akbx>');
    if (pass.length < 8) throw new Error('Set AKB_PASSPHRASE to a passphrase of at least 8 characters.');
    const est = backup.estimate(db);
    console.log(`Exporting about ${gb(est.bytes)} (${est.files} files)…`);
    let last = 0;
    await pipeline(backup.exportStream(db, pass, { onProgress: ({ done, total }) => {
      if (Date.now() - last > 2000) { last = Date.now(); process.stdout.write(`\r${Math.round((done / (total || 1)) * 100)}%   `); }
    } }), fs.createWriteStream(path.resolve(arg)));
    console.log(`\rSaved ${path.resolve(arg)} (${gb(fs.statSync(arg).size)})`);
  } else if (cmd === 'import') {
    if (!arg) throw new Error('Usage: node scripts/backup.js import <file.akbx>');
    const { LATEST } = require('../src/core/migrations');
    const timer = setInterval(() => process.stdout.write(`\r${backup.state.step} ${Math.round((backup.state.done / (backup.state.total || 1)) * 100)}%   `), 2000);
    try {
      const r = await backup.stageImport(path.resolve(arg), pass, { currentSchema: LATEST });
      console.log(`\rReady: ${r.users} accounts and ${r.files} files from ${r.created_at}${r.rekeyed ? ' (re-encrypted for this server’s key)' : ''}.`);
      console.log('Restart the server (stop it, then npm start) to apply it. The current data is kept in storage/backups/pre-import-*.');
      console.log('If the Admin page still says “Ready to restore” afterwards, it shows why the swap failed.');
    } finally { clearInterval(timer); }
  } else if (cmd === 'check') {
    const m = require('../src/core/maintenance');
    const r = m.scan();
    console.log(`On disk: ${r.disk_files} files, ${gb(r.disk_bytes)}. In the database: ${r.db_files} files, ${gb(r.db_bytes)}.`);
    console.log(`Not in the database: ${r.orphans.length} (${gb(r.orphan_bytes)}), ${r.recoverable} recoverable. Missing on disk: ${r.missing.length}. Usage counters off: ${r.usage.length}.`);
    for (const u of r.usage) console.log(`  ${u.username}: recorded ${gb(u.recorded)}, actually ${gb(u.actual)}`);
    if (process.argv.includes('--fix')) console.log('Fixed:', m.clean());
    else if (r.orphans.length || r.missing.length || r.usage.length) console.log('Run with --fix to clean up.');
  } else {
    console.log('Usage: node scripts/backup.js export <file> | import <file> | check [--fix]   (AKB_PASSPHRASE for export/import)');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
