// Password hashing. Native `bcrypt` is fastest but needs a binary built for this
// OS; when it can't load (e.g. node_modules copied from another machine) the
// pure-JS `bcryptjs` takes over. Both read and write the same $2a$/$2b$ hashes.
let impl;
try {
  impl = require('bcrypt');
  impl.hashSync('probe', 4); // the binary loads lazily on some platforms
} catch (e) {
  impl = require('bcryptjs');
  console.warn('[auth] Native bcrypt unavailable on this system, using bcryptjs (pure JavaScript).');
}

module.exports = {
  hash: (pw, rounds = 10) => impl.hash(pw, rounds),
  hashSync: (pw, rounds = 10) => impl.hashSync(pw, rounds),
  compare: (pw, hash) => impl.compare(pw, hash),
  native: impl !== require('bcryptjs'),
};
