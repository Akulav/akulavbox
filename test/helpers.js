// Unit tests run without a server. Modules that read the configuration get a throwaway data folder
// and test keys; this must be required before any of them.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akulavbox-unit-'));
process.env.STORAGE_DIR = dir;
process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret';
process.env.MASTER_KEY = '0123456789abcdef0123456789abcdef';
process.env.AKB_NO_RESTORE = '1';
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows may hold files */ } });

module.exports = { dir };
