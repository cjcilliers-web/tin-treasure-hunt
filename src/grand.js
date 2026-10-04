// Grand Treasure + sponsor videos.
// Merchants pay per finished view of their 15/30-second video (price set by TIN HQ); part of every
// view (default 5 cents) fills the live Grand Treasure pot. Clues unlock and the search circle
// shrinks as the pot grows; when it's full, the first explorer at the secret spot claims the prize.
import { bad, body, json, str, num, nowIso, distanceM, getSettings, couponCode } from './lib.js';
import { requireRole } from './auth.js';
import { stripe, stripeEnabled } from './payments.js';

const BUDGET_PACKS = [1000, 2500, 5000, 10000]; // cents: $10, $25, $50, $100
const CLAIM_RADIUS_M = 25;
const money = (c) => `$${(c / 100).toFixed(2)}`;

function merchantIdOf(user, url) {
  requireRole(user, 'merchant', 'admin');
  if (user.role === 'merchant') return user.merchant_id;
  const id = Number(url.searchParams.get('merchant'));
  if (!Number.isInteger(id) || id < 1) bad('Pick a merchant first');
  return id;
}

export function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}
function cleanLink(v) {
  if (!v) return null;
  const s = str(v, { max: 300, name: 'Link' });
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(s)) bad('Links must start with http:// or https://');
  return s;
}
const priceFor = (s, len) => (len === 30 ? s.videoPrice30 : s.videoPrice15);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- video budget (merchants) ----------

async function changeBudget(env, merchantId, delta, reason, { ref = null, note = null, by = null } = {}) {
  const row = await env.DB.prepare('UPDATE merchants SET video_balance_cents = video_balance_cents + ? WHERE id = ? AND video_balance_cents + ? >= 0 RETURNING video_balance_cents')
    .bind(delta, merchantId, delta).first();
  if (!row) return null;
  if (reason !== 'view') { // views are recorded in video_watches; keep the ledger readable
    await env.DB.prepare('INSERT INTO video_budget_ledger(merchant_id, delta_cents, reason, ref, note, created_by) VALUES (?,?,?,?,?,?)')
      .bind(merchantId, delta, reason, ref, note, by).run();
  }
  return row.video_balance_cents;
}

// POST /api/merchant/video-budget/checkout { cents }
export async function buyVideoBudget(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantIdOf(user, url);
  if (!stripeEnabled(env)) bad('Online payment is not switched on yet. Please contact TIN.');
  const m = await env.DB.prepare('SELECT id, name, contact_email FROM merchants WHERE id = ?').bind(mid).first();
  if (!m) bad('Merchant not found', 404);
  const b = await body(req, 500);
  const cents = Number(b.cents);
  if (!BUDGET_PACKS.includes(cents)) bad('Choose one of the budget amounts');
  const p = await env.DB.prepare('INSERT INTO video_budget_purchases(merchant_id, amount_cents) VALUES (?,?) RETURNING id').bind(mid, cents).first();
  const session = await stripe(env, '/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment', client_reference_id: `video:${p.id}`, customer_email: m.contact_email || undefined,
      line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Video budget ${money(cents)}`, description: `TIN Treasure Hunt sponsor video views for ${m.name}` } } } },
      metadata: { video_purchase_id: p.id, merchant_id: mid },
      success_url: `${url.origin}/app?videobudget={CHECKOUT_SESSION_ID}${user.role === 'admin' ? `&mode=merchant&merchant=${mid}` : ''}`,
      cancel_url: `${url.origin}/app?credits_cancel=1`,
    },
  });
  await env.DB.prepare('UPDATE video_budget_purchases SET stripe_session_id = ? WHERE id = ?').bind(session.id, p.id).run();
  return json({ checkoutUrl: session.url });
}

export async function markVideoBudgetPaid(env, sessionId, paymentIntent) {
  const row = await env.DB.prepare(`UPDATE video_budget_purchases SET status = 'paid', paid_at = ?, stripe_payment_intent = ?
      WHERE stripe_session_id = ? AND status != 'paid' RETURNING id, merchant_id, amount_cents`).bind(nowIso(), paymentIntent || null, sessionId).first();
  if (row) await changeBudget(env, row.merchant_id, row.amount_cents, 'purchase', { ref: `video-purchase:${row.id}`, note: `Bought ${money(row.amount_cents)} video budget` });
  return row;
}

// GET /api/merchant/video-budget/checkout/:sessionId
export async function verifyVideoBudget(req, env, user, sessionId) {
  const mid = merchantIdOf(user, new URL(req.url));
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) bad('Invalid session');
  const p = await env.DB.prepare('SELECT merchant_id, amount_cents FROM video_budget_purchases WHERE stripe_session_id = ?').bind(sessionId).first();
  if (!p || p.merchant_id !== mid) bad('Not found', 404);
  const s = await stripe(env, `/checkout/sessions/${sessionId}`);
  if (s.payment_status === 'paid') await markVideoBudgetPaid(env, sessionId, s.payment_intent);
  const m = await env.DB.prepare('SELECT video_balance_cents FROM merchants WHERE id = ?').bind(mid).first();
  return json({ paid: s.payment_status === 'paid', cents: p.amount_cents, balance: m.video_balance_cents });
}

// POST /api/admin/merchants/:id/video-budget { cents, note } — HQ gift or correction
export async function adminGiveVideoBudget(req, env, user, id) {
  requireRole(user, 'admin');
  const b = await body(req, 1_000);
  const cents = num(b.cents, { min: -10_000_000, max: 10_000_000, int: true, name: 'Amount (cents)' });
  const bal = await changeBudget(env, id, cents, cents > 0 ? 'gift' : 'adjust', { note: b.note ? str(b.note, { max: 200 }) : null, by: user.id });
  if (bal === null) bad('That would take the budget below zero, or the merchant was not found');
  return json({ balance: bal });
}

// ---------- videos (merchants and HQ) ----------

const STATS = `(SELECT COUNT(*) FROM video_watches w WHERE w.video_id = v.id AND w.completed_at IS NOT NULL) AS views,
  (SELECT COALESCE(SUM(charged_cents), 0) FROM video_watches w WHERE w.video_id = v.id) AS spent,
  (SELECT COUNT(*) FROM video_watches w WHERE w.video_id = v.id AND w.link_clicked = 1) AS clicks`;
const shapeVideo = (v, s) => ({
  id: v.id, merchantId: v.merchant_id, sponsor: v.sponsor_name, title: v.title, youtubeId: v.youtube_id, length: v.length_s,
  coupon: v.coupon_text, link: v.link_url, status: v.status, createdAt: v.created_at,
  pricePerView: v.merchant_id ? priceFor(s, v.length_s) : 0, views: v.views ?? 0, spent: v.spent ?? 0, clicks: v.clicks ?? 0,
});
function videoInput(b) {
  const id = youtubeId(b.url);
  if (!id) bad('Paste a YouTube link, for example https://youtu.be/abc123XYZ00');
  const length = Number(b.length) === 30 ? 30 : 15;
  return {
    title: str(b.title, { min: 3, max: 80, name: 'Video title' }), youtube_id: id, length_s: length,
    coupon_text: b.coupon ? str(b.coupon, { max: 160, name: 'Coupon' }) : null, link_url: cleanLink(b.link),
  };
}

// GET /api/merchant/videos
export async function merchantVideos(req, env, user) {
  const mid = merchantIdOf(user, new URL(req.url));
  const s = await getSettings(env.DB);
  const m = await env.DB.prepare('SELECT video_balance_cents FROM merchants WHERE id = ?').bind(mid).first();
  const { results } = await env.DB.prepare(`SELECT v.*, ${STATS} FROM sponsor_videos v WHERE v.merchant_id = ? ORDER BY v.id DESC`).bind(mid).all();
  return json({ balance: m?.video_balance_cents ?? 0, prices: { 15: s.videoPrice15, 30: s.videoPrice30 }, packs: BUDGET_PACKS,
    payments: stripeEnabled(env) ? 'stripe' : 'off', videos: results.map((v) => shapeVideo(v, s)) });
}

// POST /api/merchant/videos { title, url, length, coupon, link }
export async function addMerchantVideo(req, env, user) {
  const mid = merchantIdOf(user, new URL(req.url));
  const m = await env.DB.prepare('SELECT name, status FROM merchants WHERE id = ?').bind(mid).first();
  if (!m || m.status !== 'active') bad('Your merchant account is not active yet');
  const d = videoInput(await body(req, 4_000));
  const n = await env.DB.prepare(`SELECT COUNT(*) n FROM sponsor_videos WHERE merchant_id = ? AND status IN ('pending','active')`).bind(mid).first();
  if (n.n >= 5) bad('You can have up to 5 videos at a time. Pause one first.');
  const row = await env.DB.prepare(`INSERT INTO sponsor_videos(merchant_id, sponsor_name, title, youtube_id, length_s, coupon_text, link_url, status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`).bind(mid, m.name, d.title, d.youtube_id, d.length_s, d.coupon_text, d.link_url, user.role === 'admin' ? 'active' : 'pending', user.id).first();
  return json({ video: shapeVideo(row, await getSettings(env.DB)) }, 201);
}

// PATCH /api/merchant/videos/:id { status } — pause / resume
export async function updateMerchantVideo(req, env, user, id) {
  const mid = merchantIdOf(user, new URL(req.url));
  const v = await env.DB.prepare('SELECT status FROM sponsor_videos WHERE id = ? AND merchant_id = ?').bind(id, mid).first();
  if (!v) bad('Video not found', 404);
  const b = await body(req, 500);
  const ok = { active: ['paused'], paused: ['active'] }[v.status] || [];
  if (user.role !== 'admin' && !ok.includes(b.status)) bad(`A ${v.status} video cannot be set to ${b.status}`);
  await env.DB.prepare('UPDATE sponsor_videos SET status = ? WHERE id = ?').bind(b.status, id).run();
  return json({ ok: true });
}

// GET /api/admin/videos
export async function adminVideos(req, env, user) {
  requireRole(user, 'admin');
  const s = await getSettings(env.DB);
  const { results } = await env.DB.prepare(`SELECT v.*, m.video_balance_cents AS balance, ${STATS} FROM sponsor_videos v LEFT JOIN merchants m ON m.id = v.merchant_id
      ORDER BY CASE v.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, v.id DESC LIMIT 200`).all();
  return json({ videos: results.map((v) => ({ ...shapeVideo(v, s), balance: v.balance })) });
}

// POST /api/admin/videos { sponsorName, title, url, length, coupon, link } — outside sponsor, live at once, no charge
export async function adminAddVideo(req, env, user) {
  requireRole(user, 'admin');
  const b = await body(req, 4_000);
  const d = videoInput(b);
  const row = await env.DB.prepare(`INSERT INTO sponsor_videos(merchant_id, sponsor_name, title, youtube_id, length_s, coupon_text, link_url, status, created_by)
      VALUES (NULL,?,?,?,?,?,?,'active',?) RETURNING *`).bind(str(b.sponsorName, { min: 2, max: 80, name: 'Sponsor name' }), d.title, d.youtube_id, d.length_s, d.coupon_text, d.link_url, user.id).first();
  return json({ video: shapeVideo(row, await getSettings(env.DB)) }, 201);
}

// PATCH /api/admin/videos/:id { status }
export async function adminUpdateVideo(req, env, user, id) {
  requireRole(user, 'admin');
  const b = await body(req, 500);
  if (!['pending', 'active', 'paused', 'rejected'].includes(b.status)) bad('Unknown status');
  const r = await env.DB.prepare('UPDATE sponsor_videos SET status = ? WHERE id = ? RETURNING id').bind(b.status, id).first();
  if (!r) bad('Video not found', 404);
  return json({ ok: true });
}

// ---------- Grand Treasure ----------

async function liveGrand(env) {
  return env.DB.prepare(`SELECT * FROM grand_treasures WHERE status IN ('live','full','found') ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'full' THEN 1 ELSE 2 END, id DESC LIMIT 1`).first();
}

// Point `dist` metres from (lat,lng) in direction `bearing`.
function offsetPoint(lat, lng, dist, bearingDeg) {
  const R = 6371e3, b = (bearingDeg * Math.PI) / 180, p1 = (lat * Math.PI) / 180, l1 = (lng * Math.PI) / 180, d = dist / R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lng: (((l2 * 180) / Math.PI + 540) % 360) - 180 };
}

// What explorers may see: progress, unlocked clues and a search circle that always contains the spot.
async function publicGrand(env, g, user) {
  const progress = Math.min(1, g.pot_cents / g.goal_cents);
  const radius = Math.round(g.start_radius_m - (g.start_radius_m - g.final_radius_m) * progress);
  const centre = offsetPoint(g.secret_lat, g.secret_lng, radius * g.offset_frac, g.bearing_deg);
  const { results: clues } = await env.DB.prepare('SELECT unlock_pct, text FROM grand_clues WHERE grand_id = ? ORDER BY unlock_pct, id').bind(g.id).all();
  const pct = Math.floor(progress * 100);
  const s = await getSettings(env.DB);
  let mine = null;
  if (user) {
    const v = await env.DB.prepare(`SELECT COUNT(*) n FROM video_watches WHERE user_id = ? AND grand_id = ? AND completed_at IS NOT NULL`).bind(user.id, g.id).first();
    const d = await env.DB.prepare(`SELECT COUNT(*) n FROM video_watches WHERE user_id = ? AND day = ? AND completed_at IS NOT NULL AND pot_cents > 0`).bind(user.id, today()).first();
    mine = { views: v.n, todayLeft: Math.max(0, s.videoDailyLimit - d.n), won: g.found_by === user.id, claimCode: g.found_by === user.id ? g.claim_code : null };
  }
  return {
    id: g.id, title: g.title, prize: g.prize_text, emoji: g.emoji, photo: g.photo_url, area: g.area_name, status: g.status,
    goalCents: g.goal_cents, potCents: g.pot_cents, views: g.views, pct, perViewCents: s.videoPotShare,
    circle: { lat: centre.lat, lng: centre.lng, radius },
    clues: clues.map((c) => (c.unlock_pct <= pct ? { pct: c.unlock_pct, text: c.text } : { pct: c.unlock_pct, locked: true })),
    foundAt: g.found_at, claimRadius: CLAIM_RADIUS_M, mine,
  };
}

// GET /api/grand — the current Grand Treasure (public)
export async function getGrand(req, env, user) {
  const g = await liveGrand(env);
  return json({ grand: g ? await publicGrand(env, g, user) : null });
}

// POST /api/grand/claim { lat, lng } — first explorer at the spot once the pot is full
export async function claimGrand(req, env, user) {
  requireRole(user);
  const g = await liveGrand(env);
  if (!g) bad('There is no Grand Treasure right now', 404);
  if (g.status === 'live') bad(`The treasure unlocks when the pot is full: ${money(g.pot_cents)} of ${money(g.goal_cents)}. Keep watching!`, 409);
  if (g.status === 'found') bad(g.found_by === user.id ? 'You already found it!' : 'Someone already found this Grand Treasure. Watch for the next one!', 409);
  const b = await body(req, 500);
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) bad('Turn on location so we can see you are at the treasure.', 428);
  const away = distanceM(lat, lng, g.secret_lat, g.secret_lng);
  if (away > CLAIM_RADIUS_M) bad(`Not here, keep looking! Follow the clues and the circle.`, 403);
  const code = couponCode();
  const won = await env.DB.prepare(`UPDATE grand_treasures SET status = 'found', found_by = ?, found_at = ?, claim_code = ? WHERE id = ? AND status = 'full' RETURNING id`)
    .bind(user.id, nowIso(), code, g.id).first();
  if (!won) bad('Someone beat you to it by seconds!', 409);
  return json({ won: true, claimCode: code, title: g.title });
}

// ---------- watching ----------

// GET /api/videos — a video to watch now (for the Grand Treasure)
export async function nextVideos(req, env, user) {
  requireRole(user);
  const s = await getSettings(env.DB);
  const { results } = await env.DB.prepare(`SELECT v.* FROM sponsor_videos v LEFT JOIN merchants m ON m.id = v.merchant_id
      WHERE v.status = 'active' AND (v.merchant_id IS NULL OR (m.status = 'active' AND m.video_balance_cents >= CASE v.length_s WHEN 30 THEN ? ELSE ? END))
        AND NOT EXISTS (SELECT 1 FROM video_watches w WHERE w.video_id = v.id AND w.user_id = ? AND w.day = ? AND w.completed_at IS NOT NULL)
      LIMIT 50`).bind(s.videoPrice30, s.videoPrice15, user.id, today()).all();
  for (let i = results.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [results[i], results[j]] = [results[j], results[i]]; }
  return json({ videos: results.slice(0, 6).map((v) => ({ id: v.id, sponsor: v.sponsor_name, title: v.title, youtubeId: v.youtube_id, length: v.length_s, link: v.link_url })) });
}

// POST /api/videos/:id/start
export async function startVideo(req, env, user, id) {
  requireRole(user);
  const v = await env.DB.prepare(`SELECT id FROM sponsor_videos WHERE id = ? AND status = 'active'`).bind(id).first();
  if (!v) bad('This video is not available any more', 404);
  const row = await env.DB.prepare(`INSERT INTO video_watches(video_id, user_id, day, started_at) VALUES (?,?,?,?)
      ON CONFLICT(video_id, user_id, day) DO UPDATE SET started_at = CASE WHEN completed_at IS NULL THEN excluded.started_at ELSE started_at END
      RETURNING completed_at`).bind(id, user.id, today(), nowIso()).first();
  return json({ ok: true, alreadyWatched: !!row.completed_at });
}

// POST /api/videos/:id/complete — counts once the full 15/30 seconds have passed
export async function completeVideo(req, env, user, id) {
  requireRole(user);
  const v = await env.DB.prepare('SELECT * FROM sponsor_videos WHERE id = ?').bind(id).first();
  if (!v) bad('Video not found', 404);
  const watch = await env.DB.prepare('SELECT * FROM video_watches WHERE video_id = ? AND user_id = ? AND day = ?').bind(id, user.id, today()).first();
  if (!watch) bad('Start the video first');
  const coupon = { text: v.coupon_text, link: v.link_url, sponsor: v.sponsor_name };
  if (watch.completed_at) return json({ counted: false, already: true, coupon });
  if ((Date.now() - Date.parse(watch.started_at)) / 1000 < v.length_s - 1) bad('Please watch the whole video.', 400);
  const s = await getSettings(env.DB);
  const done = await env.DB.prepare(`SELECT COUNT(*) n FROM video_watches WHERE user_id = ? AND day = ? AND completed_at IS NOT NULL AND pot_cents > 0`).bind(user.id, today()).first();
  const g = await env.DB.prepare(`SELECT id FROM grand_treasures WHERE status = 'live' ORDER BY id DESC LIMIT 1`).first();
  let charged = 0, pot = 0, reason = null;
  if (done.n >= s.videoDailyLimit) reason = 'daily-limit';
  else {
    if (v.merchant_id) {
      const price = priceFor(s, v.length_s);
      const left = await changeBudget(env, v.merchant_id, -price, 'view');
      if (left === null) reason = 'sponsor-budget'; else charged = price;
    }
    if (!reason && g) pot = s.videoPotShare;
  }
  await env.DB.prepare('UPDATE video_watches SET completed_at = ?, charged_cents = ?, pot_cents = ?, grand_id = ? WHERE id = ?')
    .bind(nowIso(), charged, pot, pot ? g.id : null, watch.id).run();
  let grand = null;
  if (pot) {
    const after = await env.DB.prepare(`UPDATE grand_treasures SET pot_cents = MIN(goal_cents, pot_cents + ?), views = views + 1,
        status = CASE WHEN pot_cents + ? >= goal_cents THEN 'full' ELSE status END WHERE id = ? AND status = 'live' RETURNING *`).bind(pot, pot, g.id).first();
    if (after) grand = await publicGrand(env, after, user);
  }
  return json({ counted: pot > 0, reason, potAdded: pot, coupon, grand });
}

// POST /api/videos/:id/click
export async function clickVideo(req, env, user, id) {
  requireRole(user);
  await env.DB.prepare('UPDATE video_watches SET link_clicked = 1 WHERE video_id = ? AND user_id = ? AND day = ?').bind(id, user.id, today()).run();
  return json({ ok: true });
}

// ---------- TIN HQ: Grand Treasure ----------

// GET /api/admin/grand — all, with the secret spot (HQ only)
export async function adminGrand(req, env, user) {
  requireRole(user, 'admin');
  const { results } = await env.DB.prepare(`SELECT g.*, u.display_name AS finder, u.email AS finder_email FROM grand_treasures g LEFT JOIN tin_users u ON u.id = g.found_by ORDER BY g.id DESC LIMIT 20`).all();
  const out = [];
  for (const g of results) {
    const { results: clues } = await env.DB.prepare('SELECT id, unlock_pct, text FROM grand_clues WHERE grand_id = ? ORDER BY unlock_pct, id').bind(g.id).all();
    out.push({ ...g, clues });
  }
  const s = await getSettings(env.DB);
  const totals = await env.DB.prepare(`SELECT COUNT(*) views, COALESCE(SUM(charged_cents),0) charged, COALESCE(SUM(pot_cents),0) pot FROM video_watches WHERE completed_at IS NOT NULL`).first();
  return json({ grands: out, settings: { price15: s.videoPrice15, price30: s.videoPrice30, potShare: s.videoPotShare, dailyLimit: s.videoDailyLimit }, totals });
}

function grandInput(b) {
  const clues = Array.isArray(b.clues) ? b.clues : [];
  return {
    title: str(b.title, { min: 3, max: 80, name: 'Title' }),
    prize_text: b.prize ? str(b.prize, { max: 300, name: 'Prize description' }) : null,
    emoji: str(b.emoji || '🛵', { min: 1, max: 16, name: 'Emoji' }),
    photo_url: b.photo ? cleanLink(b.photo) : null,
    area_name: b.area ? str(b.area, { max: 60, name: 'Area' }) : null,
    goal_cents: Math.round(num(b.goalUsd, { min: 1, max: 1_000_000, name: 'Goal (USD)' }) * 100),
    secret_lat: num(b.lat, { min: -90, max: 90, name: 'Latitude' }), secret_lng: num(b.lng, { min: -180, max: 180, name: 'Longitude' }),
    start_radius_m: num(b.startRadius ?? 3000, { min: 100, max: 50_000, int: true, name: 'Starting search circle (m)' }),
    final_radius_m: num(b.finalRadius ?? 40, { min: 10, max: 2000, int: true, name: 'Final search circle (m)' }),
    clues: clues.slice(0, 20).map((c) => ({ pct: num(c.pct, { min: 0, max: 100, int: true, name: 'Clue %' }), text: str(c.text, { min: 3, max: 300, name: 'Clue' }) })),
  };
}

// POST /api/admin/grand — create (draft)
export async function adminCreateGrand(req, env, user) {
  requireRole(user, 'admin');
  const d = grandInput(await body(req, 20_000));
  const bearing = crypto.getRandomValues(new Uint32Array(1))[0] % 360;
  const frac = 0.2 + (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * 0.6; // 20–80% of the radius away
  const g = await env.DB.prepare(`INSERT INTO grand_treasures(title, prize_text, emoji, photo_url, area_name, goal_cents, secret_lat, secret_lng, start_radius_m, final_radius_m, bearing_deg, offset_frac)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(d.title, d.prize_text, d.emoji, d.photo_url, d.area_name, d.goal_cents, d.secret_lat, d.secret_lng, d.start_radius_m, d.final_radius_m, bearing, frac).first();
  if (d.clues.length) await env.DB.batch(d.clues.map((c) => env.DB.prepare('INSERT INTO grand_clues(grand_id, unlock_pct, text) VALUES (?,?,?)').bind(g.id, c.pct, c.text)));
  return json({ id: g.id }, 201);
}

// PATCH /api/admin/grand/:id { status } or { clues } or { goalUsd }
export async function adminUpdateGrand(req, env, user, id) {
  requireRole(user, 'admin');
  const b = await body(req, 20_000);
  const g = await env.DB.prepare('SELECT * FROM grand_treasures WHERE id = ?').bind(id).first();
  if (!g) bad('Not found', 404);
  if (b.status !== undefined) {
    if (!['draft', 'live', 'closed'].includes(b.status)) bad('Status can be draft, live or closed');
    if (b.status === 'live') {
      const other = await env.DB.prepare(`SELECT id FROM grand_treasures WHERE status IN ('live','full') AND id != ?`).bind(id).first();
      if (other) bad('Another Grand Treasure is already running. Close it first.');
      if (g.status === 'found') bad('This one was already found');
    }
    const status = b.status === 'live' && g.pot_cents >= g.goal_cents ? 'full' : b.status;
    await env.DB.prepare('UPDATE grand_treasures SET status = ? WHERE id = ?').bind(status, id).run();
  }
  if (Array.isArray(b.clues)) {
    const clues = grandInput({ ...g, title: g.title, goalUsd: g.goal_cents / 100, lat: g.secret_lat, lng: g.secret_lng, clues: b.clues }).clues;
    await env.DB.batch([env.DB.prepare('DELETE FROM grand_clues WHERE grand_id = ?').bind(id),
      ...clues.map((c) => env.DB.prepare('INSERT INTO grand_clues(grand_id, unlock_pct, text) VALUES (?,?,?)').bind(id, c.pct, c.text))]);
  }
  if (b.goalUsd !== undefined) {
    const goal = Math.round(num(b.goalUsd, { min: 1, max: 1_000_000, name: 'Goal (USD)' }) * 100);
    await env.DB.prepare(`UPDATE grand_treasures SET goal_cents = ?, status = CASE WHEN status IN ('live','full') THEN CASE WHEN pot_cents >= ? THEN 'full' ELSE 'live' END ELSE status END WHERE id = ?`).bind(goal, goal, id).run();
  }
  return json({ ok: true });
}

// For Polly: a short answer about the Grand Treasure.
export async function grandForPolly(env, lang) {
  const g = await liveGrand(env);
  if (!g) return lang === 'es' ? 'Ahora no hay un Gran Tesoro. ¡Pronto habrá uno nuevo!' : 'There is no Grand Treasure running right now. A new one is coming soon!';
  const p = await publicGrand(env, g, null);
  if (g.status === 'found') return lang === 'es' ? `🏆 ¡${p.title} ya fue encontrado! Pronto habrá un nuevo Gran Tesoro.` : `🏆 ${p.title} has been found! A new Grand Treasure is coming soon.`;
  const open = p.clues.filter((c) => !c.locked);
  const next = p.clues.find((c) => c.locked);
  if (lang === 'es') {
    return `🛵 ${p.title}: el bote va en ${money(p.potCents)} de ${money(p.goalCents)} (${p.pct}%). ${open.length ? `Pistas abiertas: ${open.map((c) => `“${c.text}”`).join(' ')}` : 'Aún no hay pistas abiertas.'} ${next ? `La siguiente pista se abre al ${next.pct}%.` : ''} Mira videos de negocios locales para hacer crecer el bote y acercar el círculo de búsqueda.`;
  }
  return `🛵 ${p.title}: the pot is at ${money(p.potCents)} of ${money(p.goalCents)} (${p.pct}%). ${open.length ? `Clues so far: ${open.map((c) => `“${c.text}”`).join(' ')}` : 'No clues are open yet.'} ${next ? `The next clue opens at ${next.pct}%.` : p.status === 'full' ? 'The pot is full: be the first to reach the spot and tap Claim!' : ''} Watch local business videos to grow the pot and shrink the search circle.`;
}
