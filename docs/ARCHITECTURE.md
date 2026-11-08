# Architecture

AkulavBox is a single Fastify process that serves a JSON API, a Socket.IO endpoint, and a static single-page app. State lives in one SQLite database plus encrypted files on disk.

```
browser (Vue 3, ES modules)  ──HTTP──▶  Fastify  ──▶  node:sqlite (storage/akulavbox.db)
          ▲                                │
          └────────Socket.IO (chat, presence, call signaling)
                                           └──▶  storage/users/<owner>/<id>.enc  (AES-256-CTR)
```

## Startup order

1. `src/core/config.js` loads `.env`, resolves `STORAGE_DIR`, and creates the storage folders.
2. `src/server.js` validates the config and exits with a readable message if `MASTER_KEY` or `JWT_SECRET` is wrong.
3. `src/core/db.js` opens SQLite and runs **`src/core/migrations.js`**. Pending steps run in order inside transactions, and an existing database is first snapshotted with `VACUUM INTO` to `storage/backups/`. Then the pragmas are set (WAL, `synchronous=NORMAL`, busy timeout) and the default admin is created on an empty database.
4. `src/core/library.js` adopts locked library folders created by older versions (idempotent).
5. Route modules register under `src/modules/`.

## Schema versioning

The schema version is `PRAGMA user_version`. Each entry in `MIGRATIONS` is one version. Steps must be **idempotent** (`CREATE … IF NOT EXISTS`, `addColumn` only adds missing columns), because 1.x databases already contain most tables at version 0. Append new steps at the end and never edit a released one.

| # | What |
| --- | --- |
| 1 | Baseline: every table and column 1.x ever created |
| 2 | Indexes for hot lookups |
| 3 | `users.token_version`, `created_at`, `last_login_at` |
| 4 | Trash columns `trashed_at`, `trash_root` on files and folders |
| 5 | `album_images.added_at`, `playlist_songs.position` |
| 6 | `chat_reads` (persistent unread counts) |
| 7 | `media_collections`, `media_collection_items`, `downloads`, `media_meta.source_url` / `source_id` |

## Authentication

- JWTs carry `{ id, username, role, tv }`. `tv` must equal `users.token_version`. Bumping it (password change, admin reset, "sign out everywhere") revokes every older token.
- `verifyUser` / `verifyAdmin` (`src/core/auth.js`) verify the signature **and** load the user, so deleted users and changed roles take effect immediately.
- Tokens older than a day get a fresh one in the `X-Refresh-Token` response header (sliding sessions). `frontend/lib/api.js` stores it.
- Media URLs (`<img>`, `<video>`) pass the token as `?token=`. It is redacted from logs, and `Referrer-Policy: same-origin` keeps it from leaking.
- Login: rate limited per IP and per username (10 failures / 15 min), a dummy bcrypt comparison runs for unknown usernames, and usernames are matched case-insensitively.
- `src/core/hash.js` prefers native `bcrypt` and falls back to `bcryptjs`. The hash formats are identical.

## Files and encryption (`src/core/storage.js`)

- Encrypted files: `storage/users/<owner>/<fileId>.enc`, AES-256-CTR with the per-file IV in `files.iv_hex` and the key `MASTER_KEY`.
- Shared files are stored decrypted as `.plain` while they have a `public_hash`, so `/shared/<hash>` can stream them. Un-sharing re-encrypts them with a fresh IV.
- `ctrAt(iv, offset)` positions the CTR keystream at any byte. It is used for range requests (video seeking) and for encrypting upload chunks in place.
- **Uploads:** the client sends 16 MB chunks with `upload_id`, `offset`, `total_size`, and `chunk_index` / `total_chunks`. Each chunk is encrypted and written at its offset in `storage/temp/<user>-<upload>.part`, and the IV is kept in a `.json` sidecar. The last chunk checks the size and quota, then renames the file into place. Quota and free disk space (`DISK_RESERVE_MB`) are checked on every chunk.
- Thumbnails (`src/core/thumbs.js`): made by `sharp` in three widths and cached encrypted under `storage/thumbs/`. Without `sharp`, the browser renders them and uploads them (`PUT /api/files/:id/thumb`).

## Trash (`src/core/trash.js`)

- Deleting sets `trashed_at`. Trashing a folder marks its whole subtree, with `trash_root = <folder id>` on everything inside, so the tree restores and purges as a unit.
- Every listing query filters `trashed_at IS NULL`. **Remember this when adding a query over `files` or `folders`.**
- `purgeFile()` is the only permanent delete. It removes the file from disk and cleans every reference (albums, playlists, covers, media metadata, thumbnails, quota).
- Items older than `TRASH_DAYS` are purged hourly.

## Locked library folders

Photos, Music (+ Artwork), Videos (+ Covers), and Books (+ Covers) are system folders (`folders.system_key`), defined in `src/core/library.js`. They can't be renamed, moved, deleted, or given sub-folders, and they only accept their media type. The Photos, Music, Videos, and Books pages are views over them, with per-file details in `media_meta`.

The cover and artwork sub-folders (`library.HIDDEN`) are hidden from Files listings, search and the Move picker. Their sizes still count towards the parent folder.

## Collections and link downloads

- `media_collections` and `media_collection_items` group library items, the way `playlists` and `playlist_songs` group songs (`src/core/collections.js`, `src/modules/collections.js`). Only videos use them in the UI today, but `kind` allows books.
- `src/core/tools.js` installs **yt-dlp** and a static **ffmpeg** into `storage/tools/` on first start. It picks the right build for Windows or Linux on x64 or ARM, downloads it from the official GitHub releases, checks the published SHA-256, and unpacks it with `tar`. yt-dlp runs `-U` once a day. Explicit `YTDLP_PATH` / `FFMPEG_PATH` and copies on PATH win.
- `src/core/downloader.js` keeps jobs in the `downloads` table (they resume after a restart) and runs `DOWNLOAD_PARALLEL` at once:
  1. `yt-dlp -J --flat-playlist`: a playlist becomes one job per entry. A `media_meta.source_id` match means the item is already in the library.
  2. Download to `storage/temp/dl-<job>/`. With ffmpeg, an AV1 stream ≤ 1080p is preferred.
  3. If the video isn't AV1 and ffmpeg has an AV1 encoder (`libsvtav1`), it is re-encoded one at a time (`converting`). The result is kept only if smaller.
  4. `storeFile()` encrypts the media (and its thumbnail as a cover) into the Videos/Music folders. `media_meta` gets the title, creator, date, length, description and source.
  5. Filing: a video goes into the collection named after its creator, a song into the playlist named after its artist.
- Links must be public http(s). Literal private IPs and `localhost` are refused, and yt-dlp is spawned with an argument array and `--` before the URL.
- The duplicate check (`media_meta.source_id`) only looks in the folder being saved to, so a link can be kept both as a video and as a song.
- **Sign-in cookies** (`src/core/cookies.js`): per user in `storage/private/cookies/<id>.enc` (16-byte IV, then AES-256-CTR with `MASTER_KEY`). A plain copy is written into the job's work folder only while yt-dlp runs and is removed with it. Errors that ask for sign-in get a hint pointing to Profile → Link downloads.
- **Video → song** jobs have the url `akulavbox:video/<fileId>` and go through the same queue: decrypt to the work folder, ffprobe the audio codec, copy it when browsers play it (AAC → m4a, MP3, Opus, FLAC, Vorbis) or encode to AAC, store it in Music with the video's details, copy the cover (or grab a frame) into Artwork, and file it in the creator's playlist. Without yt-dlp, only conversions run.

## Storage check (`src/core/maintenance.js`)

Compares `storage/users/` with `files`. Files written in the last hour are skipped (an upload may be finishing).
- **Orphans** (no row): unreadable `.enc` files are deleted; readable `.plain` files of an existing owner are adopted into a "Recovered files" folder with a type sniffed from their first bytes. Folders of deleted accounts go too.
- **Missing** (row, no data): if the other variant (`.enc`/`.plain`) exists the row is pointed at it, otherwise it is removed through `purgeFile()`.
- **Usage**: `users.used_bytes` is reset to the sum of the user's file rows (trash included) plus chat files still on disk.

## Full backups (`src/core/backup.js`)

- `.akbx` = `"AKBX" 0x01`, a plain JSON header (scrypt salt and cost, AES IV, a passphrase check value), the AES-256-CTR encrypted body, and an HMAC-SHA256 over header and ciphertext. Keys come from `scrypt(passphrase)`.
- Body: entries of `type | name | gzip flag | u64 length | bytes`: `manifest.json` (counts, schema, version, the `MASTER_KEY`), `akulavbox.db` (a `VACUUM INTO` snapshot, gzip level 9), then every `users/<id>/<file>` as stored (already encrypted, so not compressed) and saved cookies. Thumbnails, tools and temp files are left out.
- Import stages into `storage/import-staging/`, refuses backups with a newer schema, re-keys `.enc` files when the backup's key differs (same IV, old keystream off, new keystream on), and verifies the HMAC before writing `ready.json`. Nothing live changes until the next start: `applyPending()` runs in `db.js` before the database opens, moves the current database, `users/` and cookies to `storage/backups/pre-import-<time>/`, moves the staged data in, and clears the thumbnail cache. Migrations then bring an older backup up to date.

## Updates from GitHub (`src/core/updater.js`)

- The newest version is `package.json` on `UPDATE_BRANCH` (default `main`) of the repository named in `package.json` → `repository` (or `UPDATE_REPO`, or the git remote). No releases or tags are needed. Checked every 6 hours; notes are the `CHANGELOG.md` sections newer than the running version.
- **git mode** (the app folder is a clone and git runs): refuse if tracked files are modified, `git fetch origin <branch>`, `git merge --ff-only <sha>`. Rollback is `git reset --hard <previous sha>`.
- **archive mode**: download `/tarball/<sha>`, unpack with `tar`, check its version, copy the current code (everything but `storage/`, `node_modules/`, `.git/`, `.env*`, `logs/`) to `storage/updates/backup-<version>-<time>/`, copy the new code over, and delete files under `src/ frontend/ scripts/ docs/` that the new version no longer has. Rollback copies the backup back.
- `npm install --omit=dev` runs when `dependencies`/`optionalDependencies` changed; if it fails the old code is put back. The previous version is recorded in `storage/updates/state.json`. The running process keeps the old code until it restarts.

## Realtime (`src/modules/chat.js`)

Socket.IO shares the HTTP server. Each user joins the room `user:<id>`, so all of their tabs get events. Presence (`online_list`, `user_online`, `user_offline`) is sent to friends only. Messages are stored in `messages` (the last 1,000 per conversation are kept by a trigger). Chat files live in `storage/chat_temp/` for 10 minutes. WebRTC signaling is relayed only between friends. `/api/rtc/config` hands out STUN and TURN servers.

## Frontend (`frontend/`)

- No build step: `index.html` defines an import map (Vue and the socket.io client from CDNs), the Tailwind CDN config, the design tokens (CSS variables per theme), and `modulepreload` hints for every module.
- `app.js` holds the shell: hash routing (`#/files/<folder>`, `#/albums/<col>/<album>`, …), the top navigation bar (bottom bar on phones), account menu, banners, and shortcuts.
- `lib/` holds shared state and services: `api.js` (fetch wrapper, session, version check), `upload.js` (parallel chunked uploads, cancel and retry, folder drops), `trash.js` (move to trash + Undo), `player.js` (one global `<audio>`), `realtime.js` (socket, unread counts, calls), `library.js` (thumbnails, covers, filters), `ui.js` (toasts and dialogs).
- `pages/` has one component per section. `components/` holds the shared UI: Shell (toasts, upload tray, player, call overlay), FileViewer, Library (thumbnails, editors), Brand, and Icon.
- Motion lives in CSS (`.stagger`, `.rise`, `.lift`, `.page-*` transitions, `.app-bg`). It is turned off by `prefers-reduced-motion` or `html[data-motion="off"]` (the Profile setting).
