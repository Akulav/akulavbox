# Changelog

All notable changes to AkulavBox. Versions follow [semantic versioning](https://semver.org/). The version lives in `package.json` and is shown in the account menu and page footer, on the sign-in page, in Admin, and at `GET /api/health`.

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
