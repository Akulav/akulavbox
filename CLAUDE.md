# CLAUDE.md

Notes for working on AkulavBox, a self-hosted personal cloud made by Akulav. AkulavBox is the account and the server (like a Google account); its apps have names of their own: Trove (files, the core: `apps/trove`, page at `/box/`, API at `/api/…`, data in `box/` with its own `box/trove.db`), e-Management (`apps/documents`, `/docs`), Florin (`apps/budget`, `/budget`), Tick (`apps/tasks`, `/tasks`) and the game Ironveil (`apps/ironveil`, `/ironveil`: the WebAssembly build of `../strategy-game`, copied by `npm run ironveil`; never edit `public/game/` by hand), plus the sign-in page, launcher, Admin console and AI connectors (`hub/`). Names live in `src/core/app-list.js`; ids and paths never change. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and [docs/API.md](docs/API.md) for endpoints.

## Run and verify

- `npm start`: the server on `PORT` (default 3000), using `./data` (or an older `./storage`) and `.env`.
- `npm test`: unit tests (`test/*.test.js`, `node:test`), no server.
- `npm run check`: **run this after backend changes.** It boots a throwaway server (temporary `STORAGE_DIR`, random port, generated keys) and exercises the API end to end. It never touches `data/`.
- `npm run check` tests link downloads with `scripts/test/fake-yt-dlp.js` and `scripts/test/fake-ffmpeg.js`, stand-ins that answer like yt-dlp and ffmpeg/ffprobe with no network access (`AUTO_INSTALL_TOOLS=0`). It also restores a full backup into a second throwaway server with a different `MASTER_KEY`. Real downloads use the tools auto-installed into `data/tools/` (`apps/trove/lib/tools.js`). For a real test, use a throwaway `STORAGE_DIR`, which installs a fresh copy.
- `npm run lint`: fast static checks (every file parses, every frontend module has a modulepreload below the import map, Florin's build is present, one version in package.json / lockfile / CHANGELOG). CI (`.github/workflows/ci.yml`) runs lint, then `npm test` and `npm run check` on Linux and Windows. The app checks are in `scripts/test/apps-check.js`.
- Florin's page (`apps/budget/public/`) is Vue 3 with string templates, like AkulavBox, and Tailwind v4 (theme tokens in the `<style type="text/tailwindcss">` of its `index.html`; Trove and Tick work the same way). The server compiles the classes it finds in the app's files into one versioned stylesheet that replaces that block (`src/core/tailwind.js`, `assets.js`): a class built at run time from pieces (`'bg-' + x`) is never compiled, so write class names whole. Vue is served from `node_modules` at `/hub/vendor/`; and they share `hub/vue/` and `src/core/vue-app.js`. No build step; new modules need a modulepreload in its `index.html` (lint checks). Its CSP allows the import map by hash, computed at startup: keep it the only inline script.
- `node scripts/check.js --db <copy-of-real.db>`: also verifies that migrations and read endpoints work against a copy of a real database. Never point it at the live file.
- For UI testing, start a separate instance: set `STORAGE_DIR` to a temp folder, set another `PORT`, and use test values for `MASTER_KEY` (32 characters) and `JWT_SECRET`. A fresh instance signs in as `admin` / `admin`.
- `node scripts/icons.js` regenerates the PNG and ICO icons from `hub/brand/favicon.svg` (needs `sharp`).
- ES modules in the browser are cached per page load. After editing the frontend, reload the page, not only the hash.
- The `node_modules` in this checkout may hold Linux native builds. `bcrypt` falls back to `bcryptjs` automatically. Don't run `npm rebuild` or reinstall native modules unless asked.

## Hard rules

- **Never touch the user's `data/` (or older `storage/`) folder or `.env` secrets** except when the user asks. Work on copies. A live instance upgrades in place: anything that changes the data layout must migrate on start (see `src/core/layout.js` moving folders into `box/`) and keep old backups restorable.
- **Trove's tables live in `box/trove.db`**, attached to the one connection as the schema `trove` (`apps/trove/db.js`): query them without a schema; a new Trove table in a migration is `CREATE TABLE IF NOT EXISTS trove.<name>`. Its storage counter is `trove.usage` (`store.addUsage`/`usedBy`), not `users.used_bytes`. Full backups fold its tables back into the `akulavbox.db` snapshot (`mergeForBackup`), so a restore moves them out again on start.
- **Schema changes go through `src/core/migrations.js` only** (the apps: the step list in their `db.js`): append a new step and make it idempotent (`addColumn`, `IF NOT EXISTS`). Never edit a released step or add `ALTER TABLE` calls in modules. Steps run through `runSteps` in `src/core/sqlite.js`, which also has `tx` and `addColumn`.
- **The on-disk file format is frozen**: AES-256-CTR with `MASTER_KEY` and `files.iv_hex`, `.enc` when private, `.plain` when shared. Old files must keep decrypting.
- **Storage is one space per account** (`apps.room(user, app)` before storing anything; announce `storage.changed` on the bus after an app stores or removes files).
- **Apps talk through the bus** (`src/core/bus.js`: `bus.emit('storage.changed', { userId, app })` after storing or removing files; see "How the apps talk to each other" in ARCHITECTURE.md) and, in the browser, `window.akbBus` (one BroadcastChannel): post `storage`/`account`/`signed-out` when that happens in a page.
- **Page assets are versioned** (`src/core/assets.js`): send pages with `assets.sendPage` (or `assets.page` for the Vue apps), never as raw files, and import absolute paths that exist (`'/docs/js/x.js'`) or relative ones, so the revision reaches them.
- **The AI connector** (`src/core/connector/`, `src/modules/connector.js`): a new feature of an app usually wants a tool in `apps/<app>/connector.js` (`write: true` if it changes data, `destructive: true` if it deletes). Tools call the app's own routes through `ctx.call`; `scripts/test/connector-check.js` covers them.
- **New per-user data must be covered by delete-user and by full backups.** AkulavBox: `admin.js` and `core/backup-format.js` `listData`. The apps: their `deleteUser` hook (`apps.register`), and keep their data inside `DATA_DIR/<app>/` (backed up as a whole; SQLite files are snapshotted).
- **Every query that lists files or folders must filter `trashed_at IS NULL`** (alias it, e.g. `f.trashed_at`). Permanent deletion only goes through `purgeFile()` in `apps/trove/lib/storage.js`.
- Use `verifyUser` / `verifyAdmin` from `src/core/auth.js` on every private AkulavBox route, and always scope queries with `owner_id = request.user.id`. **AkulavBox's API never reads the `akb_session` cookie.** The apps sign in with `session.userOf(request, reply)` (`src/core/session.js`), check `apps.access(userId, app).enabled`, and need their own CSRF defence (same-origin check, form token, or custom header).
- Bump `version` in `package.json` and add a `CHANGELOG.md` entry for anything user-facing (semver: breaking → major, feature → minor, fix → patch). Run `npm install --package-lock-only --ignore-scripts` so the lockfile matches.
- **Auto-commit:** when a change is finished and verified, describe it in `CHANGELOG.md` and run `npm run commit`. It stages everything, builds the commit message from the new changelog lines, and tags `v<version>` when the version changed. Preview with `npm run commit -- --dry-run`. Don't push unless the user asks (`--push`). git may only exist inside GitHub Desktop; the script finds it.

## Code conventions

- The apps' UI text stays as it was: e-Management in Romanian, the others in English.
- **One look for every app** (docs/ARCHITECTURE.md, "One look for every app"): AkulavBox's neutrals and fonts (Geist, Bricolage Grotesque), each app's own accent. Every page loads `/hub/theme.js` in its `<head>` (the shared `akulavTheme`; never a theme key of its own) and uses `<akb-account>` from `/hub/account.js` for the account menu (app links go inside it as children). Vue pages declare it a custom element (`compilerOptions.isCustomElement`).
- An app's data folder is `config.appDataDir(id)`.

- Backend: CommonJS everywhere, one Fastify server. The account and server in `src/modules/` (one area each) and `src/core/`; each app is a plugin in `apps/<app>/index.js` (Trove: `routes/`, `lib/`, `public/`; the others: `src/routes/` or `server/`). Hub pages load their scripts from `/hub/~<revision>/…` (`src/modules/hub.js`): keep hub imports relative (`./common.js`). Keep files small: split by area when one grows past a few hundred lines. `node:sqlite` is synchronous, so use `db.tx(fn)` for multi-statement writes and prepare statements outside loops.
- Validate input at the route: trim and cap strings (`cleanName`, `cleanTitle`), check ownership, and return `{ error }` with 400 or 404. Errors are written as user-facing sentences.
- Frontend: no build step. Vue 3 Options/Composition hybrid with string templates (`/*html*/`) and Tailwind classes using the theme tokens (`bg-surface`, `text-muted`, `text-accent`, …) defined as CSS variables in `index.html`. Add icons to `components/Icon.js` (Lucide paths).
- New frontend modules need a `<link rel="modulepreload">` in `index.html`. The import map must stay **above** all module preloads.
- Use `api()` from `lib/api.js` for requests, `attempt()` / `toast` / `confirmDialog` / `promptDialog` from `lib/ui.js` for feedback, and `moveToTrash()` from `lib/trash.js` for deletes (it shows Undo, so skip the confirmation).
- Motion: use the existing classes (`stagger`, `rise`, `lift`, `zoom-media`, `pop`/`fade`/`page` transitions). Anything continuous must stop under `html[data-motion="off"]` and `prefers-reduced-motion`.
- Comments explain *why*, briefly, in the style already in the file.
- Branding: the product name is **AkulavBox** (one word, capital A and B). The credit is "Made by Akulav" (`MadeBy` in `components/Brand.js`).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. It is local only (`graphify-out/` is git-ignored).

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost). If graphify-out/ is missing, rebuild it the same way.