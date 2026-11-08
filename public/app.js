// Page Tracker dashboard (vanilla JS). All dates are computed in this computer's local time.
const $ = s => document.querySelector(s);
const DAY = 86400000;
const st = { data: null, profile: null, sort: { key: 'last7', dir: -1 }, search: '', filter: 'all', kind: 'all', open: null, lastSync: null };

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

// ---------- post types ----------
// Fixed order = fixed colour slot (never re-assigned when filtering).
const KINDS = [
  { k: 'reel', label: 'Reels', one: 'Reel', icon: '🎬' },
  { k: 'picture', label: 'Pictures', one: 'Picture', icon: '🖼️' },
  { k: 'text', label: 'Text', one: 'Text', icon: '📝' },
  { k: 'other', label: 'Videos & links', one: 'Other', icon: '🔗' },
];
const KIND = Object.fromEntries(KINDS.map(x => [x.k, x]));
const RAW_LABEL = { video: 'Video', link: 'Link', other: 'Other' };

// raw kind from the server (older data: derive from status_type / link)
function rawKind(p) {
  if (p.kind) return p.kind;
  if (/\/reel\//.test(p.link || '')) return 'reel';
  if (p.type === 'added_photos') return 'picture';
  if (p.type === 'added_video') return 'video';
  if (p.type === 'shared_story') return 'link';
  if (!p.type || p.type === 'mobile_status_update') return 'text';
  return 'other';
}
const group = raw => (raw === 'reel' || raw === 'picture' || raw === 'text') ? raw : 'other';
function kindChip(raw, withLabel = true) {
  if (!raw) return '';
  const g = group(raw);
  const label = RAW_LABEL[raw] || KIND[g].one;
  return `<span class="kchip k-${g}" title="${esc(label)}"><span class="kdot"></span>${KIND[g].icon}${withLabel ? ' ' + esc(label) : ''}</span>`;
}

// ---------- date ranges ----------
const PERIODS = [
  { k: 'today', short: 'Today' },
  { k: 'yesterday', short: 'Yesterday' },
  { k: 'last7', short: 'Last 7 days' },
  { k: 'last30', short: 'Last 30 days' },
  { k: 'prevWeek', short: 'Prev. week' },
  { k: 'thisMonth', short: 'This month' },
  { k: 'prevMonth', short: 'Prev. month' },
];
function ranges() {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mon = new Date(t0); mon.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
  const prevMon = new Date(mon); prevMon.setDate(mon.getDate() - 7);
  const m1 = new Date(t0.getFullYear(), t0.getMonth(), 1);
  const pm1 = new Date(t0.getFullYear(), t0.getMonth() - 1, 1);
  const d = n => new Date(t0.getTime() - n * DAY);
  const tomorrow = new Date(t0.getTime() + DAY);
  return {
    today: [t0, tomorrow],
    yesterday: [d(1), t0],
    last7: [d(7), t0],
    last30: [d(30), t0],
    prevWeek: [prevMon, mon],
    thisMonth: [m1, tomorrow],
    prevMonth: [pm1, m1],
    t0,
  };
}
const R = { cur: ranges() };
const monthName = d => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
function periodLabel(k) {
  const r = R.cur;
  if (k === 'thisMonth') return monthName(r.thisMonth[0]);
  if (k === 'prevMonth') return monthName(r.prevMonth[0]);
  return PERIODS.find(p => p.k === k).short;
}

const emptyCounts = () => ({ total: 0, reel: 0, picture: 0, text: 0, other: 0 });
function countIn(posts, [a, b]) {
  const c = emptyCounts();
  for (const p of posts) {
    const t = new Date(p.created);
    if (t >= a && t < b) { c.total++; c[group(rawKind(p))]++; }
  }
  return c;
}
// value shown for the selected post type
const val = c => st.kind === 'all' ? c.total : c[st.kind];

function pageStats(p) {
  const posts = p.posts || [];
  const s = { c: {} };
  for (const { k } of PERIODS) s.c[k] = countIn(posts, R.cur[k]);
  s.lastPost = p.lastPostAt ? new Date(p.lastPostAt).getTime() : 0;
  s.lastKind = p.lastPostKind || (posts[0] ? rawKind(posts[0]) : null);
  const days = s.lastPost ? (Date.now() - s.lastPost) / DAY : Infinity;
  if (p.status === 'error') s.status = { cls: 'critical', label: 'Error', rank: 0 };
  else if (!s.lastPost) s.status = { cls: 'none', label: 'No posts', rank: 1 };
  else if (days <= 2) s.status = { cls: 'good', label: 'Active', rank: 4 };
  else if (days <= 7) s.status = { cls: 'warning', label: 'Slowing', rank: 3 };
  else s.status = { cls: 'serious', label: `Inactive ${Math.floor(days)}d`, rank: 2 };
  return s;
}
function addCounts(a, b) { for (const k in a) a[k] += b[k]; return a; }

// small "🎬9 🖼️1" line under a total (only when showing all types)
function breakdown(c, cls = 'bd') {
  if (st.kind !== 'all' || !c.total) return '';
  return `<div class="${cls}">${KINDS.filter(x => c[x.k]).map(x => `<span class="k-${x.k}" title="${c[x.k]} ${esc(x.label)}"><span class="kdot"></span>${x.icon}${c[x.k]}</span>`).join('')}</div>`;
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
    if (t.cls === 'critical') out.push(`<div class="alert"><b>${esc(p.name)}:</b>&nbsp;${esc(p.error || t.label)}. Pages keep updating with saved page tokens, but new pages won't be detected until the token is replaced.</div>`);
    else if (t.cls === 'warning') out.push(`<div class="alert warn"><b>${esc(p.name)}:</b>&nbsp;${esc(t.label)} – generate a new token and update it soon.</div>`);
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
  const s = { c: Object.fromEntries(PERIODS.map(p => [p.k, emptyCounts()])), followers: 0, posted7: 0 };
  for (const p of pages) {
    const x = pageStats(p);
    for (const { k } of PERIODS) addCounts(s.c[k], x.c[k]);
    s.followers += p.followers || 0;
    if (val(x.c.last7) > 0) s.posted7++;
  }
  return s;
}

function renderTiles() {
  const pages = profilePages(st.profile);
  const s = sumStats(pages);
  const scope = st.profile === 'all' ? 'All profiles' : profileName(st.profile);
  const r = R.cur;
  const what = st.kind === 'all' ? 'Posts' : KIND[st.kind].label;
  const tile = (label, c, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${num(val(c))}</div>${breakdown(c, 'bd tile-bd')}<div class="sub">${sub}</div></div>`;
  $('#tiles').innerHTML = [
    `<div class="tile"><div class="label">Pages</div><div class="value">${num(pages.length)}</div><div class="sub">${esc(scope)}</div></div>`,
    tile(`${what} today`, s.c.today, fmtDate(r.t0)),
    tile(`${what} yesterday`, s.c.yesterday, fmtDate(r.yesterday[0])),
    tile(`${what} · last 7 days`, s.c.last7, `${s.posted7} of ${pages.length} pages posted`),
    tile(`${what} · last 30 days`, s.c.last30, `${fmtDate(r.last30[0])} – ${fmtDate(new Date(r.t0 - DAY))}`),
    tile(`${what} · ${monthName(r.thisMonth[0])}`, s.c.thisMonth, `${fmtDate(r.thisMonth[0])} – today`),
  ].join('');
}

function renderProfiles() {
  const profiles = Object.values(st.data.profiles || {});
  $('#profileCount').textContent = `${profiles.length} profile${profiles.length === 1 ? '' : 's'}`;
  const card = (id, name, pic, pages, extra) => {
    const s = sumStats(pages);
    const stat = (k, label) => `<div class="stat"><b>${val(s.c[k])}</b><span>${label}</span></div>`;
    return `<button class="profile ${st.profile === id ? 'selected' : ''}" data-profile="${esc(id)}">
      <div class="head">
        ${pic ? `<img class="avatar" src="${esc(pic)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar initials',textContent:'${esc(initials(name))}'}))">` : `<div class="avatar initials">${esc(initials(name))}</div>`}
        <div><div class="name">${esc(name)}</div><div class="muted">${pages.length} page${pages.length === 1 ? '' : 's'}</div></div>
      </div>
      <div class="stats">${stat('today', 'Today')}${stat('yesterday', 'Yesterday')}${stat('last7', '7 days')}${stat('last30', '30 days')}</div>
      ${breakdown(s.c.last30, 'bd card-bd')}
      ${extra}
    </button>`;
  };
  let html = '';
  if (profiles.length > 1) html += card('all', 'All profiles', '', profilePages('all'), `<span class="badge"><span class="dot none"></span>${profiles.length} profiles combined</span>`);
  for (const p of profiles) {
    const t = tokenState(p);
    html += card(p.id, p.name, p.picture, profilePages(p.id), `<span class="badge"><span class="dot ${t.cls}"></span>${esc(t.label)}</span>`);
  }
  $('#profiles').innerHTML = html || `<div class="empty">No profiles yet – add a token and click Sync now.</div>`;
}

function renderTable() {
  const r = R.cur;
  const all = st.profile === 'all';
  $('#pagesTitle').textContent = (all ? 'All pages' : `Pages of ${profileName(st.profile)}`) + (st.kind === 'all' ? '' : ` · ${KIND[st.kind].label} only`);
  document.querySelectorAll('.col-profile').forEach(el => el.hidden = !all);
  for (const { k } of PERIODS) { const th = document.querySelector(`th[data-sort="${k}"]`); if (th) th.textContent = periodLabel(k); }
  $('#ranges').innerHTML =
    `Yesterday = ${fmtDate(r.yesterday[0])} · Last 7 days = ${fmtDate(r.last7[0])}–${fmtDate(new Date(r.t0 - DAY))} · ` +
    `Last 30 days = ${fmtDate(r.last30[0])}–${fmtDate(new Date(r.t0 - DAY))} · Prev. week = ${fmtDate(r.prevWeek[0])}–${fmtDate(new Date(r.prevWeek[1] - DAY))} (Mon–Sun) · ` +
    `Today &amp; this month grow with each sync.` +
    `<span class="legend">${KINDS.map(x => `<span class="k-${x.k}"><span class="kdot"></span>${x.icon} ${esc(x.label)}</span>`).join('')}</span>`;

  let rows = profilePages(st.profile).map(p => ({ p, s: pageStats(p) }));
  const q = st.search.trim().toLowerCase();
  if (q) rows = rows.filter(({ p }) => (p.name + ' ' + p.category).toLowerCase().includes(q));
  if (st.filter === 'today') rows = rows.filter(x => val(x.s.c.today) > 0);
  if (st.filter === 'yesterday') rows = rows.filter(x => val(x.s.c.yesterday) > 0);
  if (st.filter === 'none-yesterday') rows = rows.filter(x => val(x.s.c.yesterday) === 0);
  if (st.filter === 'inactive') rows = rows.filter(x => val(x.s.c.last7) === 0);

  const { key, dir } = st.sort;
  const sortVal = ({ p, s }) => key === 'name' ? p.name.toLowerCase() : key === 'profile' ? (p.profileIds || []).map(profileName).join(',') :
    key === 'followers' ? (p.followers ?? -1) : key === 'status' ? s.status.rank : key === 'lastPost' ? s.lastPost : val(s.c[key]);
  rows.sort((a, b) => { const x = sortVal(a), y = sortVal(b); return (x > y ? 1 : x < y ? -1 : 0) * dir || a.p.name.localeCompare(b.p.name); });
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === key);
    th.classList.toggle('asc', th.dataset.sort === key && dir === 1);
  });

  const cell = c => { const n = val(c); return `<td class="${n ? '' : 'zero'}"><div class="n">${n}</div>${breakdown(c)}</td>`; };
  const cols = (all ? 4 : 3) + PERIODS.length + 1;
  $('#pagesBody').innerHTML = rows.map(({ p, s }) => `
    <tr class="row ${st.open === p.id ? 'open' : ''}" data-page="${esc(p.id)}">
      <td class="left"><div class="pagecell">
        ${p.picture ? `<img class="avatar sm" src="${esc(p.picture)}" alt="">` : `<div class="avatar sm"></div>`}
        <div><div class="pname">${esc(p.name)}</div><div class="pcat">${esc(p.category || '')}</div></div>
      </div></td>
      ${all ? `<td class="left col-profile">${esc((p.profileIds || []).map(profileName).join(', '))}</td>` : ''}
      <td>${num(p.followers)}</td>
      ${PERIODS.map(({ k }) => cell(s.c[k])).join('')}
      <td class="lastpost" title="${esc(fmtDateTime(p.lastPostAt))}"><div class="n">${p.lastPostAt ? ago(p.lastPostAt) : '–'}</div>${kindChip(s.lastKind)}</td>
      <td class="left"><span class="badge"><span class="dot ${s.status.cls}"></span>${esc(s.status.label)}</span></td>
    </tr>
    ${st.open === p.id ? `<tr class="detail"><td colspan="${cols}">${detail(p, s)}</td></tr>` : ''}`).join('')
    || `<tr><td colspan="${cols}" class="empty">No pages match.</td></tr>`;

  const tot = Object.fromEntries(PERIODS.map(({ k }) => [k, emptyCounts()]));
  let f = 0;
  for (const { p, s } of rows) { for (const { k } of PERIODS) addCounts(tot[k], s.c[k]); f += p.followers || 0; }
  $('#pagesFoot').innerHTML = rows.length ? `<tr><td class="left">Total (${rows.length} pages)</td>${all ? '<td class="col-profile"></td>' : ''}
    <td>${num(f)}</td>${PERIODS.map(({ k }) => `<td><div class="n">${val(tot[k])}</div>${breakdown(tot[k])}</td>`).join('')}<td></td><td></td></tr>` : '';
}

function typeMatrix(s) {
  const head = PERIODS.map(({ k }) => `<th>${esc(periodLabel(k))}</th>`).join('');
  const row = x => `<tr><td class="left"><span class="k-${x.k}"><span class="kdot"></span>${x.icon} ${esc(x.label)}</span></td>${PERIODS.map(({ k }) => `<td class="${s.c[k][x.k] ? '' : 'zero'}">${s.c[k][x.k]}</td>`).join('')}</tr>`;
  return `<div class="matrix-wrap"><table class="matrix">
    <thead><tr><th class="left">Type</th>${head}</tr></thead>
    <tbody>${KINDS.map(row).join('')}</tbody>
    <tfoot><tr><td class="left">All posts</td>${PERIODS.map(({ k }) => `<td>${s.c[k].total}</td>`).join('')}</tr></tfoot>
  </table></div>`;
}

function detail(p, s) {
  const posts = (p.posts || []).slice(0, 20);
  return `<div class="detail-grid">
    <div style="display:grid;gap:14px;align-content:start;min-width:0">
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
          <dt>Last post</dt><dd>${fmtDateTime(p.lastPostAt)} ${kindChip(s.lastKind)}</dd>
          <dt>Data updated</dt><dd>${fmtDateTime(p.updatedAt)}</dd>
          ${p.error ? `<dt>Error</dt><dd class="err">${esc(p.error)}</dd>` : ''}
        </dl>
      </div>
      <div class="card">
        <h3>Posts by type</h3>
        ${typeMatrix(s)}
      </div>
      <div class="card chart">
        <h3>Posts per day by type – last 30 days</h3>
        <div class="legend">${KINDS.map(x => `<span class="k-${x.k}"><span class="kdot"></span>${x.icon} ${esc(x.label)}</span>`).join('')}</div>
        ${chart(p)}
      </div>
    </div>
    <div class="card">
      <h3>Recent posts (${posts.length}${(p.posts || []).length > posts.length ? ' of ' + p.posts.length : ''})</h3>
      <div class="posts">
        ${posts.map(x => `<div class="post">
          ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}
          <div>
            <div class="meta">${kindChip(rawKind(x))}<span>${fmtDateTime(x.created)}</span>
              ${x.reactions != null ? `<span>👍 ${num(x.reactions)}</span>` : ''}
              ${x.comments != null ? `<span>💬 ${num(x.comments)}</span>` : ''}
              ${x.shares ? `<span>↗ ${num(x.shares)}</span>` : ''}
            </div>
            <div class="msg">${esc(x.message || '(no text)')}</div>
            ${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">View post ↗</a>` : ''}
          </div>
        </div>`).join('') || `<div class="muted">No posts in the last 70 days.</div>`}
      </div>
    </div>
  </div>`;
}

// stacked bars: one segment per post type, fixed order bottom→top, 2px gap between segments
function chart(p) {
  const t0 = R.cur.t0;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const a = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - i);
    const b = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - i + 1);
    days.push({ d: a, c: countIn(p.posts || [], [a, b]) });
  }
  const max = Math.max(1, ...days.map(x => x.c.total));
  const W = 600, H = 160, padL = 4, padB = 20, padT = 14, slot = (W - padL) / 30, bw = Math.max(4, slot - 4), GAP = 2;
  const unit = (H - padB - padT) / max;
  const bars = days.map((x, i) => {
    const x0 = padL + i * slot + (slot - bw) / 2;
    let yBase = H - padB;
    const segs = KINDS.filter(k => x.c[k.k]);
    const paths = segs.map((k, si) => {
      const h = x.c[k.k] * unit - (si > 0 ? GAP : 0);
      const top = yBase - (si > 0 ? GAP : 0) - h;
      const isTop = si === segs.length - 1;
      const r = isTop ? Math.min(4, bw / 2, h) : 0;
      const bottom = yBase - (si > 0 ? GAP : 0);
      yBase = top;
      if (h <= 0) return '';
      return `<path class="seg k-${k.k}" d="M${x0},${bottom} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${bottom} Z"></path>`;
    }).join('');
    const parts = KINDS.filter(k => x.c[k.k]).map(k => `${x.c[k.k]} ${k.label.toLowerCase()}`).join(', ');
    const label = `${x.d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${x.c.total} post${x.c.total === 1 ? '' : 's'}${parts ? ' (' + parts + ')' : ''}`;
    return `<g data-tip="${esc(label)}"><rect class="bar-hit" x="${padL + i * slot}" y="0" width="${slot}" height="${H}"></rect>${paths}</g>`;
  }).join('');
  const ticks = days.map((x, i) => (i % 7 === 2 || i === 29) ? `<text x="${i === 29 ? W : padL + i * slot + slot / 2}" y="${H - 5}" text-anchor="${i === 29 ? 'end' : 'middle'}">${i === 29 ? 'Today' : fmtDate(x.d)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Posts per day by type for the last 30 days, maximum ${max}">
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
$('#kind').addEventListener('change', e => { st.kind = e.target.value; render(); });
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
