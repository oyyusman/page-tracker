// Configuration from .env (local) and/or environment variables (Vercel).
// Keys are case-insensitive; "App Id" == "APP_ID" == "app_id".
// Every key starting with "token" is one Facebook profile token (TOKEN, TOKEN_CLARA, token2 ...).
const fs = require('fs');
const path = require('path');

function readDotEnv() {
  const env = {};
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^:=]+?)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    env[norm(m[1])] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const norm = k => k.trim().toLowerCase().replace(/[\s-]+/g, '_');

function getConfig() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) env[norm(k)] = v;
  Object.assign(env, readDotEnv()); // .env wins locally
  const tokens = Object.keys(env)
    .filter(k => /^token(_|\d|$)/.test(k) && env[k])
    .sort()
    .map(k => ({ key: k, token: env[k].trim() }));
  return {
    tokens,
    appId: env.app_id || '',
    appSecret: env.app_secret || '',
    port: parseInt(env.port || '3000', 10),
    intervalHours: parseFloat(env.sync_interval_hours || '2'),
    graphVersion: env.graph_version || '',
    password: env.dashboard_password || '',
    syncSecret: env.sync_secret || env.cron_secret || '',
    sessionSecret: env.session_secret || '',
    redisUrl: env.kv_rest_api_url || env.upstash_redis_rest_url || '',
    redisToken: env.kv_rest_api_token || env.upstash_redis_rest_token || '',
    onVercel: !!process.env.VERCEL,
  };
}

module.exports = { getConfig };
