// Phase 2 — core Treasure Hunt: discovery, claims, redemption, credits, ratings.
import {
  bad, body, json, str, num, oneOf, nowIso, addHours, distanceM, walkMin, randomCode,
  getSettings, CATEGORIES, DIFFICULTIES, nextRaffleAt, lastRaffleAt, iso,
} from './lib.js';
import { requireRole } from './auth.js';

// ---------- shared queries ----------

const DROP_COLS = `
  d.id, d.title, d.item, d.category, d.emoji, d.story_text, d.gps_lat, d.gps_lng, d.walking_distance,
  d.difficulty, d.reward_value_usd, d.is_mystery, d.kid_friendly, d.quantity, d.remaining, d.photo IS NOT NULL AS has_photo,
  d.status, d.created_at, d.destination_id, d.merchant_id,
  m.name AS merchant, m.hours, m.category AS merchant_category, m.address,
  (SELECT ROUND(AVG(r.overall_score), 1) FROM redemption_ratings r JOIN redemptions x ON x.id = r.redemption_id WHERE x.merchant_id = m.id) AS rating,
  (SELECT COUNT(*) FROM redemption_ratings r JOIN redemptions x ON x.id = r.redemption_id WHERE x.merchant_id = m.id) AS rating_count`;

export function shapeDrop(r, here, { revealMystery = false } = {}) {
  const m = here ? distanceM(here.lat, here.lng, r.gps_lat, r.gps_lng) : null;
  return {
    id: r.id, title: r.title, category: r.category, emoji: r.emoji, story: r.story_text,
    item: r.is_mystery && !revealMystery ? null : r.item, mystery: !!r.is_mystery,
    lat: r.gps_lat, lng: r.gps_lng, walkingNote: r.walking_distance, difficulty: r.difficulty,
    value: r.reward_value_usd, kids: !!r.kid_friendly, remaining: r.remaining, quantity: r.quantity,
    hasPhoto: !!r.has_photo, status: r.status, merchant: r.merchant, merchantId: r.merchant_id,
    hours: r.hours, rating: r.rating, ratingCount: r.rating_count, destination: r.destination_id,
    distanceM: m, walkMin: m == null ? null : walkMin(m),
  };
}

export async function liveDrops(env, destination, here) {
  const { results } = await env.DB.prepare(
    `SELECT ${DROP_COLS} FROM treasure_drops d JOIN merchants m ON m.id = d.merchant_id
      WHERE d.destination_id = ? AND d.status = 'active' AND m.status = 'active' AND d.remaining > 0
        AND (d.expires_at IS NULL OR d.expires_at > ?)`
  ).bind(destination, nowIso()).all();
  return results.map((r) => shapeDrop(r, here)).sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

function readHere(url, dest) {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && url.searchParams.has('lat'))
    return { lat, lng, source: 'gps' };
  return { lat: dest.center_lat, lng: dest.center_lng, source: 'center' };
}

async function destinationOr404(env, id) {
  const d = await env.DB.prepare('SELECT * FROM destinations WHERE id = ?').bind(id || 'cozumel').first();
  if (!d) bad('Unknown destination', 404);
  return d;
}

// ---------- public / traveler ----------

export async function getDestination(req, env, id) {
  const d = await destinationOr404(env, id);
  const hunt = await env.DB.prepare(`SELECT id, name, emoji, tagline, starts_on, ends_on FROM hunts WHERE destination_id = ? AND status = 'live' ORDER BY id LIMIT 1`).bind(d.id).first();
  const s = await getSettings(env.DB);
  return json({ destination: { id: d.id, name: d.name, country: d.country, lat: d.center_lat, lng: d.center_lng, status: d.status }, hunt, settings: { creditsPerFind: s.creditsPerFind, rafflePrize: s.rafflePrize }, nextRaffleAt: iso(nextRaffleAt()) });
}

export async function listDrops(req, env, user) {
  const url = new URL(req.url);
  const dest = await destinationOr404(env, url.searchParams.get('destination'));
  const here = readHere(url, dest);
  const radius = num(url.searchParams.get('radius') ?? 5000, { min: 50, max: 50_000, name: 'radius' });
  const cat = url.searchParams.get('category');
  let drops = await liveDrops(env, dest.id, here);
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  drops.forEach((d) => { if (d.distanceM <= radius) counts[d.category]++; });
  drops = drops.filter((d) => d.distanceM <= radius && (!cat || cat === 'All' || d.category === cat));
  let mine = {};
  if (user) {
    const { results } = await env.DB.prepare(`SELECT drop_id, status FROM claims WHERE user_id = ? AND status IN ('claimed','redeemed')`).bind(user.id).all();
    mine = Object.fromEntries(results.map((r) => [r.drop_id, r.status]));
  }
  drops.forEach((d) => { d.myStatus = mine[d.id] || null; });
  return json({ here, radius, counts, drops });
}

export async function getDrop(req, env, user, id) {
  const url = new URL(req.url);
  const r = await env.DB.prepare(`SELECT ${DROP_COLS} FROM treasure_drops d JOIN merchants m ON m.id = d.merchant_id WHERE d.id = ?`).bind(id).first();
  if (!r) bad('Treasure not found', 404);
  const isOwner = user && (user.role === 'admin' || (user.role === 'merchant' && user.merchant_id === r.merchant_id));
  if (r.status !== 'active' && !isOwner) bad('This treasure is no longer available', 404);
  const dest = await destinationOr404(env, r.destination_id);
  let claim = null;
  if (user) claim = await env.DB.prepare(
    `SELECT c.code, c.status, c.expires_at, x.id AS redemption_id, x.credits_awarded, rr.id AS rating_id
       FROM claims c LEFT JOIN redemptions x ON x.claim_id = c.id LEFT JOIN redemption_ratings rr ON rr.redemption_id = x.id
      WHERE c.user_id = ? AND c.drop_id = ? AND c.status IN ('claimed','redeemed')`).bind(user.id, id).first();
  const drop = shapeDrop(r, readHere(url, dest), { revealMystery: !!claim || isOwner });
  return json({ drop, claim });
}

export async function dropPhoto(req, env, id) {
  const r = await env.DB.prepare('SELECT photo FROM treasure_drops WHERE id = ?').bind(id).first();
  if (!r || !r.photo) return new Response('Not found', { status: 404 });
  const m = r.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), { headers: { 'content-type': m[1], 'cache-control': 'public, max-age=3600' } });
}

export async function claimDrop(req, env, user, id) {
  requireRole(user);
  const s = await getSettings(env.DB);
  const drop = await env.DB.prepare(
    `SELECT d.id, d.item FROM treasure_drops d JOIN merchants m ON m.id = d.merchant_id
      WHERE d.id = ? AND d.status = 'active' AND m.status = 'active'`).bind(id).first();
  if (!drop) bad('This treasure is no longer available', 404);
  const existing = await env.DB.prepare(`SELECT code, status, expires_at FROM claims WHERE user_id = ? AND drop_id = ? AND status IN ('claimed','redeemed')`).bind(user.id, id).first();
  if (existing) {
    if (existing.status === 'redeemed') bad('You already found this treasure', 409);
    return json({ claim: existing, item: drop.item });
  }
  // Reserve one unit atomically; fails cleanly when none are left.
  const took = await env.DB.prepare(`UPDATE treasure_drops SET remaining = remaining - 1 WHERE id = ? AND remaining > 0 RETURNING remaining`).bind(id).first();
  if (!took) bad('Someone found the last one. Try another treasure!', 409);
  for (let i = 0; i < 5; i++) {
    const code = randomCode(6);
    try {
      const claim = await env.DB.prepare(`INSERT INTO claims(user_id, drop_id, code, expires_at) VALUES (?,?,?,?) RETURNING code, status, expires_at`)
        .bind(user.id, id, code, addHours(s.claimHours)).first();
      return json({ claim, item: drop.item }, 201);
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) { await releaseUnit(env, id); throw e; }
      if (String(e.message).includes('user_id')) { await releaseUnit(env, id); bad('Already claimed', 409); }
    }
  }
  await releaseUnit(env, id);
  bad('Could not create a code, please try again', 500);
}

const releaseUnit = (env, dropId) => env.DB.prepare('UPDATE treasure_drops SET remaining = remaining + 1 WHERE id = ?').bind(dropId).run();

export async function cancelClaim(req, env, user, id) {
  requireRole(user);
  const c = await env.DB.prepare(`UPDATE claims SET status = 'cancelled' WHERE user_id = ? AND drop_id = ? AND status = 'claimed' RETURNING drop_id`).bind(user.id, id).first();
  if (!c) bad('No open claim for this treasure', 404);
  await releaseUnit(env, id);
  return json({ ok: true });
}

export async function myClaims(req, env, user) {
  requireRole(user);
  const { results } = await env.DB.prepare(
    `SELECT c.code, c.status, c.created_at, c.expires_at, d.id AS drop_id, d.title, d.item, d.emoji, m.name AS merchant,
            x.id AS redemption_id, x.redeemed_at, x.credits_awarded, rr.overall_score
       FROM claims c JOIN treasure_drops d ON d.id = c.drop_id JOIN merchants m ON m.id = d.merchant_id
       LEFT JOIN redemptions x ON x.claim_id = c.id LEFT JOIN redemption_ratings rr ON rr.redemption_id = x.id
      WHERE c.user_id = ? AND c.status IN ('claimed','redeemed') ORDER BY c.created_at DESC LIMIT 100`).bind(user.id).all();
  return json({ claims: results });
}

export async function myCredits(req, env, user) {
  requireRole(user);
  const bal = await env.DB.prepare('SELECT balance, last_updated FROM treasure_hunt_credits WHERE user_id = ?').bind(user.id).first();
  const { results } = await env.DB.prepare('SELECT amount, reason, ref, created_at FROM treasure_hunt_credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(user.id).all();
  const since = iso(lastRaffleAt());
  const t = await env.DB.prepare('SELECT COUNT(*) AS n FROM redemptions WHERE user_id = ? AND redeemed_at >= ?').bind(user.id, since).first();
  const last = await env.DB.prepare(`SELECT r.drawn_at, r.prize_credits, r.entrant_count, u.display_name AS winner FROM raffles r LEFT JOIN tin_users u ON u.id = r.winner_user_id ORDER BY r.id DESC LIMIT 1`).first();
  return json({
    treasureHunt: { balance: bal?.balance ?? 0, lastUpdated: bal?.last_updated ?? null, history: results },
    // Separate pools live in their own systems; never mixed or transferable.
    pools: [{ id: 'treasure_hunt', name: 'Treasure Hunt Credits', balance: bal?.balance ?? 0 },
            { id: 'tin_commerce', name: 'TIN Commerce Credits', balance: null, note: 'Separate pool' },
            { id: 'spin_win', name: 'Spin & Win Credits', balance: null, note: 'Separate pool' }],
    raffle: { nextDrawAt: iso(nextRaffleAt()), myTicketsThisWeek: t.n, lastDraw: last ? { ...last, winner: last.winner ? last.winner.split(' ')[0] : null } : null },
  });
}

export async function rateRedemption(req, env, user, redemptionId) {
  requireRole(user);
  const b = await body(req, 5_000);
  const s = (k) => num(b[k], { min: 1, max: 10, int: true, name: k });
  const red = await env.DB.prepare('SELECT id FROM redemptions WHERE id = ? AND user_id = ?').bind(redemptionId, user.id).first();
  if (!red) bad('Redemption not found', 404);
  try {
    await env.DB.prepare('INSERT INTO redemption_ratings(redemption_id, ease_score, speed_score, overall_score, comment) VALUES (?,?,?,?,?)')
      .bind(redemptionId, s('ease'), s('speed'), s('overall'), typeof b.comment === 'string' ? b.comment.slice(0, 500) : null).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) bad('You already rated this visit', 409);
    throw e;
  }
  return json({ ok: true }, 201);
}

// ---------- merchant ----------

function merchantId(user, url) {
  requireRole(user, 'merchant', 'admin');
  if (user.role === 'merchant') return user.merchant_id;
  const m = Number(url.searchParams.get('merchant'));
  if (!m) bad('Choose a merchant');
  return m;
}

async function validPhoto(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(v)) bad('Photo must be a JPEG, PNG or WebP image');
  if (v.length > 200_000) bad('Photo is too large; please use a smaller image');
  return v;
}

function dropInput(b, partial = false) {
  const out = {};
  const want = (k) => !partial || b[k] !== undefined;
  if (want('title')) out.title = str(b.title, { min: 3, max: 80, name: 'Treasure name' });
  if (want('item')) out.item = str(b.item, { min: 3, max: 120, name: 'Free reward' });
  if (want('category')) out.category = oneOf(b.category, CATEGORIES, 'Treasure type');
  if (want('emoji')) out.emoji = str(b.emoji || '🎁', { min: 1, max: 16, name: 'Icon' });
  if (want('story')) out.story_text = str(b.story, { min: 10, max: 600, name: 'The story behind this find' });
  if (want('difficulty')) out.difficulty = oneOf(b.difficulty || 'Easy', DIFFICULTIES, 'Difficulty');
  if (want('walkingNote')) out.walking_distance = b.walkingNote ? str(b.walkingNote, { max: 120, name: 'Walking distance' }) : null;
  if (want('value')) out.reward_value_usd = num(b.value ?? 0, { min: 0, max: 10_000, name: 'Retail value' });
  if (want('kids')) out.kid_friendly = b.kids === false ? 0 : 1;
  if (want('mystery')) out.is_mystery = b.mystery ? 1 : 0;
  if (b.lat !== undefined || !partial) out.gps_lat = b.lat === undefined || b.lat === null || b.lat === '' ? undefined : num(b.lat, { min: -90, max: 90, name: 'Latitude' });
  if (b.lng !== undefined || !partial) out.gps_lng = b.lng === undefined || b.lng === null || b.lng === '' ? undefined : num(b.lng, { min: -180, max: 180, name: 'Longitude' });
  return out;
}

export async function merchantMe(req, env, user) {
  const url = new URL(req.url);
  const id = merchantId(user, url);
  const m = await env.DB.prepare('SELECT id, name, category, address, lat, lng, hours, status, destination_id FROM merchants WHERE id = ?').bind(id).first();
  if (!m) bad('Merchant not found', 404);
  const s = await getSettings(env.DB);
  return json({ merchant: m, dropPrice: s.dropPrice });
}

export async function merchantDrops(req, env, user) {
  const url = new URL(req.url);
  const id = merchantId(user, url);
  const { results } = await env.DB.prepare(`SELECT ${DROP_COLS},
      (SELECT COUNT(*) FROM redemptions x WHERE x.drop_id = d.id) AS redeemed,
      (SELECT COUNT(*) FROM claims c WHERE c.drop_id = d.id AND c.status = 'claimed') AS waiting
      FROM treasure_drops d JOIN merchants m ON m.id = d.merchant_id WHERE d.merchant_id = ? ORDER BY d.id DESC`).bind(id).all();
  return json({ drops: results.map((r) => ({ ...shapeDrop(r, null, { revealMystery: true }), redeemed: r.redeemed, waiting: r.waiting })) });
}

export async function createDrop(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantId(user, url);
  const m = await env.DB.prepare('SELECT * FROM merchants WHERE id = ?').bind(mid).first();
  if (!m || !['active'].includes(m.status)) bad('Your merchant account is not active yet');
  const b = await body(req);
  const d = dropInput(b);
  const quantity = num(b.quantity, { min: 1, max: 1000, int: true, name: 'How many drops' });
  const photo = await validPhoto(b.photo);
  const s = await getSettings(env.DB);
  const fee = quantity * s.dropPrice;
  const row = await env.DB.prepare(
    `INSERT INTO treasure_drops(merchant_id, destination_id, title, item, category, emoji, story_text, gps_lat, gps_lng, walking_distance,
       difficulty, reward_value_usd, is_mystery, kid_friendly, quantity, remaining, fee_usd, photo, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending') RETURNING id, status, fee_usd`
  ).bind(mid, m.destination_id, d.title, d.item, d.category, d.emoji, d.story_text, d.gps_lat ?? m.lat, d.gps_lng ?? m.lng,
    d.walking_distance, d.difficulty, d.reward_value_usd, d.is_mystery, d.kid_friendly, quantity, quantity, fee, photo).first();
  return json({ drop: row, fee }, 201);
}

export async function updateDrop(req, env, user, id) {
  const url = new URL(req.url);
  const mid = merchantId(user, url);
  const cur = await env.DB.prepare('SELECT * FROM treasure_drops WHERE id = ? AND merchant_id = ?').bind(id, mid).first();
  if (!cur) bad('Treasure not found', 404);
  const b = await body(req);
  const d = dropInput(b, true);
  if (b.photo !== undefined) d.photo = await validPhoto(b.photo);
  if (b.status !== undefined) {
    // Merchants can pause/resume; only HQ approves.
    const allowed = { active: ['paused'], paused: ['active'] }[cur.status] || [];
    if (user.role !== 'admin' && !allowed.includes(b.status)) bad(`Cannot change status from ${cur.status} to ${b.status}`);
    d.status = user.role === 'admin' ? oneOf(b.status, ['pending', 'active', 'paused', 'expired', 'rejected'], 'status') : b.status;
  }
  // Content edits on a live drop go back to HQ for review.
  const contentKeys = ['title', 'item', 'story_text', 'photo'];
  if (user.role !== 'admin' && cur.status === 'active' && contentKeys.some((k) => d[k] !== undefined && d[k] !== cur[k])) d.status = 'pending';
  Object.keys(d).forEach((k) => d[k] === undefined && delete d[k]);
  const keys = Object.keys(d);
  if (!keys.length) return json({ ok: true });
  await env.DB.prepare(`UPDATE treasure_drops SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => d[k]), id).run();
  return json({ ok: true, status: d.status ?? cur.status });
}

export async function lookupCode(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantId(user, url);
  const b = await body(req, 5_000);
  const code = String(b.code || '').trim().toUpperCase().replace(/^TIN-TH:/, '');
  const c = await env.DB.prepare(
    `SELECT c.id, c.code, c.status, c.expires_at, d.id AS drop_id, d.title, d.item, d.emoji, d.merchant_id, u.display_name
       FROM claims c JOIN treasure_drops d ON d.id = c.drop_id JOIN tin_users u ON u.id = c.user_id WHERE c.code = ?`).bind(code).first();
  if (!c) bad('Code not found. Check the letters and try again.', 404);
  if (c.merchant_id !== mid) bad('This code is for a different merchant', 403);
  if (c.status === 'redeemed') bad('This code was already redeemed', 409);
  if (c.status !== 'claimed') bad('This code is no longer valid', 410);
  if (c.expires_at <= nowIso()) bad('This code has expired', 410);
  return json({ claim: { code: c.code, title: c.title, item: c.item, emoji: c.emoji, traveler: c.display_name.split(' ')[0], expiresAt: c.expires_at } });
}

export async function confirmRedemption(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantId(user, url);
  const b = await body(req, 450_000);
  const code = String(b.code || '').trim().toUpperCase().replace(/^TIN-TH:/, '');
  const type = oneOf(b.type, ['photo', 'signature'], 'Proof type');
  const proof = typeof b.proof === 'string' ? b.proof : '';
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(proof)) bad('A photo or signature is required to confirm');
  if (proof.length > 400_000) bad('Proof image is too large');
  if (proof.length < 800) bad('The signature looks empty. Please ask the traveler to sign.');

  const c = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.drop_id, d.merchant_id FROM claims c JOIN treasure_drops d ON d.id = c.drop_id
      WHERE c.code = ? AND c.status = 'claimed' AND c.expires_at > ?`).bind(code, nowIso()).first();
  if (!c) bad('This code is not valid any more', 410);
  if (c.merchant_id !== mid) bad('This code is for a different merchant', 403);

  // Guard: only one confirmation can flip the claim.
  const flipped = await env.DB.prepare(`UPDATE claims SET status = 'redeemed' WHERE id = ? AND status = 'claimed' RETURNING id`).bind(c.id).first();
  if (!flipped) bad('This code was just redeemed', 409);

  const s = await getSettings(env.DB);
  const credits = s.creditsPerFind;
  const p = await env.DB.prepare('INSERT INTO redemption_proofs(kind, data_url) VALUES (?, ?) RETURNING id').bind(type, proof).first();
  const now = nowIso();
  const [red] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO redemptions(claim_id, user_id, drop_id, merchant_id, confirmed_by, redeemed_at, confirmation_type, confirmation_reference, credits_awarded)
                    VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`).bind(c.id, c.user_id, c.drop_id, c.merchant_id, user.id, now, type, `proof:${p.id}`, credits),
    // Credits land ONLY here, after merchant confirmation.
    env.DB.prepare(`INSERT INTO treasure_hunt_credits(user_id, balance, last_updated) VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance, last_updated = excluded.last_updated`).bind(c.user_id, credits, now),
    env.DB.prepare(`INSERT INTO treasure_hunt_credit_ledger(user_id, amount, reason, ref) VALUES (?, ?, 'redemption', ?)`).bind(c.user_id, credits, `claim:${c.id}`),
  ]);
  return json({ ok: true, redemptionId: red.results[0].id, creditsAwarded: credits }, 201);
}

export async function merchantStats(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantId(user, url);
  const since = iso(new Date(Date.now() - 7 * 86400e3));
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const [today, week, waiting, ratings] = await Promise.all([
    q(`SELECT COUNT(*) n FROM redemptions WHERE merchant_id = ? AND redeemed_at >= ?`, mid, nowIso().slice(0, 10) + 'T00:00:00Z'),
    q(`SELECT COUNT(*) n FROM redemptions WHERE merchant_id = ? AND redeemed_at >= ?`, mid, since),
    q(`SELECT COUNT(*) n FROM claims c JOIN treasure_drops d ON d.id = c.drop_id WHERE d.merchant_id = ? AND c.status = 'claimed'`, mid),
    q(`SELECT ROUND(AVG(ease_score),1) ease, ROUND(AVG(speed_score),1) speed, ROUND(AVG(overall_score),1) overall, COUNT(*) n
         FROM redemption_ratings r JOIN redemptions x ON x.id = r.redemption_id WHERE x.merchant_id = ?`, mid),
  ]);
  const { results: recent } = await env.DB.prepare(
    `SELECT x.redeemed_at, d.title, d.emoji, u.display_name, rr.overall_score, rr.comment FROM redemptions x
       JOIN treasure_drops d ON d.id = x.drop_id JOIN tin_users u ON u.id = x.user_id
       LEFT JOIN redemption_ratings rr ON rr.redemption_id = x.id WHERE x.merchant_id = ? ORDER BY x.id DESC LIMIT 20`).bind(mid).all();
  return json({ today: today.n, week: week.n, waiting: waiting.n, ratings,
    recent: recent.map((r) => ({ ...r, display_name: r.display_name.split(' ')[0] })) });
}

// Public merchant application (HQ approves).
export async function applyMerchant(req, env, user) {
  requireRole(user);
  const b = await body(req, 10_000);
  const name = str(b.business, { min: 2, max: 100, name: 'Business name' });
  const category = str(b.category, { min: 2, max: 60, name: 'Type of business' });
  const dest = await destinationOr404(env, b.destination);
  const lat = b.lat != null && b.lat !== '' ? num(b.lat, { min: -90, max: 90, name: 'Latitude' }) : dest.center_lat;
  const lng = b.lng != null && b.lng !== '' ? num(b.lng, { min: -180, max: 180, name: 'Longitude' }) : dest.center_lng;
  const pending = await env.DB.prepare(`SELECT id FROM merchants WHERE contact_email = ? AND status = 'pending'`).bind(user.email).first();
  if (pending) bad('Your application is already with TIN HQ', 409);
  const m = await env.DB.prepare(`INSERT INTO merchants(destination_id, name, category, address, lat, lng, hours, contact_email, status)
     VALUES (?,?,?,?,?,?,?,?,'pending') RETURNING id, status`).bind(dest.id, name, category, b.address ? str(b.address, { max: 200 }) : null,
    lat, lng, b.hours ? str(b.hours, { max: 60 }) : null, user.email).first();
  return json({ merchant: m }, 201);
}

// ---------- TIN HQ (admin) ----------

export async function adminOverview(req, env, user) {
  requireRole(user, 'admin');
  const url = new URL(req.url);
  const dest = url.searchParams.get('destination') || 'cozumel';
  const since7 = iso(new Date(Date.now() - 7 * 86400e3));
  const one = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const [users, claims, reds, rating, abandoned, pendingDrops, pendingMerchants] = await Promise.all([
    one(`SELECT COUNT(*) n FROM tin_users`),
    one(`SELECT COUNT(*) n FROM claims c JOIN treasure_drops d ON d.id = c.drop_id WHERE d.destination_id = ?`, dest),
    one(`SELECT COUNT(*) n FROM redemptions x JOIN treasure_drops d ON d.id = x.drop_id WHERE d.destination_id = ?`, dest),
    one(`SELECT ROUND(AVG(overall_score),1) v FROM redemption_ratings r JOIN redemptions x ON x.id = r.redemption_id JOIN treasure_drops d ON d.id = x.drop_id WHERE d.destination_id = ?`, dest),
    one(`SELECT COUNT(*) n FROM claims c JOIN treasure_drops d ON d.id = c.drop_id WHERE d.destination_id = ? AND c.status = 'abandoned'`, dest),
    one(`SELECT COUNT(*) n FROM treasure_drops WHERE destination_id = ? AND status = 'pending'`, dest),
    one(`SELECT COUNT(*) n FROM merchants WHERE destination_id = ? AND status = 'pending'`, dest),
  ]);
  const { results: daily } = await env.DB.prepare(
    `SELECT substr(x.redeemed_at,1,10) day, COUNT(*) n FROM redemptions x JOIN treasure_drops d ON d.id = x.drop_id
      WHERE d.destination_id = ? AND x.redeemed_at >= ? GROUP BY day ORDER BY day`).bind(dest, since7).all();
  const { results: top } = await env.DB.prepare(
    `SELECT m.name, COUNT(x.id) n FROM merchants m LEFT JOIN redemptions x ON x.merchant_id = m.id
      WHERE m.destination_id = ? AND m.status = 'active' GROUP BY m.id ORDER BY n DESC LIMIT 8`).bind(dest).all();
  const { results: cats } = await env.DB.prepare(
    `SELECT d.category, COUNT(x.id) n FROM treasure_drops d LEFT JOIN redemptions x ON x.drop_id = d.id
      WHERE d.destination_id = ? GROUP BY d.category ORDER BY n DESC`).bind(dest).all();
  const closed = reds.n + abandoned.n;
  return json({
    users: users.n, claims: claims.n, redemptions: reds.n, rating: rating.v,
    verificationRate: closed ? Math.round((reds.n / closed) * 100) : null,
    pendingDrops: pendingDrops.n, pendingMerchants: pendingMerchants.n, daily, topMerchants: top, categories: cats,
  });
}

export async function adminMerchants(req, env, user) {
  requireRole(user, 'admin');
  const { results } = await env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM treasure_drops d WHERE d.merchant_id = m.id) drops,
            (SELECT COUNT(*) FROM redemptions x WHERE x.merchant_id = m.id) redemptions,
            (SELECT ROUND(AVG(r.overall_score),1) FROM redemption_ratings r JOIN redemptions x ON x.id = r.redemption_id WHERE x.merchant_id = m.id) rating
       FROM merchants m ORDER BY CASE m.status WHEN 'pending' THEN 0 ELSE 1 END, m.name`).all();
  return json({ merchants: results });
}

export async function adminCreateMerchant(req, env, user) {
  requireRole(user, 'admin');
  const b = await body(req, 10_000);
  const dest = await destinationOr404(env, b.destination);
  const m = await env.DB.prepare(`INSERT INTO merchants(destination_id, name, category, address, lat, lng, hours, contact_email, status)
     VALUES (?,?,?,?,?,?,?,?,'active') RETURNING *`).bind(dest.id, str(b.name, { min: 2, max: 100, name: 'Name' }), str(b.category, { min: 2, max: 60, name: 'Category' }),
    b.address ? str(b.address, { max: 200 }) : null, num(b.lat, { min: -90, max: 90, name: 'Latitude' }), num(b.lng, { min: -180, max: 180, name: 'Longitude' }),
    b.hours ? str(b.hours, { max: 60 }) : null, b.email ? str(b.email, { max: 200 }).toLowerCase() : null).first();
  if (m.contact_email) await linkMerchantUser(env, m);
  return json({ merchant: m }, 201);
}

async function linkMerchantUser(env, m) {
  if (!m.contact_email) return;
  await env.DB.prepare(`UPDATE tin_users SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'merchant' END, merchant_id = ? WHERE email = ?`).bind(m.id, m.contact_email).run();
}

export async function adminUpdateMerchant(req, env, user, id) {
  requireRole(user, 'admin');
  const b = await body(req, 5_000);
  const status = oneOf(b.status, ['active', 'paused', 'declined'], 'status');
  const m = await env.DB.prepare('UPDATE merchants SET status = ? WHERE id = ? RETURNING *').bind(status, id).first();
  if (!m) bad('Merchant not found', 404);
  if (status === 'active') await linkMerchantUser(env, m);
  return json({ merchant: m });
}

export async function adminDrops(req, env, user) {
  requireRole(user, 'admin');
  const { results } = await env.DB.prepare(`SELECT ${DROP_COLS}, d.fee_usd,
      (SELECT COUNT(*) FROM redemptions x WHERE x.drop_id = d.id) redeemed
      FROM treasure_drops d JOIN merchants m ON m.id = d.merchant_id
      ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, d.id DESC`).all();
  return json({ drops: results.map((r) => ({ ...shapeDrop(r, null, { revealMystery: true }), fee: r.fee_usd, redeemed: r.redeemed })) });
}

export async function adminHunts(req, env, user) {
  requireRole(user, 'admin');
  if (req.method === 'POST') {
    const b = await body(req, 5_000);
    const dest = await destinationOr404(env, b.destination);
    const h = await env.DB.prepare(`INSERT INTO hunts(destination_id, name, emoji, tagline, starts_on, ends_on, status) VALUES (?,?,?,?,?,?,'draft') RETURNING *`)
      .bind(dest.id, str(b.name, { min: 3, max: 60, name: 'Hunt name' }), str(b.emoji || '🗺️', { min: 1, max: 16 }), b.tagline ? str(b.tagline, { max: 160 }) : null,
        b.startsOn || null, b.endsOn || null).first();
    return json({ hunt: h }, 201);
  }
  const { results } = await env.DB.prepare('SELECT * FROM hunts ORDER BY CASE status WHEN \'live\' THEN 0 WHEN \'scheduled\' THEN 1 WHEN \'draft\' THEN 2 ELSE 3 END, starts_on').all();
  return json({ hunts: results });
}

export async function adminUpdateHunt(req, env, user, id) {
  requireRole(user, 'admin');
  const b = await body(req, 5_000);
  const status = oneOf(b.status, ['draft', 'scheduled', 'live', 'ended'], 'status');
  const h = await env.DB.prepare('SELECT * FROM hunts WHERE id = ?').bind(id).first();
  if (!h) bad('Hunt not found', 404);
  const stmts = [];
  // Only one live hunt per destination.
  if (status === 'live') stmts.push(env.DB.prepare(`UPDATE hunts SET status = 'ended' WHERE destination_id = ? AND status = 'live' AND id != ?`).bind(h.destination_id, id));
  stmts.push(env.DB.prepare('UPDATE hunts SET status = ? WHERE id = ?').bind(status, id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

export async function adminSettings(req, env, user) {
  requireRole(user, 'admin');
  if (req.method === 'PUT') {
    const b = await body(req, 5_000);
    const map = {
      creditsPerFind: ['credits_per_find', { min: 1, max: 1000, int: true }],
      rafflePrize: ['raffle_prize_credits', { min: 0, max: 100000, int: true }],
      dropPrice: ['drop_price_usd', { min: 0, max: 1000 }],
      claimHours: ['claim_hours', { min: 1, max: 168, int: true }],
    };
    const stmts = Object.entries(map).filter(([k]) => b[k] !== undefined)
      .map(([k, [key, opt]]) => env.DB.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(num(b[k], { ...opt, name: k }))));
    if (stmts.length) await env.DB.batch(stmts);
  }
  return json({ settings: await getSettings(env.DB) });
}

export async function adminProof(req, env, user, redemptionId) {
  requireRole(user, 'merchant', 'admin');
  const r = await env.DB.prepare('SELECT merchant_id, confirmation_reference FROM redemptions WHERE id = ?').bind(redemptionId).first();
  if (!r || (user.role === 'merchant' && r.merchant_id !== user.merchant_id)) bad('Not found', 404);
  const p = await env.DB.prepare('SELECT data_url FROM redemption_proofs WHERE id = ?').bind(Number(r.confirmation_reference.split(':')[1])).first();
  const m = p && p.data_url.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) bad('Not found', 404);
  return new Response(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), { headers: { 'content-type': m[1], 'cache-control': 'private, no-store' } });
}

// Hourly: release claims that were never redeemed (counts as abandoned).
export async function expireClaims(env) {
  const { results } = await env.DB.prepare(`UPDATE claims SET status = 'abandoned' WHERE status = 'claimed' AND expires_at <= ? RETURNING drop_id`).bind(nowIso()).all();
  if (results.length) await env.DB.batch(results.map((r) => env.DB.prepare('UPDATE treasure_drops SET remaining = remaining + 1 WHERE id = ?').bind(r.drop_id)));
  return results.length;
}
