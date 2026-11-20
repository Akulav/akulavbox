# Changelog

All notable changes to AkulavBox. Versions follow [semantic versioning](https://semver.org/). The version lives in `package.json` and is shown in the account menu and page footer, on the sign-in page, in Admin, and at `GET /api/health`.

## 5.1.0 (2026-11-20)

### Added
- **Switch apps from any app.** The account menu of every app now starts with your apps (Trove, e-Management, Koma Shelf, Florin, Tick), the current one marked, so you can jump straight from one to another without going back to the launcher.

### Changed
- **Trove is an app like the others** (`apps/trove`, with its page, its API and its library code), and **its data has a database of its own**, `box/trove.db`, next to its files. On the first start its tables (files, folders, albums, playlists, media details, link downloads) and its storage counter move there from `akulavbox.db`, after a snapshot of the database in `backups/`. The move is safe to interrupt: it runs again on the next start.
- AkulavBox's own icons and install manifest live in `hub/brand/`; they're still served at the site's root.
- The launcher, sign-in, Admin console and AI connector pages load their scripts and styles from versioned addresses, cached for a year and replaced the moment they change: fewer requests on every visit.

### Fixed
- **On iPhone the launcher could stay on “Loading your apps…”** after an update: Safari kept an older copy of a script the new page needed. The versioned addresses above make that impossible, and if the launcher still can't start (an error, or no answer for 15 seconds) it now says so and offers Reload and Sign in again.
- “e-Management” no longer breaks in two in the app menus, and the account menu shows your role and “AkulavBox account” on separate lines.

### Upgrading
- Nothing to do. Trove's tables move into `box/trove.db` on the first start (a few seconds for a large library). Full backups keep their format: backups from any version restore, and backups made now restore on 5.0 too.

## 5.0.0 (2026-11-20)

AkulavBox becomes the account and the server around its apps, the way a Google account holds its apps, and each app gets a name of its own: the files app is now **Trove**, and there is a new app, **Tick**.

### Added
- **Tick** at `/tasks/`: to-dos with lists, tags, checklists, priorities, due dates and times, and repeats (every few days, on chosen weekdays, monthly, yearly). A quick-add line understands “call mum tomorrow at 5pm #family !high every week”. Shown as a list, a board or a calendar, with Today, Upcoming and Done views. It's on for every account by default and is covered by full backups and delete-user.
- **AI connectors** at `/connect` (also in every app's account menu and on the launcher). Let Claude, or any other AI app, read your apps and, if you allow it app by app, change things in them: browse, search, read and write text files in Trove; find, add and change documents in e-Management; list and edit your webtoons in Koma Shelf; look up, add and change transactions and see your month in Florin; list, add, change and tick off tasks in Tick (35 tools in all).
  - **Claude on the web, desktop and phone:** add a custom connector with the address `https://<your server>/mcp`. Claude signs in here and you choose what it may do; no token to copy (OAuth 2.1 with PKCE). The server must be reachable over HTTPS (set `PUBLIC_URL`).
  - **Claude Code and other MCP clients:** make a token at `/connect` and add the server with it (the page shows the command). Scripts can call the same tools over plain HTTP (`/api/connector/tools`).
  - Every connector is listed with what it may do and when it was last used; change or revoke it at any time. Tokens can expire after 30 days, 90 days or a year. Making, changing, revoking and connecting apps go to the activity log.
- **One storage space per account.** What Trove, e-Management and Koma Shelf store all counts towards the account's storage, like a Google account's. The launcher shows it split by app, and so do Trove's profile, e-Management's settings and Koma Shelf's account page. Admins set one size per account; an app can still get a limit of its own inside it (“Add limit” in the Admin console).

### Changed
- **New names and marks.** The files app is **Trove** (a brass tile with stacked layers, at the same address, `/box/`); AkulavBox has a new mark of its own (an ink tile with a box in the apps' colours) on the sign-in page, the launcher, the Admin console and the account menu. The account menu says “AkulavBox account”.
- The sign-in page reads the list of apps from the server, so it always matches the launcher.
- The Admin console shows each account's storage as one bar split by app, with its size and the apps' optional limits next to it. The “Apps & defaults” limits can be left empty for none.
- Trove loads Vue from the server, like the other apps, instead of a CDN: it works offline and shares one cached copy with them. That copy (and Tailwind's) is gzipped once at start and sent with an ETag, so a reload costs a 304 instead of 430 KB.
- Lighter on the server: what the other apps store is cached for a minute instead of being added up on every Trove upload chunk, and the app defaults are read from the database only when they change.

### Fixed
- **Password managers (Bitwarden) found no icon for the site.** Since 3.1.3 every `.png` and `.ico` at the site's root answered with an error (the static file server's header hook changed in Fastify 5), so only browsers that use the SVG showed one. The icons are served again, every page now also links PNG and ICO icons (32, 192 px and an Apple touch icon), and `/apple-touch-icon-precomposed.png` exists too.
- Tick has PNG and ICO icons (it had only an SVG one), and an install manifest with them.

### Upgrading
- One database step on the first start (the AI connector's tables). Nothing moves on disk and no address changes.
- **Storage is counted per account now, across apps.** e-Management's and Koma Shelf's separate quotas are gone: what an account already stores there now counts towards its storage size. Check the Admin console; raise the size of any account that is over it (it can't add files until then, and nothing is deleted). Limits you set before, per account or in the defaults, stay as limits inside the space. `DOCUMENTS_QUOTA_MB` and `MANGA_QUOTA_MB` now only set such a limit when they are in `.env`.

## 4.1.0 (2026-11-20)

### Added
- **Your profile picture in every app.** e-Management, Koma Shelf, Florin, the launcher and the Admin console show the picture you set in AkulavBox, in one shared account menu: your name and role, the app's own links, then All apps, Profile & password, Admin console (for admins) and Sign out.
- **Florin: an overall monthly budget.** The total on Categories & budgets can now be edited (the pencil). It sets a limit of its own, and the dashboard's "Budget left" follows it. Leave it empty to go back to the sum of the category budgets.

### Changed
- **One look for every app.** All of them use AkulavBox's colours and fonts now, each with its own accent (e-Management blue, Koma Shelf pink, Florin green), and they share one theme: switch to light or dark in any app and the others follow.
- **e-Management is redesigned**: it has a dark theme, and a lighter top bar like the other apps. On phones the menu scrolls on its own row instead of wrapping.
- Under the hood: AkulavBox and the three apps run their database upgrades with one shared runner (`src/core/sqlite.js`), and moving a data folder from before 4.0 into `box/` has its own module (`src/core/layout.js`). Florin's server code lost leftovers from its old sign-in.

### Upgrading
- Nothing to do. Florin's database gets one upgrade step on the first start. A theme picked in Florin or Koma Shelf before is replaced by the shared one, AkulavBox's.

## 4.0.1 (2026-11-20)

### Changed
- **Florin's page is rewritten in Vue 3**, the same way as the rest of AkulavBox: plain ES modules with string templates and no build step. It looks and works as before; the charts are now drawn by Florin itself (SVG) instead of Recharts. Vue and Tailwind's browser build are served by the server, so the page also works without internet.
- React, Vite, Recharts and the other build tools are gone, and so are `npm run build:budget` and the committed `apps/budget/dist/`.

### Fixed
- Florin's dashboard showed its "Add" button on phones too, next to the one in the top bar.
- Florin's tabs ("Exchange rates") and "Over budget" badges no longer wrap onto two lines.

### Upgrading
- Run `npm install` (or use Admin → Updates, which does it): there is a new dependency, `@tailwindcss/browser`.

## 4.0.0 (2026-11-19)

AkulavBox becomes the home of four apps that share one account: AkulavBox, **e-Management** (documents), **Koma Shelf** (webtoons) and **Florin** (budgets).

### Added
- **One sign-in for every app.** A new sign-in page at `/login` and a launcher at `/` that shows the apps your account may use, with what each one stores. Signing in, out, changing a password or "sign out everywhere" applies to all of them.
- **e-Management** at `/docs/`: personal and work documents with categories, tags, attachments, an activity log and per-space backups (in Romanian). Every account has its own two spaces.
- **Koma Shelf** at `/manga/`: a private library, unlisted links and a public shelf for webtoons made with Koma, with a reader for long strips, moderation for admins and API tokens so Koma can publish directly. Needs `sharp`.
- **Florin** at `/budget/`: expenses and income in 30 currencies, budgets per category, a dashboard, charts and CSV export.
- **The Admin console** at `/admin` (admins only): create and delete accounts, reset passwords, change roles, sign people out, turn each app on or off per account, set the storage quota of AkulavBox, e-Management and Koma Shelf per account, see what every account stores in every app, and choose what new accounts get.
- **Full backups include every app.** Restoring a backup made with 4.0 replaces the apps' data too; older backups leave it as it is.
- Settings: `PUBLIC_URL`, `DOCUMENTS_QUOTA_MB`, `MANGA_QUOTA_MB`, `MANGA_MAX_UPLOAD_MB`, `MANGA_SITE_NAME`.
- `npm test`: unit tests for the sign-in cookie, app access and quotas, and the apps' helpers (CI runs them too).

### Changed
- **AkulavBox moved to `/box/`.** `/` is the launcher; old links (`/#/files/…`) are forwarded, and public share links (`/shared/…`) don't change. The installed app opens the launcher.
- **AkulavBox's folders moved into `box/`** of the data folder (`users/`, `thumbs/`, `private/`), on the first start, so every app has its own folder: `box/`, `documents/`, `manga/`, `budget/`. A folder that can't be moved is used where it is, and the log says so.
- AkulavBox's Admin page links to the Admin console for accounts; it keeps the disk, updates, storage check, backups and the activity log.
- The server is one Fastify app in CommonJS; each other app is a plugin under `apps/`. Bigger modules were split up (`files.js` into files, media, zip and user; `admin.js` into admin, backups and updates; `backup.js` into the format, export and restore).

### Upgrading
- Everyone stays signed in, and every existing account can use every app with the default quotas. Turn apps off or change quotas in the Admin console.
- Run `npm install` (or use Admin → Updates, which does it): there are new dependencies (`vue`, `yauzl`, `@fontsource/dela-gothic-one`).

## 3.2.0 (2026-11-12)

### Added
- **Checklists in Markdown notes.** Lines like `- [ ] milk` and `- [x] bread` show as real checkboxes in the preview, without bullets; ticked items fade and are struck through. Click a box to tick or untick it: the note is saved right away, exactly as if you had edited that one line. Nested, numbered and quoted items work, and examples inside code blocks are left alone. Notes you can't edit (read-only shares, files too large to edit) show the boxes without letting you change them.

## 3.1.4 (2026-11-12)

### Fixed
- **On Node 22, deleting files for good failed** (since 3.1.1): emptying the trash, deleting items from it, the automatic clean-up of old trash, and the storage check's clean-up answered with a server error and left everything in place. The database statements behind it used numbered placeholders, which Node 22's SQLite module can't bind (newer Node versions can). Nothing was lost: the files just stayed in the trash.
- `npm run lint` now refuses numbered SQL placeholders, and the test suite passes on Node 22.13, the oldest supported version.

## 3.1.3 (2026-11-11)

### Security
- **Fastify 5** (5.12.8) replaces Fastify 4, which no longer gets fixes. This closes several high-severity advisories, among them an authentication bypass through malformed URLs reaching not-found handlers, plus header and body validation bypasses. The plugins move with it: `@fastify/static` 10 (closes a route-guard bypass via path traversal), `@fastify/multipart` 10 and `@fastify/cors` 11.
- **sharp 0.35.5**, which makes photo thumbnails on the server, bundles libvips, libheif and librsvg versions with the image-parsing flaws fixed (CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591, CVE-2026-96889 and two libheif advisories). Every uploaded photo goes through it.
- **bcrypt 6** no longer installs through node-pre-gyp, which pulled in a critical `tar` advisory. Password hashes are unchanged.
- `minimatch` under `archiver` is pinned to a fixed version. `npm audit` now finds no advisories in production dependencies, and CI fails on any new high or critical one.

### Changed
- When `CORS_ORIGIN` is set, the listed sites may use every method the API needs (`@fastify/cors` 10+ only allows GET, HEAD and POST by default).
- CI: the lockfile check uses `npm ci --dry-run`, so a lockfile written by a newer npm (which records `libc` for sharp's Linux builds) no longer fails it. The workflow uses `actions/checkout` and `actions/setup-node` v7, which run on Node 24, and the test jobs have readable names.

## 3.1.2 (2026-11-11)

### Added
- **Continuous integration** on GitHub Actions: every push and pull request runs the static checks, then the full end-to-end test on Linux (Node 22.13 and 24, with and without the optional native modules) and on Windows. The lockfile must match `package.json`. A dependency audit runs alongside and reports without failing the build for now.
- `npm run lint`: checks that every file parses, that `index.html` preloads every frontend module below the import map, and that `package.json`, the lockfile and the newest changelog entry have the same version.

### Security
- Dependencies updated within their current versions, fixing the critical `proxy-addr` advisory and advisories in `@fastify/busboy` (uploads), `fast-uri` and `brace-expansion`.

## 3.1.1 (2026-11-11)

### Changed
- The video format badge sits on the same dark pill as the resolution and length, so it can be read on any cover, even a white one.
- The background check that reads a video's format now records its resolution in the same pass, so browsers no longer download the start of every video to measure it.

### Fixed
- Requests with ids that aren't text (an object or a number where an id belongs) in bulk actions such as editing details, removing photos from an album, adding songs to a playlist, or creating a collection no longer cause a server error.
- Broken JSON and requests that are too large get a readable 400 or 413 answer.

### Security
- **File ids and account ids from the database are never used as paths outside `data/users/`** (or the thumbnail cache). A database restored from a crafted backup could otherwise make the server read files elsewhere on the disk.
- **Every library loaded from a CDN is pinned by its hash** (Subresource Integrity): Vue, the photo cropper, and the viewers for code, Markdown, Word, Excel, EPUB and PDF. A changed copy on the CDN is refused instead of running next to your sign-in. Tailwind's CDN can't be pinned this way, since it doesn't send CORS headers.
- **The spreadsheet viewer uses SheetJS 0.20.3** from SheetJS's own CDN. The 0.18.5 build had a prototype-pollution flaw (CVE-2023-30533) that a crafted spreadsheet could trigger.
- Unexpected server errors are logged and answered with a plain sentence, so internal details (SQL, file paths) never reach the browser.

### Performance
- Permanently deleting files (emptying the trash) and the locked-folder lookups behind every listing, upload and move reuse prepared statements.
- The downloads list checks in every 10 seconds instead of every 1.2 while its tab is in the background.

## 3.1.0 (2026-11-11)

### Added
- **The video format is shown on every video card**, next to the small film watermark: AV1 (highlighted), H.264, HEVC, VP9 and so on, and in the viewer's details as **Format**. Downloads, trims and conversions record it. Videos uploaded by hand, moved into Videos, or already in your library are read in the background by ffprobe (without writing a decrypted copy to disk). Until then the card shows the file type, such as WEBM.
- **Convert to AV1** for videos that aren't AV1 yet, from the viewer's details panel, a video's menu, or for a whole selection. The video is re-encoded in the download queue (one at a time, with progress) and replaced in place, keeping its details, cover and collections. It's only replaced if the AV1 version is smaller, and the list shows how much was saved. Works in Videos and XXX, and needs ffmpeg with an AV1 encoder (installed automatically).

## 3.0.0 (2026-11-11)

### Breaking
- **Chat, friends and voice calls are gone.** The Chat section, friend requests, messages, temporary chat files, presence and WebRTC calls are removed, along with Socket.IO and the `TURN_*`, `CF_TURN_*` and `STUN_URLS` settings. Upgrading deletes the stored messages and friend lists, gives back the quota used by chat files, and removes `chat_temp/`.
- **Data now lives in `data/`** in the app folder (or wherever `STORAGE_DIR`, or the new alias `DATA_DIR`, points). An install that still has the old `storage/` folder and no `data/` keeps using it and logs a reminder to move it. Updates from GitHub never touch either folder.

### Added
- **XXX on phones.** When the section is on, it has its own slot in the bottom bar instead of hiding in the account menu.
- **Videos pick up where you stopped.** Videos longer than two minutes reopen at the point you left them (remembered in this browser), with a **Start over** button. Space plays and pauses.
- **Sign-ins in Profile.** See recent sign-ins to your account, failed ones included, with the browser, device and IP, and **sign out other devices** without changing your password.
- The browser tab shows the section you're in ("Videos · AkulavBox").

### Changed
- **New sign-in page.** One balanced card: the brand and features on one half, the form on the other, the same height and padding on both sides, a single card on phones. Fields have icons, errors are clearer (and a server that can't be reached says so), and there's a note on what to do about a forgotten password.
- **Creators and collections in Videos use 16:9 tiles**, so video covers are no longer cropped into squares.

### Fixed
- **Vertical videos overflowed the viewer.** A portrait video (a phone recording) grew past the bottom of the screen outside full screen. Videos of any shape now fit inside the viewer with black bars.
- Moving or trashing many items at once runs in one transaction, and ids that aren't strings are skipped instead of causing a server error.
- Deleting a playlist or an album removes its rows in one transaction.

### Security
- The app page gets a Content-Security-Policy (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`) and a `Permissions-Policy` that turns off camera, microphone and location.
- Responses no longer announce the server version in `X-Powered-By`.
- Very long usernames or passwords on sign-in are refused before any work, and the failed-sign-in tracker has a size cap, so a flood of made-up names can't grow memory without end.
- Profile photos must be PNG, JPEG, WebP or GIF (no SVG).

### Performance
- Folder listings, moves and zip downloads reuse prepared statements instead of preparing one per folder visited. The download queue's status lookups have an index.

## 2.10.0 (2026-11-09)

### Added
- **Scheduled backups.** In Admin → Backup and restore, back up daily or weekly at a set hour into any folder on the server. The newest backups you choose to keep stay, and older ones are deleted. If the server was off at the scheduled time, the backup runs once when it starts. **Back up now** makes one on demand. The page shows the next run, the last backup and any failure. The passphrase can come from `BACKUP_PASSPHRASE` in `.env`, or it's saved from Admin, encrypted with `MASTER_KEY`. A schedule restored onto a server with another key asks for the passphrase again.
- **Activity log** in Admin: sign-ins, failed sign-ins (also for account names that don't exist, with the IP), lock-outs, password changes, account changes by admins, public links created and removed, backups, restores, updates and restarts. Filter by type or account, search by name, file or IP, and load older entries. Entries are kept for 180 days (`ACTIVITY_DAYS`). Deleting an account removes its own entries.

### Changed
- The Backup and restore panel and the activity log are separate components, so the Admin page code is smaller. Restarting and the helpers for waiting and retrying are shared from `lib/api.js` instead of copied.
- Form posts (zip and backup downloads) use one parser and one token check for the whole server, and signing someone out or setting their password goes through one helper.

## 2.9.0 (2026-11-09)

### Added
- **Restoring a backup can't silently fail any more.** If the swap at startup fails, the Admin page now says why, for example a file held open by antivirus, Explorer, OneDrive or a second AkulavBox. Before, the page just kept saying “Ready to restore”. Everything already moved is put back, so the server runs on its old data, and the next restart tries again.
- **Backup uploads resume.** If the connection drops, the page reloads, or the check fails, picking the same file again sends only the missing part. Failed chunks are retried, and the chunks get smaller when a proxy refuses big requests (413, for example nginx's default 1 MB limit).
- **Restart now** waits for AkulavBox to come back, then reloads the page (it used to reload after a fixed 6 seconds).

### Fixed
- **A second server started on the same storage folder could swap a restore in under the running one.** Servers now record themselves in `storage/akulavbox.pid`, and only one at a time applies a restore. `scripts/backup.js` never applies one.
- **On Windows, a rename the swap needed failed at once if a file was briefly held open.** It is retried for up to 30 seconds. Storage folders spread over several drives or mounts work (copy, then delete).
- A crash in the middle of the swap carries on from where it stopped at the next start. Before, AkulavBox could start on an empty database.
- **Restart now** closes the database cleanly instead of exiting on the spot.
- A wrong passphrase on `scripts/backup.js import` deleted a restore that was already staged.
- Restoring onto a server with a different key: leftover `.enc` files that no database row lists are skipped instead of copied in unreadable.
- A damaged backup can no longer make the import read huge amounts into memory.
- **Uploads opened over a LAN address with plain http** (for example `http://192.168.1.10:3000`) failed, because `crypto.randomUUID` only exists on https and localhost.
- An import that died half way no longer leaves its staging folder behind.

### Security
- **Chat attachments are only read and deleted inside `storage/chat_temp/`.** The database held an absolute path, which was used as-is. After a restore onto another server those paths were wrong, and a crafted backup could make the server send or delete any file it can reach.
- **Zip downloads** turn folder names `.` and `..` into `_`, so an archive can't put files outside the folder it is unpacked into.

## 2.8.0 (2026-11-09)

### Added
- **XXX section** for adult videos, off by default. Turn it on in Profile → Sections. It works like Videos (Creators, Collections, All videos, link downloads, trim, covers) but keeps everything in its own locked “XXX” folder, with its own downloads list and collections, and never sends anything to Videos or Music. While it’s off, the tab, the folder and its files are hidden from Files, search and Move. Covers can be blurred until you point at them (per device). On phones it’s in the account menu.

### Security
- **Every file opened from the server is sandboxed** (no scripts on the AkulavBox origin), not only HTML and SVG. The file type a browser claims on upload was trusted before, so a file could be served as an unlisted active type. PDFs are the exception, since browsers won’t show a sandboxed PDF.
- **Upload types are validated**: anything that isn’t a plain `type/subtype` is replaced by the type from the file name.
- **Link downloads check where a name points**: a public-looking name that resolves into the server’s own network is refused, as are IPv4-mapped loopback addresses, shared address space (100.64/10), multicast and `.lan` names.
- **Login tokens must be HS256**, and malformed tokens in `?token=` are rejected cleanly.
- **No cross-site API access by default**: CORS was open to every site; it is now same-origin unless `CORS_ORIGIN` lists others. Pages get `Cross-Origin-Opener-Policy: same-origin`.
- **New passwords need at least 8 characters** (was 4). Existing passwords keep working, and shorter ones are flagged as easy to guess at sign-in.

### Fixed
- A chat socket event with a non-text id could throw inside the event handler.
- An interrupted chat upload left a half-written file until the next restart.
- Permanently deleting a file now updates every reference and the quota in one transaction.
- Trashed files could be renamed, added to playlists or used as song artwork.

## 2.7.6 (2026-11-08)

### Changed
- **Tabs in a consistent order.** Videos: Creators, Collections, All videos. Music: Artists, Playlists, All songs. All songs is now a tab instead of a tile among the playlists.
- **Playlists get artwork automatically.** A playlist without its own artwork shows the artwork of its first song, the way video collections show their first video. Artwork you choose still wins.

## 2.7.5 (2026-11-08)

### Changed
- **Music no longer shows the row of tag chips** above song lists, like Videos. Filtering by tag is still in the “All tags” menu.

## 2.7.4 (2026-11-08)

### Changed
- **Videos no longer shows the row of tag chips** above the list. Filtering by tag is still in the “All tags” menu and on each video’s tags.

### Fixed
- A downloaded tag that already started with “#” showed as “##tag”. New downloads drop the extra “#”.

## 2.7.3 (2026-11-08)

### Changed
- **Videos opens on Creators and Music opens on Artists.** Their tab comes first, and Videos → Creators has the Upload and Shuffle buttons and the link box. The full list of videos is now at All videos (`#/videos/all`). Clicking a creator still shows their videos.

## 2.7.2 (2026-11-08)

### Changed
- **Playlists are yours alone too.** Downloaded songs, and videos saved as songs, are no longer put into a playlist named after their artist: Music → Artists already groups them. Playlists made this way earlier stay until you delete them. Songs still get their artwork.

## 2.7.1 (2026-11-08)

### Changed
- **Collections are yours alone.** Downloaded videos are no longer filed into a collection named after their creator: Videos → Creators already groups them by channel, so Collections only holds the ones you make. Collections made this way earlier stay until you delete them. Downloaded songs still go into their artist’s playlist.

## 2.7.0 (2026-11-08)

### Changed
- **Big libraries are much faster.** Videos, Books, Music, Photos and Files now build the first screenful of cards or rows and add more as you scroll, so a section with thousands of items opens, searches, sorts and filters right away. Measured on 3,000 videos: about 0.1 s to show the grid and well under 0.1 s per search keystroke.
  - **Select all** stays instant on thousands of items, and shift-click ranges are quicker.
  - **Search** prepares each item’s searchable text once instead of on every keystroke.
  - **Creators and Artists** are worked out in one pass over the library.
  - **Less network:** large lists are sent gzip-compressed (a 3,000-video library went from 5.5 MB to 255 KB).
  - **Lighter pages:** thumbnails share one visibility watcher, and only the first cards play the rise-in animation.
- **No duplicate count on tiles.** Video collections, creators and music artists no longer show the item count in the top-left corner too. It stays in the caption at the bottom.

### Fixed
- **Downloads now keep all their tags.** Tags were cut to 8 per video, and only the site’s hidden keyword list was read. Now a download also gets the description’s #hashtags (what YouTube shows above the title) and the site’s categories, up to 60 tags. Pasting the link of a video you already have fills in tags it’s missing.

## 2.6.0 (2026-11-08)

### Changed
- **Re-pasting a playlist only downloads what’s new.** Videos and songs already in your library (or already in the queue) are skipped the moment the playlist is read, instead of each being looked up on the site first. The playlist line says how many were new, for example “60 items, 2 new, 58 already in your library”.
- **Big playlists move faster.**
  - **Three downloads at once** instead of two (`DOWNLOAD_PARALLEL`).
  - **AV1 doesn’t block downloads:** a video waiting for its AV1 shrink no longer holds a download slot, so the next downloads start meanwhile (`ENCODE_BACKLOG`, default 4, caps how many can wait).
  - **Dead connections fail fast:** they give up after 30 seconds instead of minutes. A download that goes silent for 3 minutes is stopped (`DOWNLOAD_STALL_SECONDS`).
  - **Automatic retries:** dropped or stalled connections are retried twice before a download fails.
- **The downloads list shows the whole queue**, running ones first, with each waiting item’s place in line and a summary such as “3 downloading · 1 shrinking to AV1 · 54 waiting”. Long playlists are no longer cut off at 60.

## 2.5.0 (2026-11-08)

### New
- **Music gets the same care as Videos.**
  - **Artists view:** one tile per artist, with their newest artwork, song count and total length, plus play and shuffle buttons. Click a tile to see their songs.
  - **Tag quick-filters:** song lists get the same row of tag chips as Videos.
  - **Trim songs:** from a song’s menu, with the same controls as videos. Fast and lossless, or exact (re-encoded to AAC). Replace the song, or save a copy that keeps the artwork and playlists. The preview plays just the chosen part.
- **Resolution on videos.** Cards show a small watermark and a resolution badge (720p, 1080p, 4K…) next to the length, and the details panel shows the exact size. Downloads and trims record it. Videos you uploaded earlier get it filled in quietly in the background. There’s also a new sort: Highest resolution.

### Fixed
- Some YouTube videos failed with “Requested format is not available”. YouTube now needs a JavaScript runtime to unlock all formats, and AkulavBox gives yt-dlp the Node.js it already runs on. If a video still doesn’t offer the preferred formats, it downloads the best one available instead of failing.

## 2.4.0 (2026-11-08)

### New
- **Trim videos.** In a video’s details panel, Trim lets you set a start and an end (type a time like 1:30, or use the current playback time), preview the cut, and either replace the video or save a trimmed copy.
  - **Fast cut:** instant and lossless, but it may start up to a few seconds early, at the nearest keyframe.
  - **Exact cut:** frame-accurate, re-encoded to AV1 (H.264 when AV1 isn’t available).
  - **Replace:** the video keeps its details, cover, collections and share link; the length and storage used update.
  - **Save as new:** the copy gets the same details and joins the same collections.
  - Trims run on the server like downloads, so you can close the page while they finish.

## 2.3.0 (2026-11-08)

### New
- **Update from GitHub.** Admin → Updates shows the installed version, checks GitHub every few hours (or on “Check now”), and shows what’s new since your version. “Update” downloads and installs it, and it runs after a restart. “Roll back” puts the previous version back. Admins see a banner anywhere in the app when a new version is out.
  - In a git clone it fast-forwards to the GitHub version, and refuses if files were edited by hand. Any other install downloads the code from GitHub, backs the current code up to `storage/updates/`, and copies the new code over.
  - Your data (`storage/`), `.env` and `node_modules` are never touched. `npm install` runs only when dependencies changed, and a failure puts the previous version back.
  - Updates needing a newer Node.js are refused with a clear message.
  - `UPDATES=off` turns this off; `UPDATE_REPO`, `UPDATE_BRANCH` and `GITHUB_TOKEN` (for a private fork) change where it looks.

## 2.2.0 (2026-11-08)

### New
- **Save a video as a song.** From a video’s menu, a selection, or a whole collection. The sound goes to Music with the same title, creator, tags, description and artwork (the video’s cover, or a frame from it), filed into the creator’s playlist. Audio is copied as-is when browsers can play it (no quality loss, smallest file), otherwise it is encoded to AAC.
- **Age-restricted and sign-in videos.** Save your browser’s sign-in cookies under Profile → Link downloads (a cookies.txt or JSON export). They’re stored encrypted, used only for your own downloads, and fix YouTube’s “Sign in to confirm your age” and sites that check your age. When a download fails for this reason, it says so and links straight there.
- **Full backup and restore.** Admin → Backup and restore downloads one passphrase-protected file with every account, password, setting, chat, album, playlist and file. Restoring checks the file’s integrity first, then swaps everything in at the next restart and keeps the replaced data in `storage/backups/`. It restores on a server with a different `MASTER_KEY` too: files are re-encrypted on the way in. Uploads go in chunks, so reverse proxies with size limits don’t get in the way; `node scripts/backup.js` does the same from the command line.
- **Storage check.** Admin → Storage check compares the files on disk with the database. It finds files that belong to nothing (left over from crashes, older versions or deleted accounts), listed files that are missing, and storage counters that drifted, and fixes them in one click. Readable lost files are recovered into a “Recovered files” folder instead of being deleted. Also available as `node scripts/backup.js check [--fix]`.
- **Music selection.** Select songs in any list, including playlists. Shift-click selects a range. The bar can play the selection, edit details, add it to a playlist (or a new one), remove it from the playlist, or move it to the trash.
- **More shuffle.** Shuffle all on the Music home, a shuffle button on every playlist tile and in its menu, Shuffle in All videos (everything shown, with the next video starting automatically) and in each collection’s menu. The shuffle choice is remembered by the player.
- `DOWNLOAD_PROXY` sends link downloads through a proxy, for sites blocked in the server’s country.

### Fixed
- Long or numerous tags pushed video cards and the details panel out of bounds. Cards show one line of tags that shortens long ones, and the details panel shows the first 12 with “+N more”.
- Downloading the audio of a link already saved as a video (or the other way round) was skipped as “Already in your library”. The duplicate check now looks only in the section being saved to.
- Sites that only offer combined video+audio streams (common on adult and news sites) could fall through to a stream above 1080p; they now pick the best one up to 1080p.
- A file recovered as plain data couldn’t get a share link.

### Development
- The downloader runs yt-dlp and ffmpeg through one helper, with shared steps for covers, details and filing. `npm run check` (114 checks) now also covers conversions, cookies, the storage check and a full backup restored into a second server with a different key, using a stand-in for ffmpeg (`scripts/test/fake-ffmpeg.js`). The check no longer installs real tools during the test.

## 2.1.0 (2026-11-08)

### New
- **Download from a link.** Paste a YouTube, Vimeo, SoundCloud or other link (or a whole playlist or channel) in Videos or Music, or paste it anywhere on those pages. AkulavBox downloads it and fills in the title, creator, date, length, description and cover. Progress shows live, and you can cancel or retry. The same link twice isn’t downloaded again.
- **Organized by creator automatically.** Each downloaded video is filed into a collection named after its channel, and each song into a playlist named after its artist.
- **Space-efficient AV1 video.** Downloads use the site’s AV1 stream when there is one (YouTube usually has it). Anything else is re-encoded to AV1, and kept only if it comes out smaller. Turn this off with `VIDEO_AV1=off`.
- **Zero setup.** The server installs yt-dlp and ffmpeg itself, on Windows or Linux (x64 or ARM). Both come from their official GitHub releases and are checked against the published SHA-256 sums. yt-dlp updates itself daily. Admin shows the downloader’s status, with Update and Reinstall buttons.
- **Video collections**, like music playlists: create, rename, favorite, set a cover, add from a video’s menu or a selection, drag to reorder, and Play all or Shuffle with the next video starting automatically.
- **Creators view** in Videos: one tile per creator, with their newest cover, how many videos they have and the total length.
- **Square tiles** in Files: denser, with a large watermark of each item’s type, a type badge, and the name and size on the tile. Photos fill their tile. Photo collections and albums use square tiles too. Tiles are now the default view.

### Changed
- Files shows just Photos, Music, Videos and Books. The Covers and Artwork folders inside them are hidden from Files, search and Move, because their sections manage them.

### Fixed
- Video counts under a minute showed “0 min”.

## 2.0.1 (2026-11-07)

### Fixed
- Profile and Admin pages hugged the left edge on wide screens. They are now centred like the rest of the app.
- The sections in the top bar sat slightly off-centre (they were centred between the logo and the account buttons, which differ in width). They now sit at the exact centre of the page.

### Development
- `npm run commit` commits all changes with a message built from the new CHANGELOG.md lines, refuses to commit without one, and tags `v<version>` when the version changes (`--dry-run` to preview, `--push` to push).

## 2.0.0 (2026-11-04)

### Upgrading from 1.x
Drop-in. On first start the database is migrated (schema 0 → 6) after a snapshot is saved to `storage/backups/`. Files on disk are unchanged. Existing sign-ins stay valid.

### New
- **Trash.** Deleting files or folders moves them to the trash, with **Undo** in the notification. A trash page restores or permanently deletes items. Items are removed after `TRASH_DAYS` (30 by default). Deleting a non-empty folder now takes one step and can be undone.
- **Server disk space in Admin.** Shows free and total space on the drive that holds `storage/`, how much of it AkulavBox uses (files, thumbnails, database, chat, unfinished uploads, backups), and a warning when user quotas promise more than the disk can hold. Uploads stop before the disk fills up (`DISK_RESERVE_MB`).
- **Folder uploads.** Upload a whole folder with its sub-folders, from a button or by dragging and dropping.
- **Better uploads.** Three files upload at once. You can cancel or retry each file, or cancel everything. Speed and time-left estimates cover all running uploads, and uploads resume after the connection drops.
- **Download any selection as one zip.** Folders included, and duplicate names are de-duplicated.
- **New text file / Markdown note** from the Files "New" menu. It opens straight in the editor.
- **Admin:** promote and demote admins (you can't remove the last admin), sign a user out everywhere, account search, last sign-in times, trash usage per user, and a warning before setting a quota below someone's current usage.
- **Playlists:** drag to reorder, and the total length is shown.
- **Chat:** unread counts survive reloads, you can delete your own messages for both people, presence is shared with friends only, and you get a notice when a message can't be delivered.
- **Profile:** light, dark, or system theme, a background-animation toggle, a password strength meter, and an About card.
- **Keyboard shortcuts:** `?` lists them all. Also `G` then a letter to switch sections, `Ctrl+A`, `Delete`, and `F2` in Files.
- **Banners** for being offline, a new server version (with a Reload button), a weak password, and nearly full storage.
- Installable as an app (web manifest), and `npm run check` for an end-to-end self-test.

### Look and feel
- The left sidebar is replaced by a top navigation bar: brand, sections in one centred pill, then Trash, Admin, theme, and an account menu. A ring around the avatar shows how full your storage is. Content is centred on the page.
- New brand mark and icons, a redesigned sign-in page, and "Made by Akulav" credits.
- A soft animated background, page transitions, staggered list entrances, hover lift on cards, glass toolbars, and toasts with countdown bars. All of it respects "reduce motion" and the in-app toggle.

### Fixed
- Sessions stayed valid after a password change, after a user was deleted, or after a role change. Tokens are now tied to a per-user version and checked against the database.
- A single upload could fill the disk past the user's quota (quota was only checked after the last chunk). Quota and free space are now checked on every chunk, and failed uploads leave nothing behind.
- Uploads that were missing chunks were saved as truncated files. They are now rejected.
- Sharing or un-sharing a file while someone was streaming it could briefly 404 (the old copy was deleted before the database switched).
- Login didn't limit failed attempts and leaked whether a username existed (by timing).
- Usernames differing only in case could be created. Sign-in is now case-insensitive.
- Album and collection endpoints crashed on a missing or empty title, and could set another user's file as a cover.
- Deleting a user left their chat files on disk.
- Chat files dropped by the 1,000-message limit were never deleted from disk.
- Typing indicators could be sent to non-friends.
- Admin password resets and quota changes reported success for unknown users.
- Zip downloads contained duplicate names, and compressed photos and videos a second time.
- Mis-set `MASTER_KEY` / `JWT_SECRET` crashed on the first upload or login. The server now refuses to start with a clear message.
- Login tokens in `?token=` URLs were written to request logs and could leak through the `Referer` header.
- The native `bcrypt` binary failing to load (for example, `node_modules` copied from another OS) stopped the server. It now falls back to `bcryptjs`.

### Faster
- Database indexes on every hot lookup (1.x scanned whole tables), WAL mode, and tuned pragmas.
- Folder sizes for a whole directory are computed in one pass, instead of one recursive query per folder.
- Uploads encrypt chunks as they arrive, so finishing a large file is an instant rename instead of a full re-read and re-encrypt.
- Bulk move, trash, add-to-album, and remove-from-album run as one request instead of one per item.
- Music artwork uses thumbnails instead of full-size images.
- All app modules are preloaded in parallel.

## 1.x
Initial releases: files, photos, music, videos, books, chat and calls, and multi-user quotas.
