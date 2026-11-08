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
| GET | `/api/user/profile` | Includes `used_bytes`, `quota_bytes`, `trash_bytes` |
| PATCH | `/api/user/profile` | `{ profile_image: dataUrl \| null }` |
| PATCH | `/api/user/password` | `{ currentPassword, newPassword }` → `{ token }`. Other sessions are revoked |

## Library (photos, music, videos, books)
| Method | Path | |
| --- | --- | --- |
| GET | `/api/library/folder/:key` | The id of a locked folder (`gallery`, `music`, `music_art`, `videos`, `video_covers`, `books`, `book_covers`) |
| GET | `/api/library/:section` | `photos` / `videos` / `books` / `music` items with details |
| PATCH | `/api/library/meta/:fileId` | Title, participants, tags, details, date, series, rating, duration, thumb_file_id, progress, width, height (a video’s resolution) |
| POST | `/api/library/meta/bulk` | `{ file_ids, add_participants, remove_participants, add_tags, remove_tags, set }` |

## Video collections
`/api/media-collections?kind=videos` (GET: with `item_count`, `total_duration`, `display_cover_id`; POST `{ kind, title, file_ids? }`), `/api/media-collections/:id` (PATCH `{ title?, notes?, cover_file_id? }`, DELETE: the videos stay), `/:id/favorite` (PATCH), `/:id/items` (GET; POST `{ file_ids }`), `/:id/items/remove` (POST `{ file_ids }`), `/:id/order` (PUT `{ file_ids }`).

## Link downloads
| Method | Path | |
| --- | --- | --- |
| GET | `/api/downloads/status` | `{ enabled, available, ytdlp, ffmpeg, av1, convert, installing, step, error }` |
| GET | `/api/downloads?kind=video\|audio` | All my unfinished jobs plus the 60 latest finished: `status` is `queued`, `probing`, `downloading`, `encode_wait` (downloaded, waiting for the AV1 encoder), `converting`, `processing`, `done`, `error`, `cancelled` or `expanded` (a playlist that became one job per entry) |
| POST | `/api/downloads` | `{ url, kind }`. Several links can be separated by spaces. `akulavbox:video/<fileId>` re-queues a conversion |
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

## Chat
`/api/chat/users`, `/api/chat/friends` (includes `unread` and `online`), `/api/chat/friends/add | accept | remove` (POST `{ friend_id }`), `/api/chat/messages/:friendId` (GET), `/api/chat/messages/:id` (DELETE, own messages), `/api/chat/read/:friendId` (POST), `/api/chat/upload` (multipart `receiver_id, file`, ≤ 50 MB), `/api/chat/download/:msgId`, `/api/rtc/config`.

**Socket.IO** (auth: `{ token }`)
- client → server: `send_message { receiver_id, content }` (ack `{ ok, error? }`), `typing`, `call_user`, `answer_call`, `reject_call`, `end_call`, `webrtc_offer`, `webrtc_answer`, `webrtc_ice_candidate` (all with `target_id`)
- server → client: `online_list`, `user_online`, `user_offline`, `receive_message`, `message_deleted`, `file_expired`, `friends_changed`, `typing`, `incoming_call`, `call_answered`, `call_rejected`, `call_ended`, and the WebRTC events

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
| GET | `/api/admin/backup` | `{ estimate, import: { running, step, done, total, error, pending }, restored }` |
| POST | `/api/admin/backup/export` | Form post: `token, passphrase` (8+ characters). Streams an `.akbx` file |
| PUT | `/api/admin/backup/upload?id=&offset=` | Raw `application/octet-stream` chunk of a backup (≤ 32 MB each) |
| POST | `/api/admin/backup/import` | `{ id \| server_path, passphrase }`. Checks the passphrase at once, then unpacks and verifies in the background |
| DELETE | `/api/admin/backup/import` | Drop a staged restore |
| GET | `/api/admin/updates` | `{ enabled, repo, branch, current, latest: { version, sha, notes, node_ok }, available, mode, applying, step, error, ready, rollback }` (`?check=1` asks GitHub now) |
| POST | `/api/admin/updates/apply` | Install the newest version in the background; it runs after a restart |
| POST | `/api/admin/updates/rollback` | Put back the code from before the last update |
| POST | `/api/admin/restart` | Exits the process so a service manager restarts it (applies a staged restore) |
