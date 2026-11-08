// Facebook Graph API sync, done in time-limited steps so it works on Vercel (short-lived
// functions) as well as locally. Each step:
//   1. refreshes the profile -> pages lists (at most once an hour, or when forced)
//   2. updates the pages whose data is older than the sync interval (oldest first)
//      until the time budget is used up. Remaining pages are done by the next step.

const POST_WINDOW_DAYS = 70;      // covers "previous calendar month" fully
const CONCURRENCY = 6;
const PROFILE_REFRESH_MIN = 60;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = encodeURIComponent;

class GraphError extends Error {
  constructor(err) { super(err.message || 'Graph API error'); this.code = err.code; }
}

function graphBase(cfg) {
  return 'https://graph.facebook.com' + (cfg.graphVersion ? '/' + cfg.graphVersion.replace(/^\/?/, '') : '');
}

async function graph(url, tries = 3) {
  for (let i = 0; ; i++) {
    let body;
    try { body = await (await fetch(url)).json(); }
    catch (e) {
      if (i < tries - 1) { await sleep(1500 * (i + 1)); continue; }
      throw new Error('Network error: ' + e.message);
    }
    if (body && body.error) {
      const e = new GraphError(body.error);
      if ([1, 2, 4, 17, 32, 341, 613].includes(e.code) && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
      throw e;
    }
    return body;
  }
}

async function graphAll(url, max = 5000) {
  const out = [];
  let next = url;
  while (next && out.length < max) {
    const r = await graph(next);
    out.push(...(r.data || []));
    next = r.paging && r.paging.next;
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

function friendlyError(e) {
  if (e.code === 190) return 'Token expired or invalid - generate a new token and update it';
  if (e.code === 10 || e.code === 200) return 'Missing permission: ' + e.message;
  if ([4, 17, 32, 613].includes(e.code)) return 'Facebook rate limit reached - will retry next sync';
  return e.message;
}

async function tokenInfo(cfg, token) {
  if (!cfg.appId || !cfg.appSecret) return null;
  try {
    const d = (await graph(`${graphBase(cfg)}/debug_token?input_token=${q(token)}&access_token=${q(cfg.appId + '|' + cfg.appSecret)}`)).data || {};
    return {
      valid: !!d.is_valid, type: d.type,
      expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
      dataAccessExpiresAt: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : null,
    };
  } catch { return null; }
}

const PAGE_FIELDS = 'id,name,category,followers_count,fan_count,link,about,username,picture.type(large){url}';
// Tried in order: if Facebook refuses one (permissions / "reduce the amount of data"), the next is used.
const POST_FIELD_SETS = [
  ['id,created_time,message,permalink_url,full_picture,status_type,attachments{media_type,type},shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)', 50],
  ['id,created_time,message,permalink_url,full_picture,status_type,attachments{media_type,type}', 25],
  ['id,created_time,message,permalink_url,full_picture,status_type', 25],
];

// Post kind: 'reel' | 'picture' | 'text' | 'video' | 'link' | 'other'
function classifyPost(p) {
  const a = p.attachments && p.attachments.data && p.attachments.data[0];
  const link = p.permalink_url || '';
  const at = (a && a.type) || '';
  const mt = (a && a.media_type) || '';
  const st = p.status_type || '';
  if (/\/reel\//.test(link) || /reel/.test(at)) return 'reel';
  if (mt === 'video' || /video/.test(at) || st === 'added_video') return 'video';
  if (mt === 'photo' || mt === 'album' || ['photo', 'album', 'profile_media', 'cover_photo', 'new_album'].includes(at) || st === 'added_photos') return 'picture';
  if (at === 'share' || st === 'shared_story') return 'link';
  if (!a || at === 'native_templates' || st === 'mobile_status_update') return 'text';
  return 'other';
}

async function fetchPage(cfg, pageId, pageToken) {
  const base = graphBase(cfg);
  const info = await graph(`${base}/${pageId}?fields=${q(PAGE_FIELDS)}&access_token=${q(pageToken)}`);
  const since = Math.floor(Date.now() / 1000) - POST_WINDOW_DAYS * 86400;
  let posts, lastErr;
  for (const [fields, limit] of POST_FIELD_SETS) {
    try {
      posts = await graphAll(`${base}/${pageId}/published_posts?fields=${q(fields)}&since=${since}&limit=${limit}&access_token=${q(pageToken)}`);
      break;
    } catch (e) {
      if (e.code === 190) throw e;
      lastErr = e;
    }
  }
  if (!posts) throw lastErr;
  let lastPostAt = posts[0] ? posts[0].created_time : null;
  let lastPostKind = posts[0] ? classifyPost(posts[0]) : null;
  if (!lastPostAt) {
    const r = await graph(`${base}/${pageId}/published_posts?fields=created_time,status_type,permalink_url&limit=1&access_token=${q(pageToken)}`);
    const p0 = r.data && r.data[0];
    lastPostAt = p0 ? p0.created_time : null;
    lastPostKind = p0 ? classifyPost(p0) : null;
  }
  return {
    id: info.id, name: info.name, category: info.category || '', username: info.username || '',
    followers: info.followers_count ?? null, likes: info.fan_count ?? null,
    link: info.link || `https://www.facebook.com/${info.id}`, about: info.about || '',
    picture: info.picture && info.picture.data ? info.picture.data.url : '',
    lastPostAt,
    lastPostKind,
    posts: posts.map(p => ({
      id: p.id, created: p.created_time, kind: classifyPost(p), message: (p.message || '').slice(0, 300),
      link: p.permalink_url || '', image: p.full_picture || '', type: p.status_type || '',
      reactions: p.reactions && p.reactions.summary ? p.reactions.summary.total_count : null,
      comments: p.comments && p.comments.summary ? p.comments.summary.total_count : null,
      shares: p.shares ? p.shares.count : 0,
    })),
  };
}

async function refreshProfiles(cfg, meta, tokens) {
  const base = graphBase(cfg);
  const profiles = {};
  const errors = [];
  await mapLimit(cfg.tokens, 4, async ({ key, token }) => {
    const tinfo = await tokenInfo(cfg, token);
    let profile;
    try {
      const me = await graph(`${base}/me?fields=${q('id,name,picture.type(large){url}')}&access_token=${q(token)}`);
      const accounts = await graphAll(`${base}/me/accounts?fields=${q('id,name,access_token')}&limit=100&access_token=${q(token)}`);
      for (const a of accounts) if (a.access_token) tokens[a.id] = a.access_token;
      profile = {
        id: me.id, name: me.name, envKey: key,
        picture: me.picture && me.picture.data ? me.picture.data.url : '',
        pageIds: accounts.map(a => a.id), tokenInfo: tinfo, status: 'ok', error: null,
      };
    } catch (e) {
      const old = Object.values(meta.profiles || {}).find(p => p.envKey === key);
      profile = old
        ? { ...old, tokenInfo: tinfo || old.tokenInfo, status: 'error', error: friendlyError(e) }
        : { id: 'unknown-' + key, name: `Unknown profile (${key})`, envKey: key, picture: '', pageIds: [], tokenInfo: tinfo, status: 'error', error: friendlyError(e) };
      errors.push({ profile: profile.name, message: friendlyError(e) });
    }
    profiles[profile.id] = profile;
  });
  return { profiles, errors };
}

// One sync step. opts: { force: bool (refresh everything now), budgetMs }
async function syncStep(cfg, store, opts = {}) {
  const started = Date.now();
  const deadline = started + (opts.budgetMs || 45000);
  const meta = (await store.get('meta')) || { profiles: {}, pageIds: [] };
  const tokens = (await store.get('tokens')) || {};
  const intervalMs = cfg.intervalHours * 3600000;

  // 1) profiles
  const profAge = meta.profilesRefreshedAt ? started - new Date(meta.profilesRefreshedAt) : Infinity;
  const keysChanged = JSON.stringify(cfg.tokens.map(t => t.key)) !== JSON.stringify(Object.values(meta.profiles || {}).map(p => p.envKey).sort());
  if (opts.force || keysChanged || profAge > PROFILE_REFRESH_MIN * 60000) {
    const { profiles, errors } = await refreshProfiles(cfg, meta, tokens);
    meta.profiles = profiles;
    meta.profileErrors = errors;
    meta.profilesRefreshedAt = new Date().toISOString();
    await store.set('tokens', tokens);
  }

  // owners
  const owners = {};
  for (const p of Object.values(meta.profiles || {})) for (const id of p.pageIds || []) (owners[id] = owners[id] || []).push(p.id);
  const pageIds = Object.keys(owners);
  const removed = (meta.pageIds || []).filter(id => !owners[id]);
  if (removed.length) await store.del(removed.map(id => 'page:' + id));
  meta.pageIds = pageIds;

  // 2) pages that are due
  const existing = await store.getMany(pageIds.map(id => 'page:' + id));
  const byId = Object.fromEntries(pageIds.map((id, i) => [id, existing[i]]));
  const syncStart = opts.forceSince ? new Date(opts.forceSince).getTime() : null;
  const isDue = id => {
    const p = byId[id];
    if (!p || !p.updatedAt) return true;
    if (p.status !== 'error' && p.lastPostKind === undefined) return true; // stored before post types existed
    const t = new Date(p.updatedAt).getTime();
    if (syncStart) return t < syncStart;
    return started - t > intervalMs - 5 * 60000; // 5 min tolerance
  };
  const due = pageIds.filter(isDue).sort((a, b) => new Date(byId[a]?.updatedAt || 0) - new Date(byId[b]?.updatedAt || 0));

  const updated = [];
  let done = 0;
  await mapLimit(due, CONCURRENCY, async id => {
    if (Date.now() > deadline) return;
    const old = byId[id];
    const tok = tokens[id];
    let page;
    try {
      if (!tok) throw new Error('No page token available - check the profile that manages this page');
      page = { ...(await fetchPage(cfg, id, tok)), status: 'ok', error: null };
    } catch (e) {
      page = old ? { ...old, status: 'error', error: friendlyError(e) } : { id, name: `Page ${id}`, posts: [], status: 'error', error: friendlyError(e) };
    }
    page.profileIds = owners[id];
    page.updatedAt = new Date().toISOString();
    updated.push(['page:' + id, page]);
    done++;
  });
  // keep owner lists current on pages we didn't touch
  for (const id of pageIds) {
    const p = byId[id];
    if (p && !updated.find(([k]) => k === 'page:' + id) && JSON.stringify(p.profileIds) !== JSON.stringify(owners[id])) {
      updated.push(['page:' + id, { ...p, profileIds: owners[id] }]);
    }
  }
  await store.setMany(updated);

  const remaining = due.length - done;
  if (done > 0 || !meta.lastSync) {
    meta.lastSync = new Date().toISOString();
  }
  meta.lastStep = { at: new Date().toISOString(), updated: done, remaining, ms: Date.now() - started };
  await store.set('meta', meta);
  return { updated: done, remaining, totalPages: pageIds.length, profiles: Object.keys(meta.profiles).length };
}

async function readAll(store) {
  const meta = (await store.get('meta')) || { profiles: {}, pageIds: [] };
  const list = await store.getMany((meta.pageIds || []).map(id => 'page:' + id));
  const pages = {};
  list.forEach(p => { if (p) pages[p.id] = p; });
  const errors = [...(meta.profileErrors || [])];
  for (const p of Object.values(pages)) if (p.status === 'error') errors.push({ page: p.name, message: p.error });
  return { profiles: meta.profiles || {}, pages, lastSync: meta.lastSync || null, lastStep: meta.lastStep || null, errors };
}

module.exports = { syncStep, readAll };
