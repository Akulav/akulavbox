// The AI connector in `npm run check`: tokens with per-app scopes, the MCP endpoint and its tools in
// every app, the plain HTTP mirror, and the OAuth flow an AI app like Claude uses (registration,
// approval, PKCE, refresh, revocation). Called from scripts/check.js against its throwaway server.

const crypto = require('crypto');

module.exports = async function connectorCheck({ api, ok, base, adminToken }) {
  const B = base();
  const json = async (r) => { try { return await r.json(); } catch (e) { return null; } };
  console.log('\nAI connector');
  // Koma Shelf runs only with sharp, an optional dependency (CI also runs without it): no sharp, no tools
  let sharp = null;
  try { sharp = require('sharp'); } catch (e) { /* optional */ }

  ok((await api('/api/connector/tokens', { method: 'POST', body: { name: 'x', scopes: {} } })).status === 400, 'a connector needs access to at least one app');
  const all = { box: 'write', documents: 'write', budget: 'write', tasks: 'write', manga: 'read' };
  const made = await api('/api/connector/tokens', { method: 'POST', body: { name: 'Check AI', scopes: all, days: 7 } });
  const token = made.data?.token;
  ok(made.status === 200 && /^akb_[\w-]{40,}$/.test(token || '') && made.data.connector.scopes.tasks === 'write', 'make a token with per-app access', JSON.stringify(made.data?.connector));
  const listed = await api('/api/connector/tokens');
  ok(listed.data?.tokens?.some((t) => t.id === made.data.connector.id && !('token_hash' in t)) && listed.data.mcp_url.endsWith('/mcp'), 'the list never shows the token itself');

  let id = 0;
  const mcp = (method, params, tk = token) => fetch(`${B}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const call = async (name, args = {}, tk = token) => (await json(await mcp('tools/call', { name, arguments: args }, tk)))?.result;
  const data = (r) => r?.structuredContent || null;

  const noAuth = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  ok(noAuth.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/.test(noAuth.headers.get('www-authenticate') || ''), 'without a token: 401 that points to the OAuth metadata');
  ok((await mcp('ping', {}, 'akb_wrong')).status === 401, 'a wrong token is refused');
  const init = await json(await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } }));
  ok(init?.result?.protocolVersion === '2025-06-18' && init.result.serverInfo.name === 'akulavbox' && init.result.capabilities.tools, 'MCP: initialize', JSON.stringify(init?.result?.serverInfo));
  const note = await fetch(`${B}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  ok(note.status === 202, 'MCP: notifications get 202');
  const tl = (await json(await mcp('tools/list', {})))?.result?.tools || [];
  const names = tl.map((t) => t.name);
  ok(['akulavbox_account', 'trove_write_text_file', 'docs_create', 'florin_add_transaction', 'tick_add_task', ...(sharp ? ['koma_webtoons'] : [])].every((n) => names.includes(n)) && !names.includes('koma_update_webtoon') && (sharp || !names.some((n) => n.startsWith('koma_'))), `MCP: ${names.length} tools, for every app (read-only where it is read-only)`);
  ok(tl.every((t) => t.inputSchema?.type === 'object' && typeof t.annotations?.readOnlyHint === 'boolean'), 'every tool has an input schema and read-only/destructive hints');
  ok((await json(await mcp('nope/nope', {})))?.error?.code === -32601, 'MCP: unknown methods are a JSON-RPC error');

  // a tool in each app
  const acc = data(await call('akulavbox_account'));
  ok(acc?.account?.username === 'admin' && acc.apps.find((a) => a.id === 'tasks')?.access === 'write' && acc.storage?.quota_bytes > 0, 'account overview: who, which apps, the storage');
  const folder = data(await call('trove_create_folder', { name: 'From the AI' }));
  const file = data(await call('trove_write_text_file', { name: 'note.md', content: '# Note\nhello', folder_id: folder?.id }));
  const read = await call('trove_read_file', { file_id: file?.id });
  ok(folder?.id && file?.id && read?.content?.some((c) => c.type === 'text' && c.text.includes('hello')), 'Trove: make a folder, save a text file and read it back');
  ok((await call('trove_read_file', { file_id: 'nope' }))?.isError === true, 'Trove: errors come back as tool errors, not crashes');
  const task = data(await call('tick_add_task', { title: 'Call the bank', due_date: '2026-12-01', priority: 'high', tags: ['admin'] }))?.task;
  const done = data(await call('tick_complete_task', { id: task?.id }))?.task;
  ok(task?.id && task.priority === 'high' && done?.status === 'done', 'Tick: add a task and tick it off');
  const txn = data(await call('florin_add_transaction', { amount: 9.5, currency: 'eur', payee: 'Check café', category: 'dining' }))?.transaction;
  ok(txn?.amount === 9.5 && txn.category === 'Dining out', 'Florin: add an expense, with the category found by name', JSON.stringify(txn));
  ok((await call('florin_add_transaction', { amount: 1, category: 'no such thing' }))?.isError, 'Florin: an unknown category is explained');
  const doc = data(await call('docs_create', { space: 'work', title: 'Contract from the AI', date: '2026-03-04', number: 'C-7' }));
  ok(doc?.id && data(await call('docs_list', { space: 'work', query: 'contract from' }))?.documents?.[0]?.number === 'C-7', 'e-Management: add a document and find it');
  ok(data(await call('docs_delete', { space: 'work', id: doc?.id }))?.ok === true, 'e-Management: delete it');
  if (sharp) ok(Array.isArray(data(await call('koma_webtoons'))?.webtoons), 'Koma Shelf: list the webtoons');
  else ok((await call('koma_webtoons'))?.isError, 'Koma Shelf isn’t running (no sharp): its tools are refused');

  // read-only
  const ro = (await api('/api/connector/tokens', { method: 'POST', body: { name: 'Read only', scopes: { tasks: 'read' } } })).data;
  const roTools = ((await json(await mcp('tools/list', {}, ro.token)))?.result?.tools || []).map((t) => t.name);
  ok(roTools.includes('tick_list_tasks') && !roTools.includes('tick_add_task') && !roTools.some((n) => n.startsWith('trove_')), 'a read-only token sees only reading tools of its apps', roTools.join(','));
  const refused = await call('tick_add_task', { title: 'x' }, ro.token);
  ok(refused?.isError && /only read/i.test(refused.content[0].text), 'and changing anything is refused');
  const rest = await fetch(`${B}/api/connector/tools/tick_list_tasks`, { method: 'POST', headers: { Authorization: `Bearer ${ro.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  ok(rest.status === 200 && Array.isArray((await json(rest))?.result?.tasks), 'the same tools answer over plain HTTP');
  const pre = await fetch(`${B}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://inspector.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /authorization/i.test(pre.headers.get('access-control-allow-headers') || ''), 'browser MCP clients get CORS (bearer tokens only, no cookies)');
  ok((await api(`/api/connector/tokens/${ro.connector.id}`, { method: 'PATCH', body: { scopes: { tasks: 'write' } } })).data?.connector?.scopes?.tasks === 'write', 'change what a connector may do');
  ok((await api(`/api/connector/tokens/${ro.connector.id}`, { method: 'DELETE' })).status === 200 && (await mcp('ping', {}, ro.token)).status === 401, 'a revoked token stops working at once');

  // OAuth (Claude's "add custom connector")
  const meta = await json(await fetch(`${B}/.well-known/oauth-authorization-server`));
  const prm = await json(await fetch(`${B}/.well-known/oauth-protected-resource`));
  ok(meta?.code_challenge_methods_supported?.includes('S256') && meta.registration_endpoint && prm?.resource?.endsWith('/mcp'), 'OAuth: discovery metadata');
  const reg = await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Check Claude', redirect_uris: ['https://claude.example/callback'] }) });
  const client = await json(reg);
  ok(reg.status === 201 && /^akc_/.test(client?.client_id || ''), 'OAuth: an AI app registers itself');
  ok((await fetch(`${B}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) })).status === 400, 'OAuth: unsafe redirect addresses are refused');
  const verifier = crypto.randomBytes(40).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = { response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.example/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'tasks:write box:read' };
  const reqInfo = await json(await fetch(`${B}/api/oauth/request?${new URLSearchParams(q)}`));
  ok(reqInfo?.client?.name === 'Check Claude' && reqInfo.scopes.tasks === 'write', 'OAuth: the approval page learns who asks and for what');
  ok((await fetch(`${B}/api/oauth/request?${new URLSearchParams({ ...q, redirect_uri: 'https://evil.example/cb' })}`)).status === 400, 'OAuth: an unregistered return address is refused');
  ok((await fetch(`${B}/oauth/authorize?${new URLSearchParams(q)}`)).status === 200, 'OAuth: the approval page is served');
  const approve = await api('/api/oauth/approve', { method: 'POST', body: { ...q, scopes: { tasks: 'write', box: 'read' } } });
  const back = new URL(approve.data?.redirect || 'http://x');
  const code = back.searchParams.get('code');
  ok(approve.status === 200 && back.origin === 'https://claude.example' && code && back.searchParams.get('state') === 'xyz', 'OAuth: approving sends the browser back with a code and the state');
  const tokenReq = (b) => fetch(`${B}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  ok((await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: q.redirect_uri, client_id: client.client_id, code_verifier: crypto.randomBytes(40).toString('base64url') })).status === 400, 'OAuth: a wrong PKCE verifier is refused (and burns the code)');
  const approve2 = await api('/api/oauth/approve', { method: 'POST', body: { ...q, scopes: { tasks: 'write', box: 'read' } } });
  const code2 = new URL(approve2.data.redirect).searchParams.get('code');
  const tok = await json(await tokenReq({ grant_type: 'authorization_code', code: code2, redirect_uri: q.redirect_uri, client_id: client.client_id, code_verifier: verifier }));
  ok(/^akb_/.test(tok?.access_token || '') && /^akbr_/.test(tok.refresh_token || '') && tok.token_type === 'Bearer' && tok.expires_in > 0, 'OAuth: the code becomes an access and a refresh token', JSON.stringify(tok)?.slice(0, 120));
  ok((await tokenReq({ grant_type: 'authorization_code', code: code2, redirect_uri: q.redirect_uri, client_id: client.client_id, code_verifier: verifier })).status === 400, 'OAuth: a code works only once');
  const oTools = ((await json(await mcp('tools/list', {}, tok.access_token)))?.result?.tools || []).map((t) => t.name);
  ok(oTools.includes('tick_add_task') && oTools.includes('trove_list_folder') && !oTools.includes('trove_write_text_file') && !oTools.includes('florin_categories'), 'OAuth: the app gets exactly what was approved');
  const ref = await json(await tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id }));
  ok(ref?.access_token && ref.access_token !== tok.access_token && (await mcp('ping', {}, tok.access_token)).status === 401 && (await mcp('ping', {}, ref.access_token)).status === 200, 'OAuth: refreshing gives a new pair and retires the old token');
  const denied = await api('/api/oauth/approve', { method: 'POST', body: { ...q, deny: true } });
  ok(new URL(denied.data.redirect).searchParams.get('error') === 'access_denied', 'OAuth: declining tells the app');
  const listed2 = (await api('/api/connector/tokens')).data.tokens;
  ok(listed2.some((t) => t.kind === 'oauth' && t.name === 'Check Claude'), 'the connected app shows in the list of connectors');
  await fetch(`${B}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${ref.refresh_token}` });
  ok((await mcp('ping', {}, ref.access_token)).status === 401, 'OAuth: revoking ends the grant');

  // a connector of an account that is deleted goes with it
  const u = await api('/api/admin/users', { method: 'POST', body: { username: 'aiuser', password: 'aipass1234' } });
  const ul = await json(await fetch(`${B}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'aiuser', password: 'aipass1234' }) }));
  const ut = await json(await fetch(`${B}/api/connector/tokens`, { method: 'POST', headers: { Authorization: `Bearer ${ul.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'theirs', scopes: { tasks: 'read' } }) }));
  ok((await mcp('ping', {}, ut.token)).status === 200, 'another account’s connector works for that account');
  ok(!(await api('/api/connector/tokens')).data.tokens.some((t) => t.name === 'theirs'), 'and isn’t listed for anyone else');
  await api(`/api/admin/users/${u.data.id}`, { method: 'DELETE' });
  ok((await mcp('ping', {}, ut.token)).status === 401, 'deleting the account ends its connectors');
  void adminToken;
};
