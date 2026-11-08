<div align="center">

<img src="frontend/favicon.svg" width="96" height="96" alt="AkulavBox logo">

# AkulavBox

**Your files, your cloud.** A self-hosted personal cloud for encrypted files, photos, music, videos, books, and chat with voice calls. It's one Node.js server with a no-build browser frontend.

![Version](https://img.shields.io/badge/version-2.4.0-E8A33D)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-5fb3a1)
![License](https://img.shields.io/badge/license-source--available-8ea1a4)

Made with ♥ by **Akulav**

</div>

---

## Features

| | |
| --- | --- |
| **Files** | Folders, drag and drop, chunked uploads up to 50 GB per file (3 files in parallel, cancel or retry each one), **folder uploads**, search, zip downloads of any selection, public share links, and in-browser previews and editing of text, code, Markdown, CSV, JSON, Word, Excel, PDF, and zip files |
| **Trash** | Deleted files and folders go to the trash with **Undo**. Restore whole folder trees. Items are deleted for good after 30 days (configurable) |
| **Encryption at rest** | AES-256-CTR. Each chunk is encrypted as it arrives, and range requests (video seeking) decrypt from any offset |
| **Photos** | Collections and albums, justified "natural shape" grids, slideshow, server-side thumbnails via `sharp` (the browser makes them if `sharp` is missing) |
| **Music** | Library, playlists you can reorder by dragging, favorites, artwork, shuffle everywhere, multi-select (shift-click ranges) to play, file, remove or delete songs, a player that keeps playing while you browse, and media-key support |
| **Download from a link** | Paste a YouTube, Vimeo, SoundCloud or other link (playlists and channels too). Title, creator, date, cover and length are filled in, videos are filed into a collection per channel and songs into a playlist per artist, and video is kept as space-efficient AV1. Age-restricted videos work with your saved sign-in cookies. yt-dlp and ffmpeg install themselves |
| **Videos and books** | Video collections with play-all and shuffle, a Creators view, **save any video as a song** (same details and artwork), **trim** (fast lossless or frame-exact, in place or as a copy), covers generated automatically, participants, tags, series, and ratings. The EPUB reader remembers your page |
| **Chat and calls** | Real-time messaging between friends, unread counts that survive reloads, deleting your own messages, files that disappear after 10 minutes, and WebRTC voice calls with optional TURN relay |
| **Multi-user** | Per-user storage quotas. The admin panel shows **free disk space on the server**, a storage breakdown, a warning when quotas promise more than the disk can hold, roles, password resets, and "sign out everywhere" |
| **Backup and upkeep** | **Full backup and restore** of every account, password and file in one passphrase-protected file (restores onto a new server, even with a different key), and a **storage check** that finds and cleans files on disk that belong to nothing |
| **Security** | Revocable sessions (a password change signs out other devices), sign-in rate limiting, timing-safe login, tokens kept out of logs and `Referer` headers, and a sandbox for uploaded HTML and SVG |
| **Polish** | Light, dark, and system themes, a subtle animated background (can be turned off), keyboard shortcuts (press `?`), installable as an app (PWA manifest), offline and update banners |

## Requirements

- Node.js **22.13 or later** (the built-in `node:sqlite` module needs it)
- Optional: build tools for the native `bcrypt` and `sharp` modules. Both are optional. AkulavBox falls back to pure-JS `bcryptjs` and to thumbnails made in the browser.

## Getting started

```bash
npm install
cp .env.example .env   # then set JWT_SECRET and MASTER_KEY
npm start
```

Open http://localhost:3000.

On first start, a default admin account is created with **username `admin` and password `admin`**. The app keeps reminding you until you change it.

To check that everything works, run the built-in test suite. It starts a throwaway server on a random port with temporary storage and never touches your data:

```bash
npm run check
```

## Configuration

All settings live in `.env` (see [.env.example](.env.example)).

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_SECRET` | *required* | Secret for signing login tokens. Use a long random string |
| `MASTER_KEY` | *required* | File encryption key, **exactly 32 characters**. Losing or changing it makes stored files unreadable |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the server listens |
| `STORAGE_DIR` | `./storage` | Where the database and files live |
| `TRASH_DAYS` | `30` | How long deleted items stay in the trash |
| `DISK_RESERVE_MB` | `512` | Uploads are refused when they would leave less free disk than this |
| `TOKEN_TTL` | `7d` | Sign-in lifetime. Active sessions renew themselves daily |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limiting sees real client IPs |
| `SQLITE_WAL` | on | Set to `0` if storage is on a network drive |
| `LOG_LEVEL` | `warn` | Fastify log level (`info` logs every request) |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | | Static TURN relay for calls |
| `TURN_SECRET` | | coturn `static-auth-secret` (short-lived credentials) |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | | Cloudflare Realtime TURN |
| `STUN_URLS` | Cloudflare + Google | Override the STUN servers |
| `DOWNLOADS` | on | `off` turns link downloads off |
| `AUTO_INSTALL_TOOLS` | on | `0` stops AkulavBox installing yt-dlp and ffmpeg into `storage/tools/` |
| `YTDLP_PATH` / `FFMPEG_PATH` | auto | Use your own copies instead |
| `VIDEO_AV1` | on | `off` keeps downloaded video in whatever format the site serves |
| `DOWNLOAD_PARALLEL` | `2` | Downloads running at the same time |
| `DOWNLOAD_PLAYLIST_MAX` | `200` | Most entries taken from one playlist or channel link |
| `UPDATES` | on | `off` turns update checks and one-click updates from GitHub off |
| `UPDATE_REPO` / `UPDATE_BRANCH` | `Akulav/akulavbox` / `main` | Where Admin → Updates looks |
| `GITHUB_TOKEN` | | Only needed to update from a private fork |
| `DOWNLOAD_PROXY` | | Send link downloads through a proxy (`http://…` or `socks5://…`), for sites blocked where the server is |

The server refuses to start if `MASTER_KEY` or `JWT_SECRET` is missing or invalid, and warns you if they are still the example values.

Calls only need a TURN relay when they fail to connect peer-to-peer (strict NATs, privacy-hardened browsers such as Brave).

## Upgrading

The easy way: **Admin → Updates → Update**, then **Restart now**. AkulavBox downloads the new version from GitHub, installs dependencies if they changed, and can roll back. Restarting by itself needs a service manager (systemd, pm2, Docker…); otherwise start it again yourself.

By hand, upgrade in place. Your existing data keeps working:

1. Stop the server, update the code, and run `npm install`.
2. Start it. Pending database migrations run automatically, and **the database is snapshotted to `storage/backups/` first**.
3. Encrypted files on disk use the same format as 1.x and are never rewritten.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Data and backups

Everything lives in `storage/`:

```
storage/
  akulavbox.db (+ -wal, -shm)   SQLite database
  users/<id>/<file>.enc         encrypted files (.plain while shared publicly)
  thumbs/                       encrypted thumbnail cache (safe to delete)
  temp/                         unfinished uploads (cleared after 24 h)
  chat_temp/                    chat files (deleted after 10 minutes)
  private/cookies/              users' saved sign-in cookies for downloads (encrypted)
  tools/                        yt-dlp and ffmpeg, installed automatically (safe to delete)
  backups/                      database snapshots taken before upgrades, and data replaced by a restore
```

**Full backups:** Admin → Backup and restore downloads one `.akbx` file with everything, protected by a passphrase you choose. It carries the encryption key inside, so it restores on any AkulavBox server. Restore it from the same panel; it is checked first and swapped in at the next restart. From the command line:

```bash
AKB_PASSPHRASE='your passphrase' node scripts/backup.js export backup.akbx
AKB_PASSPHRASE='your passphrase' node scripts/backup.js import backup.akbx   # applied on the next start
node scripts/backup.js check --fix                                           # the storage check
```

You can also stop the server and copy `storage/` **together with your `MASTER_KEY`**. Files can't be decrypted without the key.

**Age-restricted downloads:** each person can save their browser's sign-in cookies in Profile → Link downloads (export them with an extension such as "Get cookies.txt LOCALLY").

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the server, storage, encryption, and frontend fit together
- [docs/API.md](docs/API.md): HTTP and Socket.IO reference
- [CLAUDE.md](CLAUDE.md): conventions for working on the code
- [CHANGELOG.md](CHANGELOG.md): release notes

## Tech stack

- **Backend:** [Fastify](https://fastify.dev/) 4, Socket.IO, the built-in `node:sqlite`, JWT, bcrypt, archiver, and sharp
- **Frontend:** Vue 3 and Tailwind from CDNs, written as plain ES modules in `frontend/` with no build step

## License

Source-available. See [LICENSE](LICENSE). © 2026 Akulav.
