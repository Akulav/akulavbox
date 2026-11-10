# API reference

All endpoints are JSON unless noted. Authenticate with `Authorization: Bearer <token>`, or `?token=<token>` for media URLs. Errors look like `{ "error": "message" }` with a 4xx or 5xx status. `401` means sign in again, and `403` means admins only. Responses may include `X-Refresh-Token`. Store it to keep the session alive.

## Public
| Method | Path | |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, name, version, author }` |
| POST | `/api/login` | `{ username, password }` → `{ token, role, id, username, weak_password }`. Rate limited (429) |
| GET | `/shared/:hash` | A publicly shared file (supports Range) |

## Files and folders
| Method | Path | |
| --- | --- | --- |
| GET | `/api/directory/:folderId?` | `{ folders, files, currentPath }` (top level without an id) |
| GET | `/api/search?q=` | Files and folders whose names match (2+ characters) |
| GET | `/api/folders/all` | Every folder (for move pickers) |
| POST | `/api/folders` | `{ name, parent_id }` |
| POST | `/api/folders/path` | `{ parent_id, path: "a/b" }` → `{ id }`. Finds or creates nested folders |
| PATCH | `/api/folders/:id/name` · `/move` | `{ name }` · `{ folder_id }` |
| DELETE | `/api/folders/:id` | Moves the folder and its contents to the trash |
| GET | `/api/folders/:id/download` | Zip of the folder |
| POST | `/api/files/upload` | multipart: `upload_id, chunk_index, total_chunks, offset, total_size, folder_id, file` (16 MB chunks) |
| GET | `/api/files/:id/view` | The file contents (Range, `?download=1`) |
| GET / PUT | `/api/files/:id/thumb?w=240\|480\|960` | Thumbnail (`&cached=1`: from cache only) / store a browser-made one |
| PATCH | `/api/files/:id/name` · `/move` · `/share` | `{ name }` · `{ folder_id }` · `{ is_shared }` |
| PUT | `/api/files/:id/content` | `{ content, base_size }`. Edit a text file in place (≤ 5 MB) |
| DELETE | `/api/files/:id` | To the trash (`?permanent=1` deletes for good) |
| POST | `/api/items/move` | `{ files: [], folders: [], folder_id }` |
| POST | `/api/items/trash` | `{ files: [], folders: [] }` |
| POST | `/api/zip` | Form post: `token, files, folders` (comma separated), `name`. Streams a zip |
| POST | `/api/files/dims` | `{ items: [{ id, w, h }] }`. Natural image sizes |

## Trash
| Method | Path | |
| --- | --- | --- |
| GET | `/api/trash` | `{ files, folders, total_bytes, total_files, days }` |
| POST | `/api/trash/restore` · `/api/trash/delete` | `{ files: [], folders: [] }` |
| DELETE | `/api/trash` | Empty the trash |

## Account
| Method | Path | |
| --- | --- | --- |
| GET | `/api/user/profile` | Includes `used_bytes`, `quota_bytes`, `trash_bytes`, `show_xxx` |
| PATCH | `/api/user/profile` | `{ profile_image: dataUrl \| null }` (PNG, JPEG, WebP or GIF) |
| PATCH | `/api/user/settings` | `{ show_xxx: boolean }`: turn the XXX section on or off for the account |
| PATCH | `/api/user/password` | `{ currentPassword, newPassword }` → `{ token }`. At least 8 characters. Other sessions are revoked |
| POST | `/api/user/signout-others` | Revoke every other session → `{ token }` for this one |
| GET | `/api/user/activity` | My 25 latest sign-in events: `[{ at, action, detail, ip }]` (`auth.login` with the user agent in `detail`, `auth.login_failed`, `auth.locked`) |

## Library (photos, music, videos, books)
| Method | Path | |
| --- | --- | --- |
| GET | `/api/library/folder/:key` | The id of a locked folder (`gallery`, `music`, `music_art`, `videos`, `video_covers`, `books`, `book_covers`, `xxx`, `xxx_covers`). The XXX ones answer 403 while the section is off |
| GET | `/api/library/:section` | `photos` / `videos` / `books` / `music` / `xxx` items with details (`xxx`: 403 while off) |
| PATCH | `/api/library/meta/:fileId` | Title, participants, tags, details, date, series, rating, duration, thumb_file_id, progress, width, height (a video’s resolution) |
| POST | `/api/library/meta/bulk` | `{ file_ids, add_participants, remove_participants, add_tags, remove_tags, set }` |

## Video collections
`/api/media-collections?kind=videos|xxx|books` (GET: with `item_count`, `total_duration`, `display_cover_id`; POST `{ kind, title, file_ids? }`), `/api/media-collections/:id` (PATCH `{ title?, notes?, cover_file_id? }`, DELETE: the videos stay), `/:id/favorite` (PATCH), `/:id/items` (GET; POST `{ file_ids }`), `/:id/items/remove` (POST `{ file_ids }`), `/:id/order` (PUT `{ file_ids }`).

## Link downloads
| Method | Path | |
| --- | --- | --- |
| GET | `/api/downloads/status` | `{ enabled, available, ytdlp, ffmpeg, av1, convert, installing, step, error }` |
| GET | `/api/downloads?kind=video\|audio\|xxx` | All my unfinished jobs plus the 60 latest finished: `status` is `queued`, `probing`, `downloading`, `encode_wait` (downloaded, waiting for the AV1 encoder), `converting`, `processing`, `done`, `error`, `cancelled` or `expanded` (a playlist that became one job per entry) |
| POST | `/api/downloads` | `{ url, kind }` (`video`, `audio`, or `xxx`: a video saved to the XXX section, 403 while it's off). Several links can be separated by spaces. `akulavbox:video/<fileId>` re-queues a conversion |
| POST | `/api/downloads/trim` | `{ file_id, start, end, exact?, copy? }` (seconds): keep start..end of my video or song. `exact` re-encodes for a frame-accurate cut; `copy` saves a new video instead of replacing. Queued as `akulavbox:trim/<id>?…` |
| POST | `/api/downloads/from-videos` | `{ file_ids }`: save my videos' sound as songs (same details and artwork). Needs ffmpeg (`status.convert`) |
| GET / PUT / DELETE | `/api/downloads/cookies` | My sign-in cookies for downloads. GET → `{ saved, sites, updated_at }` (never the values). PUT `{ text }`: a Netscape cookies.txt or a JSON export |
| DELETE | `/api/downloads/:id` | Cancel, or remove a finished job from the list |
| POST | `/api/downloads/clear` | Remove finished jobs |
| POST | `/api/downloads/tools` | Admins: `{ action: 'install' \| 'update' }` reinstalls the tools or updates yt-dlp |

## Albums
`/api/collections` (GET, POST), `/api/collections/:id` (DELETE), `/:id/title`, `/:id/notes`, `/:id/favorite`, `/:id/cover` (PATCH), `/:id/download`, `/:colId/images`, `/:colId/albums` (GET, POST).
`/api/albums/:id` (DELETE), `/:id/title`, `/:id/notes`, `/:id/favorite`, `/:id/cover` (PATCH), `/:id/images` (GET, POST `{ file_id }`), `/:id/images/bulk` and `/:id/images/remove` (POST `{ file_ids }`), `/:id/images/:fileId` (DELETE), `/:id/download`, `/api/albums/migrate` (POST).

## Music
`/api/music/songs` (GET), `/api/music/playlists` (GET: with `song_count`, `total_duration`, `display_cover_id`; POST `{ title }`), `/api/music/playlists/:id` (DELETE), `/:id/title`, `/:id/favorite`, `/:id/cover` (PATCH), `/:id/songs` (GET, POST `{ file_id }`), `/:id/songs/bulk` and `/:id/songs/remove` (POST `{ file_ids }`), `/:id/order` (PUT `{ file_ids }`), `/:id/songs/:file_id` (DELETE), `/api/music/songs/:id/cover` (POST `{ cover_file_id }`).

## Admin (admins only)
| Method | Path | |
| --- | --- | --- |
| GET | `/api/admin/users` | Accounts with usage, file count, trash, last sign-in |
| POST | `/api/admin/users` | `{ username, password, quota, role }` |
| DELETE | `/api/admin/users/:id` | Deletes the account and all of its data |
| PATCH | `/api/admin/users/:id/password` · `/quota` · `/role` | `{ newPassword }` · `{ quota }` · `{ role }` |
| POST | `/api/admin/users/:id/signout` | Revokes every session |
| GET | `/api/admin/system` | Disk `{ total, free, used }`, storage breakdown, totals, overcommit, version, schema, Node, uptime (`?fresh=1` re-measures) |
| GET | `/api/admin/storage-check` | Files on disk vs. the database: `orphans` (no row), `missing` (row, no data), `usage` (drifted counters), with byte totals |
| POST | `/api/admin/storage-check/clean` | `{ orphans?, missing?, usage? }` (all on by default) → `{ deleted, freed_bytes, recovered, repaired, removed_rows, usage_fixed }` |
| GET | `/api/admin/activity?kind=&user=&q=&before=&limit=` | `{ items: [{ id, at, user_id, username, action, target, detail, ip }], next, keep_days }`, newest first. `kind`: `signin`, `failed`, `account`, `share`, `backup`, `server`. `before=<next>` loads older rows |
| PUT | `/api/admin/backup/schedule` | `{ enabled, every: daily\|weekly, hour, weekday, keep, dir, passphrase? }` → the schedule status (never the passphrase) |
| POST | `/api/admin/backup/schedule/run` | Make a scheduled backup now (in the background; see `schedule` in `GET /api/admin/backup`) |
| GET | `/api/admin/backup` | `{ estimate, import: { running, step, done, total, error, staging, pending }, restored, schedule: { enabled, every, hour, weekday, keep, dir, default_dir, has_passphrase, passphrase_from_env, passphrase_unreadable, next_at, last, last_ok, running, done, total, timezone } }`. `staging` is the id of another process (the command line) unpacking a backup; `pending.failed` is `{ error, at }` when the last start couldn't swap the restore in |
| POST | `/api/admin/backup/export` | Form post: `token, passphrase` (8+ characters). Streams an `.akbx` file |
| GET | `/api/admin/backup/upload?id=` | `{ size }`: how much of that upload the server has, to resume it |
| PUT | `/api/admin/backup/upload?id=&offset=` | Raw `application/octet-stream` chunk of a backup (≤ 32 MB each). A chunk past the end → 409 `{ error, size }` |
| POST | `/api/admin/backup/import` | `{ id \| server_path, passphrase }`. Checks the passphrase at once, then unpacks and verifies in the background |
| DELETE | `/api/admin/backup/import` | Drop a staged restore |
| GET | `/api/admin/updates` | `{ enabled, repo, branch, current, latest: { version, sha, notes, node_ok }, available, mode, applying, step, error, ready, rollback }` (`?check=1` asks GitHub now) |
| POST | `/api/admin/updates/apply` | Install the newest version in the background; it runs after a restart |
| POST | `/api/admin/updates/rollback` | Put back the code from before the last update |
| POST | `/api/admin/restart` | Stops the server cleanly so a service manager restarts it (applies a staged restore) |
