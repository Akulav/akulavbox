// The apps that share one AkulavBox account: one list for the whole server (the launcher, the sign-in
// page, the Admin console, access and storage in core/apps.js, full backups in core/backup-format.js,
// the AI connector). No dependencies, so modules that load before the database (backups, restore) can
// use it too.
// Adding an app: an entry here, its plugin in apps/index.js, its icon in hub/common.js.
//
// AkulavBox is the account and the server, like a Google account: each app has a name of its own.
// The ids and paths never change (data folders, backups and links depend on them); names may.
//   quota: the app keeps files, which count towards the account's storage (one space for every app)

const APPS = [
  { id: 'box', name: 'Trove', path: '/box/', short: 'Files, photos, music, videos and books', tagline: 'Files, photos, music, videos and books, encrypted on your server.', color: '#E8A33D', core: true, quota: true },
  { id: 'documents', name: 'e-Management', path: '/docs/', short: 'Personal and work documents', tagline: 'Personal and work documents with categories, tags and attachments.', color: '#3b82f6', quota: true },
  { id: 'manga', name: 'Koma Shelf', path: '/manga/', short: 'Webtoons made with Koma', tagline: 'Webtoons made with Koma: a private library and a public shelf.', color: '#f03862', quota: true },
  { id: 'budget', name: 'Florin', path: '/budget/', short: 'Expenses, budgets and charts', tagline: 'Expenses and income in any currency, with budgets and charts.', color: '#1baf7a', quota: false },
  { id: 'tasks', name: 'Tick', path: '/tasks/', short: 'To-dos, a board and a calendar', tagline: 'To-dos with lists, due dates, repeats, a board and a calendar.', color: '#8b5cf6', quota: false },
  // a game (github.com/Akulav/strategy-game, built to WebAssembly): its saves are files of the account
  { id: 'ironveil', name: 'Ironveil', path: '/ironveil/', short: 'Automation and tower-defense game', tagline: 'Mine, build supply lines and factories, and hold off the swarm. Your progress is saved to your account.', color: '#f0732e', quota: true },
];

/** The apps with a data folder of their own, DATA_DIR/<id> (every one but Trove) */
const APP_IDS = APPS.filter((a) => !a.core).map((a) => a.id);

module.exports = { APPS, APP_IDS };
