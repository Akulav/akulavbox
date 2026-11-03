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

## Realtime (`src/modules/chat.js`)

Socket.IO shares the HTTP server. Each user joins the room `user:<id>`, so all of their tabs get events. Presence (`online_list`, `user_online`, `user_offline`) is sent to friends only. Messages are stored in `messages` (the last 1,000 per conversation are kept by a trigger). Chat files live in `storage/chat_temp/` for 10 minutes. WebRTC signaling is relayed only between friends. `/api/rtc/config` hands out STUN and TURN servers.

## Frontend (`frontend/`)

- No build step: `index.html` defines an import map (Vue and the socket.io client from CDNs), the Tailwind CDN config, the design tokens (CSS variables per theme), and `modulepreload` hints for every module.
- `app.js` holds the shell: hash routing (`#/files/<folder>`, `#/albums/<col>/<album>`, …), sidebar, banners, and shortcuts.
- `lib/` holds shared state and services: `api.js` (fetch wrapper, session, version check), `upload.js` (parallel chunked uploads, cancel and retry, folder drops), `trash.js` (move to trash + Undo), `player.js` (one global `<audio>`), `realtime.js` (socket, unread counts, calls), `library.js` (thumbnails, covers, filters), `ui.js` (toasts and dialogs).
- `pages/` has one component per section. `components/` holds the shared UI: Shell (toasts, upload tray, player, call overlay), FileViewer, Library (thumbnails, editors), Brand, and Icon.
- Motion lives in CSS (`.stagger`, `.rise`, `.lift`, `.page-*` transitions, `.app-bg`). It is turned off by `prefers-reduced-motion` or `html[data-motion="off"]` (the Profile setting).
