# AkulavBox

A self-hosted personal cloud: file storage, photo albums, music, videos, books, and chat with voice/video calls — all in one Node.js server with a no-build browser frontend.

## Features

- **File manager** — folders, chunked uploads (up to 50 GB per file), public share links, zip downloads
- **Encryption at rest** — files are stored AES-256-CTR encrypted on disk
- **Photos** — collections and albums, server-side thumbnails via `sharp` (falls back to browser-made thumbnails)
- **Music** — library, playlists, favorites, custom artwork
- **Videos & Books** — media library with covers and a built-in EPUB reader
- **Chat & calls** — real-time messaging over Socket.IO, WebRTC voice/video with optional TURN relay
- **Multi-user** — per-user storage quotas and an admin panel

## Tech stack

- **Backend:** [Fastify](https://fastify.dev/), Socket.IO, built-in `node:sqlite`, JWT auth, bcrypt
- **Frontend:** plain ES modules served statically from `frontend/` (no build step)

## Requirements

- Node.js **22.13+** (for `node:sqlite` without flags)

## Getting started

```bash
npm install
cp .env.example .env   # then edit JWT_SECRET and MASTER_KEY
npm start
```

Open http://localhost:3000.

On first start a default admin account is created — **username `admin`, password `admin`**. Change the password right after logging in.

## Configuration

All settings live in `.env` (see [.env.example](.env.example)):

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | HTTP port (default `3000`) |
| `JWT_SECRET` | yes | Secret for signing login tokens |
| `MASTER_KEY` | yes | File encryption key — **exactly 32 characters**. Losing or changing it makes stored files unreadable |
| `LOG_LEVEL` | no | Fastify log level (default `warn`) |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | no | Static TURN relay for calls |
| `TURN_SECRET` | no | coturn `static-auth-secret` (short-lived credentials instead of static ones) |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | no | Cloudflare Realtime TURN |
| `STUN_URLS` | no | Override default STUN servers |

A TURN relay is only needed when calls fail to connect peer-to-peer (strict NATs, privacy-hardened browsers).

## Project structure

```
src/
  server.js        Fastify entry point
  core/            database, auth, thumbnails, MIME and library helpers
  modules/         API routes: auth, admin, files, albums, music, library, chat
frontend/
  index.html       SPA shell
  pages/           app screens (files, media, music, albums, chat, profile, admin)
  components/      shared UI
  lib/             API client, uploads, player, realtime
storage/           runtime data (created automatically, git-ignored)
```

## Data & backups

Everything lives in `storage/`: the SQLite database (`akulavbox.db`), each user's encrypted files, and the thumbnail cache. To back up, stop the server and copy `storage/` **together with your `MASTER_KEY`** — the files can't be decrypted without it.
