import { api, session, toLogin, icon, mark, esc, permsHtml, wirePerms } from './common.js';

// /oauth/authorize: an AI app (Claude, …) asks to use this account through the AI connector. The
// person picks, app by app, what it may do; the server (src/modules/connector.js) checks the request
// again and sends the browser back to the app with a one-time code.

const $ = (id) => document.getElementById(id);
const q = Object.fromEntries(new URLSearchParams(location.search));

function bad(msg) {
  $('boot').hidden = true;
  $('form').hidden = true;
  $('bad').innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
  $('bad').hidden = false;
}

async function main() {
  $('mark').innerHTML = mark(48);
  const s = session();
  if (!s) return toLogin(location.pathname + location.search);
  $('who').textContent = `Signed in as ${s.username}`;

  let req, appsList;
  try {
    const r = await fetch(`/api/oauth/request${location.search}`);
    req = await r.json();
    if (!r.ok) return bad(req.error || 'This request isn’t valid.');
    appsList = (await api('/api/oauth/apps')).apps;
  } catch (e) { return bad(e.message || 'Can’t reach the server.'); }

  const name = req.client.name;
  document.title = `Connect ${name} · AkulavBox`;
  $('title').textContent = `Connect ${name}`;
  $('lead').innerHTML = `<b>${esc(name)}</b> wants to use your AkulavBox account. Choose what it may do in each app; it sees only the apps you allow.`;
  $('back').textContent = `After you choose, you go back to ${req.client.goes_to}.`;
  // what the app asked for, or read access to every app that is on
  const asked = Object.keys(req.scopes || {}).length ? req.scopes : Object.fromEntries(appsList.filter((a) => a.enabled).map((a) => [a.id, 'read']));
  $('perms').innerHTML = permsHtml(appsList, asked);
  const read = wirePerms($('perms'));
  $('boot').hidden = true;
  $('form').hidden = false;

  const send = async (deny) => {
    $('allow').disabled = $('deny').disabled = true;
    try {
      const r = await api('/api/oauth/approve', { method: 'POST', body: { ...q, scopes: read(), deny: !!deny } });
      location.assign(r.redirect);
    } catch (e) {
      bad(e.message);
    }
  };
  $('form').onsubmit = (e) => {
    e.preventDefault();
    if (!Object.keys(read()).length) { $('bad').innerHTML = `${icon('alert')}<span>Allow at least one app, or decline.</span>`; $('bad').hidden = false; return; }
    send(false);
  };
  $('deny').onclick = () => send(true);
}

main();
