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
  shield: '<path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const CATS = ['Food', 'Drink', 'Dessert', 'Adventure', 'Shopping', 'Mystery'];
const CAT_EMO = { Food: '🍔', Drink: '🍺', Dessert: '🍦', Adventure: '🧭', Shopping: '🛍️', Mystery: '🎁' };
const RADII = [100, 1000, 5000, 10000, 50000]; // last stop = everything

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
    S.gps = g;
    // Treasures can be dropped anywhere on earth, so we search around the explorer wherever they are.
    // "Explore <town> instead" (S.browseTown) lets someone far away look at the destination.
    if (S.browseTown) return;
    const far = haversine(g, center) > 40000;
    const moved = !S.here || S.locSource !== 'gps' || haversine(g, S.here) > 40;
    S.here = g; S.locSource = 'gps'; setLoc(far ? 'Your location' : `Your location · ${S.dest.name}`);
    if (S.view === 'detail' && S.gate) S.gate();
    if (moved && S.mode === 'traveler' && ['hunt', 'map'].includes(S.view)) render();
  }, () => setLoc(`${S.dest.name} · town centre (location off)`), { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}
function browseTown(on) {
  S.browseTown = on;
  if (on) { S.here = { lat: S.dest.lat, lng: S.dest.lng }; S.locSource = 'center'; setLoc(`Exploring ${S.dest.name} · town centre`); }
  else if (S.gps) { S.here = S.gps; S.locSource = 'gps'; setLoc(haversine(S.gps, { lat: S.dest.lat, lng: S.dest.lng }) > 40000 ? 'Your location' : `Your location · ${S.dest.name}`); }
  render();
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
  // Arriving from the TIN Merchant Cockpit: open the merchant view (admins act as that merchant).
  const wantMode = params.get('mode'), wantM = Number(params.get('merchant'));
  if (wantMode === 'merchant' && canMerchant) {
    S.mode = 'merchant'; saveUi();
    if (canHq && wantM > 0) { S.merchantId = wantM; S.merchant = null; }
    if (!params.get('paid') && !params.get('unpaid') && !params.get('credits') && !params.get('credits_cancel')) history.replaceState(null, '', location.pathname);
  }
  if (params.get('sso') === 'not-switched-on') toast('This business is not in the Treasure Hunt yet. Switch it on in your TIN Merchant Cockpit first.');
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
  const paid = params.get('paid'), unpaid = params.get('unpaid'), credits = params.get('credits'), cancel = params.get('credits_cancel'), asM = Number(params.get('merchant'));
  if (!paid && !unpaid && !credits && !cancel) return;
  history.replaceState(null, '', location.pathname);
  if (S.me.role === 'traveler') return;
  if (S.me.role === 'admin' && asM) S.merchantId = asM;
  S.mode = 'merchant'; saveUi(); setMode('merchant');
  if (cancel) { go('mList'); toast('Payment cancelled. No drops were bought.'); return; }
  if (credits) {
    try { const r = await api(`/api/merchant/credits/checkout/${encodeURIComponent(credits)}${mq()}`); S.merchant = null; go('mList');
      toast(r.paid ? `Payment received! ${r.drops} drops added. You now have ${r.balance}.` : 'Payment is processing. Your drops will appear shortly.'); }
    catch (e) { go('mList'); toast(e.message); }
    return;
  }
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
  merchant: [['mScan', 'Redeem', 'scan'], ['mList', 'Drops', 'list'], ['mMsg', 'Shield', 'shield'], ['mStats', 'Today', 'stats'], ['mStars', 'Ratings', 'star']],
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
  navEl.innerHTML = nav.map(([v, l, i]) => `<button data-go="${v}" ${v === active ? 'aria-current="page"' : ''}>${ico(i)}${l}${v === 'mMsg' && S.msgBadge ? `<span class="badge" aria-label="${S.msgBadge} new">${S.msgBadge}</span>` : ''}</button>`).join('');
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
  <div class="slider"><div class="lbl"><span>Search distance</span><b id="rv">${radLabel(S.radiusIdx)}</b></div>
    <input type="range" id="rad" min="0" max="${RADII.length - 1}" step="1" value="${S.radiusIdx}" aria-label="Search distance"></div>
  <div class="chips">${['All', ...CATS].map((c) => `<button class="chip" data-c="${c}" aria-pressed="${S.cat === c}">${c}</button>`).join('')}</div>
  ${S.browseTown ? `<button class="sbtn" id="mine" style="justify-self:start">📍 Back to treasures near me</button>` : ''}
  ${data.drops.length ? data.drops.map(dropCard).join('') : `<p class="empty">No treasures within ${radLabel(S.radiusIdx)}. Slide the distance wider or ask Polly.</p>${!S.browseTown && S.gps && haversine(S.gps, { lat: S.dest.lat, lng: S.dest.lng }) > 40000 ? `<button class="btn" id="town">🗺️ Explore ${esc(S.dest.name)}'s treasures instead</button>` : ''}`}`;
  const tw = $('#town', el); if (tw) tw.onclick = () => browseTown(true);
  const mn = $('#mine', el); if (mn) mn.onclick = () => browseTown(false);
  $('#rad', el).oninput = (e) => { $('#rv').textContent = radLabel(Number(e.target.value)); };
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

const radLabel = (i) => (i === RADII.length - 1 ? 'All' : fmtD(RADII[i]));

function dropCard(d) {
  const st = d.myStatus === 'redeemed' ? 'Found ✓' : d.myStatus === 'claimed' ? 'Claimed' : `${d.remaining} left`;
  return `<button class="drop ${d.myStatus === 'redeemed' ? 'done' : ''}" data-d="${d.id}"><span class="chest">${esc(d.emoji)}</span>
    <span><div class="n">${esc(d.title)}</div><div class="m">${d.mystery ? 'Mystery reward' : esc(d.item)} · ${esc(d.merchant)}</div>
    <div class="m">${esc(d.difficulty)} · ${d.rating ? `★ ${Number(d.rating).toFixed(1)}` : 'New'}</div></span>
    <span class="d">${fmtD(d.distanceM)}<small>${st}</small></span></button>`;
}

// Light street map (streets, ferry terminals, shops, landmarks) with a Satellite option
// for finding an exact entrance or corner. Both are free with attribution.
function addBaseLayers(map) {
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' });
  streets.addTo(map);
  L.control.layers({ '🗺️ Streets': streets, '🛰️ Satellite': satellite }, null, { position: 'topright', collapsed: false }).addTo(map);
  return streets;
}

let leafletMap = null;
VIEWS.map = async (el) => {
  const data = await api(`/api/drops?destination=${S.dest.id}&radius=50000${hereQs()}`);
  el.innerHTML = `<div class="lmap" id="lmap" role="region" aria-label="Map of treasures"></div>
    <p class="legend">Gold pins are live treasures. Tap one for details. ${S.locSource === 'gps' ? 'The teal dot is you.' : 'Turn on location to see yourself on the map.'}</p>`;
  if (!window.L) { $('#lmap').innerHTML = '<p class="empty">Map is loading, try again in a moment.</p>'; return; }
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  leafletMap = L.map('lmap', { zoomControl: true }).setView([S.here.lat, S.here.lng], 14);
  // OpenStreetMap tiles (no API key needed), darkened with CSS to match the app.
  addBaseLayers(leafletMap);
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

/* ---------- TIN Coupon-style treasure card ---------- */
const fmtCode = (c) => (/^\d{8}$/.test(c) ? `${c.slice(0, 4)} ${c.slice(4)}` : c);
const initials = (n) => String(n || '?').replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function couponStatus(d, claim) {
  if (claim?.status === 'redeemed') return ['redeemed', 'Redeemed ✓'];
  if (claim?.status === 'claimed') return Date.parse(claim.expires_at) < Date.now() ? ['expired', 'Expired'] : ['claimed', 'Claimed'];
  if (!d.remaining) return ['expired', 'All found'];
  return ['available', 'Available'];
}
function couponHtml(d, claim, { stub = false } = {}) {
  const [sk, sl] = couponStatus(d, claim);
  const n = Math.max(d.photoCount || 0, 0);
  const slides = n
    ? Array.from({ length: n }, (_, i) => `<img src="/api/drops/${d.id}/photos/${i}" alt="${esc(d.title)} photo ${i + 1}" loading="lazy">`).join('')
    : `<div class="cp-art"><span>${esc(d.emoji)}</span><small>${esc(d.category)}</small></div>`;
  const limit = S.settings.claimRadius ?? 10;
  const terms = [
    'Completely free. No purchase needed.',
    'One per explorer. Single use.',
    `Claim it while standing at the treasure (within ${limit} m).`,
    `Show the QR or 8-digit code to staff within ${S.settings.claimHours ?? 24} hours of claiming.`,
    `Earn ${S.settings.creditsPerFind} Treasure Hunt credits when ${d.merchant} confirms.`,
    ...(d.terms ? [d.terms] : []),
  ];
  return `<article class="coupon" aria-label="Treasure coupon from ${esc(d.merchant)}">
    <header class="cp-head">
      ${d.hasLogo ? `<img class="cp-logo" src="/api/merchants/${d.merchantId}/logo" alt="${esc(d.merchant)} logo">` : `<span class="cp-logo cp-mono" aria-hidden="true">${esc(initials(d.merchant))}</span>`}
      <div class="cp-who"><b>${esc(d.merchant)}</b><small>${esc(d.category)} · ${fmtD(d.distanceM)} away</small></div>
      <span class="cp-status s-${sk}">${sl}</span>
    </header>
    <div class="cp-gallery" data-n="${n || 1}">
      <div class="cp-track">${slides}</div>
      ${n > 1 ? `<button class="cp-nav prev" aria-label="Previous photo">‹</button><button class="cp-nav next" aria-label="Next photo">›</button>
      <div class="cp-dots">${Array.from({ length: n }, (_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    </div>
    <div class="cp-body">
      <div class="cp-title">${esc(d.emoji)} ${esc(d.title)}</div>
      <div class="cp-reward">${d.item ? esc(d.item) : '🎁 Mystery reward, revealed when you claim'}</div>
      <div class="cp-value">${d.value ? `Value $${Number(d.value).toFixed(0)} · ` : ''}<b>FREE</b> · ${esc(d.difficulty)}</div>
      <p class="clue">${esc(d.story)}</p>
      <details class="cp-terms"><summary>Terms &amp; how to redeem</summary><ul>${terms.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
    </div>
    ${stub && claim ? `<div class="cp-stub">
      <div id="qr" class="cp-qr" aria-label="Redemption QR code"></div>
      <div class="cp-code" aria-label="Backup code">${esc(fmtCode(claim.code))}</div>
      <small>Backup code · saved to your wallet<br>Valid until ${new Date(claim.expires_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>
    </div>` : ''}
  </article>`;
}
function wireGallery(root) {
  const g = $('.cp-gallery', root); if (!g) return;
  const track = $('.cp-track', g), n = Number(g.dataset.n); let i = 0;
  const show = (k) => { i = (k + n) % n; track.style.transform = `translateX(-${i * 100}%)`; $$('.cp-dots i', g).forEach((d, j) => d.classList.toggle('on', j === i)); };
  const p = $('.prev', g), nx = $('.next', g);
  if (p) p.onclick = () => show(i - 1);
  if (nx) nx.onclick = () => show(i + 1);
  let x0 = null;
  g.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  g.addEventListener('touchend', (e) => { if (x0 == null || n < 2) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
}
function drawQr(root, code) {
  try { const qr = qrcode(0, 'M'); qr.addData(`TIN-TH:${code}`); qr.make(); $('#qr', root).innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch {}
}

VIEWS.detail = async (el, id) => {
  const { drop: d, claim } = await api(`/api/drops/${id}?x=1${hereQs()}`);
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=walking`;
  el.innerHTML = `<button class="back" id="bk">← Back to treasures</button>
  ${couponHtml(d, claim)}
  <div class="facts">
    <div class="fact"><div class="k">Walk</div><div class="v">${fmtD(d.distanceM)} · ${d.walkMin} min</div></div>
    <div class="fact"><div class="k">Rating</div><div class="v">${d.rating ? `★ ${Number(d.rating).toFixed(1)} (${d.ratingCount})` : 'New'}</div></div>
    <div class="fact"><div class="k">Hours</div><div class="v">${esc(d.hours || '—')}</div></div>
    <div class="fact"><div class="k">Left</div><div class="v">${d.remaining}</div></div>
  </div>
  ${d.walkingNote ? `<p class="note">🚶 ${esc(d.walkingNote)}</p>` : ''}
  ${claim?.status === 'redeemed' ? `<p class="empty">You found this treasure ✓</p>` :
    claim ? `<button class="btn" id="showqr">Show my coupon code</button>` :
    `<div class="gate" id="gate"></div><button class="btn" id="claim">Claim this treasure</button>`}
  <a class="btn ghost" href="${dirUrl}" target="_blank" rel="noopener">Walking directions</a>`;
  wireGallery(el);
  $('#bk', el).onclick = () => go('hunt');
  const c = $('#claim', el);
  if (c) {
    S.gate = () => claimGate(d, c);
    S.gate();
    c.onclick = async () => {
      if (!S.gate()) return;
      c.disabled = true; c.textContent = 'Claiming…';
      try { await api(`/api/drops/${d.id}/claim`, { method: 'POST', body: { lat: S.here.lat, lng: S.here.lng } }); toast('Treasure claimed! Your coupon is in your wallet.'); go('qr', d.id); }
      catch (e) { toast(e.message); c.disabled = false; c.textContent = 'Claim this treasure'; S.gate(); }
    };
  }
  const q = $('#showqr', el); if (q) q.onclick = () => go('qr', d.id);
};

// Explorers can browse from anywhere, but can only claim when standing at the treasure.
function claimGate(d, btn) {
  const gate = $('#gate'); if (!gate || !btn.isConnected) return false;
  const limit = S.settings.claimRadius ?? 10;
  if (S.locSource !== 'gps') {
    gate.innerHTML = `📍 Turn on location to claim. You must be within <b>${limit} m</b> of the treasure.`;
    btn.disabled = true; return false;
  }
  const away = Math.round(haversine(S.here, { lat: d.lat, lng: d.lng }));
  if (away > limit) {
    gate.innerHTML = `🚶 You're <b>${fmtD(away)}</b> away. Walk to within <b>${limit} m</b> to claim it.`;
    btn.disabled = true; return false;
  }
  gate.innerHTML = `✅ You're here! Claim it before another explorer does.`;
  btn.disabled = false; return true;
}

VIEWS.qr = async (el, id) => {
  const { drop: d, claim } = await api(`/api/drops/${id}`);
  if (!claim) return go('detail', id);
  if (claim.status === 'redeemed') return go('rate', id);
  el.innerHTML = `<button class="back" id="bk">← My codes</button>
  ${couponHtml(d, claim, { stub: true })}
  <div class="status"><span class="p"></span>Show this to ${esc(d.merchant)} staff. Waiting for them to confirm…</div>
  <button class="back" id="cancel" style="text-align:center">Cancel this claim</button>`;
  wireGallery(el); drawQr(el, claim.code);
  $('#bk', el).onclick = () => go('claims');
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
    <span class="d">${c.status === 'redeemed' ? `+${c.credits_awarded}<small>${c.overall_score ? `★ ${c.overall_score}` : 'Rate it'}</small>` : `${esc(fmtCode(c.code))}<small>Show coupon</small>`}</span></button>`;
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
  if (!S.merchant || S.merchant.id !== (S.merchantId || S.me.merchantId)) { const r = await api(`/api/merchant/me${mq()}`); S.merchant = r.merchant; S.payments = r.payments; S.settings.dropPrice = r.dropPrice; S.packs = r.packs || []; S.credits = r.credits ?? 0; S.ledger = r.ledger || []; }
  setLoc(`Merchant · ${S.merchant.name}`);
  refreshMsgBadge();
  return true;
}

VIEWS.mScan = async (el) => {
  if (!(await merchantGuard(el))) return;
  const st = await api(`/api/merchant/stats${mq()}`);
  el.innerHTML = `<div class="merch"><h3>Redeem a treasure</h3>
    <p class="note">Scan the explorer's QR code, or type the 8-digit code from their coupon.</p>
    <button class="btn sea" id="cam">📷 Scan QR code</button>
    <div id="camwrap" hidden><video class="scan" id="vid" playsinline muted></video><button class="back" id="camx" style="text-align:center">Stop camera</button></div>
    <form id="cf" style="display:grid;gap:8px"><input id="code" maxlength="14" placeholder="1234 5678" inputmode="numeric" autocomplete="off" aria-label="Redemption code"><button class="btn">Check code</button></form>
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
  const code = String(raw).trim().toUpperCase().replace(/^TIN-TH:/, '').replace(/[\s-]/g, '');
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
    <span class="note">Code ${esc(fmtCode(c.code))} is valid for ${esc(c.traveler)}. Hand over the treasure, then add proof.</span>
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
  const pill = (s, d) => d?.blocked ? '<span class="pill ended">🛡️ blocked</span>' : `<span class="pill ${s === 'active' ? 'live' : s}">${s === 'active' ? 'live' : s}</span>`;
  el.innerHTML = `<div class="card" style="gap:10px"><div style="display:flex;gap:12px;align-items:center">
      ${S.merchant.has_logo ? `<img class="cp-logo" src="/api/merchants/${S.merchant.id}/logo?v=${Date.now()}" alt="Your logo">` : `<span class="cp-logo cp-mono">${esc(initials(S.merchant.name))}</span>`}
      <div><b>${esc(S.merchant.name)}</b><div class="note">Your logo appears on every treasure coupon.</div></div></div>
      <label class="sbtn" style="justify-self:start;cursor:pointer">${S.merchant.has_logo ? 'Change logo' : 'Upload logo'}<input type="file" accept="image/*" hidden id="lg"></label></div>
  ${creditsCard()}
  <button class="btn" id="nd">＋ Create a new treasure</button>
  ${drops.length ? drops.map((d) => `<div class="card" style="gap:8px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(d.emoji)} ${esc(d.title)}</b>${pill(d.status, d)}</div>
    <div class="note">${esc(d.item)} · ${d.remaining}/${d.quantity} left · ${d.redeemed} redeemed · ${d.waiting} waiting</div>
    ${d.paymentStatus === 'unpaid' ? `<div class="note" style="color:var(--warn)">💳 $${d.fee} to pay before TIN HQ can approve</div>` : d.paymentStatus === 'paid' ? '<div class="note" style="color:var(--ok)">💳 Paid</div>' : ''}
    <div class="row">${d.paymentStatus === 'unpaid' ? `<button class="sbtn gold" data-pay="${d.id}">Pay $${d.fee}</button>` : ''}${d.status === 'active' ? `<button class="sbtn stop" data-p="${d.id}">Pause</button>` : d.status === 'paused' ? `<button class="sbtn go" data-r="${d.id}">Resume</button>` : ''}<button class="sbtn" data-e="${d.id}">Edit</button></div></div>`).join('')
    : '<p class="empty">No treasures yet. Create your first adventure!</p>'}`;
  $('#nd', el).onclick = () => go('mNew');
  wireCredits(el);
  $('#lg', el).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const logo = await shrink(f, 300, 0.85); await api(`/api/merchant/me${mq()}`, { method: 'PATCH', body: { logo } }); S.merchant = null; toast('Logo saved'); render(); } catch (err) { toast(err.message); } };
  const patch = async (id, body) => { try { await api(`/api/merchant/drops/${id}${mq()}`, { method: 'PATCH', body }); render(); } catch (e) { toast(e.message); } };
  $$('[data-p]', el).forEach((b) => (b.onclick = () => patch(b.dataset.p, { status: 'paused' })));
  $$('[data-r]', el).forEach((b) => (b.onclick = () => patch(b.dataset.r, { status: 'active' })));
  $$('[data-e]', el).forEach((b) => (b.onclick = () => go('mEdit', drops.find((d) => d.id === Number(b.dataset.e)))));
  $$('[data-pay]', el).forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await api(`/api/merchant/drops/${b.dataset.pay}/pay${mq()}`, { method: 'POST' }); location.href = r.checkoutUrl; } catch (e) { toast(e.message); b.disabled = false; } }));
};

const money = (n) => `$${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;
function creditsCard() {
  const price = S.settings.dropPrice ?? 1, packs = S.packs || [];
  const online = S.payments === 'stripe';
  const why = { welcome: '🎁 Welcome gift', gift: '🎁 Gift from TIN', purchase: '💳 Bought', drop: '🗝️ Treasure', refund: '↩️ Refund', adjust: '✏️ Adjusted by TIN' };
  return `<div class="card credits" style="gap:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="note">Your drop credits</div><b style="font-size:2rem;line-height:1">🎟️ ${S.credits ?? 0}</b></div>
      <div class="note" style="max-width:24ch">1 credit = 1 treasure drop. Buy drops upfront, then hide treasures any time.</div></div>
    ${online ? `<div class="row" style="flex-wrap:wrap;gap:8px">${packs.map((p, i) => `<button class="sbtn gold" data-pack="${i}">Buy ${p.drops} drops · ${money(p.usd)}</button>`).join('')}</div>
    <form id="buyf" class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><input id="buyn" type="number" min="1" max="10000" value="10" style="width:90px" aria-label="Number of drops"><span class="note">drops × ${money(price)} = <b id="buyt">${money(10 * price)}</b></span><button class="sbtn">Buy</button></form>
    <p class="note">🔒 Secure card payment by Stripe.</p>` : '<p class="note">Online payment is not switched on yet. Ask TIN HQ for drops.</p>'}
    ${(S.ledger || []).length ? `<details><summary class="note" style="cursor:pointer">History</summary><div class="hist">${S.ledger.map((l) => `<div><span>${why[l.reason] || l.reason}${l.note ? ' · ' + esc(l.note) : ''} <span class="note">${esc(l.created_at.slice(0, 10))}</span></span><b style="color:${l.delta > 0 ? 'var(--ok)' : 'inherit'}">${l.delta > 0 ? '+' : ''}${l.delta}</b></div>`).join('')}</div></details>` : ''}
  </div>`;
}
function wireCredits(el) {
  const price = S.settings.dropPrice ?? 1;
  const buy = async (b, btn) => { btn.disabled = true; try { const r = await api(`/api/merchant/credits/checkout${mq()}`, { method: 'POST', body: b }); btn.textContent = 'Opening secure payment…'; location.href = r.checkoutUrl; } catch (e) { toast(e.message); btn.disabled = false; } };
  $$('[data-pack]', el).forEach((b) => (b.onclick = () => buy({ pack: Number(b.dataset.pack) }, b)));
  const n = $('#buyn', el); if (n) n.oninput = () => { $('#buyt', el).textContent = money((Number(n.value) || 0) * price); };
  const f = $('#buyf', el); if (f) f.onsubmit = (e) => { e.preventDefault(); buy({ drops: Number(n.value) }, $('button', f)); };
}

// Reads "20.6296, -87.0739", "20.6296 -87.0739", "20.6296° N, 87.0739° W" or a Google Maps link.
function parseCoords(text) {
  const t = String(text || '').trim();
  const at = t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  let lat, lng;
  if (at) { lat = Number(at[1]); lng = Number(at[2]); }
  else {
    const m = t.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])?/);
    if (!m) return null;
    lat = Number(m[1]) * (/[Ss]/.test(m[2] || '') ? -1 : 1);
    lng = Number(m[3]) * (/[Ww]/.test(m[4] || '') ? -1 : 1);
  }
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// Map in the treasure form: drag the pin, tap the map, paste coordinates, or jump to "here" / "my business".
function placePicker(el, d) {
  const biz = S.merchant && Number.isFinite(S.merchant.lat) ? { lat: S.merchant.lat, lng: S.merchant.lng } : { lat: S.dest.lat, lng: S.dest.lng };
  let pin = d && Number.isFinite(d.lat) ? { lat: d.lat, lng: d.lng } : { ...biz };
  let map = null, marker = null, warnT = null;
  const info = $('#pinfo', el), input = $('#coords', el);
  const show = (pan) => {
    input.value = `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`;
    const away = haversine(biz, pin);
    info.innerHTML = `${away < 15 ? '🏪 At your business.' : `📏 ${fmtD(Math.round(away))} from your business.`} <a href="https://www.google.com/maps?q=${pin.lat},${pin.lng}" target="_blank" rel="noopener">Check in Google Maps ↗</a>`;
    if (marker) marker.setLatLng([pin.lat, pin.lng]);
    if (map && pan) map.setView([pin.lat, pin.lng], Math.max(map.getZoom(), 16));
    clearTimeout(warnT); warnT = setTimeout(async () => {
      try { const r = await api(`/api/merchant/shield-check?lat=${pin.lat}&lng=${pin.lng}${mq().replace('?', '&')}`); const w = $('#pwarn', el); if (w) w.hidden = !r.inside; } catch {}
    }, 400);
  };
  const set = (p, pan = true) => { pin = { lat: Number(p.lat), lng: Number(p.lng) }; $('#er').textContent = ''; show(pan); };
  const jump = () => { const p = parseCoords(input.value); if (!p) { $('#er').textContent = 'Those coordinates were not understood. Use the format 20.6296, -87.0739.'; return; } set(p); };
  $('#cgo', el).onclick = jump;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); jump(); } };
  input.onpaste = () => setTimeout(() => { if (parseCoords(input.value)) jump(); }, 0);
  $('#pbiz', el).onclick = () => set(biz);
  $('#pme', el).onclick = () => {
    if (!navigator.geolocation) { $('#er').textContent = 'This device cannot share its location.'; return; }
    navigator.geolocation.getCurrentPosition((p) => set({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { $('#er').textContent = 'Turn on location so we can place the treasure where you are.'; }, { enableHighAccuracy: true, timeout: 20000 });
  };
  const draw = () => {
    if (!window.L) { setTimeout(draw, 300); return; }
    map = L.map('pmap', { zoomControl: true }).setView([pin.lat, pin.lng], 16);
    addBaseLayers(map);
    if (Number.isFinite(biz.lat) && S.merchant) L.marker([biz.lat, biz.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="pinx biz">🏪</div>', iconSize: [26, 26] }) }).addTo(map);
    marker = L.marker([pin.lat, pin.lng], { draggable: true, autoPan: true, icon: L.divIcon({ className: '', html: `<div class="pinx drag">${esc($('#em')?.value || '🎁')}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(map);
    marker.on('dragend', () => set(marker.getLatLng(), false));
    map.on('click', (e) => set(e.latlng, false));
    const em = $('#em', el); if (em) em.addEventListener('change', () => marker.setIcon(L.divIcon({ className: '', html: `<div class="pinx drag">${esc(em.value)}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] })));
    setTimeout(() => map && map.invalidateSize(), 60);
  };
  show(false); draw();
  return { get: () => pin };
}

function dropForm(el, d) {
  const edit = !!d;
  const price = S.settings.dropPrice ?? 1;
  const hq = S.me.role === 'admin', have = S.credits ?? 0;
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
    <fieldset class="place"><legend>Where is the treasure hidden?</legend>
      <p class="note">Drag the pin to the exact spot or tap the map. You can also paste coordinates, for example from Google Maps.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><input id="coords" inputmode="text" autocomplete="off" placeholder="e.g. 20.6296, -87.0739" aria-label="Coordinates: latitude, longitude" style="flex:1;min-width:180px"><button type="button" class="sbtn gold" id="cgo" style="flex:none">Go</button></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="sbtn" id="pme">📍 Where I'm standing</button><button type="button" class="sbtn" id="pbiz">🏪 At my business</button></div>
      <div class="lmap pmap" id="pmap" role="region" aria-label="Map: drag the pin to place the treasure"></div>
      <p class="note" id="pinfo" role="status"></p>
      <p class="note" id="pwarn" hidden style="color:var(--warn)">🛡️ This spot is inside another business's Treasure Shield. They will be told when your treasure goes live and may block it. If they do, your unused drop credits come back.</p>
    </fieldset>
    <label>Your terms (optional)<textarea id="tm" maxlength="500" placeholder="e.g. Dine-in only. Not valid on public holidays.">${esc(d?.terms || '')}</textarea></label>
    <div class="photos" id="phs"></div>
    <label class="sbtn" style="justify-self:start;cursor:pointer">📷 Add photos (up to 4)<input type="file" accept="image/*" multiple hidden id="pf"></label>
    ${edit ? '<p class="note">Changes to the name, reward, story, photo or location go back to TIN HQ for a quick review.</p>' : hq ? '<div class="sum"><span>Created by TIN HQ</span><b>Free</b></div>' : `<div class="sum"><span>Uses drop credits · you have ${have}</span><b id="tot">10</b></div>`}
    <div class="err" id="er"></div>
    <button class="btn" type="submit">${edit ? 'Save changes' : '🗝️ Drop treasure'}</button>${edit ? '' : '<p class="note">TIN HQ checks every treasure before explorers can find it.</p>'}
    ${edit || hq ? '' : `<p class="note" id="cnote">🎟️ Each drop uses 1 credit. If TIN HQ does not approve the treasure, your credits come back.</p><button type="button" class="sbtn gold" id="getmore" ${have >= 10 ? 'hidden' : ''}>Buy more drops</button>`}
  </form>`;
  // Gallery photos: start from the treasure's current photos when editing.
  let photos = null, current = d?.photoCount || 0;
  const drawPhotos = () => {
    const box = $('#phs'); if (!box) return;
    const list = photos ? photos : Array.from({ length: current }, (_, i) => `/api/drops/${d.id}/photos/${i}`);
    box.innerHTML = list.length ? list.map((src, i) => `<figure><img src="${src}" alt="Photo ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">✕</button></figure>`).join('') : '<p class="note">No photos yet. Treasures with photos get found more.</p>';
    $$('[data-rm]', box).forEach((b) => (b.onclick = async () => {
      if (!photos) photos = await Promise.all(list.map((u) => (u.startsWith('data:') ? u : fetch(u).then((r) => r.blob()).then((bl) => shrink(bl, 800, 0.7)))));
      photos.splice(Number(b.dataset.rm), 1); drawPhotos();
    }));
  };
  $('#bk', el).onclick = () => go('mList');
  const place = placePicker(el, d);
  const qt = $('#qt', el); if (qt && !hq) qt.oninput = () => { const q = Number(qt.value) || 0; $('#tot').textContent = q; $('#getmore').hidden = q <= have; };
  const gm = $('#getmore', el); if (gm) gm.onclick = () => go('mList');
  drawPhotos();
  $('#pf', el).onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    if (!photos) photos = current ? await Promise.all(Array.from({ length: current }, (_, i) => fetch(`/api/drops/${d.id}/photos/${i}`).then((r) => r.blob()).then((bl) => shrink(bl, 800, 0.7)))) : [];
    for (const f of files) { if (photos.length >= 4) { toast('Up to 4 photos'); break; } photos.push(await shrink(f, 800, 0.7)); }
    e.target.value = ''; drawPhotos();
  };
  $('#f', el).onsubmit = async (e) => {
    e.preventDefault();
    const body = { title: $('#tn').value, item: $('#it').value, story: $('#cl').value, category: $('#ct').value, emoji: $('#em').value, difficulty: $('#df').value, value: Number($('#vl').value || 0), walkingNote: $('#wd').value, kids: $('#kd').checked, mystery: $('#my').checked };
    if (!edit) body.quantity = Number($('#qt').value);
    const pin = place.get(); body.lat = pin.lat; body.lng = pin.lng;
    if (photos) body.photos = photos;
    body.terms = $('#tm').value;
    const btn = $('button[type=submit]', el); btn.disabled = true;
    try {
      if (edit) { const r = await api(`/api/merchant/drops/${d.id}${mq()}`, { method: 'PATCH', body }); toast(r.status === 'pending' ? 'Saved. Sent to TIN HQ for review.' : 'Saved'); }
      else {
        const r = await api(`/api/merchant/drops${mq()}`, { method: 'POST', body });
        S.merchant = null;
        toast(r.drop.payment_status === 'waived' ? 'Treasure created' : `Sent to TIN HQ for approval · ${r.creditsUsed} credits used, ${r.balance} left`);
      }
      go('mList');
    } catch (err) { $('#er').textContent = err.message; btn.disabled = false; }
  };
}
VIEWS.mNew = async (el) => { if (await merchantGuard(el)) dropForm(el, null); };
VIEWS.mEdit = async (el, d) => { if (await merchantGuard(el)) dropForm(el, d); };

/* ---------- Treasure Shield & merchant messages ---------- */
async function refreshMsgBadge() {
  try {
    const r = await api(`/api/merchant/messages?peek=1${mq().replace('?', '&')}`);
    const n = r.unread || r.open;
    if (n === S.msgBadge) return;
    S.msgBadge = n;
    const b = $('#nav [data-go="mMsg"]'); if (!b) return;
    b.querySelector('.badge')?.remove();
    if (n) b.insertAdjacentHTML('beforeend', `<span class="badge" aria-label="${n} new">${n}</span>`);
  } catch {}
}

function msgCard(m) {
  const when = new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const where = m.drop_lat != null ? `<a href="https://www.google.com/maps?q=${m.drop_lat},${m.drop_lng}" target="_blank" rel="noopener">📍 See where it is ↗</a>` : '';
  const open = m.kind === 'shield_alert' && m.state === 'open';
  const done = m.kind === 'shield_alert' ? { left: '✅ You left it.', blocked: '🛡️ You blocked it.', closed: 'Closed: the treasure moved, ended, or your shield was off.' }[m.state] : '';
  return `<div class="card msg${open ? ' open' : ''}" style="gap:8px">
    <div class="note">${esc(when)}${m.read_at ? '' : ' · <b style="color:var(--gold)">New</b>'}</div>
    <div class="msgtext">${esc(m.body)}</div>${where}
    ${open ? `<div class="row"><button class="sbtn" data-act="leave" data-id="${m.id}">Leave it</button><button class="sbtn stop" data-act="block" data-id="${m.id}">🛡️ Block it</button></div>` : done ? `<div class="note">${done}</div>` : ''}</div>`;
}

let shieldMap = null;
VIEWS.mMsg = async (el) => {
  if (!(await merchantGuard(el))) return;
  const [sh, ms] = await Promise.all([api(`/api/merchant/shield${mq()}`), api(`/api/merchant/messages${mq()}`)]);
  S.msgBadge = -1; refreshMsgBadge();
  const cur = sh.shield ? { ...sh.shield } : { lat: sh.business.lat, lng: sh.business.lng, radius: Math.min(50, sh.maxRadius), active: false };
  el.innerHTML = `<div class="card" style="gap:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">🛡️ Treasure Shield</h3><span class="pill ${sh.shield?.active ? 'live' : 'draft'}">${sh.shield?.active ? 'on' : sh.shield ? 'off' : 'not set up'}</span></div>
    <p class="note">Protect your place. When another business's treasure goes live inside your shield, you get a message here and choose: leave it or block it.</p>
    <label style="flex-direction:row;display:flex;gap:8px;align-items:center"><input type="checkbox" id="shon" style="width:auto" ${cur.active || !sh.shield ? 'checked' : ''}> Shield on</label>
    <div class="slider"><div class="lbl"><span>Shield size</span><b id="shrv">${cur.radius} m</b></div>
      <input type="range" id="shr" min="10" max="${sh.maxRadius}" step="5" value="${cur.radius}" aria-label="Shield size in metres"></div>
    <div class="lmap smap" id="smap" role="region" aria-label="Map of your shield"></div>
    <p class="note">Drag the 🛡️ to move the centre, up to ${sh.maxCentreFromBusiness} m from your business. The largest shield is ${sh.maxRadius} m.</p>
    <div class="err" id="sher"></div>
    <button class="btn" id="shsave">${sh.shield ? 'Save shield' : '🛡️ Switch on my shield'}</button></div>`;
  const inbox = `<h3 style="margin:8px 2px 0">Messages</h3>
  ${ms.messages.length ? ms.messages.map(msgCard).join('') : '<p class="empty">No messages yet. You will be told here when a treasure lands inside your shield, or if one of your treasures is blocked.</p>'}`;
  // Alerts waiting for an answer go first; otherwise the shield settings lead.
  if (ms.open) el.insertAdjacentHTML('afterbegin', inbox); else el.insertAdjacentHTML('beforeend', inbox);
  const r = $('#shr', el), rv = $('#shrv', el);
  let circle = null, centre = null;
  const draw = () => {
    if (!window.L || !$('#smap')) { if ($('#smap')) setTimeout(draw, 300); return; }
    if (shieldMap) { shieldMap.remove(); shieldMap = null; }
    shieldMap = L.map('smap', { zoomControl: true }).setView([cur.lat, cur.lng], 17);
    addBaseLayers(shieldMap);
    L.marker([sh.business.lat, sh.business.lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="pinx biz">🏪</div>', iconSize: [26, 26] }) }).addTo(shieldMap);
    circle = L.circle([cur.lat, cur.lng], { radius: cur.radius, color: '#f1c40f', weight: 2, fillOpacity: 0.15 }).addTo(shieldMap);
    centre = L.marker([cur.lat, cur.lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="pinx drag">🛡️</div>', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(shieldMap);
    centre.on('drag', () => circle.setLatLng(centre.getLatLng()));
    centre.on('dragend', () => { const p = centre.getLatLng(); cur.lat = p.lat; cur.lng = p.lng; });
    shieldMap.fitBounds(circle.getBounds(), { padding: [24, 24] });
    setTimeout(() => shieldMap && shieldMap.invalidateSize(), 60);
  };
  draw();
  r.oninput = () => { cur.radius = Number(r.value); rv.textContent = `${cur.radius} m`; if (circle) circle.setRadius(cur.radius); };
  r.onchange = () => { if (circle && shieldMap) shieldMap.fitBounds(circle.getBounds(), { padding: [24, 24] }); };
  $('#shsave', el).onclick = async (e) => {
    e.target.disabled = true; $('#sher').textContent = '';
    try {
      const res = await api(`/api/merchant/shield${mq()}`, { method: 'PUT', body: { active: $('#shon').checked, radius: cur.radius, lat: cur.lat, lng: cur.lng } });
      toast(res.shield.active ? `Shield on · ${res.shield.radius} m${res.alerts ? ` · ${res.alerts} treasure${res.alerts === 1 ? '' : 's'} already inside, see Messages` : ''}` : 'Shield switched off');
      render();
    } catch (err) { $('#sher').textContent = err.message; e.target.disabled = false; }
  };
  $$('[data-act]', el).forEach((b) => (b.onclick = async () => {
    const block = b.dataset.act === 'block';
    if (block && !confirm('Block this treasure? It will be taken down and the other business will be told.')) return;
    b.disabled = true;
    try {
      const res = await api(`/api/merchant/messages/${b.dataset.id}/act${mq()}`, { method: 'POST', body: { action: b.dataset.act } });
      toast(res.note || (res.state === 'blocked' ? 'Blocked. The treasure is no longer shown.' : 'OK, the treasure stays.'));
      render();
    } catch (err) { toast(err.message); b.disabled = false; }
  }));
};

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
  el.innerHTML = `<div class="hqbar"><h1>TIN <em>HQ</em> · ${esc(S.dest.name)}</h1><span class="note">Signed in as ${esc(S.me.name)} · <button class="linkbtn" id="hqOut">Sign out</button></span></div>
  <div class="hqtabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${hqTab === k}">${l}</button>`).join('')}</div>
  <div id="hqb"><div class="spin"></div></div>`;
  $$('[data-t]', el).forEach((b) => (b.onclick = () => { hqTab = b.dataset.t; hqRender(); }));
  $('#hqOut', el).onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; };
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
  el.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3>Merchants</h3><button class="sbtn gold" id="syncTin" title="Bring in the merchants switched on in the TIN merchant cockpit">⟳ Sync from TIN Commerce</button></div><div class="tbl"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Contact</th><th class="n">Credits</th><th class="n">Drops</th><th class="n">Redeemed</th><th class="n">Rating</th><th></th></tr></thead><tbody>
  ${merchants.map((m) => `<tr><td>${esc(m.name)} ${m.is_sample ? '<span class="sample">sample</span>' : ''}${m.needs_location ? ` <button class="sbtn" data-loc="${m.id}" title="Paste coordinates from Google Maps">📍 Set location</button>` : ''}</td><td>${esc(m.category)}</td><td>${pill(m.status)}</td><td>${esc(m.contact_email || '')}</td><td class="n"><b>${m.drop_credits ?? 0}</b> <button class="sbtn" data-gift="${m.id}" title="Give free drops (or type a minus number to take some away)">🎁 Give</button></td><td class="n">${m.drops}</td><td class="n">${m.redemptions}</td><td class="n">${m.rating ?? '—'}</td>
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
  $$('[data-gift]', el).forEach((b) => (b.onclick = async () => {
    const m = merchants.find((x) => x.id === Number(b.dataset.gift));
    const v = prompt(`How many free drops for ${m.name}? (Use a minus number to take drops away.)`, '25'); if (v === null) return;
    const note = prompt('Note (optional), e.g. "Launch gift"', '') ?? '';
    try { const r = await api(`/api/admin/merchants/${m.id}/credits`, { method: 'POST', body: { drops: Number(v), note } }); hqToast(`${m.name} now has ${r.balance} drop credits`); hqRender(); } catch (e) { hqToast(e.message); }
  }));
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
  $('#syncTin', el).onclick = async (e) => { e.target.disabled = true; try { const r = await api('/api/admin/sync-tin', { method: 'POST' }); hqToast(`TIN sync: ${r.added} added, ${r.updated} updated, ${r.paused} paused`); hqRender(); } catch (err) { hqToast(err.message); e.target.disabled = false; } };
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
  el.innerHTML = `<div class="card"><h3>Treasure Drops</h3><div class="tbl"><table><thead><tr><th>Treasure</th><th>Merchant</th><th>Where</th><th>Story</th><th>Status</th><th>Payment</th><th class="n">Left</th><th class="n">Redeemed</th><th class="n">Fee</th><th></th></tr></thead><tbody>
  ${drops.map((d) => `<tr><td>${esc(d.emoji)} <b>${esc(d.title)}</b><div class="note">${esc(d.item)} · ${esc(d.category)} · ${esc(d.difficulty)}</div></td><td>${esc(d.merchant)}</td><td><a href="https://www.google.com/maps?q=${d.lat},${d.lng}" target="_blank" rel="noopener">📍 Map ↗</a><div class="note">${d.fromBusinessM == null ? '' : d.fromBusinessM < 15 ? 'At the business' : `${fmtD(d.fromBusinessM)} from the business`}</div></td><td style="max-width:300px" class="note">${esc(d.story)}</td><td>${d.blocked ? '<span class="pill ended">🛡️ blocked</span>' : pill(d.status)}</td><td><span class="pill ${d.paymentStatus === 'unpaid' ? 'pending' : d.paymentStatus === 'paid' ? 'live' : 'draft'}">${d.paymentStatus}</span></td>
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
    <label>Price per single drop (USD)<input name="dropPrice" type="number" min="0" step="0.01" value="${s.dropPrice}"></label>
    <label>Free welcome drops for each new merchant<input name="welcomeDrops" type="number" min="0" max="10000" value="${s.welcomeDrops ?? 25}"></label>
    <label>Largest Treasure Shield a merchant can set (metres)<input name="shieldMaxRadius" type="number" min="10" max="2000" value="${s.shieldMaxRadius ?? 150}"></label>
    <fieldset style="grid-column:1/-1;border:1px solid var(--line);border-radius:10px;padding:10px"><legend class="note">Drop packs (leave a row empty to remove it)</legend>
      ${[0, 1, 2, 3].map((i) => { const p = (s.dropPacks || [])[i] || {}; return `<div class="row" style="gap:8px;align-items:center;margin:4px 0"><input name="pd${i}" type="number" min="1" placeholder="Drops" value="${p.drops ?? ''}" style="width:110px" aria-label="Pack ${i + 1} drops"><span class="note">drops for US$</span><input name="pu${i}" type="number" min="0.5" step="0.01" placeholder="Price" value="${p.usd ?? ''}" style="width:110px" aria-label="Pack ${i + 1} price"></div>`; }).join('')}
      <p class="note">Example: 100 drops for US$10 = 10 cents a drop. The minimum card payment is US$0.50.</p></fieldset>
    <label>Claim code valid (hours)<input name="claimHours" type="number" min="1" max="168" value="${s.claimHours}"></label>
    <label>Explorer must be within (metres) to claim<input name="claimRadius" type="number" min="5" max="5000" value="${s.claimRadius}"></label>
    <p class="note" style="grid-column:1/-1">Phone GPS is usually accurate to about 5–20 m, and less inside buildings. A very small distance can stop explorers who are standing at the door.</p>
    <button class="sbtn gold">Save</button></form></div>`;
  $('#sf', el).onsubmit = async (e) => { e.preventDefault(); const raw = Object.fromEntries([...new FormData(e.target)]); const f = {}; for (const [k, v] of Object.entries(raw)) if (!/^p[du]\d$/.test(k)) f[k] = Number(v);
    f.dropPacks = [0, 1, 2, 3].map((i) => ({ drops: Number(raw['pd' + i]), usd: Number(raw['pu' + i]) })).filter((p) => p.drops > 0 && p.usd > 0); try { await api('/api/admin/settings', { method: 'PUT', body: f }); Object.assign(S.settings, { creditsPerFind: f.creditsPerFind, rafflePrize: f.rafflePrize, dropPrice: f.dropPrice, claimRadius: f.claimRadius }); hqToast('Settings saved'); } catch (err) { hqToast(err.message); } };
};

boot().catch((e) => { document.body.innerHTML = `<p class="empty" style="padding:40px">${esc(e.message)}</p>`; });
