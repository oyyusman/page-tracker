// Request handlers shared by Vercel functions (api/*.js) and the local server (server.js).
const { getConfig } = require('./config');
const { getStore } = require('./store');
const { syncStep, readAll } = require('./sync');
const auth = require('./auth');

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function urlOf(req) { return new URL(req.url, 'http://localhost'); }
function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? safeJson(req.body) : req.body || {});
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(safeJson(s)));
    req.on('error', () => resolve({}));
  });
}
const safeJson = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

async function data(req, res) {
  const cfg = getConfig();
  if (!auth.isLoggedIn(cfg, req)) return send(res, 401, { error: 'login required', needsLogin: true });
  try {
    const all = await readAll(getStore(cfg));
    send(res, 200, { ...all, intervalHours: cfg.intervalHours, passwordProtected: !!cfg.password, profilesConfigured: cfg.tokens.length });
  } catch (e) { send(res, 500, { error: e.message }); }
}

async function sync(req, res) {
  const cfg = getConfig();
  const url = urlOf(req);
  if (!auth.canSync(cfg, req, url)) return send(res, 401, { error: 'not allowed' });
  if (!cfg.tokens.length) return send(res, 400, { error: 'No Facebook token configured (TOKEN environment variable / .env line)' });
  try {
    const since = url.searchParams.get('since');
    const result = await syncStep(cfg, getStore(cfg), {
      force: url.searchParams.get('force') === '1',
      forceSince: since ? Number(since) : null,
      budgetMs: cfg.onVercel ? 45000 : 120000,
    });
    send(res, 200, { ok: true, ...result });
  } catch (e) { send(res, 500, { error: e.message }); }
}

async function login(req, res) {
  const cfg = getConfig();
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const body = await readBody(req);
  if (!auth.checkPassword(cfg, body.password)) {
    await new Promise(r => setTimeout(r, 800)); // slow down guessing
    return send(res, 401, { error: 'Wrong password' });
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(cfg, req) });
}

async function logout(req, res) {
  send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie });
}

module.exports = { data, sync, login, logout };
