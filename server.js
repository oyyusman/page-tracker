// Page Tracker - local server (for running on your own PC).
// On Vercel, the files in api/ are used instead; both share the code in lib/.
//   node server.js          start
//   node server.js --open   start and open the browser
const http = require('http');
const fs = require('fs');
const path = require('path');
const handlers = require('./lib/handlers');
const { getConfig } = require('./lib/config');
const { getStore } = require('./lib/store');
const { syncStep } = require('./lib/sync');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const routes = { '/api/data': handlers.data, '/api/sync': handlers.sync, '/api/login': handlers.login, '/api/logout': handlers.logout };

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[url.pathname];
  if (route) return Promise.resolve(route(req, res)).catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(path.join(PUBLIC_DIR, file));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

// ---- background sync: every 10 minutes, update the pages that are due ----
let running = false;
async function tick(reason) {
  if (running) return;
  running = true;
  try {
    const cfg = getConfig();
    if (!cfg.tokens.length) return;
    const r = await syncStep(cfg, getStore(cfg), { budgetMs: 120000 });
    if (r.updated) console.log(`[${new Date().toLocaleString()}] Sync (${reason}): updated ${r.updated} page(s), ${r.remaining} remaining, ${r.totalPages} total`);
    if (r.remaining) setTimeout(() => tick('continue'), 1000);
  } catch (e) {
    console.error(`[${new Date().toLocaleString()}] Sync error:`, e.message);
  } finally { running = false; }
}

const cfg = getConfig();
const URL_LOCAL = `http://localhost:${cfg.port}`;
const openBrowser = () => { if (process.argv.includes('--open')) require('child_process').exec(`start "" "${URL_LOCAL}"`); };
if (!cfg.tokens.length) console.error('No token found in .env. Add a line like:  token: "EAA..."');

const server = http.createServer(handle);
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${cfg.port} is already in use - Page Tracker is probably already running.`);
    console.log(`Opening ${URL_LOCAL} ... (if it does not load, close the other window or set PORT = 3001 in .env)`);
    openBrowser();
    setTimeout(() => process.exit(0), 1500);
  } else { console.error('Server error:', e.message); process.exit(1); }
});

// IPv4 + IPv6 localhost (some browsers resolve "localhost" to ::1). Local only.
server.listen(cfg.port, '127.0.0.1', () => {
  const v6 = http.createServer(handle);
  v6.on('error', () => {});
  v6.listen(cfg.port, '::1');
  console.log(`Page Tracker running at ${URL_LOCAL}  (also http://127.0.0.1:${cfg.port})`);
  console.log(`Profiles: ${cfg.tokens.length} | each page refreshes every ${cfg.intervalHours} h | storage: ${getStore(cfg).kind}`);
  console.log('Keep this window open. Closing it stops the tracker.');
  openBrowser();
  tick('startup');
  setInterval(() => tick('scheduled'), 10 * 60000);
});
