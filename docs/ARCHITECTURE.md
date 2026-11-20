# Architecture

AkulavBox is the account and the server around six apps, the way a Google account holds its apps: **Trove** (files, the core, at `/box/`), **e-Management** (`/docs`), **Koma Shelf** (`/manga`), **Florin** (`/budget`), **Tick** (`/tasks`) and the game **Ironveil** (`/ironveil`). It is a single Fastify process (CommonJS) that serves the account API and Trove's single-page app, the pages around them (sign-in, launcher, Admin console, AI connectors), and the other apps as Fastify plugins. Accounts live in one SQLite database; every app keeps its own data in its own folder of the data folder. The app ids and paths never change (data folders, backups and links depend on them); their names live in `src/core/app-list.js`.

```
                         ┌─ /login / /admin /connect  hub/ (plain JS) ─┐
browser ──HTTP──▶ Fastify ┼─ /box/ + /api/…  apps/trove (Vue 3)          ┼──▶ data/akulavbox.db (accounts, app access, connectors, settings)
                         │                                              │    data/box/trove.db (Trove's tables and storage counter)
                         │                                              │    data/box/users/<owner>/<id>.enc (AES-256-CTR)
                         ├─ /docs/…   apps/documents (Vue 3)            ├──▶ data/documents/<account>/{personal,work}/
                         ├─ /manga/…  apps/manga (server-rendered)      ├──▶ data/manga/ (koma-shelf.sqlite, works/)
                         ├─ /budget/… apps/budget (Vue 3)              ├──▶ data/budget/florin.db
                         ├─ /tasks/…  apps/tasks (Vue 3)               ├──▶ data/tasks/tasks.db
AI app ──MCP/OAuth──▶     └─ /mcp, /oauth/…  src/modules/connector.js  ─┘   (calls the apps above as the account)
```

## One account for every app

- **Accounts** are AkulavBox's `users` table. The other apps keep a row per account that has used them (`users.box_id` in Koma Shelf and Florin, a folder per account id in e-Management), created on first visit, so their own tables keep their ids. Roles always come from AkulavBox.
- **Sign-in** is `POST /api/login` on the shared page `/login` (`hub/login.js`). It returns the JWT, which the page stores (`akulavToken`, as AkulavBox always did), and sets the same JWT in the HttpOnly cookie `akb_session` (`src/core/session.js`, `SameSite=Lax`, `Secure` on HTTPS, lifetime = the token's).
- **AkulavBox's API reads only the `Authorization` header** (it has no CSRF tokens). The other apps read only the cookie, each with its own CSRF defence: e-Management checks the origin of every change, Koma Shelf checks the origin and a per-account form token (`session.csrfOf`, an HMAC of the account id and `token_version`), Florin requires an `X-Requested-With: florin` header.
- The cookie is checked like the header (`auth.authenticate`): signature, the account still exists, `token_version`. "Sign out everywhere", a password change and deleting the account end it in every app. Tokens older than a day are renewed in the cookie too.
- The launcher and AkulavBox's page call `POST /api/session` with the header token on load, which (re)sets the cookie: sessions from before 4.0 carry over, and a cookie that expired comes back. `POST /api/session/resume` (same origin only) does the opposite for a page that lost its stored token. Signing out (`POST /api/logout`, same origin only) clears the cookie; `/login?out=1` also forgets the stored token, for apps that can't reach it.
- **Access** (`src/core/apps.js`, table `user_apps`): Trove is always on; the others can be turned off per account. No row means the defaults (`settings` key `apps.defaults`, set in the Admin console, kept in memory until changed).
- **One storage space per account** (`apps.space()`, `apps.room()`): `users.quota_bytes` is its size, and what Trove (its `usage` table in `trove.db`), e-Management and Koma Shelf (their `usage` hooks) store all counts towards it. Every place that stores files asks `apps.room(user, app)`: Trove's uploads, link downloads and edits (`storage.storeFile`/`replaceFile`, `files.js`), e-Management's uploads, Koma Shelf's. An app may also have a limit of its own inside the space (`user_apps.quota_bytes` or the default; none unless the admin sets one, or `DOCUMENTS_QUOTA_MB` / `MANGA_QUOTA_MB` are in `.env`). The other apps' usage is cached for a minute (Trove asks on every upload chunk); an app announces `storage.changed` on the bus (`src/core/bus.js`) when it stores or removes files, and the asking app's own usage is always read fresh.
- **Each app registers hooks** (`apps.register(id, { usage, summary, totals, deleteUser, connector })`) that the launcher, the Admin console and delete-user use. An app that can't start (`apps.failed`) answers with a short page saying why; Koma Shelf without `sharp` still registers its data hooks (`apps/manga/src/data.js`), so usage shows and delete-user still removes its data.

## One look for every app

- **The same neutrals and fonts.** The ink/paper colours, Geist for text and Bricolage Grotesque for headings come from AkulavBox (`apps/trove/public/index.html`, `hub/hub.css`); AkulavBox's own pages (sign-in, launcher, console, connectors) use its mark, an ink tile with a box in the apps' colours, and the same colours in its word; each app keeps its own accent and mark: Trove brass, e-Management blue (teal in the work space), Koma Shelf pink (and its Dela Gothic headlines), Florin green, Tick violet.
- **One theme.** `localStorage` `akulavTheme` (`light`, `dark` or `system`) is read before the page paints by `hub/theme.js` (AkulavBox's `index.html` has the same few lines inline), which sets `<html data-theme>` and the `dark` class Tailwind's `dark:` variant uses. Changing it in any app changes it in all of them (also in other open tabs).
- **One account menu.** `<akb-account>` (`hub/account.js`, a custom element with its own shadow DOM and `hub/account.css`) is in the launcher, the Admin console, e-Management, Koma Shelf, Florin and Tick: at the top an app switcher (the account's apps from `GET /api/session/me`, the current one marked; Trove's own menu has the same), the account's profile picture, the app's own links (its children), then All apps, Profile & password, AI connectors, Admin console and Sign out, plus the theme button. It asks `GET /api/session/me` (the cookie) and shows the picture from `/api/session/avatar`. It speaks Romanian on a `lang="ro"` page. Trove has its own menu in `app.js`, with the same picture and links.

## The apps (`apps/`)

Each app is a Fastify plugin registered by `apps/index.js` under its prefix, with its own security headers, error and not-found handlers.

- **Trove** (`apps/trove`, the core: every account has it): `index.js` registers it like the other apps (hooks: usage, summary, totals, delete-user, connector) and its routes (`routes/`: files, media, zip, trash, albums, music, library, collections, downloads, at `/api/…`); `lib/` holds storage and encryption, thumbnails, the trash, the library folders and link downloads; `public/` is its page, served at the site's root paths with `index.html` at `/box/`.
  - **Its database is `box/trove.db`** (`db.js`), ATTACHed to the server's connection as the schema `trove` before migrations run, so queries name its tables without a schema and one transaction covers both files. Its storage counter is the table `usage` (until 5.1, `users.used_bytes`).
  - **Moving the tables there** (`moveIn`, on start) is safe to interrupt: while `akulavbox.db` still has them they are the real copy; they are copied into `trove.db` in one transaction (after a `VACUUM INTO` snapshot in `backups/`), and dropped from `akulavbox.db` in a second one. Foreign keys to `users` are left out of the copies (SQLite can't point into another file); the ones between Trove's tables stay.
  - **Full backups keep their format**: the export puts Trove's tables back into the `akulavbox.db` snapshot (`mergeForBackup`), so old and new backups restore the same way; the restore sets the live `trove.db` aside and the tables move out again on the next start.
- **e-Management** (`apps/documents`, `/docs`, in Romanian): `index.js` (auth, headers, the page) and `src/routes/` (categories, documents, backup and the activity log). Two SQLite databases per account (`src/db.js`, opened on first use and kept open). Files are stored as random names next to them, PDFs and images open inline, everything else downloads. Uploads are checked against the account's quota as they arrive. The page is Vue 3 served from `node_modules` (`/hub/vendor/vue.js`), split into `public/js/`.
- **Koma Shelf** (`apps/manga`, `/manga`): server-rendered pages (`src/views/`, an escaping `html```  template), routes in `src/routes/` (shelf, library, account, api, admin), uploads to disk (`src/uploads.js`) and a background queue that re-encodes strips to WebP slices with sharp (`src/ingest.js`). Views use root paths; `withBase` (`src/html.js`) adds `/manga` to every link on the way out, and `"~/…"` links to the server around it. `works.bytes` (measured after processing) counts towards the quota. API tokens (`ks_…`) for Koma are its own; they stop working when the account is deleted or loses access.
- **Tick** (`apps/tasks`, `/tasks`): to-dos with lists, tags, checklists, due dates and repeats (`server/repeat.js`), shown as a list, a board or a calendar. `index.js` and `server/` (one database, `tasks.db`, whose rows carry the account id directly: no account table of its own). The page is Vue 3 like Florin's. Florin and Tick share their server scaffolding (`src/core/vue-app.js`: the CSP with the import map's hash, the `/api` scope with the CSRF header check and JSON errors, the page and its deep links) and their browser building blocks (`hub/vue/`: dialogs and toasts, icons, the router, base styles).
- **Ironveil** (`apps/ironveil`, `/ironveil`): Akulav's game (github.com/Akulav/strategy-game, Rust and macroquad) in its WebAssembly build. `public/game/` is the game's own web build (`gl.js`, `audio.js`, `storage.js`, `ironveil.wasm`), copied by `npm run ironveil` (`scripts/ironveil.js`, which runs `cargo build --target wasm32-unknown-unknown` in `../strategy-game` or `IRONVEIL_SRC`). The game saves through a small bridge (its `src/storage.rs` and `web/storage.js`): files on the desktop, `localStorage` when its web build runs alone, and here `public/play.js`, which loads the account's saves before the game starts, answers the game's reads from memory and writes changes back to `/ironveil/api/saves` in the background (a save that can't reach the server waits in the browser and goes out on the next visit). Saves are files, `DATA_DIR/ironveil/<account id>/<key>.json` (`saves.js`), so they count in the account's storage and full backups take the folder as it is. The `.wasm` is gzipped once in memory and served with an ETag; the CSP allows `'wasm-unsafe-eval'` and nothing else beyond this server's own scripts.
- **Florin** (`apps/budget`, `/budget`): `index.js` and `server/routes/`. The page (`public/`) is Vue 3 with string templates and a small history router (`public/js/router.js`); `index.html` is sent for every page path after the sign-in check, so links and reloads work. Tailwind v4's classes are compiled once by the server into a versioned stylesheet (`src/core/tailwind.js`, run from `assets.js`), so the page never waits for a script to style it. Vue and Tailwind are served from `node_modules` at `/hub/vendor/` (gzipped once at start, with an ETag), with no build step; Trove and e-Management load the same Vue file. The charts are SVG components in `public/js/charts.js`.

## How the apps talk to each other

- **On the server: the bus** (`src/core/bus.js`). `bus.emit(event, data)` calls every listener of `bus.on(event, fn)` at once, in the process; a listener that throws is logged and never stops the others or the app that emitted. Events: `storage.changed` `{ userId, app }` (an app stored or removed files; `apps.js` reads its usage again), `account.deleted` `{ userId }` (after every app removed the account's data; the AI connector drops its tokens), `access.changed` `{ userId, app, enabled }`. Apps register what the others may ask of them with `apps.register(id, { usage, summary, totals, deleteUser, connector })`, and the AI connector calls their routes in the process (`ctx.call`).
- **In the browser: one BroadcastChannel**, `akulavbox`, shared by every open page of every app (`window.akbBus` from `hub/account.js`; Trove's `bus` in `lib/api.js`). `signed-out`: every other page goes to the sign-in page. `storage`: the launcher's storage card and Trove's meter read it again (Trove sends it when its storage changed, e-Management after saving or deleting a document). `account`: the account menus repaint (a new profile picture). No polling, no connection kept open.

## Page assets (`src/core/assets.js`)

- Every app's scripts and styles are served at `<prefix>~<revision>/<path>` (`/hub/~r/`, `/docs/~r/`, `/budget/~r/`, `/tasks/~r/`, Trove's under `/box/~r/`, Vue and Tailwind at `/hub/vendor/~r/`), cached for a year (`immutable`) and gzipped once in memory. One revision for the whole server: a hash of every asset file, re-checked (sizes and dates) at most every 2 seconds when a page is sent.
- Pages are sent with their asset URLs rewritten to the revision (attributes and the import map), and so are the absolute imports inside the scripts; relative imports stay under the same revision. So a reload asks the server for data only, and a browser never mixes an old cached module with a new page. A URL with an older revision gets the current file, uncached. Florin's and Tick's CSP hash follows the rewritten import map.
- Unversioned URLs still work (revalidated on every use).

## The AI connector (`src/core/connector/`, `src/modules/connector.js`)

- **What it is.** An MCP server at `/mcp` (Streamable HTTP, stateless: every message gets its answer on its own POST, no SSE and no sessions), the same tools over plain HTTP at `/api/connector/tools`, and OAuth 2.1 so an AI app such as Claude connects with only the address. People manage it at `/connect`.
- **Tokens** (`tokens.js`, table `connector_tokens`): `akb_` + 32 random bytes; only the SHA-256 is stored, with the scopes as JSON (`{ box: 'read' | 'write', documents, manga, budget, tasks }`). Made by hand (`kind 'token'`, an expiry or none) or by OAuth (`kind 'oauth'`: access tokens last a day, refresh tokens `akbr_…` 90 days and are replaced on every use). `last_used_at` is written at most once a minute. They survive a password change (like other API tokens) and go with delete-user; expired ones are swept hourly.
- **Tools** (`tools.js`): `{ name, app, write, destructive, input, run(ctx, args) }`. Trove's are in `tools.js`; every other app registers its own as `apps.register(id, { …, connector: { tools } })` in `apps/<app>/connector.js` (Koma Shelf's in `src/connector.js`, from its data hooks). A token sees a tool when it has the app's scope (`write` for tools that change things) and the app is on for the account; `tools/list` and every call check it again.
- **Calls go through the apps' own routes.** `ctx.call(app, method, url, …)` runs `fastify.inject` as the account, with a two-minute JWT (`auth.signShort`) in both the `Authorization` header (Trove's API) and the `akb_session` cookie (the apps), a same-origin `Origin`, and the Vue apps' CSRF header. So ownership, validation, quotas and "is the app on" stay where they are, and the tools can't do anything the account couldn't. Koma Shelf's pages are server-rendered forms, so its tools read and update its database directly with the same rules.
- **OAuth**: discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`; clients register themselves (`/oauth/register`, `oauth_clients`; unused ones go after 30 days); `/oauth/authorize` is a page (`hub/authorize.html`) where the signed-in person picks the scopes, and `POST /api/oauth/approve` (the session token, so no CSRF) stores a one-time code (`oauth_codes`, hashed, 10 minutes) bound to the client, the redirect address and the PKCE challenge. `/oauth/token` checks all three and issues the token pair.
- The connector's endpoints answer any origin (CORS `*`): they take bearer tokens only, never the cookie. Each token is limited to 240 calls a minute.
## Startup order

1. `src/core/config.js` loads `.env`, resolves the data folder (`STORAGE_DIR` / `DATA_DIR`, else `data/` in the app folder, else an older `storage/` that already holds a database), and has `src/core/layout.js` move AkulavBox's folders of a data folder from before 4.0 (`users/`, `thumbs/`, `private/`) into `box/` (a rename; a folder that can't be moved, or a second server on the same folder, keeps the old place and logs why; command-line tools never move anything), then creates its sub-folders. The other apps' folders are `config.appDataDir(id)`. Paths below say `data/`.
2. `src/server.js` validates the config and exits with a readable message if `MASTER_KEY` or `JWT_SECRET` is wrong.
3. `src/core/db.js` opens SQLite and runs **`src/core/migrations.js`**. Pending steps run in order inside transactions, and an existing database is first snapshotted with `VACUUM INTO` to `data/backups/`. Then the pragmas are set (WAL, `synchronous=NORMAL`, busy timeout) and the default admin is created on an empty database.
4. `apps/trove/lib/library.js` adopts locked library folders created by older versions (idempotent).
5. Route modules register under `src/modules/` (AkulavBox: `files`, `media`, `zip`, `user`, `trash`, `albums`, `music`, `library`, `collections`, `downloads`; the server: `auth`, `hub`, `admin`, `console`, `connector`, `backups`, `updates`), then the apps (`apps/index.js`).

## Schema versioning

The schema version is `PRAGMA user_version`. Each entry in `MIGRATIONS` (`src/core/migrations.js`) is one version, run in its own transaction by `runSteps` (`src/core/sqlite.js`), after a `VACUUM INTO` snapshot of an existing database. Steps must be **idempotent** (`CREATE … IF NOT EXISTS`, `addColumn` only adds missing columns), because 1.x databases already contain most tables at version 0. Append new steps at the end and never edit a released one.

| # | What |
| --- | --- |
| 1 | Baseline: every table and column 1.x ever created |
| 2 | Indexes for hot lookups |
| 3 | `users.token_version`, `created_at`, `last_login_at` |
| 4 | Trash columns `trashed_at`, `trash_root` on files and folders |
| 5 | `album_images.added_at`, `playlist_songs.position` |
| 6 | `chat_reads` (persistent unread counts) |
| 7 | `media_collections`, `media_collection_items`, `downloads`, `media_meta.source_url` / `source_id` |
| 8 | `users.show_xxx` (opt-in XXX section) |
| 9 | `settings`, `activity` |
| 10 | Drops `messages`, `friends`, `chat_reads` (chat removed in 3.0) and gives chat-file quota back |
| 11 | `downloads(status)` index |
| 12 | `media_meta.video_codec` |
| 13 | `user_apps` (per-account access and quota for the other apps) |
| 14 | `connector_tokens`, `oauth_clients`, `oauth_codes` (the AI connector) |

The apps have their own databases and steps, run the same way: Koma Shelf and Florin list them in their `db.js` and call `runSteps` (Florin's step 3 adds `users.monthly_budget` and drops the unused `sessions` table); e-Management adds missing columns with `addColumn`. All three share `tx`, `addColumn` and `runSteps` from `src/core/sqlite.js`.

## Authentication

- JWTs carry `{ id, username, role, tv }`. `tv` must equal `users.token_version`. Bumping it (password change, admin reset, "sign out everywhere") revokes every older token.
- `verifyUser` / `verifyAdmin` (`src/core/auth.js`) verify the signature **and** load the user, so deleted users and changed roles take effect immediately.
- Tokens older than a day get a fresh one in the `X-Refresh-Token` response header (sliding sessions). `apps/trove/public/lib/api.js` stores it.
- Media URLs (`<img>`, `<video>`) pass the token as `?token=`. It is redacted from logs, and `Referrer-Policy: same-origin` keeps it from leaking. Every user file served from the origin (except PDFs) gets a `sandbox` CSP (`mime.fileCsp`), so no uploaded file can run script next to the token.
- Tokens are HS256 only. CORS is off unless `CORS_ORIGIN` lists origins. New passwords need `PASSWORD_MIN` (8) characters.
- Login: rate limited per IP and per username (10 failures / 15 min), a dummy bcrypt comparison runs for unknown usernames, and usernames are matched case-insensitively.
- `src/core/hash.js` prefers native `bcrypt` and falls back to `bcryptjs`. The hash formats are identical.

## Files and encryption (`apps/trove/lib/storage.js`)

- Encrypted files: `data/box/users/<owner>/<fileId>.enc`, AES-256-CTR with the per-file IV in `files.iv_hex` and the key `MASTER_KEY`.
- Shared files are stored decrypted as `.plain` while they have a `public_hash`, so `/shared/<hash>` can stream them. Un-sharing re-encrypts them with a fresh IV.
- `ctrAt(iv, offset)` positions the CTR keystream at any byte. It is used for range requests (video seeking) and for encrypting upload chunks in place.
- **Uploads:** the client sends 16 MB chunks with `upload_id`, `offset`, `total_size`, and `chunk_index` / `total_chunks`. Each chunk is encrypted and written at its offset in `data/temp/<user>-<upload>.part`, and the IV is kept in a `.json` sidecar. The last chunk checks the size and quota, then renames the file into place. Quota and free disk space (`DISK_RESERVE_MB`) are checked on every chunk.
- Thumbnails (`apps/trove/lib/thumbs.js`): made by `sharp` in three widths and cached encrypted under `data/box/thumbs/`. Without `sharp`, the browser renders them and uploads them (`PUT /api/files/:id/thumb`).

## Trash (`apps/trove/lib/trash.js`)

- Deleting sets `trashed_at`. Trashing a folder marks its whole subtree, with `trash_root = <folder id>` on everything inside, so the tree restores and purges as a unit.
- Every listing query filters `trashed_at IS NULL`. **Remember this when adding a query over `files` or `folders`.**
- `purgeFile()` is the only permanent delete. It removes the file from disk and cleans every reference (albums, playlists, covers, media metadata, thumbnails, quota).
- Items older than `TRASH_DAYS` are purged hourly.

## Locked library folders

Photos, Music (+ Artwork), Videos (+ Covers), and Books (+ Covers) are system folders (`folders.system_key`), defined in `apps/trove/lib/library.js`. They can't be renamed, moved, deleted, or given sub-folders, and they only accept their media type. The Photos, Music, Videos, and Books pages are views over them, with per-file details in `media_meta`.

The cover and artwork sub-folders (`library.HIDDEN`) are hidden from Files listings, search and the Move picker. Their sizes still count towards the parent folder.

**XXX** (+ Covers) is an opt-in video section (`optIn` in `SYSTEM`, `users.show_xxx`, toggled with `PATCH /api/user/settings`). While it is off, `library.hiddenKeys(userId)` adds both folders to the hidden set, the folder can't be opened, and its library, folder id and `kind: 'xxx'` downloads answer 403. It is never adopted by name (`noAdopt`), so a user's own "XXX" folder stays theirs. Download and trim jobs of kind `xxx` are videos stored in it (`downloader.KINDS`); "save as song" isn't offered there.

## Collections and link downloads

- `media_collections` and `media_collection_items` group library items, the way `playlists` and `playlist_songs` group songs (`apps/trove/lib/collections.js`, `apps/trove/routes/collections.js`). Only videos use them in the UI today, but `kind` allows books.
- `apps/trove/lib/tools.js` installs **yt-dlp** and a static **ffmpeg** into `data/tools/` on first start. It picks the right build for Windows or Linux on x64 or ARM, downloads it from the official GitHub releases, checks the published SHA-256, and unpacks it with `tar`. yt-dlp runs `-U` once a day. Explicit `YTDLP_PATH` / `FFMPEG_PATH` and copies on PATH win.
- `apps/trove/lib/downloader.js` keeps jobs in the `downloads` table (they resume after a restart) and runs `DOWNLOAD_PARALLEL` at once:
  1. `yt-dlp -J --flat-playlist`: a playlist becomes one job per entry, except entries whose `<ie_key>:<id>` is already a `media_meta.source_id` in the target folder, or whose URL is already queued. A single link with a matching `source_id` is linked instead of downloaded.
  - Slots: `DOWNLOAD_PARALLEL` jobs hold a slot. A job waiting for the one-at-a-time AV1 encoder (`encode_wait`) gives its slot back (up to `ENCODE_BACKLOG` such jobs). yt-dlp runs with `--socket-timeout 30` and a watchdog that kills it after `DOWNLOAD_STALL_SECONDS` without output; network failures are retried twice inside the job.
  2. Download to `data/temp/dl-<job>/`. With ffmpeg, an AV1 stream ≤ 1080p is preferred.
  3. If the video isn't AV1 and ffmpeg has an AV1 encoder (`libsvtav1`), it is re-encoded one at a time (`converting`). The result is kept only if smaller.
  4. `storeFile()` encrypts the media (and its thumbnail as a cover) into the Videos/Music folders. `media_meta` gets the title, creator, date, length, description and source.
  5. Filing: none. Collections and playlists are the user's own; Videos → Creators and Music → Artists group downloads by `participants`.
- Links must be public http(s). Private, loopback, link-local, shared (100.64/10) and multicast addresses are refused, literal or after a DNS lookup (`checkLink`), as are `localhost`, `.local`, `.internal` and `.lan` names. Redirects the site makes later aren't checked; `DOWNLOAD_PROXY` isolates yt-dlp completely. yt-dlp is spawned with an argument array and `--` before the URL.
- The duplicate check (`media_meta.source_id`) only looks in the folder being saved to, so a link can be kept both as a video and as a song.
- **Sign-in cookies** (`apps/trove/lib/cookies.js`): per user in `data/box/private/cookies/<id>.enc` (16-byte IV, then AES-256-CTR with `MASTER_KEY`). A plain copy is written into the job's work folder only while yt-dlp runs and is removed with it. Errors that ask for sign-in get a hint pointing to Profile → Link downloads.
- **Video → song** jobs have the url `akulavbox:video/<fileId>` and go through the same queue: decrypt to the work folder, ffprobe the audio codec, copy it when browsers play it (AAC → m4a, MP3, Opus, FLAC, Vorbis) or encode to AAC, store it in Music with the video's details, copy the cover (or grab a frame) into Artwork, and file it in the creator's playlist. Without yt-dlp, only conversions run.
- yt-dlp gets `--js-runtimes node:<this Node>` when it supports it (YouTube needs a JS runtime for its full format list), and a download that hits "Requested format is not available" is retried with `bv*+ba/b`, then with yt-dlp's default choice.
- Video width and height live in `media_meta.width/height`: ffprobed for downloads and trims, read by the browser (`readVideoSize`, header only) for uploads.
- The video codec lives in `media_meta.video_codec` (shown as the format badge on video cards). Downloads, trims and AV1 conversions record it with ffprobe. Other videos in Videos/XXX (uploads, moves, older libraries) are probed in the background (`probeMissing`, a few seconds after an upload and every 30 minutes): the decrypted stream is piped into ffprobe, so no plain copy touches the disk. Unreadable files get `''` and aren't retried.
- **Convert to AV1** jobs (`akulavbox:av1/<fileId>`, kind `video` or `xxx`) decrypt the video, wait for the one-at-a-time encoder like downloads do (`toAv1`), and swap the result in with `storage.replaceFile()` (same id, details, cover, collections; the name becomes `.mp4`) only when it is smaller. They need an AV1 encoder (`status.encode_av1`), even when `VIDEO_AV1=off`.
- **Trim** jobs (`akulavbox:trim/<fileId>?s=&e=&exact=&copy=`, videos and songs; songs re-encode to AAC for an exact cut) decrypt the media, cut it with ffmpeg (`-ss` before `-i` with stream copy for a fast keyframe cut, or a re-encode to AV1/H.264 for an exact one), and either store a copy (same details and collections) or swap the contents in place with `storage.replaceFile()`, which keeps the file id, writes a fresh IV and adjusts `used_bytes`.

## Storage check (`apps/trove/lib/maintenance.js`)

Compares `data/box/users/` with `files` (AkulavBox only). Files written in the last hour are skipped (an upload may be finishing).
- **Orphans** (no row): unreadable `.enc` files are deleted; readable `.plain` files of an existing owner are adopted into a "Recovered files" folder with a type sniffed from their first bytes. Folders of deleted accounts go too.
- **Missing** (row, no data): if the other variant (`.enc`/`.plain`) exists the row is pointed at it, otherwise it is removed through `purgeFile()`.
- **Usage**: `users.used_bytes` is reset to the sum of the user's file rows (trash included).

## Full backups (`src/core/backup.js`)

- `.akbx` = `"AKBX" 0x01`, a plain JSON header (scrypt salt and cost, AES IV, a passphrase check value), the AES-256-CTR encrypted body, and an HMAC-SHA256 over header and ciphertext. Keys come from `scrypt(passphrase)`.
- Body: entries of `type | name | gzip flag | u64 length | bytes`: `manifest.json` (counts, schema, version, the `MASTER_KEY`, and `apps`: the apps whose folders it carries), `akulavbox.db` (a `VACUUM INTO` snapshot, gzip level 9), every app database as `apps/<app>/<path>` (snapshots, gzipped), then every `users/<id>/<file>` as stored (already encrypted, so not compressed), saved cookies, and every other file of the apps' folders as `apps/<app>/<path>`. Thumbnails, tools, temp files, `tmp/` and interrupted imports are left out. Entry names in the backup stay `users/…` and `private/…`, wherever those folders are on disk.
- Code: `backup-format.js` (the format and what goes in), `backup.js` (export, and the entry point), `restore.js` (staging and the swap).
- Import stages into `data/import-staging/`, refuses backups with a newer schema, re-keys `.enc` files when the backup's key differs (same IV, old keystream off, new keystream on), and verifies the HMAC before writing `ready.json`. Nothing live changes until the next start: `applyPending()` runs in `db.js` before the database opens, moves the current database, `users/`, cookies and the folder of every app the backup carries to `data/backups/pre-import-<time>/`, moves the staged data in, and clears the thumbnail cache. Migrations then bring an older backup up to date.
- The swap is journaled in `import-staging/swap.json`. Renames that fail with `EBUSY`/`EPERM`/`EACCES` (Windows: a file held open) are retried for 30 s, `EXDEV` falls back to copy and delete; a step that still fails puts everything back and writes `failed.json`, which the Admin page shows. A crash mid-swap resumes from the journal; if putting things back also fails, the server refuses to start rather than open an empty database. `data/akulavbox.pid` (`core/instance.js`) stops a second server on the same folder from swapping, and `scripts/backup.js` never swaps (`AKB_NO_RESTORE=1`).
- **Scheduled backups** (`core/schedule.js`): the settings live in the `settings` table under `backup.schedule` (`core/settings.js`; secrets in it are sealed with AES-256-GCM under a key derived from `MASTER_KEY`, so after a restore onto another key they read as missing). A one-minute timer runs `exportStream` into `<dir>/akulavbox-auto-<local time>.akbx` (written as `.part`, then renamed) when the next slot after the later of the last run and the last schedule change has passed, so a missed slot runs once at start. The newest `keep` files matching that name are kept; nothing else in the folder is touched. `BACKUP_PASSPHRASE` overrides the stored passphrase.

## Activity log (`src/core/activity.js`)

- `activity.log(request, action, { target, detail, user })` adds a row to `activity` (who from `request.user`, IP from `request.ip`; `user` for actions with no session, like a failed sign-in). It never throws. Rows go after `ACTIVITY_DAYS` (default 180) and beyond 50,000.
- Actions: `auth.*` (sign-in, failed, locked), `account.*`, `admin.user_*`, `share.*`, `backup.*`, `admin.update_*`, `admin.storage_cleaned`, `admin.server_restart`. The Admin filter groups them by prefix. Delete-user removes the account's own rows (`forgetUser`); the admin's "deleted account" row stays.
- A restore applied (or refused) at startup is logged once the server listens, since the swap runs before the database opens.

## Updates from GitHub (`src/core/updater.js`)

- The newest version is `package.json` on `UPDATE_BRANCH` (default `main`) of the repository named in `package.json` → `repository` (or `UPDATE_REPO`, or the git remote). No releases or tags are needed. Checked every 6 hours; notes are the `CHANGELOG.md` sections newer than the running version.
- **git mode** (the app folder is a clone and git runs): refuse if tracked files are modified, `git fetch origin <branch>`, `git merge --ff-only <sha>`. Rollback is `git reset --hard <previous sha>`.
- **archive mode**: download `/tarball/<sha>`, unpack with `tar`, check its version, copy the current code (everything but `data/`, `data/`, the data folder if it sits in the app folder, `node_modules/`, `.git/`, `.env*`, `logs/`) to `data/updates/backup-<version>-<time>/`, copy the new code over, and delete files under `src/ apps/trove/public/ scripts/ docs/ apps/ hub/` that the new version no longer has. Rollback copies the backup back.
- `npm install --omit=dev` runs when `dependencies`/`optionalDependencies` changed; if it fails the old code is put back. The previous version is recorded in `data/updates/state.json`. The running process keeps the old code until it restarts.

## The launcher, sign-in and the Admin console (`hub/`, `src/modules/hub.js`, `src/modules/console.js`)

- Plain HTML and ES modules with no framework and no build step, styled with the same tokens as AkulavBox (`hub/hub.css`); `hub/common.js` holds the session, `api()`, toasts, dialogs and icons. AkulavBox's own icons and install manifest are in `hub/brand/` and served at the site's root (`/favicon.ico`, `/apple-touch-icon.png`, …).
- **Versioned files** for every app's page: see "Page assets". The launcher also shows a Reload button when its script fails or the server doesn't answer within 15 seconds.
- **Site icon check** (Admin console, `GET /api/admin/site-icon`, `src/core/site-icon.js`): fetches the server's public address the way Bitwarden's icon service does (IPv4 record, the HTTPS certificate chain, at most 2 redirects of the kinds it follows, the `<head>` icons ranked like it, PNG/ICO/JPEG only) and reports each step; `?bitwarden=1` also asks Bitwarden's icon service what it answers now.
- `/` (`index.html`, `home.js`): the apps of the signed-in account (`GET /api/apps`) with what each stores, and the account's storage split by app. Links from before 4.0 (`/#/files/…`) are forwarded to `/box/`.
- `/login` (`login.html`, `login.js`): signs in, then goes to `?next=` (a path on this server only). It lists the apps from `GET /api/apps/catalog` (the one list in `app-list.js`).
- `/connect` (`connect.html`, `connect.js`): the account's AI connectors. `/oauth/authorize` (`authorize.html`, `authorize.js`): an AI app asks to connect.
- `/admin` (`admin.html`, `console.js`): accounts with their apps (`GET /api/admin/console`), per-app switches and quotas, defaults, and the account actions of `admin.js`. AkulavBox's own Admin page keeps the server tasks (disk, updates, storage check, backups, activity) and links here for accounts.

## Frontend (`apps/trove/public/`)

- Trove's page. No build step: `index.html` defines an import map (Vue from `/hub/vendor/vue.js`, the server's copy), the Tailwind theme (a `<style type="text/tailwindcss">` the server compiles into a versioned stylesheet, `src/core/tailwind.js`), the design tokens (CSS variables per theme), and `modulepreload` hints for every module.
- Served at `/box/` (its files stay at the root paths, so `index.html` is unchanged). Signing in and out goes through `/login`.
- `app.js` holds the shell: hash routing (`#/files/<folder>`, `#/albums/<col>/<album>`, …), the top navigation bar (bottom bar on phones), account menu, banners, and shortcuts.
- Admin is `pages/AdminPanel.js` plus `components/BackupPanel.js` (export, schedule, restore) and `components/ActivityLog.js`.
- `lib/` holds shared state and services: `api.js` (fetch wrapper, session, version check, `restartServer`, `sleep`, `waitOnline`), `upload.js` (parallel chunked uploads, cancel and retry, folder drops), `trash.js` (move to trash + Undo), `player.js` (one global `<audio>`), `library.js` (thumbnails, covers, filters), `lists.js` (long lists), `ui.js` (toasts and dialogs).
- **Long lists** (`lib/lists.js`): `useRenderLimit` renders a chunk of a list and adds the next one when a marker after it nears the viewport; the rendered list is always a prefix, so indexes match the full list. `useSelection` keeps selected ids in an array with a Set for lookups. Use both for any list that can reach thousands of items.
- JSON answers over 4 KB are gzip-compressed in `server.js` when the browser accepts it.
- `pages/` has one component per section. `components/` holds the shared UI: Shell (toasts, upload tray, player), FileViewer, Library (thumbnails, editors), Brand, and Icon.
- Motion lives in CSS (`.stagger`, `.rise`, `.lift`, `.page-*` transitions, `.app-bg`). It is turned off by `prefers-reduced-motion` or `html[data-motion="off"]` (the Profile setting).
