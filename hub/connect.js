import { api, session, toLogin, icon, lockup, esc, accountMenu, madeBy, toast, dialog, relative, permsHtml, wirePerms, scopeChips, copyText } from './common.js';

// AI connectors (/connect): the account's tokens for AI apps, and how to connect Claude.
// The server side is src/modules/connector.js; the tools are in src/core/connector/.

const $ = (id) => document.getElementById(id);
let state = null;
let readNew = null;

const when = (s) => (s ? relative(s) : null);
const expiry = (s) => {
  if (!s) return 'never expires';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d < new Date() ? 'expired' : `expires ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
};

function snippets(token) {
  const url = state.mcp_url;
  return {
    cc: `claude mcp add --transport http akulavbox ${url} --header "Authorization: Bearer ${token}"`,
    json: JSON.stringify({ mcpServers: { akulavbox: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    curl: `curl -H "Authorization: Bearer ${token}" ${state.base_url}/api/connector/tools`,
  };
}

function rowHtml(t) {
  const used = when(t.last_used_at);
  return `<div class="connector" data-id="${esc(t.id)}">
    <span class="tile" style="--c:${t.kind === 'oauth' ? '#d97757' : '#8b5cf6'}">${icon(t.kind === 'oauth' ? 'globe' : 'key')}</span>
    <div class="c-main">
      <p class="name">${esc(t.name)} <span class="chip">${t.kind === 'oauth' ? 'Signed in app' : `Token ${esc(t.prefix)}…`}</span></p>
      <div class="scopes">${scopeChips(t.scopes, state.apps) || '<span class="faint">No access</span>'}</div>
      <small class="faint">Made ${esc(when(t.created_at) || '')} · ${used ? `last used ${esc(used)}` : 'not used yet'} · ${esc(expiry(t.expires_at))}</small>
      <div class="c-edit" hidden></div>
    </div>
    <div class="row-actions">
      <button class="icon-btn" data-act="edit" title="Change what it may do" aria-label="Change what ${esc(t.name)} may do">${icon('settings')}</button>
      <button class="icon-btn danger" data-act="revoke" title="Revoke" aria-label="Revoke ${esc(t.name)}">${icon('trash')}</button>
    </div>
  </div>`;
}

function render() {
  $('list').innerHTML = state.tokens.length ? state.tokens.map(rowHtml).join('') : '<p class="empty">No connectors yet. Connect Claude above, or make a token.</p>';
  $('count').textContent = state.tokens.length ? `${state.tokens.length}` : '';
}

function renderTools() {
  const n = state.apps.reduce((s, a) => s + a.tools.length, 0);
  $('tools-title').textContent = `What an AI can do here (${n + 1} tools)`;
  $('tools').innerHTML = `<p class="muted" style="font-size:13px;margin:0 0 12px">Every connector also gets <span class="mono">akulavbox_account</span>: who you are, which apps it may use, and your storage. An AI only sees the tools of the apps you allowed, and the “change” tools only with Read &amp; change.</p>` +
    state.apps.map((a) => `<div class="tool-app"><p><span class="dot" style="background:${esc(a.color)}"></span><b>${esc(a.name)}</b></p><ul>${a.tools.map((t) => `<li><span class="mono">${esc(t.name)}</span> ${esc(t.title)}${t.write ? ` <span class="chip ${t.destructive ? 'chip-danger' : ''}">${t.destructive ? 'deletes' : 'changes'}</span>` : ''}</li>`).join('')}</ul></div>`).join('');
}

async function load() {
  state = await api('/api/connector/tokens');
  render();
}

function showToken(token, name) {
  const s = snippets(token);
  $('once-title').textContent = `Your token for ${name}`;
  $('once-token').textContent = token;
  $('once-cc').textContent = s.cc;
  $('once-json').textContent = s.json;
  $('once-curl').textContent = s.curl;
  $('once').hidden = false;
  $('once').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function onList(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const row = b.closest('.connector');
  const t = state.tokens.find((x) => x.id === row.dataset.id);
  if (!t) return;
  if (b.dataset.act === 'revoke') {
    const ok = await dialog({ title: `Revoke ${t.name}?`, message: t.kind === 'oauth' ? 'The app is signed out of your account and has to be connected again.' : 'Anything using this token stops working at once.', confirm: 'Revoke', danger: true });
    if (!ok) return;
    try { await api(`/api/connector/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE' }); toast(`${t.name} was revoked`); } catch (err) { toast(err.message, 'error'); }
    return load();
  }
  if (b.dataset.act === 'edit') {
    const box = row.querySelector('.c-edit');
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = `<div class="perms compact">${permsHtml(state.apps, t.scopes)}</div><div class="cc-foot"><span></span><span style="display:flex;gap:8px"><button class="btn btn-sm" data-cancel>Cancel</button><button class="btn btn-sm btn-primary" data-save>Save</button></span></div>`;
    const read = wirePerms(box);
    box.hidden = false;
    box.querySelector('[data-cancel]').onclick = () => { box.hidden = true; };
    box.querySelector('[data-save]').onclick = async () => {
      const scopes = read();
      if (!Object.keys(scopes).length) return toast('Give it access to at least one app, or revoke it.', 'error');
      try { await api(`/api/connector/tokens/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { scopes } }); toast('Saved'); await load(); } catch (err) { toast(err.message, 'error'); }
    };
  }
}

async function main() {
  const s = session();
  if (!s) return toLogin('/connect');
  try { await load(); } catch (e) { $('boot').textContent = e.message; return; }
  $('lockup').innerHTML = lockup(30);
  accountMenu($('account'), s);
  $('ic-claude').innerHTML = icon('globe');
  $('ic-term').innerHTML = icon('terminal');
  $('new-title').innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center">${icon('plus')}Make a token</span>`;
  $('create-btn').innerHTML = `${icon('key')}Make token`;
  $('once-close').innerHTML = icon('x');
  for (const b of document.querySelectorAll('[data-copy]')) b.innerHTML = `${icon('copy')}<span>Copy</span>`;
  $('mcp-url').textContent = state.mcp_url;
  $('cc-example').textContent = `claude mcp add --transport http akulavbox ${state.mcp_url} \\\n  --header "Authorization: Bearer <your token>"`;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$|\.lan$/.test(location.hostname);
  $('reach').innerHTML = `${icon('alert')}<span>${local || location.protocol !== 'https:'
    ? 'Claude connects from Anthropic’s servers, so this server must be reachable from the internet over HTTPS (set PUBLIC_URL in .env to its public address). Claude Code and local tools work on your network as they are.'
    : 'Claude connects from Anthropic’s servers to this address. You can revoke it below at any time.'}</span>`;
  $('footer').innerHTML = madeBy();

  $('perms').innerHTML = permsHtml(state.apps, Object.fromEntries(state.apps.filter((a) => a.enabled).map((a) => [a.id, 'read'])));
  readNew = wirePerms($('perms'));
  renderTools();

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText($(b.dataset.copy).textContent);
  });
  $('once-close').onclick = () => { $('once').hidden = true; };
  $('list').addEventListener('click', onList);
  $('create').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('cname').value.trim();
    const scopes = readNew();
    if (!name) return toast('Give it a name, like the app or the computer it runs on.', 'error');
    if (!Object.keys(scopes).length) return toast('Give it access to at least one app.', 'error');
    $('create-btn').disabled = true;
    try {
      const r = await api('/api/connector/tokens', { method: 'POST', body: { name, scopes, days: $('cdays').value || null } });
      $('cname').value = '';
      showToken(r.token, r.connector.name);
      await load();
    } catch (err) { toast(err.message, 'error'); }
    $('create-btn').disabled = false;
  };

  $('boot').hidden = true;
  $('page').hidden = false;
  fetch('/api/health').then((r) => r.json()).then((h) => { $('footer').innerHTML = madeBy(h.version); }).catch(() => {});
}

main();
