/* TIN Treasure Hunt — live app (Explorer, Merchant and TIN HQ views). */
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtD = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; throw e; }
  return data;
}

const ICON = {
  hunt: '<path d="M3 7h18v12H3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 11h18M10 11v3h4v-3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 7c0-2 2-3 7-3s7 1 7 3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  polly: '<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="9" cy="10.5" r="1" fill="currentColor"/><circle cx="13" cy="10.5" r="1" fill="currentColor"/><circle cx="17" cy="10.5" r="1" fill="currentColor"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 6l10-3 1 3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  claims: '<rect x="4" y="4" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="4" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="14" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" stroke="currentColor" stroke-width="1.6"/>',
  scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  list: '<path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="1.6"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const CATS = ['Food', 'Drink', 'Dessert', 'Adventure', 'Shopping', 'Mystery'];
const CAT_EMO = { Food: '🍔', Drink: '🍺', Dessert: '🍦', Adventure: '🧭', Shopping: '🛍️', Mystery: '🎁' };
const RADII = [100, 1000, 5000, 10000];

function toast(msg, where = $('#phone')) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  if (where === document.body) Object.assign(t.style, { position: 'fixed', bottom: '24px' });
  where.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------- state ---------- */
const params = new URLSearchParams(location.search);
const S = {
  me: null, dest: null, hunt: null, settings: null, here: null, locSource: 'center',
  radiusIdx: 2, cat: 'All', mode: 'traveler', view: 'hunt', arg: null, chat: [], poll: null,
};
try { const saved = JSON.parse(localStorage.getItem('tin-th-ui') || '{}'); if (saved.radiusIdx != null) S.radiusIdx = saved.radiusIdx; if (saved.mode) S.mode = saved.mode; } catch {}
const saveUi = () => { try { localStorage.setItem('tin-th-ui', JSON.stringify({ radiusIdx: S.radiusIdx, mode: S.mode })); } catch {} };

/* ---------- location ---------- */
function startLocation() {
  const center = { lat: S.dest.lat, lng: S.dest.lng };
  S.here = center;
  setLoc(`${S.dest.name} · town centre`);
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((p) => {
    const g = { lat: p.coords.latitude, lng: p.coords.longitude };
    const far = haversine(g, center) > 40000;
    if (far) { S.locSource = 'center'; setLoc(`Not in ${S.dest.name} yet · showing from town`); return; }
    const moved = !S.here || haversine(g, S.here) > 40;
    S.here = g; S.locSource = 'gps'; setLoc(`Your location · ${S.dest.name}`);
    if (moved && S.mode === 'traveler' && ['hunt', 'map'].includes(S.view)) render();
  }, () => setLoc(`${S.dest.name} · town centre (location off)`), { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}
function haversine(a, b) {
  const R = 6371e3, t = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * t / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin((b.lng - a.lng) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const setLoc = (t) => { $('#locTxt').textContent = t; };
const hereQs = () => (S.locSource === 'gps' ? `&lat=${S.here.lat}&lng=${S.here.lng}` : '');

/* ---------- boot ---------- */
async function boot() {
  try { S.me = (await api('/api/me')).user; } catch { S.me = null; }
  if (!S.me) { location.href = `/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
  const destId = params.get('d') || S.me.destination || 'cozumel';
  const d = await api(`/api/destinations/${destId}`);
  S.dest = d.destination; S.hunt = d.hunt; S.settings = d.settings; S.nextRaffleAt = d.nextRaffleAt;
  document.title = `TIN Treasure Hunt · ${S.dest.name}`;
  const sw = $('#viewsw');
  const canMerchant = S.me.role === 'merchant' || S.me.role === 'admin';
  const canHq = S.me.role === 'admin';
  $('[data-mode="merchant"]', sw).hidden = !canMerchant;
  $('[data-mode="hq"]', sw).hidden = !canHq;
  sw.hidden = !canMerchant;
  if ((S.mode === 'merchant' && !canMerchant) || (S.mode === 'hq' && !canHq)) S.mode = 'traveler';
  $$('[data-mode]', sw).forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('#credBtn').onclick = () => { setMode('traveler'); go('wallet'); };
  startLocation();
  refreshCredits();
  setMode(S.mode, true);
  handlePaymentReturn();
}

async function handlePaymentReturn() {
  const paid = params.get('paid'), unpaid = params.get('unpaid');
  if (!paid && !unpaid) return;
  history.replaceState(null, '', location.pathname);
  if (S.me.role === 'traveler') return;
  S.mode = 'merchant'; saveUi(); setMode('merchant');
  if (unpaid) { go('mList'); toast('Payment not finished. You can pay any time from My treasures.'); return; }
  try {
    const r = await api(`/api/merchant/checkout/${encodeURIComponent(paid)}`);
    go('mList');
    toast(r.paid ? `Payment received! “${r.title}” is with TIN HQ for approval.` : 'Payment is processing. We will update it shortly.');
  } catch (e) { go('mList'); toast(e.message); }
}

async function refreshCredits() {
  try { const c = await api('/api/me/credits'); S.credits = c; $('#credBtn').textContent = `🪙 ${c.treasureHunt.balance}`; } catch {}
}

function setMode(m, first) {
  S.mode = m; saveUi();
  $$('#viewsw [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('#phone').hidden = m === 'hq';
  $('#hq').hidden = m !== 'hq';
  if (m === 'hq') { hqRender(); return; }
  go(m === 'merchant' ? 'mScan' : 'hunt');
}

const NAVS = {
  traveler: [['hunt', 'Hunt', 'hunt'], ['map', 'Map', 'map'], ['polly', 'Polly', 'polly'], ['claims', 'My codes', 'claims'], ['wallet', 'Credits', 'wallet']],
  merchant: [['mScan', 'Redeem', 'scan'], ['mList', 'Drops', 'list'], ['mStats', 'Today', 'stats'], ['mStars', 'Ratings', 'star']],
};

function go(view, arg = null) {
  S.view = view; S.arg = arg;
  if (S.poll) { clearInterval(S.poll); S.poll = null; }
  stopCamera();
  render();
}

function render() {
  const nav = NAVS[S.mode] || NAVS.traveler;
  const navEl = $('#nav');
  navEl.style.gridTemplateColumns = `repeat(${nav.length},1fr)`;
  const active = { detail: 'hunt', qr: 'claims', rate: 'claims', mNew: 'mList', mEdit: 'mList', account: 'wallet' }[S.view] || S.view;
  navEl.innerHTML = nav.map(([v, l, i]) => `<button data-go="${v}" ${v === active ? 'aria-current="page"' : ''}>${ico(i)}${l}</button>`).join('');
  $$('#nav [data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  // Each render gets a fresh pane, so a slow earlier view can never overwrite a newer one.
  const screen = $('#screen');
  const el = document.createElement('div');
  el.className = 'pane';
  el.innerHTML = '<div class="spin"></div>';
  screen.replaceChildren(el);
  screen.scrollTop = 0;
  const fn = VIEWS[S.view];
  Promise.resolve(fn ? fn(el, S.arg) : null).catch((e) => {
    if (e.status === 401) { location.href = '/'; return; }
    el.innerHTML = `<p class="empty">${esc(e.message)}</p><button class="btn ghost" id="retry">Try again</button>`;
    $('#retry', el).onclick = render;
  });
}

/* ---------- Explorer views ---------- */
const VIEWS = {};

VIEWS.hunt = async (el) => {
  const radius = RADII[S.radiusIdx];
  const data = await api(`/api/drops?destination=${S.dest.id}&radius=${radius}&category=${encodeURIComponent(S.cat)}${hereQs()}`);
  const h = S.hunt;
  el.innerHTML = `
  <div class="theme"><div class="t">${esc(h ? `${h.emoji} ${h.name} in ${S.dest.name}` : `🗺️ Treasure Hunt ${S.dest.name}`)}</div>
    <small>${esc(h?.tagline || `Every verified find earns ${S.settings.creditsPerFind} credits and a raffle ticket.`)} Don't collect coupons. Collect Adventures™.</small></div>
  <div class="today" role="group" aria-label="Today's Treasures">${CATS.map((c) => `<button class="tt" data-c="${c}" aria-pressed="${S.cat === c}"><b>${data.counts[c]}</b>${CAT_EMO[c]} ${c}</button>`).join('')}</div>
  <div class="askp" id="tip" hidden></div>
  <button class="askp" id="askp">🦜 ${esc(PL().ask)}</button>
  <div class="slider"><div class="lbl"><span>Search distance</span><b id="rv">${fmtD(radius)}</b></div>
    <input type="range" id="rad" min="0" max="${RADII.length - 1}" step="1" value="${S.radiusIdx}" aria-label="Search distance"></div>
  <div class="chips">${['All', ...CATS].map((c) => `<button class="chip" data-c="${c}" aria-pressed="${S.cat === c}">${c}</button>`).join('')}</div>
  ${data.drops.length ? data.drops.map(dropCard).join('') : `<p class="empty">No treasures within ${fmtD(radius)}. Slide the distance wider or ask Polly.</p>`}`;
  $('#rad', el).oninput = (e) => { $('#rv').textContent = fmtD(RADII[e.target.value]); };
  $('#rad', el).onchange = (e) => { S.radiusIdx = Number(e.target.value); saveUi(); render(); };
  $$('[data-c]', el).forEach((b) => (b.onclick = () => { S.cat = S.cat === b.dataset.c && b.classList.contains('tt') ? 'All' : b.dataset.c; render(); }));
  $('#askp', el).onclick = () => { go('polly'); setTimeout(() => pollyAsk(PL().sugg[0]), 50); };
  loadTip(el);
  $$('[data-d]', el).forEach((b) => (b.onclick = () => go('detail', Number(b.dataset.d))));
};

async function loadTip(el) {
  try {
    const tip = await api(`/api/polly/tip?destination=${S.dest.id}&lang=${PL().code}${hereQs()}`);
    const box = $('#tip', el); if (!box || tip.kind === 'none') return;
    box.hidden = false;
    box.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start"><span class="parrot" style="width:32px;height:32px;font-size:1rem;flex:none">🦜</span><div style="display:grid;gap:8px;min-width:0">
      <span>${esc(tip.text)}</span>
      ${tip.drops?.length ? `<div class="mini" style="display:grid;gap:6px">${tip.drops.map((d) => `<button class="chip" style="text-align:left" data-td="${d.id}">${esc(d.emoji)} ${esc(d.title)} · ${fmtD(d.distanceM)}</button>`).join('')}</div>` : ''}
      ${tip.action === 'qr' ? `<button class="sbtn gold" data-tq="${tip.dropId}" style="justify-self:start">${esc(PL().showCode)}</button>` : ''}
      ${tip.ask ? `<button class="sbtn" data-ta style="justify-self:start">${esc(PL().yes)}</button>` : ''}</div></div>`;
    $$('[data-td]', box).forEach((b) => (b.onclick = () => go('detail', Number(b.dataset.td))));
    const q = $('[data-tq]', box); if (q) q.onclick = () => go('qr', Number(q.dataset.tq));
    const a = $('[data-ta]', box); if (a) a.onclick = () => { go('polly'); setTimeout(() => pollyAsk(tip.ask), 50); };
  } catch {}
}

function dropCard(d) {
  const st = d.myStatus === 'redeemed' ? 'Found ✓' : d.myStatus === 'claimed' ? 'Claimed' : `${d.remaining} left`;
  return `<button class="drop ${d.myStatus === 'redeemed' ? 'done' : ''}" data-d="${d.id}"><span class="chest">${esc(d.emoji)}</span>
    <span><div class="n">${esc(d.title)}</div><div class="m">${d.mystery ? 'Mystery reward' : esc(d.item)} · ${esc(d.merchant)}</div>
    <div class="m">${esc(d.difficulty)} · ${d.rating ? `★ ${Number(d.rating).toFixed(1)}` : 'New'}</div></span>
    <span class="d">${fmtD(d.distanceM)}<small>${st}</small></span></button>`;
}

let leafletMap = null;
VIEWS.map = async (el) => {
  const data = await api(`/api/drops?destination=${S.dest.id}&radius=50000${hereQs()}`);
  el.innerHTML = `<div class="lmap" id="lmap" role="region" aria-label="Map of treasures"></div>
    <p class="legend">Gold pins are live treasures. Tap one for details. ${S.locSource === 'gps' ? 'The teal dot is you.' : 'Turn on location to see yourself on the map.'}</p>`;
  if (!window.L) { $('#lmap').innerHTML = '<p class="empty">Map is loading, try again in a moment.</p>'; return; }
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  leafletMap = L.map('lmap', { zoomControl: true }).setView([S.here.lat, S.here.lng], 14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(leafletMap);
  if (S.locSource === 'gps') L.marker([S.here.lat, S.here.lng], { icon: L.divIcon({ className: '', html: '<div class="pinx me"></div>', iconSize: [16, 16] }) }).addTo(leafletMap);
  const pts = [];
  data.drops.forEach((d) => {
    pts.push([d.lat, d.lng]);
    L.marker([d.lat, d.lng], { icon: L.divIcon({ className: '', html: `<div class="pinx">${esc(d.emoji)}</div>`, iconSize: [30, 30] }) })
      .addTo(leafletMap)
      .bindPopup(`<b>${esc(d.title)}</b><br>${esc(d.merchant)} · ${fmtD(d.distanceM)}<br><button data-open="${d.id}">Open</button>`);
  });
  leafletMap.on('popupopen', (e) => { const b = e.popup.getElement().querySelector('[data-open]'); if (b) b.onclick = () => go('detail', Number(b.dataset.open)); });
  if (pts.length && S.locSource !== 'gps') leafletMap.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  setTimeout(() => leafletMap && leafletMap.invalidateSize(), 50);
};

VIEWS.detail = async (el, id) => {
  const { drop: d, claim } = await api(`/api/drops/${id}?x=1${hereQs()}`);
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=walking`;
  el.innerHTML = `<button class="back" id="bk">← Back to treasures</button>
  ${d.hasPhoto ? `<img class="dimg" src="/api/drops/${d.id}/photo" alt="">` : ''}
  <div class="hero"><span class="big">${esc(d.emoji)}</span><h2>${esc(d.title)}</h2>
    <div class="note">${esc(d.merchant)} · ${esc(d.category)}</div>
    <div class="clue">${esc(d.story)}</div>
    <div><b>${d.item ? esc(d.item) : '🎁 Mystery reward, revealed when you claim'}</b></div></div>
  <div class="facts">
    <div class="fact"><div class="k">Distance</div><div class="v">${fmtD(d.distanceM)} · ${d.walkMin} min</div></div>
    <div class="fact"><div class="k">Difficulty</div><div class="v">${esc(d.difficulty)}</div></div>
    <div class="fact"><div class="k">Rating</div><div class="v">${d.rating ? `★ ${Number(d.rating).toFixed(1)} (${d.ratingCount})` : 'New'}</div></div>
    <div class="fact"><div class="k">Hours</div><div class="v">${esc(d.hours || '—')}</div></div>
    <div class="fact"><div class="k">Left</div><div class="v">${d.remaining}</div></div>
    <div class="fact"><div class="k">You earn</div><div class="v">🪙 ${S.settings.creditsPerFind}</div></div>
  </div>
  ${d.walkingNote ? `<p class="note">🚶 ${esc(d.walkingNote)}</p>` : ''}
  ${claim?.status === 'redeemed' ? `<p class="empty">You found this treasure ✓</p>` :
    claim ? `<button class="btn" id="showqr">Show my code</button>` :
    `<button class="btn" id="claim">Claim this treasure</button>`}
  <a class="btn ghost" href="${dirUrl}" target="_blank" rel="noopener">Walking directions</a>
  <p class="note">Credits are added only after ${esc(d.merchant)} confirms your visit.</p>`;
  $('#bk', el).onclick = () => go('hunt');
  const c = $('#claim', el);
  if (c) c.onclick = async () => {
    c.disabled = true; c.textContent = 'Claiming…';
    try { await api(`/api/drops/${d.id}/claim`, { method: 'POST' }); toast('Treasure claimed! Show your code at the counter.'); go('qr', d.id); }
    catch (e) { toast(e.message); c.disabled = false; c.textContent = 'Claim this treasure'; }
  };
  const q = $('#showqr', el); if (q) q.onclick = () => go('qr', d.id);
};

VIEWS.qr = async (el, id) => {
  const { drop: d, claim } = await api(`/api/drops/${id}`);
  if (!claim) return go('detail', id);
  if (claim.status === 'redeemed') return go('rate', id);
  el.innerHTML = `<button class="back" id="bk">← ${esc(d.title)}</button>
  <div class="qrcard"><strong>${esc(d.item)}</strong><div id="qr"></div><div class="code">${esc(claim.code)}</div>
    <small>Show this at ${esc(d.merchant)}. Valid until ${new Date(claim.expires_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</small></div>
  <div class="status"><span class="p"></span>Waiting for ${esc(d.merchant)} to confirm…</div>
  <button class="back" id="cancel" style="text-align:center">Cancel this claim</button>`;
  try { const qr = qrcode(0, 'M'); qr.addData(`TIN-TH:${claim.code}`); qr.make(); $('#qr', el).innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch {}
  $('#bk', el).onclick = () => go('detail', id);
  $('#cancel', el).onclick = async () => { if (!confirm('Cancel this claim? The treasure goes back for other explorers.')) return; try { await api(`/api/drops/${id}/claim`, { method: 'DELETE' }); toast('Claim cancelled'); go('hunt'); } catch (e) { toast(e.message); } };
  S.poll = setInterval(async () => {
    try { const r = await api(`/api/drops/${id}`); if (r.claim?.status === 'redeemed') { clearInterval(S.poll); S.poll = null; celebrate(r.claim.credits_awarded, () => go('rate', id)); refreshCredits(); } } catch {}
  }, 4000);
};

function celebrate(credits, then) {
  const b = document.createElement('div');
  b.className = 'burst';
  b.innerHTML = `<div style="display:grid;gap:10px"><div style="font-size:2.4rem">🏴‍☠️</div><div class="c">+${credits}</div><div>Treasure found! Credits added.</div><div class="note">You're in Sunday's raffle.</div><button class="btn" id="ok2">Rate your visit</button></div>`;
  $('#phone').appendChild(b);
  $('#ok2', b).onclick = () => { b.remove(); then(); };
}

VIEWS.rate = async (el, id) => {
  const { drop: d, claim } = await api(`/api/drops/${id}`);
  if (!claim?.redemption_id) return go('claims');
  if (claim.rating_id) { el.innerHTML = `<p class="empty">Thanks, you already rated ${esc(d.merchant)}.</p>`; return; }
  const scores = {};
  const scale = (k, q) => `<div class="rate"><div class="q">${q}</div><div class="scale" data-k="${k}">${Array.from({ length: 10 }, (_, i) => `<button data-n="${i + 1}" aria-label="${i + 1} of 10">${i + 1}</button>`).join('')}</div></div>`;
  el.innerHTML = `<div class="hero"><span class="big">${esc(d.emoji)}</span><h2>How was ${esc(d.merchant)}?</h2><div class="note">Your rating helps great treasures rise to the top.</div></div>
  ${scale('ease', 'How easy was it to find?')}${scale('speed', 'How fast was the redemption?')}${scale('overall', 'Overall experience')}
  <div class="form"><label>Anything to add? (optional)<textarea id="cm" maxlength="500"></textarea></label></div>
  <button class="btn" id="send">Send rating</button><button class="back" id="skip" style="text-align:center">Skip for now</button>`;
  $$('.scale', el).forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => { scores[s.dataset.k] = Number(b.dataset.n); $$('button', s).forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= scores[s.dataset.k])); })));
  $('#skip', el).onclick = () => go('hunt');
  $('#send', el).onclick = async () => {
    if (!scores.ease || !scores.speed || !scores.overall) return toast('Please rate all three');
    try { await api(`/api/redemptions/${claim.redemption_id}/rating`, { method: 'POST', body: { ...scores, comment: $('#cm').value } }); toast('Thanks! Rating sent.'); go('hunt'); }
    catch (e) { toast(e.message); }
  };
};

VIEWS.claims = async (el) => {
  const { claims } = await api('/api/me/claims');
  const open = claims.filter((c) => c.status === 'claimed'), done = claims.filter((c) => c.status === 'redeemed');
  const row = (c) => `<button class="drop ${c.status === 'redeemed' ? 'done' : ''}" data-d="${c.drop_id}" data-s="${c.status}" data-r="${c.redemption_id && !c.overall_score ? 1 : 0}">
    <span class="chest">${esc(c.emoji)}</span><span><div class="n">${esc(c.title)}</div><div class="m">${esc(c.item)} · ${esc(c.merchant)}</div></span>
    <span class="d">${c.status === 'redeemed' ? `+${c.credits_awarded}<small>${c.overall_score ? `★ ${c.overall_score}` : 'Rate it'}</small>` : `${esc(c.code)}<small>Show code</small>`}</span></button>`;
  el.innerHTML = `<h3 style="margin:0;font-family:var(--f-display);font-weight:400">My codes</h3>
    ${open.length ? open.map(row).join('') : '<p class="empty">No open codes. Claim a treasure to get one.</p>'}
    ${done.length ? `<h3 style="margin:8px 0 0;font-family:var(--f-display);font-weight:400">Treasures found</h3>${done.map(row).join('')}` : ''}`;
  $$('[data-d]', el).forEach((b) => (b.onclick = () => go(b.dataset.s === 'claimed' ? 'qr' : b.dataset.r === '1' ? 'rate' : 'detail', Number(b.dataset.d))));
};

VIEWS.wallet = async (el) => {
  const c = await api('/api/me/credits'); S.credits = c;
  $('#credBtn').textContent = `🪙 ${c.treasureHunt.balance}`;
  const next = new Date(c.raffle.nextDrawAt);
  el.innerHTML = `<div class="bal"><small>Treasure Hunt Credits</small><div class="v">${c.treasureHunt.balance}</div><small>Earned only on merchant-confirmed finds.</small></div>
  <div class="pools">${c.pools.map((p) => `<div class="${p.id === 'treasure_hunt' ? 'act' : ''}">${esc(p.name)}<b>${p.balance ?? '—'}</b>${p.note ? esc(p.note) : ''}</div>`).join('')}</div>
  <p class="note">The three credit pools are separate and can't be mixed or transferred.</p>
  <div class="raffle"><b>🎟️ Sunday raffle · ${S.settings.rafflePrize} credits</b>
    <div class="cd" id="cd"></div>
    <div class="note">You have ${c.raffle.myTicketsThisWeek} ticket${c.raffle.myTicketsThisWeek === 1 ? '' : 's'} this week. Every verified find is one ticket. Draw: Sundays 2pm UTC.</div>
    ${c.raffle.lastDraw ? `<div class="note">Last winner: ${esc(c.raffle.lastDraw.winner || 'no entries')} · ${c.raffle.lastDraw.prize_credits} credits</div>` : ''}</div>
  <h3 style="margin:0;font-family:var(--f-display);font-weight:400">History</h3>
  <div class="hist">${c.treasureHunt.history.length ? c.treasureHunt.history.map((h) => `<div><span>${h.reason === 'raffle' ? '🎟️ Raffle win' : h.reason === 'redemption' ? '🏴‍☠️ Treasure found' : esc(h.reason)} · ${ago(h.created_at)}</span><b>+${h.amount}</b></div>`).join('') : '<p class="note">No credits yet. Find your first treasure!</p>'}</div>
  <div class="card" style="gap:8px"><div><b>${esc(S.me.name)}</b><div class="note">${esc(S.me.email)}</div></div>
    ${S.me.role === 'traveler' ? '<button class="btn ghost" id="biz">I own a business: add my treasure</button>' : ''}
    <button class="back" id="out">Sign out</button></div>`;
  const tick = () => { const s = Math.max(0, (next - Date.now()) / 1000); const cd = $('#cd'); if (cd) cd.textContent = `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
  tick(); S.poll = setInterval(tick, 30000);
  $('#out', el).onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; };
  const biz = $('#biz', el); if (biz) biz.onclick = () => go('apply');
};

VIEWS.apply = async (el) => {
  el.innerHTML = `<button class="back" id="bk">← Credits</button>
  <div class="hero"><span class="big">🗝️</span><h2>Hide a treasure on ${esc(S.dest.name)}</h2><div class="note">Tell TIN HQ about your business. Once approved you can create Treasure Drops for $${S.settings.dropPrice ?? 1} each.</div></div>
  <form class="form" id="f">
    <label>Business name<input id="bn" required maxlength="100"></label>
    <label>Type of business<input id="bc" required maxlength="60" placeholder="Restaurant, dive shop, boutique…"></label>
    <label>Address<input id="ba" maxlength="200"></label>
    <label>Opening hours<input id="bh" maxlength="60" placeholder="09:00–18:00"></label>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="bl" style="width:auto"> I'm at my business now (use my location)</label>
    <div class="err" id="er"></div>
    <button class="btn" type="submit">Send to TIN HQ</button>
  </form>`;
  $('#bk', el).onclick = () => go('wallet');
  $('#f', el).onsubmit = async (e) => {
    e.preventDefault();
    const b = { business: $('#bn').value, category: $('#bc').value, address: $('#ba').value, hours: $('#bh').value, destination: S.dest.id };
    if ($('#bl').checked && S.locSource === 'gps') Object.assign(b, { lat: S.here.lat, lng: S.here.lng });
    try { await api('/api/merchant/apply', { method: 'POST', body: b }); el.innerHTML = '<div class="hero"><span class="big">✅</span><h2>Application sent</h2><div class="note">TIN HQ will review it and switch on your Merchant view.</div></div>'; }
    catch (err) { $('#er').textContent = err.message; }
  };
};

/* ---------- Polly ---------- */
const POLLY_UI = {
  en: { hello: "Hola! I'm Polly, your treasure guide. Tell me what you're in the mood for, who you're with, or how much time you have.", ask: 'Ask Polly: “Help me find treasure.”', ph: 'Ask Polly…', showCode: 'Show my code', yes: 'Yes, plan it',
    sugg: ['Help me find treasure', 'I only want food treasures', 'Treasures within walking distance', 'I have kids', "Make today's hunt last one hour", 'What is open now?', 'How many credits do I have?'] },
  es: { hello: '¡Hola! Soy Polly, tu guía de tesoros. Dime qué se te antoja, con quién vas o cuánto tiempo tienes.', ask: 'Pregúntale a Polly: “Ayúdame a encontrar tesoros.”', ph: 'Pregúntale a Polly…', showCode: 'Ver mi código', yes: 'Sí, ármala',
    sugg: ['Ayúdame a encontrar tesoros', 'Solo quiero tesoros de comida', 'Tesoros cerca a pie', 'Tengo niños', 'Haz que la búsqueda de hoy dure una hora', '¿Qué está abierto ahora?', '¿Cuántos créditos tengo?'] },
  pt: { hello: 'Olá! Sou a Polly, sua guia de tesouros. Diga o que você quer, com quem está ou quanto tempo tem.', ask: 'Pergunte à Polly: “Me ajude a achar tesouros.”', ph: 'Pergunte à Polly…', showCode: 'Mostrar meu código', yes: 'Sim, monte a rota',
    sugg: ['Me ajude a achar tesouros', 'Só quero tesouros de comida', 'Tesouros perto a pé', 'Tenho crianças', 'Faça a caça de hoje durar uma hora', 'O que está aberto agora?', 'Quantos créditos eu tenho?'] },
  fr: { hello: 'Bonjour ! Je suis Polly, votre guide des trésors. Dites-moi ce qui vous fait envie, avec qui vous êtes ou combien de temps vous avez.', ask: 'Demandez à Polly : « Aide-moi à trouver des trésors. »', ph: 'Demandez à Polly…', showCode: 'Voir mon code', yes: 'Oui, prépare-la',
    sugg: ['Aide-moi à trouver des trésors', 'Je veux seulement des trésors à manger', 'Trésors à pied tout près', "J'ai des enfants", "Fais une chasse d'une heure aujourd'hui", "Qu'est-ce qui est ouvert maintenant ?", 'Combien de crédits ai-je ?'] },
  de: { hello: 'Hallo! Ich bin Polly, deine Schatzführerin. Sag mir, worauf du Lust hast, mit wem du unterwegs bist oder wie viel Zeit du hast.', ask: 'Frag Polly: „Hilf mir, Schätze zu finden.“', ph: 'Frag Polly…', showCode: 'Meinen Code zeigen', yes: 'Ja, plane sie',
    sugg: ['Hilf mir, Schätze zu finden', 'Ich möchte nur Essens-Schätze', 'Schätze zu Fuß in der Nähe', 'Ich habe Kinder', 'Plane eine einstündige Schatzsuche', 'Was ist jetzt geöffnet?', 'Wie viele Credits habe ich?'] },
};
const PL = () => ({ code: POLLY_UI[S.me?.language] ? S.me.language : 'en', ...(POLLY_UI[S.me?.language] || POLLY_UI.en) });

VIEWS.polly = async (el) => {
  if (!S.chat.length) S.chat.push({ p: true, t: PL().hello });
  const sugg = PL().sugg;
  el.innerHTML = `<div class="pollyhead"><span class="parrot">🦜</span><div><b>Polly</b><div class="note">Knows where you are, what's live and your credits</div></div></div>
  <div class="chat" id="chat" aria-live="polite"></div>
  <div class="chips">${sugg.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
  <form class="ask" id="askf"><input id="q" placeholder="${esc(PL().ph)}" autocomplete="off" aria-label="Ask Polly"><button>Ask</button></form>`;
  drawChat();
  $$('[data-s]', el).forEach((b) => (b.onclick = () => pollyAsk(b.dataset.s)));
  $('#askf', el).onsubmit = (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) { $('#q').value = ''; pollyAsk(q); } };
};

function drawChat() {
  const c = $('#chat'); if (!c) return;
  c.innerHTML = S.chat.map((m) => `<div class="msg ${m.p ? 'p' : 'u'}">${esc(m.t)}${m.drops?.length ? `<div class="mini">${m.drops.map((d) => `<button data-d="${d.id}">${d.n ? `<b>${d.n}.</b> ` : ''}${esc(d.emoji)} ${esc(d.title)} · ${fmtD(d.distanceM)}</button>`).join('')}</div>` : ''}</div>`).join('');
  $$('[data-d]', c).forEach((b) => (b.onclick = () => go('detail', Number(b.dataset.d))));
  const scr = $('#screen'); scr.scrollTop = scr.scrollHeight;
}

async function pollyAsk(q) {
  S.chat.push({ p: false, t: q }); S.chat.push({ p: true, t: '…' }); drawChat();
  try {
    const r = await api('/api/polly', { method: 'POST', body: { q, destination: S.dest.id, ...(S.locSource === 'gps' ? { lat: S.here.lat, lng: S.here.lng } : {}) } });
    S.chat[S.chat.length - 1] = { p: true, t: r.reply, drops: r.drops };
  } catch (e) { S.chat[S.chat.length - 1] = { p: true, t: `Sorry, I couldn't answer that just now. ${e.message}` }; }
  drawChat();
}

/* ---------- Merchant views ---------- */
const mq = () => (S.me.role === 'admin' && S.merchantId ? `?merchant=${S.merchantId}` : '');
let camStream = null, camTimer = null;
function stopCamera() { if (camTimer) cancelAnimationFrame(camTimer); camTimer = null; if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; }

async function merchantGuard(el) {
  if (S.me.role === 'admin' && !S.merchantId) {
    const { merchants } = await api('/api/admin/merchants');
    const act = merchants.filter((m) => m.status === 'active');
    el.innerHTML = `<div class="merch"><h3>Act as which merchant?</h3><p class="note">As TIN HQ you can run any merchant's counter.</p>
      <div class="pending">${act.map((m) => `<button data-m="${m.id}"><span>${esc(m.name)}</span><span class="note">${esc(m.category)}</span></button>`).join('')}</div></div>`;
    $$('[data-m]', el).forEach((b) => (b.onclick = () => { S.merchantId = Number(b.dataset.m); render(); }));
    return false;
  }
  if (!S.merchant || S.merchant.id !== (S.merchantId || S.me.merchantId)) { const r = await api(`/api/merchant/me${mq()}`); S.merchant = r.merchant; S.payments = r.payments; S.settings.dropPrice = r.dropPrice; }
  setLoc(`Merchant · ${S.merchant.name}`);
  return true;
}

VIEWS.mScan = async (el) => {
  if (!(await merchantGuard(el))) return;
  const st = await api(`/api/merchant/stats${mq()}`);
  el.innerHTML = `<div class="merch"><h3>Redeem a treasure</h3>
    <p class="note">Scan the explorer's QR code, or type the 6-letter code.</p>
    <button class="btn sea" id="cam">📷 Scan QR code</button>
    <div id="camwrap" hidden><video class="scan" id="vid" playsinline muted></video><button class="back" id="camx" style="text-align:center">Stop camera</button></div>
    <form id="cf" style="display:grid;gap:8px"><input id="code" maxlength="12" placeholder="ABC123" autocomplete="off" aria-label="Redemption code"><button class="btn">Check code</button></form>
    <div class="err" id="er"></div></div>
  <div class="kp"><div><b>${st.today}</b><span>Redeemed today</span></div><div><b>${st.waiting}</b><span>Explorers with open codes</span></div></div>
  ${S.me.role === 'admin' ? '<button class="back" id="swm">Switch merchant</button>' : ''}`;
  $('#cf', el).onsubmit = (e) => { e.preventDefault(); checkCode($('#code').value); };
  $('#cam', el).onclick = startCamera;
  $('#camx', el).onclick = () => { stopCamera(); $('#camwrap').hidden = true; };
  const sw = $('#swm', el); if (sw) sw.onclick = () => { S.merchantId = null; S.merchant = null; render(); };
};

async function startCamera() {
  const wrap = $('#camwrap'), vid = $('#vid');
  if (!navigator.mediaDevices?.getUserMedia) return toast('Camera not available. Type the code instead.');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    wrap.hidden = false; vid.srcObject = camStream; await vid.play();
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const loop = () => {
      if (!camStream) return;
      if (vid.readyState >= 2 && window.jsQR) {
        cv.width = vid.videoWidth; cv.height = vid.videoHeight; cx.drawImage(vid, 0, 0);
        const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
        if (r?.data) { stopCamera(); wrap.hidden = true; checkCode(r.data); return; }
      }
      camTimer = requestAnimationFrame(loop);
    };
    loop();
  } catch { toast('Camera blocked. Type the code instead.'); }
}

async function checkCode(raw) {
  const code = String(raw).trim().toUpperCase().replace(/^TIN-TH:/, '');
  $('#er') && ($('#er').textContent = '');
  if (code.length < 4) return;
  try { const { claim } = await api(`/api/merchant/lookup${mq()}`, { method: 'POST', body: { code } }); proof(claim); }
  catch (e) { if ($('#er')) $('#er').textContent = e.message; else toast(e.message); }
}

function proof(c) {
  let type = 'signature', photo = '', drawn = 0;
  const b = document.createElement('div');
  b.className = 'burst'; Object.assign(b.style, { alignItems: 'start', overflowY: 'auto', background: 'rgba(7,16,15,.97)' });
  b.innerHTML = `<div style="display:grid;gap:10px;width:100%;text-align:left"><strong style="font-size:1.05rem">${esc(c.emoji)} ${esc(c.item)}</strong>
    <span class="note">Code ${esc(c.code)} is valid for ${esc(c.traveler)}. Hand over the treasure, then add proof.</span>
    <div class="seg"><button data-t="signature" aria-pressed="true">✍️ Signature</button><button data-t="photo" aria-pressed="false">📷 Photo</button></div>
    <div id="pz"></div><div class="err" id="per"></div>
    <button class="btn sea" id="fin">Confirm redemption</button><button class="back" id="cx">Cancel</button></div>`;
  $('#phone').appendChild(b);
  const pz = $('#pz', b);
  const showSig = () => {
    pz.innerHTML = '<canvas class="sig" width="600" height="240" aria-label="Explorer signature"></canvas><span class="note">Ask the explorer to sign with a finger. <button class="linkbtn" id="clr">Clear</button></span>';
    const cv = $('canvas', pz), x = cv.getContext('2d');
    x.fillStyle = '#fbf6e7'; x.fillRect(0, 0, cv.width, cv.height);
    x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#1a1405';
    let on = false;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.onpointerdown = (e) => { on = true; cv.setPointerCapture(e.pointerId); x.beginPath(); x.moveTo(...pt(e)); };
    cv.onpointermove = (e) => { if (!on) return; x.lineTo(...pt(e)); x.stroke(); drawn++; };
    cv.onpointerup = () => { on = false; };
    $('#clr', pz).onclick = () => { x.fillRect(0, 0, cv.width, cv.height); drawn = 0; };
  };
  const showPhoto = () => {
    pz.innerHTML = `<label class="photo" id="ph">${photo ? `<img src="${photo}" alt="Proof photo">` : '📷 Take a photo of the explorer with their treasure'}<input type="file" accept="image/*" capture="environment" hidden id="pf"></label>`;
    $('#pf', pz).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; photo = await shrink(f, 720, 0.7); showPhoto(); };
  };
  $$('.seg button', b).forEach((x) => (x.onclick = () => { type = x.dataset.t; $$('.seg button', b).forEach((y) => y.setAttribute('aria-pressed', String(y === x))); type === 'signature' ? showSig() : showPhoto(); }));
  showSig();
  $('#cx', b).onclick = () => b.remove();
  $('#fin', b).onclick = async () => {
    let data;
    if (type === 'signature') { if (drawn < 5) return ($('#per', b).textContent = 'Please get a signature first.'); data = $('canvas', pz).toDataURL('image/jpeg', 0.6); }
    else { if (!photo) return ($('#per', b).textContent = 'Please take a photo first.'); data = photo; }
    const fin = $('#fin', b); fin.disabled = true; fin.textContent = 'Confirming…';
    try {
      const r = await api(`/api/merchant/confirm${mq()}`, { method: 'POST', body: { code: c.code, type, proof: data } });
      b.innerHTML = `<div style="display:grid;gap:10px"><div style="font-size:2.4rem">✅</div><div class="c">Done</div><div>${esc(c.traveler)} earned ${r.creditsAwarded} credits.</div><button class="btn" id="nx">Next explorer</button></div>`;
      $('#nx', b).onclick = () => { b.remove(); render(); };
    } catch (e) { $('#per', b).textContent = e.message; fin.disabled = false; fin.textContent = 'Confirm redemption'; }
  };
}

function shrink(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', q)); };
    img.onerror = rej; img.src = u;
  });
}

VIEWS.mList = async (el) => {
  if (!(await merchantGuard(el))) return;
  const { drops } = await api(`/api/merchant/drops${mq()}`);
  const pill = (s) => `<span class="pill ${s === 'active' ? 'live' : s}">${s === 'active' ? 'live' : s}</span>`;
  el.innerHTML = `<button class="btn" id="nd">＋ Create a new treasure</button>
  ${drops.length ? drops.map((d) => `<div class="card" style="gap:8px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(d.emoji)} ${esc(d.title)}</b>${pill(d.status)}</div>
    <div class="note">${esc(d.item)} · ${d.remaining}/${d.quantity} left · ${d.redeemed} redeemed · ${d.waiting} waiting</div>
    ${d.paymentStatus === 'unpaid' ? `<div class="note" style="color:var(--warn)">💳 $${d.fee} to pay before TIN HQ can approve</div>` : d.paymentStatus === 'paid' ? '<div class="note" style="color:var(--ok)">💳 Paid</div>' : ''}
    <div class="row">${d.paymentStatus === 'unpaid' ? `<button class="sbtn gold" data-pay="${d.id}">Pay $${d.fee}</button>` : ''}${d.status === 'active' ? `<button class="sbtn stop" data-p="${d.id}">Pause</button>` : d.status === 'paused' ? `<button class="sbtn go" data-r="${d.id}">Resume</button>` : ''}<button class="sbtn" data-e="${d.id}">Edit</button></div></div>`).join('')
    : '<p class="empty">No treasures yet. Create your first adventure!</p>'}`;
  $('#nd', el).onclick = () => go('mNew');
  const patch = async (id, body) => { try { await api(`/api/merchant/drops/${id}${mq()}`, { method: 'PATCH', body }); render(); } catch (e) { toast(e.message); } };
  $$('[data-p]', el).forEach((b) => (b.onclick = () => patch(b.dataset.p, { status: 'paused' })));
  $$('[data-r]', el).forEach((b) => (b.onclick = () => patch(b.dataset.r, { status: 'active' })));
  $$('[data-e]', el).forEach((b) => (b.onclick = () => go('mEdit', drops.find((d) => d.id === Number(b.dataset.e)))));
  $$('[data-pay]', el).forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/merchant/drops/${b.dataset.pay}/pay${mq()}`, { method: 'POST' }); location.href = r.checkoutUrl; } catch (e) { toast(e.message); b.disabled = false; } }));
};

function dropForm(el, d) {
  const edit = !!d;
  const price = S.settings.dropPrice ?? 1;
  el.innerHTML = `<button class="back" id="bk">← My treasures</button>
  <div class="hero" style="gap:4px"><h2>${edit ? 'Edit your treasure' : 'Create an adventure'}</h2><div class="note">You're not making a coupon. You're hiding a treasure for explorers to find.</div></div>
  <form class="form" id="f">
    <label>Name your treasure<input id="tn" required maxlength="80" placeholder="e.g. The Captain's Burger" value="${esc(d?.title || '')}"></label>
    <label>What's the free reward?<input id="it" required maxlength="120" placeholder="e.g. Free burger" value="${esc(d?.item || '')}"></label>
    <label>What's the story behind this find? (required)<textarea id="cl" required minlength="10" maxlength="600" placeholder="Captain Morgan left this burger near the place where travelers first arrive on the island. Can you find it before another explorer does?">${esc(d?.story || '')}</textarea></label>
    <div class="two"><label>Treasure type<select id="ct">${CATS.map((c) => `<option ${d?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Icon<select id="em">${['🍔', '🌮', '🍕', '☕', '🍹', '🍺', '🍦', '🍫', '🤿', '🛶', '🛵', '🏖️', '💎', '🛍️', '🎁', '🗝️'].map((e) => `<option ${d?.emoji === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label></div>
    <div class="two"><label>Difficulty<select id="df">${['Easy', 'Medium', 'Hard'].map((x) => `<option ${d?.difficulty === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Retail value (USD)<input id="vl" type="number" min="0" step="0.5" value="${d?.value ?? 5}"></label></div>
    ${edit ? '' : `<label>How many drops<input id="qt" type="number" min="1" max="1000" value="10" required></label>`}
    <label>Walking distance note<input id="wd" maxlength="120" placeholder="e.g. 5 min walk from the ferry pier" value="${esc(d?.walkingNote || '')}"></label>
    <div class="two"><label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="kd" style="width:auto" ${d?.kids === false ? '' : 'checked'}> Kid-friendly</label>
      <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="my" style="width:auto" ${d?.mystery ? 'checked' : ''}> Mystery reward</label></div>
    <label style="flex-direction:row;display:flex;gap:6px;align-items:center"><input type="checkbox" id="gl" style="width:auto"> Treasure is where I'm standing now (otherwise at the business)</label>
    <label class="photo" id="ph">${d?.hasPhoto ? `<img src="/api/drops/${d.id}/photo" alt="">` : '📷 Add a photo of the treasure (optional)'}<input type="file" accept="image/*" hidden id="pf"></label>
    ${edit ? '<p class="note">Changes to the name, reward, story or photo go back to TIN HQ for a quick review.</p>' : `<div class="sum"><span>Total to pay</span><b id="tot">$${10 * price}</b></div>`}
    <div class="err" id="er"></div>
    <button class="btn" type="submit">${edit ? 'Save changes' : 'Pay & send for approval'}</button>
    ${edit ? '' : S.payments === 'stripe' ? '<p class="note">🔒 Secure payment by Stripe. Card, and OXXO where available.</p>' : '<p class="note">TIN will send you an invoice for the drop fee.</p>'}
  </form>`;
  let photo;
  $('#bk', el).onclick = () => go('mList');
  const qt = $('#qt', el); if (qt) qt.oninput = () => { $('#tot').textContent = `$${(Number(qt.value) || 0) * price}`; };
  $('#pf', el).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; photo = await shrink(f, 640, 0.72); $('#ph').firstChild.replaceWith(Object.assign(document.createElement('img'), { src: photo, alt: '' })); const old = $('#ph').childNodes; if (old[0].nodeType === 3) old[0].remove(); };
  $('#f', el).onsubmit = async (e) => {
    e.preventDefault();
    const body = { title: $('#tn').value, item: $('#it').value, story: $('#cl').value, category: $('#ct').value, emoji: $('#em').value, difficulty: $('#df').value, value: Number($('#vl').value || 0), walkingNote: $('#wd').value, kids: $('#kd').checked, mystery: $('#my').checked };
    if (!edit) body.quantity = Number($('#qt').value);
    if ($('#gl').checked) { if (S.locSource !== 'gps') return ($('#er').textContent = 'Turn on location to place the treasure where you are.'); body.lat = S.here.lat; body.lng = S.here.lng; }
    if (photo) body.photo = photo;
    const btn = $('button[type=submit]', el); btn.disabled = true;
    try {
      if (edit) { const r = await api(`/api/merchant/drops/${d.id}${mq()}`, { method: 'PATCH', body }); toast(r.status === 'pending' ? 'Saved. Sent to TIN HQ for review.' : 'Saved'); }
      else {
        const r = await api(`/api/merchant/drops${mq()}`, { method: 'POST', body });
        if (r.checkoutUrl) { btn.textContent = 'Opening secure payment…'; location.href = r.checkoutUrl; return; }
        toast(r.drop.payment_status === 'waived' ? 'Treasure created' : `Sent to TIN HQ for approval · $${r.fee}`);
      }
      go('mList');
    } catch (err) { $('#er').textContent = err.message; btn.disabled = false; }
  };
}
VIEWS.mNew = async (el) => { if (await merchantGuard(el)) dropForm(el, null); };
VIEWS.mEdit = async (el, d) => { if (await merchantGuard(el)) dropForm(el, d); };

VIEWS.mStats = async (el) => {
  if (!(await merchantGuard(el))) return;
  const st = await api(`/api/merchant/stats${mq()}`);
  el.innerHTML = `<div class="kp"><div><b>${st.today}</b><span>Redeemed today</span></div><div><b>${st.week}</b><span>Last 7 days</span></div>
    <div><b>${st.waiting}</b><span>Open codes</span></div><div><b>${st.ratings.overall ?? '—'}</b><span>Avg overall rating</span></div></div>
  <h3 style="margin:0;font-family:var(--f-display);font-weight:400">Recent explorers</h3>
  <div class="hist">${st.recent.length ? st.recent.map((r) => `<div><span>${esc(r.emoji)} ${esc(r.display_name)} · ${esc(r.title)} · ${ago(r.redeemed_at)}</span><b>${r.overall_score ? `★ ${r.overall_score}` : ''}</b></div>`).join('') : '<p class="note">No redemptions yet.</p>'}</div>`;
};

VIEWS.mStars = async (el) => {
  if (!(await merchantGuard(el))) return;
  const st = await api(`/api/merchant/stats${mq()}`);
  const r = st.ratings;
  const bar = (l, v) => `<div class="rate"><div class="q" style="display:flex;justify-content:space-between"><span>${l}</span><b>${v ?? '—'}</b></div><div style="height:8px;border-radius:4px;background:var(--line)"><div style="height:8px;border-radius:4px;background:var(--gold);width:${(v || 0) * 10}%"></div></div></div>`;
  el.innerHTML = `<div class="hero" style="gap:4px"><h2>Your ratings</h2><div class="note">${r.n} rating${r.n === 1 ? '' : 's'}. Higher ratings move your treasures up for explorers.</div></div>
  ${bar('Ease of finding', r.ease)}${bar('Speed of redemption', r.speed)}${bar('Overall', r.overall)}
  <h3 style="margin:0;font-family:var(--f-display);font-weight:400">Comments</h3>
  <div class="hist">${st.recent.filter((x) => x.comment).map((x) => `<div><span>“${esc(x.comment)}” · ${esc(x.display_name)}</span><b>★ ${x.overall_score}</b></div>`).join('') || '<p class="note">No comments yet.</p>'}</div>`;
};

/* ---------- TIN HQ ---------- */
let hqTab = 'overview';
async function hqRender() {
  const el = $('#hq');
  const tabs = [['overview', 'Overview'], ['merchants', 'Merchants'], ['drops', 'Treasure Drops'], ['hunts', 'Hunts'], ['raffle', 'Raffle'], ['settings', 'Settings']];
  el.innerHTML = `<div class="hqbar"><h1>TIN <em>HQ</em> · ${esc(S.dest.name)}</h1><span class="note">Signed in as ${esc(S.me.name)}</span></div>
  <div class="hqtabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${hqTab === k}">${l}</button>`).join('')}</div>
  <div id="hqb"><div class="spin"></div></div>`;
  $$('[data-t]', el).forEach((b) => (b.onclick = () => { hqTab = b.dataset.t; hqRender(); }));
  const body = $('#hqb', el);
  try { await HQ[hqTab](body); } catch (e) { body.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
const hqToast = (m) => toast(m, document.body);
const HQ = {};

HQ.overview = async (el) => {
  const o = await api(`/api/admin/overview?destination=${S.dest.id}`);
  const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push(d.toISOString().slice(0, 10)); }
  const vals = days.map((d) => o.daily.find((x) => x.day === d)?.n || 0);
  const max = Math.max(4, ...vals), W = 560, H = 220, pad = 30, bw = (W - pad * 2) / 7;
  const bars = vals.map((v, i) => { const h = (v / max) * (H - 60); const x = pad + i * bw + bw * 0.2; return `<g class="bar" data-v="${v}" data-d="${days[i]}"><rect x="${x}" y="${H - 30 - h}" width="${bw * 0.6}" height="${Math.max(h, 1)}" rx="4" fill="var(--gold)"/><rect x="${pad + i * bw}" y="10" width="${bw}" height="${H - 40}" fill="transparent"/><text x="${x + bw * 0.3}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${new Date(days[i] + 'T12:00:00Z').toLocaleDateString('en', { weekday: 'short' })}</text></g>`; }).join('');
  const k = (v, l, s = '') => `<div class="kpi"><b>${v ?? '—'}</b><span>${l}</span>${s ? `<small>${s}</small>` : ''}</div>`;
  el.innerHTML = `<div class="hqgrid">${k(o.users, 'Explorer accounts')}${k(o.claims, 'Claims')}${k(o.redemptions, 'Verified redemptions')}${k(o.verificationRate != null ? `${o.verificationRate}%` : null, 'Verification rate', 'Target 80%+')}${k(o.rating, 'Avg rating', 'Target 8.5+')}${k(o.pendingDrops + o.pendingMerchants, 'Waiting for approval')}</div>
  <div class="cols" style="margin-top:14px"><div class="card"><h3>Verified redemptions, last 7 days</h3><div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Redemptions per day">${bars}</svg><div class="tip" id="tp" hidden></div></div></div>
  <div class="card"><h3>Top merchants</h3><div class="hist">${o.topMerchants.map((m) => `<div><span>${esc(m.name)}</span><b>${m.n}</b></div>`).join('') || '<p class="note">No merchants yet.</p>'}</div>
  <h3>What explorers hunt</h3><div class="hist">${o.categories.map((c) => `<div><span>${CAT_EMO[c.category] || ''} ${esc(c.category)}</span><b>${c.n}</b></div>`).join('')}</div></div></div>`;
  const tp = $('#tp', el), ch = $('.chart', el);
  $$('.bar', el).forEach((g) => { g.onmouseenter = (e) => { const r = ch.getBoundingClientRect(), b = g.getBoundingClientRect(); tp.hidden = false; tp.textContent = `${g.dataset.d}: ${g.dataset.v} redemptions`; tp.style.left = `${b.left - r.left + b.width / 2}px`; tp.style.top = `${b.top - r.top + 20}px`; }; g.onmouseleave = () => (tp.hidden = true); });
};

HQ.merchants = async (el) => {
  const { merchants } = await api('/api/admin/merchants');
  const pill = (s) => `<span class="pill ${s === 'active' ? 'live' : s === 'declined' ? 'ended' : s}">${s}</span>`;
  el.innerHTML = `<div class="card"><h3>Merchants</h3><div class="tbl"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Contact</th><th class="n">Drops</th><th class="n">Redeemed</th><th class="n">Rating</th><th></th></tr></thead><tbody>
  ${merchants.map((m) => `<tr><td>${esc(m.name)} ${m.is_sample ? '<span class="sample">sample</span>' : ''}${m.needs_location ? ` <button class="sbtn" data-loc="${m.id}" title="Paste coordinates from Google Maps">📍 Set location</button>` : ''}</td><td>${esc(m.category)}</td><td>${pill(m.status)}</td><td>${esc(m.contact_email || '')}</td><td class="n">${m.drops}</td><td class="n">${m.redemptions}</td><td class="n">${m.rating ?? '—'}</td>
    <td>${m.status === 'pending' ? `<button class="sbtn go" data-s="active" data-id="${m.id}">Approve</button> <button class="sbtn stop" data-s="declined" data-id="${m.id}">Decline</button>` : m.status === 'active' ? `<button class="sbtn stop" data-s="paused" data-id="${m.id}">Pause</button>` : `<button class="sbtn go" data-s="active" data-id="${m.id}">Activate</button>`}</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="card"><h3>Import merchants</h3>
  <p class="note">Upload an Excel or CSV file, or copy rows from Excel and paste them below. The first row must be headers, e.g. <b>Name, Category, Address, Latitude, Longitude, Hours, Email, Phone, Website</b>. Only Name is required. Rows without GPS are placed at the town centre and marked 📍 so you can fix them.</p>
  <div class="hqform"><label>Excel or CSV file<input type="file" id="imf" accept=".xlsx,.xls,.csv,.tsv,.txt"></label>
    <label style="display:flex;gap:6px;align-items:center;flex-direction:row"><input type="checkbox" id="imact" style="width:auto"> Activate right away (otherwise they wait in Pending)</label></div>
  <textarea id="imt" rows="5" placeholder="…or paste rows from Excel here" style="background:var(--deep);border:1px solid var(--line);border-radius:8px;padding:8px 10px;width:100%"></textarea>
  <div id="imp"></div></div>
  <div class="card"><h3>Add a merchant</h3><p class="note">If the owner already has a TIN account with this email, it becomes their merchant login. Otherwise they sign up with it and HQ re-activates the merchant to link it.</p>
  <form class="hqform" id="af"><label>Business name<input name="name" required></label><label>Type<input name="category" required placeholder="Restaurant"></label><label>Owner email<input name="email" type="email"></label>
  <label>Latitude<input name="lat" required value="${S.dest.lat}"></label><label>Longitude<input name="lng" required value="${S.dest.lng}"></label><label>Hours<input name="hours" placeholder="09:00–18:00"></label><label>Address<input name="address"></label><button class="sbtn gold">Add merchant</button></form></div>`;
  $$('[data-s]', el).forEach((b) => (b.onclick = async () => { try { await api(`/api/admin/merchants/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.s } }); hqToast('Updated'); hqRender(); } catch (e) { hqToast(e.message); } }));
  $$('[data-loc]', el).forEach((b) => (b.onclick = async () => {
    const v = prompt('Paste the GPS coordinates (from Google Maps, right-click the place → copy the numbers), e.g. 20.5112, -86.9468');
    if (!v) return; const m = v.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return hqToast('Please paste two numbers separated by a comma');
    try { await api(`/api/admin/merchants/${b.dataset.loc}`, { method: 'PATCH', body: { lat: Number(m[1]), lng: Number(m[2]) } }); hqToast('Location saved'); hqRender(); } catch (e) { hqToast(e.message); }
  }));
  let importRows = [];
  const showPreview = () => {
    const box = $('#imp');
    if (!importRows.length) { box.innerHTML = '<p class="note">No rows found. Check that the first row has a Name column.</p>'; return; }
    const noGps = importRows.filter((r) => r.lat === '' || r.lat == null || r.lng === '' || r.lng == null).length;
    box.innerHTML = `<p class="note"><b>${importRows.length}</b> merchants ready${noGps ? ` · ${noGps} without GPS` : ''}. Duplicates of existing names are skipped.</p>
      <div class="tbl"><table><thead><tr><th>Name</th><th>Category</th><th>Address</th><th>GPS</th><th>Email</th></tr></thead><tbody>
      ${importRows.slice(0, 8).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.category || '')}</td><td>${esc(r.address || '')}</td><td>${r.lat !== '' && r.lat != null ? `${esc(r.lat)}, ${esc(r.lng)}` : '📍'}</td><td>${esc(r.email || '')}</td></tr>`).join('')}
      </tbody></table></div>${importRows.length > 8 ? `<p class="note">…and ${importRows.length - 8} more</p>` : ''}
      <button class="sbtn gold" id="imgo">Import ${importRows.length} merchants</button>`;
    $('#imgo').onclick = async () => {
      $('#imgo').disabled = true;
      try { const r = await api('/api/admin/merchants/import', { method: 'POST', body: { rows: importRows, destination: S.dest.id, activate: $('#imact').checked } });
        hqToast(`Imported ${r.added} merchants${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}${r.needsLocation ? `, ${r.needsLocation} need GPS` : ''}`); hqRender(); }
      catch (e) { hqToast(e.message); $('#imgo').disabled = false; }
    };
  };
  $('#imt', el).oninput = (e) => { importRows = mapRows(parseDelimited(e.target.value)); showPreview(); };
  $('#imf', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      if (/\.xlsx?$/i.test(f.name)) { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); const wb = XLSX.read(await f.arrayBuffer()); importRows = mapRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })); }
      else importRows = mapRows(parseDelimited(await f.text()));
      showPreview();
    } catch (err) { hqToast(`Could not read that file: ${err.message}`); }
  };
  $('#af', el).onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('/api/admin/merchants', { method: 'POST', body: { ...f, destination: S.dest.id } }); hqToast('Merchant added'); hqRender(); } catch (err) { hqToast(err.message); } };
};

function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load reader')); document.head.appendChild(s); });
}
// Parse CSV / TSV (Excel paste) into rows of cells, honouring quotes.
function parseDelimited(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
const HEAD = {
  name: ['name', 'business', 'business name', 'merchant', 'merchant name', 'nombre', 'negocio', 'company'],
  category: ['category', 'type', 'categoria', 'categoría', 'tipo', 'tin category', 'business type'],
  address: ['address', 'direccion', 'dirección', 'street', 'location'],
  lat: ['lat', 'latitude', 'latitud'], lng: ['lng', 'lon', 'long', 'longitude', 'longitud'],
  gps: ['gps', 'coordinates', 'coords', 'coordenadas', 'lat/lng', 'lat,lng'],
  hours: ['hours', 'opening hours', 'horario', 'open'], email: ['email', 'e-mail', 'correo', 'mail'],
  phone: ['phone', 'tel', 'telephone', 'telefono', 'teléfono', 'whatsapp', 'mobile'], website: ['website', 'web', 'url', 'site', 'sitio'],
};
function mapRows(rows) {
  if (rows.length < 2) return [];
  const heads = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = {}; for (const [k, names] of Object.entries(HEAD)) { const i = heads.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; }
  if (col.name == null) return [];
  return rows.slice(1).map((r) => {
    const g = (k) => (col[k] == null ? '' : String(r[col[k]] ?? '').trim());
    let lat = g('lat'), lng = g('lng');
    if ((!lat || !lng) && g('gps')) { const m = g('gps').match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/); if (m) { lat = m[1]; lng = m[2]; } }
    return { name: g('name'), category: g('category'), address: g('address'), lat, lng, hours: g('hours'), email: g('email'), phone: g('phone'), website: g('website') };
  }).filter((r) => r.name);
}

HQ.drops = async (el) => {
  const { drops } = await api('/api/admin/drops');
  const pill = (s) => `<span class="pill ${s === 'active' ? 'live' : s === 'rejected' || s === 'expired' ? 'ended' : s}">${s === 'active' ? 'live' : s}</span>`;
  el.innerHTML = `<div class="card"><h3>Treasure Drops</h3><div class="tbl"><table><thead><tr><th>Treasure</th><th>Merchant</th><th>Story</th><th>Status</th><th>Payment</th><th class="n">Left</th><th class="n">Redeemed</th><th class="n">Fee</th><th></th></tr></thead><tbody>
  ${drops.map((d) => `<tr><td>${esc(d.emoji)} <b>${esc(d.title)}</b><div class="note">${esc(d.item)} · ${esc(d.category)} · ${esc(d.difficulty)}</div></td><td>${esc(d.merchant)}</td><td style="max-width:300px" class="note">${esc(d.story)}</td><td>${pill(d.status)}</td><td><span class="pill ${d.paymentStatus === 'unpaid' ? 'pending' : d.paymentStatus === 'paid' ? 'live' : 'draft'}">${d.paymentStatus}</span></td>
    <td class="n">${d.remaining}/${d.quantity}</td><td class="n">${d.redeemed}</td><td class="n">$${d.fee}</td>
    <td>${d.status === 'pending' && d.paymentStatus === 'unpaid' ? `<button class="sbtn" data-waive="${d.id}">Waive fee &amp; approve</button> ` : ''}${d.status === 'pending' && d.paymentStatus !== 'unpaid' ? `<button class="sbtn go" data-s="active" data-id="${d.id}">Approve</button> <button class="sbtn stop" data-s="rejected" data-id="${d.id}">Reject</button>` : d.status === 'pending' ? `<button class="sbtn stop" data-s="rejected" data-id="${d.id}">Reject</button>` : d.status === 'active' ? `<button class="sbtn stop" data-s="paused" data-id="${d.id}">Pause</button>` : d.status === 'paused' ? `<button class="sbtn go" data-s="active" data-id="${d.id}">Resume</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div></div>`;
  $$('[data-s]', el).forEach((b) => (b.onclick = async () => { const d = drops.find((x) => x.id === Number(b.dataset.id)); try { await api(`/api/merchant/drops/${d.id}?merchant=${d.merchantId}`, { method: 'PATCH', body: { status: b.dataset.s } }); hqToast('Updated'); hqRender(); } catch (e) { hqToast(e.message); } }));
  $$('[data-waive]', el).forEach((b) => (b.onclick = async () => { const d = drops.find((x) => x.id === Number(b.dataset.waive)); if (!confirm(`Waive the $${d.fee} fee and approve “${d.title}”?`)) return; try { await api(`/api/merchant/drops/${d.id}?merchant=${d.merchantId}`, { method: 'PATCH', body: { status: 'active', paymentStatus: 'waived' } }); hqToast('Fee waived, treasure live'); hqRender(); } catch (e) { hqToast(e.message); } }));
};

HQ.hunts = async (el) => {
  const { hunts } = await api('/api/admin/hunts');
  el.innerHTML = `<div class="card"><h3>Themed hunts</h3><p class="note">The live hunt is the banner explorers see on the Hunt screen. Only one can be live per destination.</p>
  <div class="tbl"><table><thead><tr><th>Hunt</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>
  ${hunts.map((h) => `<tr><td>${esc(h.emoji)} <b>${esc(h.name)}</b><div class="note">${esc(h.tagline || '')}</div></td><td>${esc(h.starts_on || '')} → ${esc(h.ends_on || '')}</td><td><span class="pill ${h.status}">${h.status}</span></td>
    <td>${h.status !== 'live' ? `<button class="sbtn go" data-s="live" data-id="${h.id}">Go live</button>` : `<button class="sbtn stop" data-s="ended" data-id="${h.id}">End</button>`} ${h.status === 'draft' ? `<button class="sbtn" data-s="scheduled" data-id="${h.id}">Schedule</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="card"><h3>Create a hunt</h3><form class="hqform" id="hf"><label>Name<input name="name" required placeholder="Carnival Hunt"></label><label>Emoji<input name="emoji" value="🎭"></label><label>Tagline<input name="tagline"></label><label>Starts<input name="startsOn" type="date"></label><label>Ends<input name="endsOn" type="date"></label><button class="sbtn gold">Create</button></form></div>`;
  $$('[data-s]', el).forEach((b) => (b.onclick = async () => { try { await api(`/api/admin/hunts/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.s } }); const d = await api(`/api/destinations/${S.dest.id}`); S.hunt = d.hunt; hqToast('Updated'); hqRender(); } catch (e) { hqToast(e.message); } }));
  $('#hf', el).onsubmit = async (e) => { e.preventDefault(); try { await api('/api/admin/hunts', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), destination: S.dest.id } }); hqToast('Hunt created'); hqRender(); } catch (err) { hqToast(err.message); } };
};

HQ.raffle = async (el) => {
  const r = await api('/api/admin/raffle');
  el.innerHTML = `<div class="cols"><div class="card"><h3>This week</h3><div class="hqgrid">
    <div class="kpi"><b>${r.tickets}</b><span>Tickets (verified finds)</span></div><div class="kpi"><b>${r.entrants}</b><span>Explorers entered</span></div><div class="kpi"><b>${r.prize}</b><span>Prize credits</span></div></div>
    <p class="note">Draws automatically every Sunday at 2pm UTC from that week's confirmed redeemers. Next draw: ${new Date(r.nextDrawAt).toUTCString().replace(':00 GMT', ' UTC')}.</p>
    <div class="drum" id="drum">🎟️</div>
    <button class="sbtn" id="draw">Draw last week now (only if the automatic draw was missed)</button></div>
  <div class="card"><h3>Past draws</h3><div class="hist">${r.history.map((h) => `<div><span>${h.week_end.slice(0, 10)} · ${esc(h.winner_name || 'no entries')} · ${h.entrant_count} entrants${h.trigger === 'manual' ? ' · manual' : ''}</span><b>${h.winner_user_id ? `+${h.prize_credits}` : '—'}</b></div>`).join('') || '<p class="note">No draws yet.</p>'}</div></div></div>`;
  $('#draw', el).onclick = async () => {
    try { const x = await api('/api/admin/raffle/draw', { method: 'POST' }); $('#drum').textContent = x.winnerName ? `🏆 ${x.winnerName} +${x.prize}` : 'No entries last week'; setTimeout(hqRender, 2500); }
    catch (e) { hqToast(e.message); }
  };
};

HQ.settings = async (el) => {
  const { settings: s } = await api('/api/admin/settings');
  el.innerHTML = `<div class="card"><h3>Program settings</h3><form class="hqform" id="sf">
    <label>Credits per verified find<input name="creditsPerFind" type="number" min="1" value="${s.creditsPerFind}"></label>
    <label>Raffle prize (credits)<input name="rafflePrize" type="number" min="0" value="${s.rafflePrize}"></label>
    <label>Price per drop (USD)<input name="dropPrice" type="number" min="0" step="0.5" value="${s.dropPrice}"></label>
    <label>Claim code valid (hours)<input name="claimHours" type="number" min="1" max="168" value="${s.claimHours}"></label>
    <button class="sbtn gold">Save</button></form></div>`;
  $('#sf', el).onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Number(v)])); try { await api('/api/admin/settings', { method: 'PUT', body: f }); Object.assign(S.settings, { creditsPerFind: f.creditsPerFind, rafflePrize: f.rafflePrize, dropPrice: f.dropPrice }); hqToast('Settings saved'); } catch (err) { hqToast(err.message); } };
};

boot().catch((e) => { document.body.innerHTML = `<p class="empty" style="padding:40px">${esc(e.message)}</p>`; });
