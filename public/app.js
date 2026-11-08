// Page Tracker dashboard (vanilla JS). All dates are computed in this computer's local time.
const $ = s => document.querySelector(s);
const DAY = 86400000;
const st = { data: null, profile: null, sort: { key: 'last7', dir: -1 }, search: '', filter: 'all', open: null, lastSync: null };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => n == null ? '–' : Number(n).toLocaleString();
const fmtDate = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}

// ---------- date ranges ----------
function ranges() {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mon = new Date(t0); mon.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
  const prevMon = new Date(mon); prevMon.setDate(mon.getDate() - 7);
  const m1 = new Date(t0.getFullYear(), t0.getMonth(), 1);
  const pm1 = new Date(t0.getFullYear(), t0.getMonth() - 1, 1);
  const d = n => new Date(t0.getTime() - n * DAY);
  return {
    today: [t0, new Date(t0.getTime() + DAY)],
    yesterday: [d(1), t0],
    last7: [d(7), t0],
    last30: [d(30), t0],
    prevWeek: [prevMon, mon],
    prevMonth: [pm1, m1],
    t0,
  };
}
const R = { cur: ranges() };

function countIn(posts, [a, b]) {
  let n = 0;
  for (const p of posts) { const t = new Date(p.created); if (t >= a && t < b) n++; }
  return n;
}

function pageStats(p) {
  const posts = p.posts || [];
  const r = R.cur;
  const s = {
    today: countIn(posts, r.today), yesterday: countIn(posts, r.yesterday),
    last7: countIn(posts, r.last7), last30: countIn(posts, r.last30),
    prevWeek: countIn(posts, r.prevWeek), prevMonth: countIn(posts, r.prevMonth),
    lastPost: p.lastPostAt ? new Date(p.lastPostAt).getTime() : 0,
  };
  const days = s.lastPost ? (Date.now() - s.lastPost) / DAY : Infinity;
  if (p.status === 'error') s.status = { cls: 'critical', label: 'Error', rank: 0 };
  else if (!s.lastPost) s.status = { cls: 'none', label: 'No posts', rank: 1 };
  else if (days <= 2) s.status = { cls: 'good', label: 'Active', rank: 4 };
  else if (days <= 7) s.status = { cls: 'warning', label: 'Slowing', rank: 3 };
  else s.status = { cls: 'serious', label: `Inactive ${Math.floor(days)}d`, rank: 2 };
  return s;
}

// ---------- data ----------
async function load() {
  const res = await fetch('/api/data', { credentials: 'same-origin' });
  if (res.status === 401) return showLogin();
  const json = await res.json();
  if (!res.ok) { $('#alerts').innerHTML = `<div class="alert"><b>Error:</b>&nbsp;${esc(json.error || res.status)}</div>`; return; }
  $('#login').hidden = true; $('#app').hidden = false;
  st.data = json;
  $('#logoutBtn').hidden = !json.passwordProtected;
  st.lastSync = st.data.lastSync;
  const ids = Object.keys(st.data.profiles || {});
  if (!st.profile || (st.profile !== 'all' && !ids.includes(st.profile))) st.profile = ids.length > 1 ? 'all' : ids[0] || 'all';
  render();
}

function profilePages(pid) {
  const pages = Object.values(st.data.pages || {});
  return pid === 'all' ? pages : pages.filter(p => (p.profileIds || []).includes(pid));
}
function profileName(id) { return st.data.profiles[id]?.name || id; }
function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('').replace(/'/g, ''); }

// ---------- render ----------
function render() {
  R.cur = ranges();
  renderSync();
  renderAlerts();
  renderTiles();
  renderProfiles();
  renderTable();
}

function renderSync() {
  const d = st.data;
  if (st.syncing) return;
  const txt = $('#syncText'), btn = $('#syncBtn');
  const pending = d.lastStep && d.lastStep.remaining ? ` · ${d.lastStep.remaining} page(s) waiting to update` : '';
  txt.textContent = `Last synced ${ago(d.lastSync)} · auto-refresh every ${d.intervalHours} h${pending}`;
  txt.title = d.lastSync ? fmtDateTime(d.lastSync) : '';
  btn.disabled = false; btn.textContent = 'Sync now';
}

// ---------- login ----------
function showLogin() {
  $('#app').hidden = true; $('#login').hidden = false;
  setTimeout(() => $('#password').focus(), 50);
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn'); btn.disabled = true; $('#loginErr').textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) });
    if (r.ok) { $('#password').value = ''; await load(); }
    else $('#loginErr').textContent = (await r.json()).error || 'Login failed';
  } catch { $('#loginErr').textContent = 'Network error'; }
  btn.disabled = false;
});
$('#logoutBtn').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); });

function renderAlerts() {
  const out = [];
  const d = st.data;
  if (!d.lastSync && !st.syncing) out.push(`<div class="alert">No data yet. Click <b>Sync now</b>${d.profilesConfigured ? '' : ' – but first add a Facebook token (TOKEN setting / .env line)'}.</div>`);
  if (st.syncError) out.push(`<div class="alert"><b>Sync failed:</b>&nbsp;${esc(st.syncError)}</div>`);
  for (const p of Object.values(d.profiles || {})) {
    const t = tokenState(p);
    if (t.cls === 'critical') out.push(`<div class="alert"><b>${esc(p.name)}:</b>&nbsp;${esc(p.error || t.label)}. Pages keep updating with saved page tokens, but new pages won't be detected until the token in <code>.env</code> is replaced.</div>`);
    else if (t.cls === 'warning') out.push(`<div class="alert warn"><b>${esc(p.name)}:</b>&nbsp;${esc(t.label)} – generate a new token and update <code>.env</code> soon.</div>`);
  }
  const pageErrs = Object.values(d.pages || {}).filter(p => p.status === 'error');
  if (pageErrs.length) out.push(`<div class="alert warn"><b>${pageErrs.length} page(s) failed to update:</b>&nbsp;${pageErrs.map(p => esc(p.name)).join(', ')}. Open the page row for details.</div>`);
  $('#alerts').innerHTML = out.join('');
}

function tokenState(p) {
  const t = p.tokenInfo;
  if (p.status === 'error') return { cls: 'critical', label: 'Token problem' };
  if (!t) return { cls: 'none', label: 'Token status unknown' };
  if (!t.valid) return { cls: 'critical', label: 'Token invalid' };
  const dates = [t.expiresAt, t.dataAccessExpiresAt].filter(Boolean).map(x => new Date(x));
  if (!dates.length) return { cls: 'good', label: 'Token never expires' };
  const first = new Date(Math.min(...dates));
  const days = Math.floor((first - Date.now()) / DAY);
  if (days < 0) return { cls: 'critical', label: 'Token expired' };
  if (days <= 10) return { cls: 'warning', label: `Token expires in ${days} day${days === 1 ? '' : 's'}` };
  return { cls: 'good', label: `Token valid until ${first.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` };
}

function sumStats(pages) {
  const s = { today: 0, yesterday: 0, last7: 0, last30: 0, prevWeek: 0, prevMonth: 0, followers: 0 };
  for (const p of pages) { const x = pageStats(p); for (const k of Object.keys(s)) s[k] += k === 'followers' ? (p.followers || 0) : x[k]; }
  return s;
}

function renderTiles() {
  const pages = profilePages(st.profile);
  const s = sumStats(pages);
  const active = pages.filter(p => pageStats(p).last7 > 0).length;
  const scope = st.profile === 'all' ? 'All profiles' : profileName(st.profile);
  const r = R.cur;
  const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  $('#tiles').innerHTML = [
    tile('Pages', num(pages.length), esc(scope)),
    tile('Posts today', num(s.today), fmtDate(r.t0)),
    tile('Posts yesterday', num(s.yesterday), fmtDate(r.yesterday[0])),
    tile('Last 7 days', num(s.last7), `${active} of ${pages.length} pages posted`),
    tile('Last 30 days', num(s.last30), `${fmtDate(r.last30[0])} – ${fmtDate(new Date(r.t0 - DAY))}`),
    tile('Followers', num(s.followers), 'across these pages'),
  ].join('');
}

function renderProfiles() {
  const profiles = Object.values(st.data.profiles || {});
  $('#profileCount').textContent = `${profiles.length} profile${profiles.length === 1 ? '' : 's'}`;
  const card = (id, name, pic, pages, extra) => {
    const s = sumStats(pages);
    return `<button class="profile ${st.profile === id ? 'selected' : ''}" data-profile="${esc(id)}">
      <div class="head">
        ${pic ? `<img class="avatar" src="${esc(pic)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar initials',textContent:'${esc(initials(name))}'}))">` : `<div class="avatar initials">${esc(initials(name))}</div>`}
        <div><div class="name">${esc(name)}</div><div class="muted">${pages.length} page${pages.length === 1 ? '' : 's'}</div></div>
      </div>
      <div class="stats">
        <div class="stat"><b>${s.today}</b><span>Today</span></div>
        <div class="stat"><b>${s.yesterday}</b><span>Yesterday</span></div>
        <div class="stat"><b>${s.last7}</b><span>7 days</span></div>
        <div class="stat"><b>${s.last30}</b><span>30 days</span></div>
      </div>
      ${extra}
    </button>`;
  };
  let html = '';
  if (profiles.length > 1) html += card('all', 'All profiles', '', profilePages('all'), `<span class="badge"><span class="dot none"></span>${profiles.length} profiles combined</span>`);
  for (const p of profiles) {
    const t = tokenState(p);
    html += card(p.id, p.name, p.picture, profilePages(p.id), `<span class="badge"><span class="dot ${t.cls}"></span>${esc(t.label)}</span>`);
  }
  $('#profiles').innerHTML = html || `<div class="empty">No profiles yet – add a token to .env and click Sync now.</div>`;
}

function renderTable() {
  const r = R.cur;
  const all = st.profile === 'all';
  $('#pagesTitle').textContent = all ? 'All pages' : `Pages of ${profileName(st.profile)}`;
  $('#pagesTable').classList.toggle('single', !all);
  document.querySelectorAll('.col-profile').forEach(el => el.hidden = !all);
  $('#prevMonthHead').textContent = r.prevMonth[0].toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  $('#ranges').textContent =
    `Yesterday = ${fmtDate(r.yesterday[0])} · Last 7 days = ${fmtDate(r.last7[0])}–${fmtDate(new Date(r.t0 - DAY))} · ` +
    `Last 30 days = ${fmtDate(r.last30[0])}–${fmtDate(new Date(r.t0 - DAY))} · Prev. week = ${fmtDate(r.prevWeek[0])}–${fmtDate(new Date(r.prevWeek[1] - DAY))} (Mon–Sun) · ` +
    `Today counts are live and grow with each sync.`;

  let rows = profilePages(st.profile).map(p => ({ p, s: pageStats(p) }));
  const q = st.search.trim().toLowerCase();
  if (q) rows = rows.filter(({ p }) => (p.name + ' ' + p.category).toLowerCase().includes(q));
  if (st.filter === 'today') rows = rows.filter(x => x.s.today > 0);
  if (st.filter === 'yesterday') rows = rows.filter(x => x.s.yesterday > 0);
  if (st.filter === 'none-yesterday') rows = rows.filter(x => x.s.yesterday === 0);
  if (st.filter === 'inactive') rows = rows.filter(x => x.s.last7 === 0);

  const { key, dir } = st.sort;
  const val = ({ p, s }) => key === 'name' ? p.name.toLowerCase() : key === 'profile' ? (p.profileIds || []).map(profileName).join(',') :
    key === 'followers' ? (p.followers ?? -1) : key === 'status' ? s.status.rank : s[key];
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir || a.p.name.localeCompare(b.p.name); });
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === key);
    th.classList.toggle('asc', th.dataset.sort === key && dir === 1);
  });

  const cell = n => `<td class="${n ? '' : 'zero'}">${n}</td>`;
  const cols = all ? 11 : 10;
  $('#pagesBody').innerHTML = rows.map(({ p, s }) => `
    <tr class="row ${st.open === p.id ? 'open' : ''}" data-page="${esc(p.id)}">
      <td class="left"><div class="pagecell">
        ${p.picture ? `<img class="avatar sm" src="${esc(p.picture)}" alt="">` : `<div class="avatar sm"></div>`}
        <div><div class="pname">${esc(p.name)}</div><div class="pcat">${esc(p.category || '')}</div></div>
      </div></td>
      ${all ? `<td class="left col-profile">${esc((p.profileIds || []).map(profileName).join(', '))}</td>` : ''}
      <td>${num(p.followers)}</td>
      ${cell(s.today)}${cell(s.yesterday)}${cell(s.last7)}${cell(s.last30)}${cell(s.prevWeek)}${cell(s.prevMonth)}
      <td title="${esc(fmtDateTime(p.lastPostAt))}">${p.lastPostAt ? ago(p.lastPostAt) : '–'}</td>
      <td class="left"><span class="badge"><span class="dot ${s.status.cls}"></span>${esc(s.status.label)}</span></td>
    </tr>
    ${st.open === p.id ? `<tr class="detail"><td colspan="${cols}">${detail(p, s)}</td></tr>` : ''}`).join('')
    || `<tr><td colspan="${cols}" class="empty">No pages match.</td></tr>`;

  const tot = rows.reduce((a, { p, s }) => { for (const k of ['today', 'yesterday', 'last7', 'last30', 'prevWeek', 'prevMonth']) a[k] += s[k]; a.f += p.followers || 0; return a; },
    { today: 0, yesterday: 0, last7: 0, last30: 0, prevWeek: 0, prevMonth: 0, f: 0 });
  $('#pagesFoot').innerHTML = rows.length ? `<tr><td class="left">Total (${rows.length} pages)</td>${all ? '<td class="col-profile"></td>' : ''}
    <td>${num(tot.f)}</td><td>${tot.today}</td><td>${tot.yesterday}</td><td>${tot.last7}</td><td>${tot.last30}</td><td>${tot.prevWeek}</td><td>${tot.prevMonth}</td><td></td><td></td></tr>` : '';
}

function detail(p, s) {
  const posts = (p.posts || []).slice(0, 20);
  return `<div class="detail-grid">
    <div style="display:grid;gap:14px;align-content:start">
      <div class="card">
        <h3>Page details</h3>
        ${p.about ? `<p class="about">${esc(p.about)}</p>` : ''}
        <dl class="kv">
          <dt>Page ID</dt><dd>${esc(p.id)}</dd>
          <dt>Category</dt><dd>${esc(p.category || '–')}</dd>
          ${p.username ? `<dt>Username</dt><dd>@${esc(p.username)}</dd>` : ''}
          <dt>Followers</dt><dd>${num(p.followers)}</dd>
          <dt>Likes</dt><dd>${num(p.likes)}</dd>
          <dt>Link</dt><dd><a href="${esc(p.link)}" target="_blank" rel="noopener">Open on Facebook ↗</a></dd>
          <dt>Last post</dt><dd>${fmtDateTime(p.lastPostAt)}</dd>
          <dt>Data updated</dt><dd>${fmtDateTime(p.updatedAt)}</dd>
          ${p.error ? `<dt>Error</dt><dd class="err">${esc(p.error)}</dd>` : ''}
        </dl>
      </div>
      <div class="card chart">
        <h3>Posts per day – last 30 days</h3>
        ${chart(p)}
      </div>
    </div>
    <div class="card">
      <h3>Recent posts (${posts.length}${(p.posts || []).length > posts.length ? ' of ' + p.posts.length : ''})</h3>
      <div class="posts">
        ${posts.map(x => `<div class="post">
          ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}
          <div>
            <div class="meta"><span>${fmtDateTime(x.created)}</span>
              ${x.reactions != null ? `<span>👍 ${num(x.reactions)}</span>` : ''}
              ${x.comments != null ? `<span>💬 ${num(x.comments)}</span>` : ''}
              ${x.shares ? `<span>↗ ${num(x.shares)}</span>` : ''}
            </div>
            <div class="msg">${esc(x.message || '(no text)')}</div>
            ${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">View post ↗</a>` : ''}
          </div>
        </div>`).join('') || `<div class="muted">No posts in the last ${70} days.</div>`}
      </div>
    </div>
  </div>`;
}

function chart(p) {
  const t0 = R.cur.t0;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const a = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - i);
    const b = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - i + 1);
    days.push({ d: a, n: countIn(p.posts || [], [a, b]) });
  }
  const max = Math.max(1, ...days.map(x => x.n));
  const W = 600, H = 150, padL = 4, padB = 20, padT = 14, slot = (W - padL) / 30, bw = Math.max(4, slot - 4);
  const y = n => H - padB - (n / max) * (H - padB - padT);
  const bars = days.map((x, i) => {
    const x0 = padL + i * slot + (slot - bw) / 2;
    const yy = y(x.n), h = H - padB - yy;
    const label = `${x.d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${x.n} post${x.n === 1 ? '' : 's'}`;
    // bar with rounded top (4px), square at baseline
    const r = Math.min(4, bw / 2, h);
    const path = h > 0 ? `M${x0},${H - padB} V${yy + r} Q${x0},${yy} ${x0 + r},${yy} H${x0 + bw - r} Q${x0 + bw},${yy} ${x0 + bw},${yy + r} V${H - padB} Z` : '';
    return `<g data-tip="${esc(label)}"><rect class="bar-hit" x="${padL + i * slot}" y="0" width="${slot}" height="${H}"></rect>${path ? `<path class="bar" d="${path}"></path>` : ''}</g>`;
  }).join('');
  const ticks = days.map((x, i) => (i % 7 === 2 || i === 29) ? `<text x="${i === 29 ? W : padL + i * slot + slot / 2}" y="${H - 5}" text-anchor="${i === 29 ? 'end' : 'middle'}">${i === 29 ? 'Today' : fmtDate(x.d)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Posts per day for the last 30 days, maximum ${max}">
    <text x="${padL}" y="10">max ${max}/day</text>
    <line class="axis" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"></line>
    ${bars}${ticks}
  </svg>`;
}

// ---------- events ----------
document.addEventListener('click', e => {
  const prof = e.target.closest('[data-profile]');
  if (prof) { st.profile = prof.dataset.profile; st.open = null; render(); return; }
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    st.sort = st.sort.key === k ? { key: k, dir: -st.sort.dir } : { key: k, dir: (k === 'name' || k === 'profile') ? 1 : -1 };
    renderTable(); return;
  }
  const row = e.target.closest('tr.row');
  if (row && !e.target.closest('a')) { st.open = st.open === row.dataset.page ? null : row.dataset.page; renderTable(); }
});
$('#search').addEventListener('input', e => { st.search = e.target.value; renderTable(); });
$('#filter').addEventListener('change', e => { st.filter = e.target.value; renderTable(); });
// Sync now: refreshes everything. The server works in time-limited steps, so keep calling
// until no pages remain.
$('#syncBtn').addEventListener('click', async () => {
  const btn = $('#syncBtn'), txt = $('#syncText');
  st.syncing = true; st.syncError = null;
  btn.disabled = true; btn.textContent = 'Syncing…'; txt.textContent = 'Reading profiles and pages…';
  const since = Date.now();
  try {
    let first = true;
    for (let i = 0; i < 100; i++) {
      const r = await fetch(`/api/sync?since=${since}${first ? '&force=1' : ''}`, { method: 'POST' });
      if (r.status === 401) { st.syncing = false; return showLogin(); }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      first = false;
      txt.textContent = `Updating pages… ${j.totalPages - j.remaining} of ${j.totalPages}`;
      if (!j.remaining) break;
    }
  } catch (e) { st.syncError = e.message; }
  st.syncing = false;
  await load();
});

const tip = $('#tooltip');
document.addEventListener('mousemove', e => {
  const g = e.target.closest && e.target.closest('[data-tip]');
  if (!g) { tip.hidden = true; return; }
  tip.textContent = g.dataset.tip; tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = (e.clientY - 34) + 'px';
});

// ---------- refresh ----------
// reload data every 5 minutes; re-render every minute so "x min ago" and day ranges stay current
setInterval(() => { if (!st.syncing && !$('#app').hidden) load(); }, 5 * 60000);
setInterval(() => { if (st.data && !st.syncing && !$('#app').hidden) render(); }, 60000);

// deep link: http://localhost:3000/#page=<pageId> opens that page's details
const hp = location.hash.match(/page=([^&]+)/);
if (hp) st.open = decodeURIComponent(hp[1]);
load();
