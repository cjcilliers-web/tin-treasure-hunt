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

const STATS = `(SELECT COUNT(*) FROM video_watches w WHERE w.video_id = v.id AND w.completed_at IS NOT NULL)
    + (SELECT COUNT(*) FROM ad_network_views a WHERE a.video_id = v.id) AS views,
  (SELECT COUNT(*) FROM ad_network_views a WHERE a.video_id = v.id AND a.source = 'spin') AS spin_views,
  (SELECT COALESCE(SUM(charged_cents), 0) FROM video_watches w WHERE w.video_id = v.id)
    + (SELECT COALESCE(SUM(charged_cents), 0) FROM ad_network_views a WHERE a.video_id = v.id) AS spent,
  (SELECT COUNT(*) FROM video_watches w WHERE w.video_id = v.id AND w.link_clicked = 1) AS clicks`;
const shapeVideo = (v, s) => ({
  id: v.id, merchantId: v.merchant_id, sponsor: v.sponsor_name, title: v.title, youtubeId: v.youtube_id, length: v.length_s,
  coupon: v.coupon_text, link: v.link_url, status: v.status, createdAt: v.created_at,
  pricePerView: v.merchant_id ? priceFor(s, v.length_s) : 0, views: v.views ?? 0, spinViews: v.spin_views ?? 0, spent: v.spent ?? 0, clicks: v.clicks ?? 0,
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
  return (await liveGrands(env))[0] || null;
}
// Every Grand Treasure explorers can see: running ones first, then found ones (until HQ closes them).
async function liveGrands(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM grand_treasures WHERE status IN ('live','full','found')
      ORDER BY CASE status WHEN 'full' THEN 0 WHEN 'live' THEN 1 ELSE 2 END, id DESC LIMIT 20`).all();
  return results;
}
// Which running treasure a finished view fills: the sponsor's own treasure, otherwise TIN's own (house) treasure.
async function grandForVideo(env, v) {
  if (v.merchant_id) {
    const own = await env.DB.prepare(`SELECT id FROM grand_treasures WHERE status = 'live' AND sponsor_merchant_id = ? ORDER BY id DESC LIMIT 1`).bind(v.merchant_id).first();
    if (own) return own;
  }
  return env.DB.prepare(`SELECT id FROM grand_treasures WHERE status = 'live' AND sponsor_merchant_id IS NULL ORDER BY id DESC LIMIT 1`).first();
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
  const { results: qs } = await env.DB.prepare('SELECT id, question, options, bonus_clue FROM grand_quiz WHERE grand_id = ? ORDER BY id').bind(g.id).all();
  const answers = new Map();
  if (user && qs.length) {
    const { results: a } = await env.DB.prepare('SELECT quiz_id, choice, correct FROM grand_quiz_answers WHERE grand_id = ? AND user_id = ?').bind(g.id, user.id).all();
    for (const x of a) answers.set(x.quiz_id, x);
  }
  const quiz = qs.map((q) => {
    const a = answers.get(q.id);
    return { id: q.id, question: q.question, options: JSON.parse(q.options), answered: !!a, correct: a ? !!a.correct : null, bonus: a && a.correct ? q.bonus_clue : null };
  });
  return {
    id: g.id, title: g.title, prize: g.prize_text, emoji: g.emoji, photo: g.photo_url, area: g.area_name, status: g.status,
    sponsor: g.sponsor_name || null, sponsorMerchantId: g.sponsor_merchant_id || null, quiz,
    goalCents: g.goal_cents, potCents: g.pot_cents, views: g.views, pct, perViewCents: s.videoPotShare,
    circle: { lat: centre.lat, lng: centre.lng, radius },
    clues: clues.map((c) => (c.unlock_pct <= pct ? { pct: c.unlock_pct, text: c.text } : { pct: c.unlock_pct, locked: true })),
    foundAt: g.found_at, claimRadius: CLAIM_RADIUS_M, mine,
  };
}

// GET /api/grand — the current Grand Treasure (public)
// GET /api/grand?id= — all Grand Treasures (public), or one by id
export async function getGrand(req, env, user) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (id) {
    const g = await env.DB.prepare(`SELECT * FROM grand_treasures WHERE id = ? AND status IN ('live','full','found')`).bind(id).first();
    return json({ grand: g ? await publicGrand(env, g, user) : null });
  }
  const list = [];
  for (const g of await liveGrands(env)) list.push(await publicGrand(env, g, user));
  return json({ grand: list[0] || null, grands: list });
}

// POST /api/grand/:id/quiz/:qid { choice } — one try per question; a right answer opens the bonus clue
export async function answerQuiz(req, env, user, id, qid) {
  requireRole(user);
  const q = await env.DB.prepare(`SELECT q.*, g.status FROM grand_quiz q JOIN grand_treasures g ON g.id = q.grand_id WHERE q.id = ? AND q.grand_id = ?`).bind(qid, id).first();
  if (!q || !['live', 'full'].includes(q.status)) bad('This question is not available', 404);
  const b = await body(req, 300);
  const options = JSON.parse(q.options);
  const choice = Number(b.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= options.length) bad('Pick one of the answers');
  const correct = choice === q.answer ? 1 : 0;
  const row = await env.DB.prepare(`INSERT INTO grand_quiz_answers(quiz_id, grand_id, user_id, choice, correct) VALUES (?,?,?,?,?)
      ON CONFLICT(quiz_id, user_id) DO NOTHING RETURNING id`).bind(qid, id, user.id, choice, correct).first();
  if (!row) bad('You already answered this one', 409);
  return json({ correct: !!correct, rightAnswer: correct ? choice : null, bonus: correct ? q.bonus_clue : null });
}

// POST /api/grand/claim { lat, lng } — first explorer at the spot once the pot is full
export async function claimGrand(req, env, user) {
  requireRole(user);
  const b = await body(req, 500);
  const gid = Number(b.id);
  const g = gid ? await env.DB.prepare(`SELECT * FROM grand_treasures WHERE id = ? AND status IN ('live','full','found')`).bind(gid).first() : await liveGrand(env);
  if (!g) bad('There is no Grand Treasure right now', 404);
  if (g.status === 'live') bad(`The treasure unlocks when the pot is full: ${money(g.pot_cents)} of ${money(g.goal_cents)}. Keep watching!`, 409);
  if (g.status === 'found') bad(g.found_by === user.id ? 'You already found it!' : 'Someone already found this Grand Treasure. Watch for the next one!', 409);
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
  // Watching for one treasure: a sponsor's treasure plays only that sponsor's videos; TIN's own
  // treasure plays every other business (those without a running treasure of their own).
  const gid = Number(new URL(req.url).searchParams.get('grand'));
  const g = gid ? await env.DB.prepare('SELECT sponsor_merchant_id FROM grand_treasures WHERE id = ?').bind(gid).first() : null;
  const only = g && g.sponsor_merchant_id ? 'AND v.merchant_id = ?' : `AND (v.merchant_id IS NULL OR NOT EXISTS (SELECT 1 FROM grand_treasures og WHERE og.status = 'live' AND og.sponsor_merchant_id = v.merchant_id))`;
  const args = [s.videoPrice30, s.videoPrice15, user.id, today()];
  if (g && g.sponsor_merchant_id) args.push(g.sponsor_merchant_id);
  const { results } = await env.DB.prepare(`SELECT v.* FROM sponsor_videos v LEFT JOIN merchants m ON m.id = v.merchant_id
      WHERE v.status = 'active' AND (v.merchant_id IS NULL OR (m.status = 'active' AND m.video_balance_cents >= CASE v.length_s WHEN 30 THEN ? ELSE ? END))
        AND NOT EXISTS (SELECT 1 FROM video_watches w WHERE w.video_id = v.id AND w.user_id = ? AND w.day = ? AND w.completed_at IS NOT NULL)
        ${g ? only : ''}
      LIMIT 50`).bind(...args).all();
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
  const done = await env.DB.prepare(`SELECT COUNT(*) n FROM video_watches WHERE user_id = ? AND day = ? AND completed_at IS NOT NULL AND pot_cents > 0`).bind(user.id, today()).first();
  const r = await chargeView(env, v, done.n);
  await env.DB.prepare('UPDATE video_watches SET completed_at = ?, charged_cents = ?, pot_cents = ?, grand_id = ? WHERE id = ?')
    .bind(nowIso(), r.charged, r.pot, r.grandId, watch.id).run();
  const after = await fillPot(env, r);
  return json({ counted: r.pot > 0, reason: r.reason, potAdded: r.pot, coupon, grand: after ? await publicGrand(env, after, user) : null });
}

// One finished view, wherever it was watched (Treasure Hunt or Spin & Win): charge the advertiser
// the HQ price and work out the pot share for the live Grand Treasure. `doneToday` = the viewer's
// counted views today, for the daily limit.
export async function chargeView(env, v, doneToday) {
  const s = await getSettings(env.DB);
  const g = await grandForVideo(env, v);
  let charged = 0, pot = 0, reason = null;
  if (doneToday >= s.videoDailyLimit) reason = 'daily-limit';
  else {
    if (v.merchant_id) {
      const price = priceFor(s, v.length_s);
      const left = await changeBudget(env, v.merchant_id, -price, 'view');
      if (left === null) reason = 'sponsor-budget'; else charged = price;
    }
    if (!reason && g) pot = s.videoPotShare;
  }
  return { charged, pot, reason, grandId: pot ? g.id : null };
}

// Adds a view's pot share to the Grand Treasure; returns the updated row (or null).
export async function fillPot(env, { pot, grandId }) {
  if (!pot) return null;
  return env.DB.prepare(`UPDATE grand_treasures SET pot_cents = MIN(goal_cents, pot_cents + ?), views = views + 1,
      status = CASE WHEN pot_cents + ? >= goal_cents THEN 'full' ELSE status END WHERE id = ? AND status = 'live' RETURNING *`).bind(pot, pot, grandId).first();
}

export { publicGrand, priceFor };

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
    const { results: quiz } = await env.DB.prepare(`SELECT q.id, q.question, q.options, q.answer, q.bonus_clue,
        (SELECT COUNT(*) FROM grand_quiz_answers a WHERE a.quiz_id = q.id) AS tries, (SELECT COUNT(*) FROM grand_quiz_answers a WHERE a.quiz_id = q.id AND a.correct = 1) AS rights
        FROM grand_quiz q WHERE q.grand_id = ? ORDER BY q.id`).bind(g.id).all();
    out.push({ ...g, clues, quiz: quiz.map((q) => ({ ...q, options: JSON.parse(q.options) })) });
  }
  const s = await getSettings(env.DB);
  const totals = await env.DB.prepare(`SELECT COUNT(*) views, COALESCE(SUM(charged_cents),0) charged, COALESCE(SUM(pot_cents),0) pot FROM (
      SELECT charged_cents, pot_cents FROM video_watches WHERE completed_at IS NOT NULL
      UNION ALL SELECT charged_cents, pot_cents FROM ad_network_views)`).first();
  totals.spinViews = (await env.DB.prepare('SELECT COUNT(*) n FROM ad_network_views').first()).n;
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
    sponsor_merchant_id: b.sponsorMerchantId ? num(b.sponsorMerchantId, { min: 1, int: true, name: 'Sponsor' }) : null,
    clues: clues.slice(0, 20).map((c) => ({ pct: num(c.pct, { min: 0, max: 100, int: true, name: 'Clue %' }), text: str(c.text, { min: 3, max: 300, name: 'Clue' }) })),
  };
}

// POST /api/admin/grand — create (draft)
export async function adminCreateGrand(req, env, user) {
  requireRole(user, 'admin');
  const d = grandInput(await body(req, 20_000));
  let sponsorName = null;
  if (d.sponsor_merchant_id) {
    const m = await env.DB.prepare('SELECT name FROM merchants WHERE id = ?').bind(d.sponsor_merchant_id).first();
    if (!m) bad('Sponsor merchant not found');
    sponsorName = m.name;
  }
  const bearing = crypto.getRandomValues(new Uint32Array(1))[0] % 360;
  const frac = 0.2 + (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * 0.6; // 20–80% of the radius away
  const g = await env.DB.prepare(`INSERT INTO grand_treasures(title, prize_text, emoji, photo_url, area_name, goal_cents, secret_lat, secret_lng, start_radius_m, final_radius_m, bearing_deg, offset_frac, sponsor_merchant_id, sponsor_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(d.title, d.prize_text, d.emoji, d.photo_url, d.area_name, d.goal_cents, d.secret_lat, d.secret_lng, d.start_radius_m, d.final_radius_m, bearing, frac, d.sponsor_merchant_id, sponsorName).first();
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
      const other = await env.DB.prepare(`SELECT title FROM grand_treasures WHERE status IN ('live','full') AND id != ? AND COALESCE(sponsor_merchant_id, 0) = ?`).bind(id, g.sponsor_merchant_id || 0).first();
      if (other) bad(g.sponsor_merchant_id ? `${g.sponsor_name} already has a Grand Treasure running (“${other.title}”). Close it first.` : `TIN's own Grand Treasure “${other.title}” is already running. Close it first, or give this one a sponsor.`);
      if (g.status === 'found' || g.found_by) bad('This one was already found');
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
  const all = (await liveGrands(env)).filter((x) => x.status !== 'found');
  if (all.length > 1) {
    const parts = [];
    for (const x of all) { const p = await publicGrand(env, x, null); parts.push(`${p.emoji} ${p.title}${p.sponsor ? ` (${lang === 'es' ? 'de' : 'by'} ${p.sponsor})` : ''}: ${p.pct}%`); }
    return lang === 'es'
      ? `Hay ${all.length} Grandes Tesoros ahora: ${parts.join(' · ')}. Abre uno para ver sus pistas, mira videos de su patrocinador y responde mi quiz para pistas extra. 🦜`
      : `There are ${all.length} Grand Treasures right now: ${parts.join(' · ')}. Open one to see its clues, watch its sponsor's videos and answer my quiz for bonus clues. 🦜`;
  }
  const g = all[0] || await liveGrand(env);
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

// ---------- Polly's quiz (TIN HQ) ----------

function quizInput(b) {
  const options = (Array.isArray(b.options) ? b.options : []).map((o) => String(o || '').trim()).filter(Boolean);
  if (options.length < 2 || options.length > 4) bad('Give 2 to 4 answers');
  options.forEach((o) => str(o, { min: 1, max: 120, name: 'Answer' }));
  const answer = Number(b.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) bad('Mark which answer is right');
  return { question: str(b.question, { min: 5, max: 200, name: 'Question' }), options, answer, bonus: str(b.bonus, { min: 3, max: 300, name: 'Bonus clue' }) };
}

// POST /api/admin/grand/:id/quiz { question, options[], answer, bonus }
export async function adminAddQuiz(req, env, user, id) {
  requireRole(user, 'admin');
  const g = await env.DB.prepare('SELECT id FROM grand_treasures WHERE id = ?').bind(id).first();
  if (!g) bad('Not found', 404);
  const n = await env.DB.prepare('SELECT COUNT(*) n FROM grand_quiz WHERE grand_id = ?').bind(id).first();
  if (n.n >= 12) bad('Up to 12 questions per Grand Treasure');
  const q = quizInput(await body(req, 4_000));
  const row = await env.DB.prepare('INSERT INTO grand_quiz(grand_id, question, options, answer, bonus_clue) VALUES (?,?,?,?,?) RETURNING id')
    .bind(id, q.question, JSON.stringify(q.options), q.answer, q.bonus).first();
  return json({ id: row.id }, 201);
}

// DELETE /api/admin/grand/:id/quiz/:qid
export async function adminDeleteQuiz(req, env, user, id, qid) {
  requireRole(user, 'admin');
  await env.DB.batch([env.DB.prepare('DELETE FROM grand_quiz_answers WHERE quiz_id = ? AND grand_id = ?').bind(qid, id),
    env.DB.prepare('DELETE FROM grand_quiz WHERE id = ? AND grand_id = ?').bind(qid, id)]);
  return json({ ok: true });
}

// POST /api/admin/grand/:id/quiz/suggest { about } — Polly drafts questions about the sponsor (HQ reviews them)
export async function adminSuggestQuiz(req, env, user, id) {
  requireRole(user, 'admin');
  const g = await env.DB.prepare('SELECT title, sponsor_name, prize_text FROM grand_treasures WHERE id = ?').bind(id).first();
  if (!g) bad('Not found', 404);
  if (!env.AI) bad("Polly's AI is not switched on yet, so please type the questions yourself for now.", 503);
  const b = await body(req, 4_000);
  const about = str(b.about, { min: 20, max: 2000, name: 'About the sponsor' });
  const prompt = `You write a fun, family-friendly quiz for a treasure hunt app in Cozumel, Mexico.
Sponsor: ${g.sponsor_name || 'TIN Commerce'}. Prize: ${g.title}${g.prize_text ? ` (${g.prize_text})` : ''}.
Facts about the sponsor (use ONLY these facts, never invent any): ${about}
Write 3 multiple-choice questions about the sponsor, each with 3 short answers and exactly one right answer taken from the facts.
Reply with JSON only: [{"question":"...","options":["...","...","..."],"answer":0}]`;
  let text = '';
  try {
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }], max_tokens: 700 });
    text = String(r?.response || '');
  } catch { bad('Polly could not think of questions right now. Please try again.', 502); }
  let items = [];
  try { items = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch { items = []; }
  const out = (Array.isArray(items) ? items : []).map((q) => {
    try { const v = quizInput({ ...q, bonus: 'Bonus clue' }); return { question: v.question, options: v.options, answer: v.answer }; } catch { return null; }
  }).filter(Boolean).slice(0, 3);
  if (!out.length) bad('Polly could not make questions from that text. Add a few more facts and try again.', 422);
  return json({ questions: out });
}
