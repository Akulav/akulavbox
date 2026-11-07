# CLAUDE.md

Notes for working on AkulavBox, a self-hosted personal cloud made by Akulav. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and [docs/API.md](docs/API.md) for endpoints.

## Run and verify

- `npm start`: the server on `PORT` (default 3000), using `./storage` and `.env`.
- `npm run check`: **run this after backend changes.** It boots a throwaway server (temporary `STORAGE_DIR`, random port, generated keys) and exercises the API end to end. It never touches `storage/`.
- `node scripts/check.js --db <copy-of-real.db>`: also verifies that migrations and read endpoints work against a copy of a real database. Never point it at the live file.
- For UI testing, start a separate instance: set `STORAGE_DIR` to a temp folder, set another `PORT`, and use test values for `MASTER_KEY` (32 characters) and `JWT_SECRET`. A fresh instance signs in as `admin` / `admin`.
- `node scripts/icons.js` regenerates the PNG and ICO icons from `frontend/favicon.svg` (needs `sharp`).
- ES modules in the browser are cached per page load. After editing the frontend, reload the page, not only the hash.
- The `node_modules` in this checkout may hold Linux native builds. `bcrypt` falls back to `bcryptjs` automatically. Don't run `npm rebuild` or reinstall native modules unless asked.

## Hard rules

- **Never touch the user's `storage/` folder or `.env` secrets** except when the user asks. Work on copies.
- **Schema changes go through `src/core/migrations.js` only**: append a new step and make it idempotent (`addColumn`, `IF NOT EXISTS`). Never edit a released step or add `ALTER TABLE` calls in modules.
- **The on-disk file format is frozen**: AES-256-CTR with `MASTER_KEY` and `files.iv_hex`, `.enc` when private, `.plain` when shared. Old files must keep decrypting.
- **Every query that lists files or folders must filter `trashed_at IS NULL`** (alias it, e.g. `f.trashed_at`). Permanent deletion only goes through `purgeFile()` in `src/core/storage.js`.
- Use `verifyUser` / `verifyAdmin` from `src/core/auth.js` on every private route, and always scope queries with `owner_id = request.user.id`.
- Bump `version` in `package.json` and add a `CHANGELOG.md` entry for anything user-facing (semver: breaking → major, feature → minor, fix → patch). Run `npm install --package-lock-only --ignore-scripts` so the lockfile matches.
- **Auto-commit:** when a change is finished and verified, describe it in `CHANGELOG.md` and run `npm run commit`. It stages everything, builds the commit message from the new changelog lines, and tags `v<version>` when the version changed. Preview with `npm run commit -- --dry-run`. Don't push unless the user asks (`--push`). git may only exist inside GitHub Desktop; the script finds it.

## Code conventions

- Backend: CommonJS, Fastify plugins in `src/modules/` (one area each), and shared logic in `src/core/`. `node:sqlite` is synchronous, so use `db.tx(fn)` for multi-statement writes and prepare statements outside loops.
- Validate input at the route: trim and cap strings (`cleanName`, `cleanTitle`), check ownership, and return `{ error }` with 400 or 404. Errors are written as user-facing sentences.
- Frontend: no build step. Vue 3 Options/Composition hybrid with string templates (`/*html*/`) and Tailwind classes using the theme tokens (`bg-surface`, `text-muted`, `text-accent`, …) defined as CSS variables in `index.html`. Add icons to `components/Icon.js` (Lucide paths).
- New frontend modules need a `<link rel="modulepreload">` in `index.html`. The import map must stay **above** all module preloads.
- Use `api()` from `lib/api.js` for requests, `attempt()` / `toast` / `confirmDialog` / `promptDialog` from `lib/ui.js` for feedback, and `moveToTrash()` from `lib/trash.js` for deletes (it shows Undo, so skip the confirmation).
- Motion: use the existing classes (`stagger`, `rise`, `lift`, `zoom-media`, `pop`/`fade`/`page` transitions). Anything continuous must stop under `html[data-motion="off"]` and `prefers-reduced-motion`.
- Comments explain *why*, briefly, in the style already in the file.
- Branding: the product name is **AkulavBox** (one word, capital A and B). The credit is "Made by Akulav" (`MadeBy` in `components/Brand.js`).
