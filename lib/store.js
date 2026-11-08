// Storage: Upstash Redis (on Vercel) or local JSON files (on your PC).
// Layout:  meta   -> { profiles, lastSync, profilesRefreshedAt, errors, pageIds }
//          page:ID -> one page with its posts
//          tokens  -> { pageId: pageToken }   (never sent to the browser)
const fs = require('fs');
const path = require('path');

const PREFIX = 'pt:';

function redisStore(url, token) {
  async function call(body, pipeline) {
    const res = await fetch(url.replace(/\/$/, '') + (pipeline ? '/pipeline' : ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error('Database error: ' + (json.error || res.status));
    return json;
  }
  const parse = v => (v == null ? null : JSON.parse(v));
  return {
    kind: 'redis',
    async get(key) { return parse((await call(['GET', PREFIX + key])).result); },
    async set(key, val) { await call(['SET', PREFIX + key, JSON.stringify(val)]); },
    async getMany(keys) {
      if (!keys.length) return [];
      const out = [];
      for (let i = 0; i < keys.length; i += 100) {
        const r = await call(['MGET', ...keys.slice(i, i + 100).map(k => PREFIX + k)]);
        out.push(...r.result.map(parse));
      }
      return out;
    },
    async setMany(entries) {
      for (let i = 0; i < entries.length; i += 50) {
        await call(entries.slice(i, i + 50).map(([k, v]) => ['SET', PREFIX + k, JSON.stringify(v)]), true);
      }
    },
    async del(keys) { if (keys.length) await call(['DEL', ...keys.map(k => PREFIX + k)]); },
  };
}

function fileStore(dir) {
  const f = key => path.join(dir, key.replace(/[^a-z0-9_.-]/gi, '_') + '.json');
  const read = key => { try { return JSON.parse(fs.readFileSync(f(key), 'utf8')); } catch { return null; } };
  const write = (key, val) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f(key) + '.tmp', JSON.stringify(val));
    fs.renameSync(f(key) + '.tmp', f(key));
  };
  return {
    kind: 'file',
    async get(key) { return read(key); },
    async set(key, val) { write(key, val); },
    async getMany(keys) { return keys.map(read); },
    async setMany(entries) { for (const [k, v] of entries) write(k, v); },
    async del(keys) { for (const k of keys) try { fs.unlinkSync(f(k)); } catch {} },
  };
}

function getStore(cfg) {
  if (cfg.redisUrl && cfg.redisToken) return redisStore(cfg.redisUrl, cfg.redisToken);
  if (cfg.onVercel) throw new Error('No database connected. In Vercel: Storage > Create Database > Upstash Redis > connect it to this project, then redeploy.');
  return fileStore(path.join(__dirname, '..', 'data'));
}

module.exports = { getStore };
