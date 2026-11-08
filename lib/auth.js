// Password login with a signed, HttpOnly session cookie. No password set => open access (local use).
const crypto = require('crypto');

const COOKIE = 'pt_session';
const DAYS = 30;

function key(cfg) {
  return crypto.createHash('sha256').update('pt|' + (cfg.sessionSecret || '') + '|' + cfg.password + '|' + cfg.appSecret).digest();
}
function sign(cfg, exp) {
  return crypto.createHmac('sha256', key(cfg)).update(String(exp)).digest('base64url');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLoggedIn(cfg, req) {
  if (!cfg.password) return true;
  const c = cookies(req)[COOKIE];
  if (!c) return false;
  const [exp, sig] = c.split('.');
  return Number(exp) > Date.now() && safeEqual(sig, sign(cfg, exp));
}

function checkPassword(cfg, given) {
  return !!cfg.password && safeEqual(given || '', cfg.password);
}

function sessionCookie(cfg, req) {
  const exp = Date.now() + DAYS * 86400000;
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `${COOKIE}=${exp}.${sign(cfg, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure}`;
}
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// Sync may be triggered by a logged-in user, or by the cron service with the sync secret.
function canSync(cfg, req, url) {
  if (cfg.syncSecret) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (safeEqual(url.searchParams.get('key') || '', cfg.syncSecret) || safeEqual(bearer, cfg.syncSecret)) return true;
  }
  if (cfg.password) return isLoggedIn(cfg, req);
  return !cfg.onVercel && !cfg.syncSecret; // fully open only when running locally without secrets
}

module.exports = { isLoggedIn, checkPassword, sessionCookie, clearCookie, canSync };
