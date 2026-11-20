# API reference

All endpoints are JSON unless noted. AkulavBox's own API (`/api/…`: the account, the launcher, the Admin console, and Trove, the files app) authenticates with `Authorization: Bearer <token>`, or `?token=<token>` for media URLs; it never reads the sign-in cookie. Errors look like `{ "error": "message" }` with a 4xx or 5xx status. `401` means sign in again, and `403` means admins only. Responses may include `X-Refresh-Token`. Store it to keep the session alive.

The other apps (`/docs`, `/manga`, `/budget`, `/tasks`) use the same sign-in through the HttpOnly cookie `akb_session` (the same JWT), set by `/api/login` and `/api/session`. Their routes are listed at the end, followed by the AI connector (`/mcp`), which takes connector tokens instead.

## Public
| Method | Path | |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, name, version, author }` |
| POST | `/api/login` | `{ username, password }` → `{ token, role, id, username, weak_password }`, and sets the `akb_session` cookie. Rate limited (429) |
| POST | `/api/logout` | Clears the `akb_session` cookie (the page forgets its stored token) |
| POST | `/api/session/resume` | Cookie only, same origin: → `{ token, id, username, role }` for a page that lost its stored token. Other origins get 403 |
| GET | `/api/session/me` | Cookie only, for the shared account menu (`hub/account.js`): `{ id, username, role, avatar, apps: [{ id, name, path, color }] }` (`apps`: the ones the account may open, for the app switcher); `avatar` is `/api/session/avatar?v=<version>` or `null`. 401 when signed out |
| GET | `/api/apps/catalog` | The apps of the server for the signed-out sign-in page: `{ name, version, apps: [{ id, name, path, tagline, short, color }] }` |
| GET | `/api/session/avatar` | Cookie only: the account's profile picture as an image (PNG, JPEG, WebP or GIF), cached until its `?v=` changes. 404 without one |
| GET | `/`, `/login`, `/admin`, `/connect`, `/box/` | The launcher, the sign-in page (`?next=/path` to come back to, `?out=1` after signing out), the Admin console, AI connectors, Trove's page |
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
| POST | `/api/downloads/av1` | `{ file_ids }`: re-encode my videos to AV1 in place (`akulavbox:av1/<id>` jobs). Ones already AV1 or already queued are skipped (`skipped`). The original is kept when AV1 isn't smaller. Needs `status.encode_av1` |
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
| POST | `/api/admin/users` | `{ username, password, quota, role }`; `quota` is the size of the account's storage, shared by every app |
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
| GET | `/api/admin/site-icon?bitwarden=1` | The site icon check: `{ address, ok, icon, steps: [{ ok, text }], bitwarden }`. Fetches the public address the way Bitwarden's icon service does; `bitwarden=1` also asks that service (sends the domain name to Bitwarden) |
| POST | `/api/admin/restart` | Stops the server cleanly so a service manager restarts it (applies a staged restore) |

## e-Management (`/docs`)

Cookie sign-in. Changes (anything but GET) must come from the same origin. `:store` is `personal` or `work`; a record of one space is not found in the other.

| Method | Path | |
| --- | --- | --- |
| GET | `/docs/` | The page (signed out: redirect to `/login?next=/docs/`) |
| GET | `/docs/api/me` | `{ id, username, role, quota_bytes, used_bytes, app_bytes, limit_bytes, stores: [{ key, label }] }`: the account's storage (every app), e-Management's part, and its own limit if the admin set one |
| GET / POST | `/docs/api/s/:store/categories` | Categories with their tags / `{ name, color, sort }` |
| PUT / DELETE | `/docs/api/s/:store/categories/:id` | |
| POST · PUT / DELETE | `/docs/api/s/:store/tags` · `/tags/:id` | `{ category_id, name }` · `{ name }` |
| GET | `/docs/api/s/:store/documents` | Every document with `tagIds` and `files` |
| POST · PUT | `/docs/api/s/:store/documents` · `/documents/:id` | multipart: `data` (JSON `{ title, doc_date, number, description, tagIds, removeFileIds }`) and up to 10 `files` of 50 MB. 413 when the account's storage is full |
| DELETE | `/docs/api/s/:store/documents/:id` | Deletes the document and its files |
| GET | `/docs/api/s/:store/files/:id` | A file (PDF/PNG/JPEG inline, the rest as a download; `?download=1`) |
| GET · POST | `/docs/api/s/:store/export` · `/import` | A `.anscbackup` of the space · the archive as the request body (`application/octet-stream`), replacing the space |
| GET · POST | `/docs/api/audit` · `/docs/api/audit/prune` | The account's activity log (90 days) · `{ until: 'YYYY-MM-DD' }` |

## Koma Shelf (`/manga`)

Server-rendered pages under `/manga/` (`/`, `/w/:id`, `/w/:id/:chapter`, `/u/:username`, `/me`, `/upload`, `/account`, `/admin`). Cookie sign-in; form posts need the `_csrf` field from the page (or `X-CSRF-Token`) and the same origin. `/manga/login` sends you to `/login`.

For Koma and scripts, with `Authorization: Bearer ks_…` (create a token under Account → Connect Koma):

| Method | Path | |
| --- | --- | --- |
| GET | `/manga/api/v1/me` | Who the token belongs to |
| POST | `/manga/api/v1/works` | multipart: `files` (zip/cbz or images), optional `title`, `description`, `visibility`, `cover`. 413 when the account's storage is full |
| GET | `/manga/api/v1/works/:id` | `{ status: processing \| ready \| failed, progress, url, … }` |

## Florin (`/budget`)

Cookie sign-in. Changes need the header `X-Requested-With: florin`.

| Method | Path | |
| --- | --- | --- |
| GET | `/budget/api/config` · `/budget/api/currencies` | App version and default currency · exchange rates |
| GET / PATCH | `/budget/api/auth/me` | The account: `{ user: { id, name, username, role, baseCurrency, monthlyBudget } }` / `{ name?, baseCurrency?, monthlyBudget? }`. `monthlyBudget` 0 or empty: the total budget is the sum of the category budgets |
| GET / POST | `/budget/api/categories` | / `{ name, icon, color, kind, budget }` |
| PATCH / DELETE | `/budget/api/categories/:id` | |
| GET / POST | `/budget/api/transactions` | Filters `?from=&to=&kind=&category=&q=` / `{ kind, amount, currency, date, categoryId, payee, note }` |
| PATCH / DELETE | `/budget/api/transactions/:id` | |
| GET | `/budget/api/transactions/export.csv` · `/payees` | CSV of the (filtered) transactions · known payees |
| GET | `/budget/api/stats/overview` · `/trend` · `/analytics` | Dashboard and chart data. The overview's `totals.budget` is the overall monthly budget when set, else `totals.categoryBudgets` |
| GET · PATCH | `/budget/api/admin/stats` · `/budget/api/admin/settings` | Admins: totals · `{ defaultCurrency }` |
| PUT · POST | `/budget/api/admin/rates/:code` · `/rates/refresh` | Admins: `{ rate }` · fetch the latest rates |

## Ironveil (`/ironveil`)

Cookie sign-in. Changes need the header `X-Requested-With: ironveil` (and a same-origin request). The game's saves are JSON texts by name (`profile`, `run`; names are `[a-z][a-z0-9_-]{0,31}`, at most 16 per account, 32 MB each). They count in the account's storage.

| Method | Path | What it does |
|---|---|---|
| GET | `/ironveil/` | The game's page (signed-out visitors go to `/login`) |
| GET | `/ironveil/game/ironveil.wasm` | The game, gzipped, with an ETag (404 until `npm run ironveil` has built it) |
| GET | `/ironveil/api/saves` | `{ saves: { name: text }, updated: { name: ISO date } }` |
| PUT | `/ironveil/api/saves/:name` | Body: the save, as `text/plain`. `413` when the account's storage is full |
| DELETE | `/ironveil/api/saves/:name` | Remove a save (a finished run's) |
| GET | `/ironveil/api/profile` | The progress in plain words: `runs`, `best_wave`, `total_kills`, `play_time_hours`, `legacy_shards`, `achievements`, `run_in_progress` (the AI connector's `ironveil_progress`) |

## Tick (`/tasks`)

Cookie sign-in. Changes need the header `X-Requested-With: tasks`. Every path is under `/tasks/api`; ids are integers, dates `YYYY-MM-DD`, times `HH:MM`.

| Method | Path | |
| --- | --- | --- |
| GET | `/tasks/` and its page paths (`/tasks/today`, `/tasks/list/3`, …) | The page (signed out: redirect to `/login`) |
| GET | `/bootstrap` | `{ user, prefs, lists, tasks }`: everything the page needs at once |
| GET / POST | `/tasks` | Every open task (to do and doing) / `{ title, notes, listId, dueDate, dueTime, priority 0–3, flagged, tags, checklist: [{ text, done }], repeat: { every, unit: day\|week\|month\|year, weekdays? }, status }` → 201 `{ task }` |
| GET | `/tasks/done?offset=&limit=&listId=&from=&to=` | `{ total, items }`, newest first |
| GET / PATCH / DELETE | `/tasks/:id` | `{ task }` / any of the fields above, plus `today` → `{ task, next }` (`next`: a repeating task's new copy when it is ticked off; `undoNext` takes it back) |
| POST | `/tasks/reorder` · `/tasks/clear-done` | `{ ids }` · `{ listId? }` |
| GET / POST | `/lists` | With open and done counts / `{ name, color, icon }` |
| PATCH / DELETE | `/lists/:id` | `?tasks=delete` deletes its tasks too (they go to the Inbox otherwise) |
| POST | `/lists/reorder` | `{ ids }` |
| GET · PATCH / DELETE | `/tags` · `/tags/:tag` | Tags in use · `{ name }` renames it on every task / removes it |
| GET / PATCH | `/prefs` | `{ weekStart, startView, showDoneInLists, sort }` |

## AI connector

Lets an AI app read, and when allowed change, every app of an account. Calls carry `Authorization: Bearer akb_…`: a token made at `/connect`, or one an AI app got through OAuth. A token's scopes say per app (`box`, `documents`, `manga`, `budget`, `tasks`) `read` or `write`; it sees only the tools of the apps it may use (and that are on for the account), and the tools that change something only with `write`. 240 calls a minute per token. These endpoints answer any origin (CORS), since they take bearer tokens only.

| Method | Path | |
| --- | --- | --- |
| POST | `/mcp` | The [Model Context Protocol](https://modelcontextprotocol.io) over Streamable HTTP, stateless, with JSON answers: `initialize`, `ping`, `tools/list`, `tools/call` (single messages or a batch). Notifications → 202. Without a valid token: 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` |
| GET | `/api/connector/tools` | The same tools for plain HTTP: `{ account, connector, tools: [{ name, title, description, inputSchema, annotations }] }` |
| POST | `/api/connector/tools/:name` | The tool's arguments as the body → `{ result }`, or 400 `{ error }` |

The tools (`akulavbox_account` always; the others by app): `trove_list_folder`, `trove_search`, `trove_library`, `trove_read_file` (text and images), `trove_create_folder`, `trove_write_text_file`, `trove_update_text_file`, `trove_rename`, `trove_move`, `trove_trash`; `docs_categories`, `docs_list`, `docs_get`, `docs_read_file`, `docs_create`, `docs_update`, `docs_delete`; `koma_webtoons`, `koma_webtoon`, `koma_update_webtoon`; `florin_categories`, `florin_transactions`, `florin_month`, `florin_trend`, `florin_add_transaction`, `florin_update_transaction`, `florin_delete_transaction`; `tick_lists`, `tick_list_tasks`, `tick_add_task`, `tick_update_task`, `tick_complete_task`, `tick_delete_task`, `tick_create_list`. Each calls the app's own route in the process, as the account.

The account's connectors (signed in, `Authorization` with the session token as for the rest of `/api`):

| Method | Path | |
| --- | --- | --- |
| GET | `/api/connector/tokens` | `{ tokens: [{ id, name, kind: token\|oauth, prefix, scopes, created_at, last_used_at, expires_at }], apps, mcp_url, base_url }` |
| POST | `/api/connector/tokens` | `{ name, scopes: { app: read\|write }, days }` (`days` null: until revoked) → `{ token, connector }`. The token is shown this once |
| PATCH / DELETE | `/api/connector/tokens/:id` | `{ name?, scopes? }` / revoke |

OAuth 2.1 for AI apps (authorization code with PKCE S256, public clients, refresh tokens):

| Method | Path | |
| --- | --- | --- |
| GET | `/.well-known/oauth-protected-resource` · `/.well-known/oauth-authorization-server` | Discovery (RFC 9728, RFC 8414) |
| POST | `/oauth/register` | Dynamic client registration (RFC 7591): `{ client_name, redirect_uris }` → 201 `{ client_id, … }`. Redirects must be https, http on localhost, or an app's own scheme |
| GET | `/oauth/authorize` | The approval page: `response_type=code&client_id&redirect_uri&code_challenge&code_challenge_method=S256&state&scope` (`scope`: `tasks:write box:read …`; the person picks the final ones) |
| POST | `/oauth/token` | `grant_type=authorization_code` (`code, redirect_uri, client_id, code_verifier`) or `refresh_token` (`refresh_token, client_id`) → `{ access_token, token_type, expires_in, refresh_token, scope }`. Access tokens last a day, refresh tokens 90 days and change on every use |
| POST | `/oauth/revoke` | `token=` (access or refresh): ends the grant |
