# Changelog

All notable changes to AkulavBox. Versions follow [semantic versioning](https://semver.org/). The version lives in `package.json` and is shown in the account menu and page footer, on the sign-in page, in Admin, and at `GET /api/health`.

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
