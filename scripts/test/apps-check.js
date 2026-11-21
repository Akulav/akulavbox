// The apps around AkulavBox in `npm run check`: one sign-in (the shared cookie), the launcher,
// the Admin console, and e-Management and Florin each storing in their own folder.
// Called from scripts/check.js with its helpers; it runs against the same throwaway server.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cookieFrom = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('akb_session='));

module.exports = async function appsCheck({ api, ok, base, tmp, login, adminToken }) {
  const B = base();
  const get = (p, { cookie, headers = {}, redirect = 'manual', method = 'GET', body } = {}) =>
    fetch(B + p, { method, redirect, body, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const json = async (r) => { try { return await r.json(); } catch (e) { return null; } };

  console.log('\nOne sign-in for every app');
  const setCookie = (login.headers.getSetCookie?.() || []).find((c) => c.startsWith('akb_session=')) || '';
  ok(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie) && /Path=\//.test(setCookie), 'signing in also sets the shared HttpOnly cookie', setCookie);
  const jar = cookieFrom(login);

  for (const [p, what] of [['/', 'the app launcher'], ['/login', 'the sign-in page'], ['/admin', 'the Admin console page'], ['/connect', 'the AI connectors page'], ['/box/', 'Trove at /box/']]) {
    const r = await get(p);
    ok(r.status === 200 && /text\/html/.test(r.headers.get('content-type') || ''), `serves ${what}`, String(r.status));
  }
  // password managers (Bitwarden) and browsers look for these on the site's root
  const icons = [['/favicon.ico', /icon/], ['/favicon-32x32.png', /png/], ['/apple-touch-icon.png', /png/], ['/apple-touch-icon-precomposed.png', /png/], ['/icon-192.png', /png/], ['/favicon.svg', /svg/], ['/trove.ico', /icon/], ['/tasks/favicon.ico', /icon/]];
  const badIcons = [];
  for (const [p, type] of icons) { const r = await get(p); if (r.status !== 200 || !type.test(r.headers.get('content-type') || '')) badIcons.push(`${p} ${r.status}`); }
  ok(!badIcons.length, 'the site’s icons are served as images (Bitwarden finds them)', badIcons.join(', '));
  const rootHtml = await (await get('/')).text();
  ok(/<link rel="icon" href="\/favicon\.ico"/.test(rootHtml) && /apple-touch-icon/.test(rootHtml), 'the launcher links its PNG and ICO icons');
  // the hub's modules come from a versioned path, so a phone never mixes an old cached module with a new one
  const homeJs = /src="(\/hub\/~[\w-]+\/home\.js)"/.exec(rootHtml)?.[1];
  const homeRes = homeJs && await get(homeJs);
  ok(homeRes?.status === 200 && /immutable/.test(homeRes.headers.get('cache-control') || '') && /\/hub\/~[\w-]+\/hub\.css/.test(rootHtml), 'the launcher’s scripts and styles carry a revision and are cached for good', homeJs);
  ok((await get('/hub/~nope/../../package.json')).status === 404 && (await get('/hub/home.js')).status === 200, 'the versioned path can’t leave hub/, and the plain one still works');
  // every app's page is versioned the same way, and so are the absolute imports inside its scripts
  const trovePage = await (await get('/box/')).text();
  const troveApp = /src="(\/box\/~[\w-]+\/app\.js)"/.exec(trovePage)?.[1];
  const troveJs = troveApp && await get(troveApp, { headers: { 'Accept-Encoding': 'gzip' } });
  ok(troveJs?.status === 200 && /immutable/.test(troveJs.headers.get('cache-control') || '') && /"vue": "\/hub\/vendor\/~[\w-]+\/vue\.js"/.test(trovePage), 'Trove’s page: its modules and Vue versioned and cached for good', troveApp);
  const docsHtml = await (await get('/docs/', { cookie: jar })).text();
  const docsApp = /src="(\/docs\/~[\w-]+\/app\.js)"/.exec(docsHtml)?.[1];
  const docsJs = docsApp && await (await get(docsApp)).text();
  ok(docsJs && /from '\/docs\/~[\w-]+\/js\/state\.js'/.test(docsJs) && /from '\/hub\/vendor\/~[\w-]+\/vue\.js'/.test(docsJs), 'imports inside a script carry the revision too (e-Management)', docsApp);
  ok((await get(docsApp.replace(/~[\w-]+/, '~old'))).headers.get('cache-control') === 'no-cache', 'an old revision still gets the current file, uncached');
  ok((await get('/box/~x/../../.env')).status === 404 && (await get('/docs/~x/js/../../index.js')).status === 404, 'versioned paths stay inside their folders');
  // Trove's tables live in their own database (5.1)
  const { DatabaseSync: DS } = require('node:sqlite');
  const mainDb = new DS(path.join(tmp, 'akulavbox.db'), { readOnly: true });
  const inMain = mainDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('files', 'folders', 'albums', 'media_meta')").get().n;
  mainDb.close();
  ok(inMain === 0 && fs.existsSync(path.join(tmp, 'box', 'trove.db')), 'Trove keeps its tables in box/trove.db, not in akulavbox.db');
  const cat = await json(await get('/api/apps/catalog'));
  ok(cat?.name === 'AkulavBox' && cat.apps.map((a) => a.name).join() === 'Trove,e-Management,Florin,Tick,Ironveil', 'the sign-in page reads the app names from the server', JSON.stringify(cat?.apps?.map((a) => a.name)));
  const vz = await get('/hub/vendor/vue.js', { headers: { 'Accept-Encoding': 'gzip' } });
  ok(vz.status === 200 && vz.headers.get('etag') && (await get('/hub/vendor/vue.js', { headers: { 'If-None-Match': vz.headers.get('etag') } })).status === 304, 'Vue is served with an ETag (a reload costs a 304)');
  ok((await get('/box')).headers.get('location') === '/box/', '/box goes to /box/');
  ok((await get('/somewhere-else')).status === 404, 'unknown pages get a 404 page');
  const docsAnon = await get('/docs/');
  ok(docsAnon.status === 302 && docsAnon.headers.get('location') === '/login?next=%2Fdocs%2F', 'signed-out visitors are sent to the shared sign-in page', `${docsAnon.status} ${docsAnon.headers.get('location')}`);
  ok((await get('/api/directory', { cookie: jar })).status === 401, 'AkulavBox’s API doesn’t accept the cookie (no CSRF there)');

  // header token ↔ cookie
  const sync = await fetch(`${B}/api/session`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
  ok(sync.status === 200 && cookieFrom(sync), 'the launcher turns the stored token into the cookie (sessions from before 4.0 carry over)');
  const resume = await get('/api/session/resume', { cookie: jar, method: 'POST' });
  const resumed = await json(resume);
  ok(resume.status === 200 && resumed?.token && resumed.username === 'admin', 'a page with only the cookie gets its token back');
  ok((await get('/api/session/resume', { cookie: jar, method: 'POST', headers: { Origin: 'https://evil.example' } })).status === 403, 'other sites can’t exchange the cookie for a token');

  // the shared account menu (hub/account.js): who is signed in, and the AkulavBox profile picture
  ok((await get('/api/session/me')).status === 401, 'the account menu needs the cookie');
  const meBefore = await json(await get('/api/session/me', { cookie: jar }));
  ok(meBefore?.username === 'admin' && meBefore.role === 'admin' && meBefore.avatar === null, 'the account menu learns who is signed in (no picture yet)');
  ok((await get('/api/session/avatar', { cookie: jar })).status === 404, 'no picture: 404');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await api('/api/user/profile', { method: 'PATCH', body: { profile_image: `data:image/png;base64,${png.toString('base64')}` } });
  const meAfter = await json(await get('/api/session/me', { cookie: jar }));
  ok(/^\/api\/session\/avatar\?v=[0-9a-f]{12}$/.test(meAfter?.avatar || ''), 'with a profile picture, it gets a versioned URL', meAfter?.avatar);
  const pic = await get(meAfter.avatar, { cookie: jar });
  ok(pic.status === 200 && pic.headers.get('content-type') === 'image/png' && Buffer.from(await pic.arrayBuffer()).equals(png) && /immutable/.test(pic.headers.get('cache-control') || ''), 'every app shows the same picture (served as the image, cached until it changes)');
  ok((await get(meAfter.avatar)).status === 401, 'the picture needs the cookie too');
  await api('/api/user/profile', { method: 'PATCH', body: { profile_image: null } });
  ok((await json(await get('/api/session/me', { cookie: jar })))?.avatar === null, 'removing the picture removes it everywhere');
  for (const page of ['/hub/account.js', '/hub/account.css', '/hub/theme.js']) ok((await get(page)).status === 200, `serves ${page}`);
  const apps = await api('/api/apps');
  const expected = ['box', 'documents', 'budget', 'tasks', 'ironveil'];
  ok(apps.status === 200 && apps.data.apps.length === 5 && expected.every((id) => apps.data.apps.some((a) => a.id === id && a.available)), 'the launcher lists all five apps, every one running', JSON.stringify(apps.data?.apps?.map((a) => [a.id, a.available, a.problem])));
  // Koma Shelf was removed in 6.0: its address is gone
  ok((await get('/manga/', { cookie: jar })).status === 404, 'Koma Shelf is gone (/manga/ is a 404)');

  // --- e-Management ---
  console.log('\ne-Management (/docs)');
  const me = await get('/docs/api/me', { cookie: jar });
  const meData = await json(me);
  ok(me.status === 200 && meData?.username === 'admin' && meData.stores.length === 2, 'signed in through the shared cookie, with a personal and a work space');
  const cats = await json(await get('/docs/api/s/personal/categories', { cookie: jar }));
  ok(Array.isArray(cats) && cats.length > 0, 'a new account starts with the default categories');
  const docBytes = crypto.randomBytes(5000);
  const fd = new FormData();
  fd.append('data', JSON.stringify({ title: 'Check document', doc_date: '2026-01-15', tagIds: [cats[0].tags[0]?.id].filter(Boolean) }));
  fd.append('files', new Blob([docBytes]), 'scan.pdf');
  const made = await fetch(`${B}/docs/api/s/personal/documents`, { method: 'POST', body: fd, headers: { Cookie: jar } });
  const madeData = await json(made);
  ok(made.status === 200 && madeData?.id, 'add a document with a file', JSON.stringify(madeData));
  const userDocs = path.join(tmp, 'documents', 'admin-uuid-0000');
  const stored = fs.existsSync(path.join(userDocs, 'personal', 'uploads')) ? fs.readdirSync(path.join(userDocs, 'personal', 'uploads')) : [];
  ok(stored.length === 1 && fs.existsSync(path.join(userDocs, 'personal', 'ansc.db')) && fs.existsSync(path.join(userDocs, 'work', 'ansc.db')), 'its files live in documents/<account>/ of the data folder');
  const list = await json(await get('/docs/api/s/personal/documents', { cookie: jar }));
  const fileId = list?.[0]?.files?.[0]?.id;
  const dl = await get(`/docs/api/s/personal/files/${fileId}`, { cookie: jar });
  ok(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(docBytes), 'the file downloads intact');
  ok((await get(`/docs/api/s/work/files/${fileId}`, { cookie: jar })).status === 404, 'a file of one space isn’t found in the other');
  ok((await get('/docs/api/s/personal/categories', { cookie: jar, method: 'POST', body: JSON.stringify({ name: 'X' }), headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } })).status === 403, 'cross-site changes are refused');
  const appsNow = await api('/api/apps');
  ok(appsNow.data.apps.find((a) => a.id === 'documents')?.used_bytes === docBytes.length, 'the launcher shows what e-Management stores');

  // --- Florin ---
  console.log('\nFlorin (/budget)');
  const fme = await get('/budget/api/auth/me', { cookie: jar });
  const fmeData = await json(fme);
  ok(fme.status === 200 && fmeData?.user?.username === 'admin' && fmeData.user.role === 'admin', 'signed in through the shared cookie, admin role from AkulavBox');
  const fcats = await json(await get('/budget/api/categories', { cookie: jar }));
  ok(fcats?.categories?.length > 0, 'a new account starts with the default categories');
  const txBody = JSON.stringify({ kind: 'expense', amount: 12.5, currency: 'EUR', date: '2026-01-15', categoryId: fcats.categories.find((c) => c.kind === 'expense')?.id, payee: 'Check' });
  ok((await get('/budget/api/transactions', { cookie: jar, method: 'POST', body: txBody, headers: { 'Content-Type': 'application/json' } })).status === 403, 'changes without the CSRF header are refused');
  const tx = await get('/budget/api/transactions', { cookie: jar, method: 'POST', body: txBody, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'florin' } });
  ok(tx.status === 201 || tx.status === 200, 'add a transaction', `${tx.status} ${JSON.stringify(await json(tx))}`);
  ok(fs.existsSync(path.join(tmp, 'budget', 'florin.db')), 'its database lives in budget/ of the data folder');
  const fjson = { cookie: jar, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'florin' } };
  const setBudget = (v) => get('/budget/api/auth/me', { ...fjson, method: 'PATCH', body: JSON.stringify({ monthlyBudget: v }) });
  const overview = async () => {
    const r = await get('/budget/api/stats/overview', { cookie: jar });
    const body = await json(r);
    if (!body?.totals) throw new Error(`Florin's overview answered ${r.status}: ${JSON.stringify(body)}`);
    return body.totals;
  };
  const sumOfCategories = (await overview()).categoryBudgets;
  ok((await json(await setBudget(1234.5))).user.monthlyBudget === 1234.5 && (await overview()).budget === 1234.5, 'an overall monthly budget replaces the sum of the categories');
  ok((await setBudget(-5)).status === 400, 'a negative monthly budget is refused');
  await setBudget('');
  ok((await overview()).budget === sumOfCategories, 'clearing it goes back to the sum of the category budgets');
  const page = await get('/budget/', { cookie: jar });
  const pageText = await page.text();
  ok(page.status === 200 && /src="\/budget\/~[\w-]+\/app\.js"/.test(pageText), 'serves the page under /budget/');
  ok((await get('/budget/')).status === 302, 'signed-out visitors go to the sign-in page');
  const deep = await get('/budget/settings', { cookie: jar });
  ok(deep.status === 200 && /src="\/budget\/~[\w-]+\/app\.js"/.test(await deep.text()), 'a deep link (/budget/settings) opens the page');
  // every module, script and stylesheet the page links is served
  const linked = [...pageText.matchAll(/(?:src|href)="(\/budget\/[^"]+)"/g)].map((m) => m[1]);
  const missing = [];
  for (const u of linked) if ((await get(u, { cookie: jar })).status !== 200) missing.push(u);
  ok(linked.length > 10 && !missing.length, `the page's ${linked.length} files are served (Vue and Tailwind from this server)`, missing.join(', '));
  // Tailwind is compiled on the server: the page links a stylesheet instead of the browser build
  const twUrl = pageText.match(/href="(\/budget\/~[\w-]+\/tailwind\.css)"/)?.[1];
  ok(twUrl && !/tailwind\.js|text\/tailwindcss/.test(pageText), 'the page links compiled Tailwind instead of compiling it in the browser');
  const tw = twUrl ? await get(twUrl) : null;
  const twText = tw ? await tw.text() : '';
  ok(tw?.status === 200 && /immutable/.test(tw.headers.get('cache-control') || '') && /\.bg-surface\b/.test(twText) && /\.lg\\:hidden/.test(twText),
    `the compiled stylesheet has the page's classes and is cached for good (${Math.round(twText.length / 1024)} KB)`);
  const troveHtml = await (await get('/box/')).text();
  const troveTw = troveHtml.match(/href="(\/box\/~[\w-]+\/tailwind\.css)"/)?.[1];
  ok(troveTw && !/cdn\.tailwindcss\.com|cropper\.min\.js/.test(troveHtml) && (await get(troveTw)).status === 200, 'Trove loads its styles from this server, no blocking scripts from CDNs');
  const vueRes = await get('/hub/vendor/vue.js');
  ok(/javascript/.test(vueRes.headers.get('content-type') || ''), 'Vue is served as JavaScript');
  ok((await get('/budget/index.html')).status !== 200, 'index.html is not served past the sign-in check');
  ok((await get('/budget/api/nope', { cookie: jar })).status === 404, 'unknown API paths are a JSON 404');

  // --- Tasks ---
  console.log('\nTasks (/tasks)');
  const T = (p, { method = 'GET', body, cookie = jar, csrf = true } = {}) =>
    get(`/tasks/api${p}`, { cookie, method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-Requested-With': 'tasks' } : {}) } });
  const boot = await json(await T('/bootstrap'));
  ok(boot?.user?.username === 'admin' && Array.isArray(boot.tasks) && boot.prefs?.weekStart === 1, 'signed in through the shared cookie; it starts empty, with default preferences');
  ok((await T('/tasks', { method: 'POST', body: { title: 'x' }, csrf: false })).status === 403, 'changes without the CSRF header are refused');
  ok((await T('/tasks', { method: 'POST', body: { title: '   ' } })).status === 400, 'a task needs a title');
  const tlist = (await json(await T('/lists', { method: 'POST', body: { name: 'Check list', color: '#3b82f6', icon: 'briefcase' } })))?.list;
  ok(tlist?.id && tlist.name === 'Check list', 'make a list');
  ok((await T('/lists', { method: 'POST', body: { name: 'Bad', color: 'red' } })).status === 400, 'a list colour must be #rrggbb');
  const tnew = await T('/tasks', { method: 'POST', body: { title: 'Check task', listId: tlist.id, dueDate: '2026-11-20', dueTime: '09:30', priority: 3, tags: ['#Work', 'work', 'home'], checklist: [{ text: 'one' }, { text: 'two', done: true }], repeat: { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] } } });
  const ttask = (await json(tnew))?.task;
  ok(tnew.status === 201 && ttask.tags.join() === 'home,Work' && ttask.checklist.length === 2 && ttask.checklist[1].done && ttask.repeat.weekdays.length === 5, 'add a task with tags (no duplicates), a checklist and a repeat', JSON.stringify(ttask));
  ok(fs.existsSync(path.join(tmp, 'tasks', 'tasks.db')), 'its database lives in tasks/ of the data folder');
  ok((await T('/tasks', { method: 'POST', body: { title: 'x', listId: 999999 } })).status === 400, 'a task can’t go into a list that doesn’t exist');
  ok((await T('/tasks', { method: 'POST', body: { title: 'x', dueDate: '2026-13-40' } })).status === 400, 'a wrong date is refused');
  // ticking a repeating task makes the next one (Friday → Monday for weekdays), Undo takes it back
  const tdone = await json(await T(`/tasks/${ttask.id}`, { method: 'PATCH', body: { status: 'done', today: '2026-11-20' } }));
  ok(tdone?.task?.status === 'done' && tdone.task.completedAt && tdone.next?.dueDate === '2026-11-23' && tdone.next.status === 'todo' && tdone.next.checklist.every((i) => !i.done) && tdone.next.tags.length === 2, 'ticking a repeating task makes the next one, with its checklist unticked', JSON.stringify(tdone?.next));
  const tundo = await json(await T(`/tasks/${ttask.id}`, { method: 'PATCH', body: { status: 'todo', undoNext: tdone.next.id } }));
  const openNow = (await json(await T('/tasks'))).tasks;
  ok(tundo?.task?.status === 'todo' && !tundo.task.completedAt && !openNow.some((t) => t.id === tdone.next.id), 'Undo reopens it and takes the next one back');
  const second = (await json(await T('/tasks', { method: 'POST', body: { title: 'Second', listId: tlist.id } }))).task;
  await T('/tasks/reorder', { method: 'POST', body: { ids: [ttask.id, second.id] } });
  const order = (await json(await T('/tasks'))).tasks.filter((t) => t.listId === tlist.id).sort((a, b) => a.position - b.position).map((t) => t.id);
  ok(order.join() === `${ttask.id},${second.id}`, 'tasks keep the order they were dragged into');
  ok((await json(await T(`/tags/${encodeURIComponent('home')}`, { method: 'PATCH', body: { name: 'house' } })))?.changed === 1 && (await json(await T(`/tasks/${ttask.id}`))).task.tags.includes('house'), 'rename a tag on every task');
  ok((await json(await T('/prefs', { method: 'PATCH', body: { weekStart: 0, sort: 'due' } }))).prefs.sort === 'due' && (await T('/prefs', { method: 'PATCH', body: { sort: 'nope' } })).status === 400, 'save preferences (and refuse unknown ones)');
  await T(`/lists/${tlist.id}`, { method: 'DELETE' });
  const afterDel = (await json(await T('/tasks'))).tasks;
  ok(afterDel.filter((t) => [ttask.id, second.id].includes(t.id)).every((t) => t.listId === null), 'deleting a list keeps its tasks, in the Inbox');
  const other = (await json(await T('/tasks', { method: 'POST', body: { title: 'Mine only' } }))).task;
  const tdoneList = await json(await T('/tasks/done'));
  ok(tdoneList?.total >= 0 && Array.isArray(tdoneList.items), 'done tasks are listed page by page');
  const tpage = await get('/tasks/', { cookie: jar });
  const tpageText = await tpage.text();
  ok(tpage.status === 200 && /src="\/tasks\/~[\w-]+\/app\.js"/.test(tpageText) && (await get('/tasks/list/5', { cookie: jar })).status === 200, 'serves the page, also for its deep links');
  const tlinked = [...tpageText.matchAll(/(?:src|href)="(\/(?:tasks|hub)\/[^"]+)"/g)].map((m) => m[1]);
  const tmissing = [];
  for (const u of tlinked) if ((await get(u, { cookie: jar })).status !== 200) tmissing.push(u);
  ok(tlinked.length > 20 && !tmissing.length, `the page's ${tlinked.length} files are served`, tmissing.join(', '));
  ok((await get('/tasks/')).status === 302, 'signed-out visitors go to the sign-in page');
  const tsummary = (await api('/api/apps')).data.apps.find((a) => a.id === 'tasks');
  ok(/open task/.test(tsummary?.summary || ''), 'the launcher says how many tasks are open', tsummary?.summary);

  // --- Ironveil ---
  console.log('\nIronveil (/ironveil)');
  ok((await get('/ironveil/')).headers.get('location')?.startsWith('/login'), 'signed-out visitors go to the sign-in page');
  const ivPage = await get('/ironveil/', { cookie: jar });
  const ivHtml = await ivPage.text();
  ok(ivPage.status === 200 && /'wasm-unsafe-eval'/.test(ivPage.headers.get('content-security-policy') || '') && /src="\/ironveil\/~[\w-]+\/game\/gl\.js"/.test(ivHtml), 'serves the game’s page (WebAssembly allowed, its scripts versioned)');
  const wasmRes = await get('/ironveil/game/ironveil.wasm', { cookie: jar, headers: { 'Accept-Encoding': 'gzip' } });
  const wasmOk = wasmRes.status === 200;
  ok(wasmOk ? /application\/wasm/.test(wasmRes.headers.get('content-type') || '') && wasmRes.headers.get('etag') : wasmRes.status === 404, wasmOk ? 'the game (WebAssembly) is served gzipped, with an ETag' : 'without a build, the game file is a clear 404 (npm run ironveil)');
  ok((await get('/ironveil/index.html', { cookie: jar })).status === 404, 'index.html is not served past the sign-in check');
  const IV = (p, { method = 'GET', body, cookie = jar, csrf = true } = {}) =>
    get(`/ironveil/api${p}`, { cookie, method, body, headers: { ...(body !== undefined ? { 'Content-Type': 'text/plain' } : {}), ...(csrf ? { 'X-Requested-With': 'ironveil' } : {}) } });
  ok((await json(await IV('/saves')))?.saves && Object.keys((await json(await IV('/saves'))).saves).length === 0, 'a new player has no saves');
  ok((await IV('/saves/profile', { method: 'PUT', body: '{}', csrf: false })).status === 403, 'saving without the CSRF header is refused');
  ok((await IV('/saves/..%2Fx', { method: 'PUT', body: '{}' })).status === 400 && (await IV('/saves/profile', { method: 'PUT', body: 'not json' })).status === 400, 'bad save names and non-JSON saves are refused');
  const prof = JSON.stringify({ unlocked: ['first_blood'], shards: 12, legacy: [1], best_wave: 7, total_kills: 300, runs: 2, total_time: 5400 });
  ok((await IV('/saves/profile', { method: 'PUT', body: prof })).status === 200 && (await IV('/saves/run', { method: 'PUT', body: '{"seed":1}' })).status === 200, 'save the profile and a run');
  const ivSaves = await json(await IV('/saves'));
  ok(ivSaves?.saves?.profile === prof && ivSaves.saves.run === '{"seed":1}' && fs.existsSync(path.join(tmp, 'ironveil')), 'they come back as they were, from ironveil/ in the data folder');
  const ivProf = await json(await IV('/profile'));
  ok(ivProf?.best_wave === 7 && ivProf.runs === 2 && ivProf.play_time_hours === 1.5 && ivProf.run_in_progress === true, 'the progress, in plain words (for the AI connector)', JSON.stringify(ivProf));
  ok((await IV('/saves/run', { method: 'DELETE' })).status === 200 && !(await json(await IV('/saves'))).saves.run, 'a finished run’s save is removed');
  const ivUsed = (await api('/api/apps')).data.space?.apps?.find((a) => a.id === 'ironveil')?.bytes;
  ok(ivUsed === Buffer.byteLength(prof), 'the saves count in the account’s storage', String(ivUsed));
  ok(/Best wave 7/.test((await api('/api/apps')).data.apps.find((a) => a.id === 'ironveil')?.summary || ''), 'the launcher shows the best wave');

  // --- Admin console ---
  console.log('\nAdmin console');
  const iconCheck = await api('/api/admin/site-icon');
  ok(iconCheck.status === 200 && Array.isArray(iconCheck.data?.steps) && iconCheck.data.steps.length > 0, 'the site icon check reports its steps (here: an IP address, which Bitwarden refuses)', JSON.stringify(iconCheck.data?.steps?.[0]));
  const mk = await api('/api/admin/users', { method: 'POST', body: { username: 'appuser', password: 'apppass123', apps: { budget: { enabled: false } } } });
  ok(mk.status === 200, 'create an account, with Florin off from the start');
  const ul = await fetch(`${B}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'appuser', password: 'apppass123' }) });
  const ujar = cookieFrom(ul);
  const utoken = (await json(ul))?.token;
  const uapps = await json(await fetch(`${B}/api/apps`, { headers: { Authorization: `Bearer ${utoken}` } }));
  ok(uapps?.apps?.length === 4 && !uapps.apps.some((a) => a.id === 'budget'), 'the launcher only shows the apps the account may use');
  ok((await get('/docs/api/me', { cookie: ujar })).status === 200 && (await get('/budget/api/auth/me', { cookie: ujar })).status === 403, 'a turned-off app refuses the account');
  ok((await fetch(`${B}/api/admin/console`, { headers: { Authorization: `Bearer ${utoken}` } })).status === 403, 'the console API is for admins only');
  const con = await api('/api/admin/console');
  const row = con.data?.users?.find((u) => u.username === 'appuser');
  ok(con.status === 200 && row && row.apps.budget.enabled === false && row.apps.documents.enabled === true && con.data.apps.length === 5, 'the console lists every account with its apps', JSON.stringify(row?.apps));
  ok((await api(`/api/admin/users/${row.id}/apps/documents`, { method: 'PATCH', body: { quota_bytes: 0 } })).status === 400, 'a zero quota is refused');
  ok((await api(`/api/admin/users/${row.id}/apps/documents`, { method: 'PATCH', body: { quota_bytes: 1000 } })).data?.quota_bytes === 1000, 'set an account’s e-Management quota');
  const big = new FormData();
  big.append('data', JSON.stringify({ title: 'Too big', doc_date: '2026-01-15' }));
  big.append('files', new Blob([crypto.randomBytes(4000)]), 'big.pdf');
  const over = await fetch(`${B}/docs/api/s/work/documents`, { method: 'POST', body: big, headers: { Cookie: ujar } });
  ok(over.status === 413, 'an upload over the quota is refused', String(over.status));
  const uDocs = path.join(tmp, 'documents', row.id);
  ok(fs.existsSync(uDocs) && fs.readdirSync(path.join(uDocs, 'work', 'uploads')).length === 0, '…and nothing of it is kept');
  ok((await api(`/api/admin/users/${row.id}/apps/documents`, { method: 'PATCH', body: { quota_bytes: null } })).data?.custom_quota === false, 'back to the default quota');

  // one storage space for every app: e-Management's files count in the account's space, and when it
  // is full, Trove refuses too
  console.log('\nOne storage space for every app');
  const small = new FormData();
  small.append('data', JSON.stringify({ title: 'Small', doc_date: '2026-01-15' }));
  small.append('files', new Blob([crypto.randomBytes(3000)]), 'small.pdf');
  ok((await fetch(`${B}/docs/api/s/personal/documents`, { method: 'POST', body: small, headers: { Cookie: ujar } })).status === 200, 'store a document with a file');
  const sp = (await json(await fetch(`${B}/api/apps`, { headers: { Authorization: `Bearer ${utoken}` } })))?.space;
  ok(sp && sp.apps.find((a) => a.id === 'documents')?.bytes === 3000 && sp.used_bytes === 3000 && sp.apps.some((a) => a.id === 'box' && a.name === 'Trove'), 'the launcher shows one space, split by app', JSON.stringify(sp));
  ok((await json(await fetch(`${B}/api/user/profile`, { headers: { Authorization: `Bearer ${utoken}` } })))?.used_bytes === 3000, 'Trove’s profile counts every app');
  ok((await json(await get('/docs/api/me', { cookie: ujar })))?.app_bytes === 3000, 'e-Management shows its own part of the space');
  await api(`/api/admin/users/${row.id}/quota`, { method: 'PATCH', body: { quota: 3100 } });
  const tUp = new FormData();
  for (const [k, v] of Object.entries({ upload_id: 'spacecheck1', chunk_index: '0', total_chunks: '1', total_size: '500', offset: '0' })) tUp.append(k, v);
  tUp.append('file', new Blob([crypto.randomBytes(500)]), 'x.bin');
  const tOver = await fetch(`${B}/api/files/upload`, { method: 'POST', body: tUp, headers: { Authorization: `Bearer ${utoken}` } });
  ok(tOver.status === 400 && /quota/i.test((await json(tOver))?.error || ''), 'Trove refuses a file once the other apps filled the space', String(tOver.status));
  const docOver = new FormData();
  docOver.append('data', JSON.stringify({ title: 'More', doc_date: '2026-01-15' }));
  docOver.append('files', new Blob([crypto.randomBytes(500)]), 'more.pdf');
  ok((await fetch(`${B}/docs/api/s/personal/documents`, { method: 'POST', body: docOver, headers: { Cookie: ujar } })).status === 413, 'and so does e-Management');
  const conRow = (await api('/api/admin/console')).data.users.find((u) => u.id === row.id);
  ok(conRow?.space?.used_bytes === 3000 && conRow.space.quota_bytes === 3100, 'the Admin console shows the account’s whole space', JSON.stringify(conRow?.space));
  await api(`/api/admin/users/${row.id}/quota`, { method: 'PATCH', body: { quota: 5 * 1024 ** 3 } });
  const defsNone = await api('/api/admin/apps/defaults', { method: 'PUT', body: { documents: { quota_bytes: null } } });
  ok(defsNone.status === 200 && defsNone.data.documents.quota_bytes === null, 'an app’s default limit can be “none” (the account’s space only)');
  // Florin back on, and a first visit creates the account's Florin row (delete-user must remove it)
  await api(`/api/admin/users/${row.id}/apps/budget`, { method: 'PATCH', body: { enabled: true } });
  await fetch(`${B}/budget/api/auth/me`, { headers: { Cookie: ujar } });
  const utask = await T('/tasks', { method: 'POST', body: { title: 'Their task' }, cookie: ujar });
  ok(utask.status === 201 && !(await json(await T('/tasks'))).tasks.some((t) => t.title === 'Their task'), 'one account doesn’t see another’s tasks');
  const defs = await api('/api/admin/apps/defaults', { method: 'PUT', body: { budget: { enabled: false } } });
  ok(defs.status === 200 && defs.data.budget.enabled === false, 'change what new accounts get');
  const mk2 = await api('/api/admin/users', { method: 'POST', body: { username: 'appuser2', password: 'apppass123' } });
  const row2 = (await api('/api/admin/console')).data.users.find((u) => u.id === mk2.data.id);
  ok(row2 && row2.apps.budget.enabled === false, 'a new account gets the defaults');
  await api('/api/admin/apps/defaults', { method: 'PUT', body: { budget: { enabled: true } } });
  await api(`/api/admin/users/${mk2.data.id}`, { method: 'DELETE' });

  ok((await fetch(`${B}/ironveil/api/saves/profile`, { method: 'PUT', body: '{"runs":1}', headers: { Cookie: ujar, 'Content-Type': 'text/plain', 'X-Requested-With': 'ironveil' } })).status === 200, 'another account saves a game');
  const uSaves = path.join(tmp, 'ironveil', row.id);
  ok((await json(await IV('/saves')))?.saves?.profile !== '{"runs":1}', 'one account doesn’t see another’s saves');
  ok((await api(`/api/admin/users/${row.id}/signout`, { method: 'POST' })).status === 200 && (await get('/docs/api/me', { cookie: ujar })).status === 401, '“Sign out everywhere” ends the cookie too');
  const del = await api(`/api/admin/users/${row.id}`, { method: 'DELETE' });
  const { DatabaseSync } = require('node:sqlite');
  const fdb = new DatabaseSync(path.join(tmp, 'budget', 'florin.db'), { readOnly: true });
  const left = fdb.prepare('SELECT COUNT(*) AS n FROM users WHERE box_id = ?').get(row.id).n;
  fdb.close();
  const tdb = new DatabaseSync(path.join(tmp, 'tasks', 'tasks.db'), { readOnly: true });
  const tleft = tdb.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?').get(row.id).n;
  tdb.close();
  ok(del.status === 200 && !fs.existsSync(uDocs) && left === 0 && tleft === 0 && !fs.existsSync(uSaves), 'deleting an account removes its data in every app (Ironveil’s saves too)');
  return { jar, docId: madeData?.id, taskTitle: other?.title };
};
