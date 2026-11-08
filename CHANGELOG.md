# Changelog

All notable changes to AkulavBox. Versions follow [semantic versioning](https://semver.org/). The version lives in `package.json` and is shown in the account menu and page footer, on the sign-in page, in Admin, and at `GET /api/health`.

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
