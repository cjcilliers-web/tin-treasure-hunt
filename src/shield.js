// TIN Treasure Shield: a merchant protects a circle around their business. When another
// merchant's treasure goes live inside it, the owner gets a message and can leave it or block it.
// Blocking takes the treasure down, gives the dropper back their unused drop credits and tells them.
import { bad, body, json, num, nowIso, distanceM, getSettings } from './lib.js';
import { requireRole } from './auth.js';
import { changeCredits } from './credits.js';

const MAX_CENTRE_FROM_BUSINESS_M = 500; // a shield protects your own place, not a far-away spot
const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

function merchantIdOf(user, url) {
  requireRole(user, 'merchant', 'admin');
  if (user.role === 'merchant') return user.merchant_id;
  const id = Number(url.searchParams.get('merchant'));
  if (!Number.isInteger(id) || id < 1) bad('Pick a merchant first');
  return id;
}

// Shields whose circle covers the point, skipping the merchant who owns the treasure.
async function shieldsCovering(env, lat, lng, exceptMerchantId) {
  const pad = 0.05; // ~5 km box; the exact circle check follows
  const { results } = await env.DB.prepare(
    `SELECT s.merchant_id, s.lat, s.lng, s.radius_m, m.name FROM treasure_shields s JOIN merchants m ON m.id = s.merchant_id
      WHERE s.active = 1 AND m.status = 'active' AND s.merchant_id != ?
        AND s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?`
  ).bind(exceptMerchantId ?? 0, lat - pad, lat + pad, lng - pad, lng + pad).all();
  return results.map((s) => ({ ...s, away: distanceM(s.lat, s.lng, lat, lng) })).filter((s) => s.away <= s.radius_m);
}

async function alertOwner(env, ownerId, drop, away) {
  const seen = await env.DB.prepare(
    `SELECT 1 FROM merchant_messages WHERE merchant_id = ? AND kind = 'shield_alert' AND drop_id = ?
       AND ABS(drop_lat - ?) < 0.000001 AND ABS(drop_lng - ?) < 0.000001 LIMIT 1`
  ).bind(ownerId, drop.id, drop.gps_lat, drop.gps_lng).first();
  if (seen) return false;
  const text = `${drop.emoji || '🎁'} “${drop.title}” (${drop.item}) from ${drop.merchant} is now inside your Treasure Shield, ${fmtM(away)} from its centre. You can leave it or block it.`;
  await env.DB.prepare(`INSERT INTO merchant_messages(merchant_id, kind, drop_id, drop_lat, drop_lng, body, state) VALUES (?,?,?,?,?,?,'open')`)
    .bind(ownerId, 'shield_alert', drop.id, drop.gps_lat, drop.gps_lng, text).run();
  return true;
}

const DROP_FOR_ALERT = `SELECT d.id, d.merchant_id, d.title, d.item, d.emoji, d.gps_lat, d.gps_lng, d.status, m.name AS merchant
  FROM treasure_drops d JOIN merchants m ON m.id = d.merchant_id`;

// Called whenever a treasure goes live (approved, resumed, or re-approved after a move).
export async function checkShieldsForDrop(env, dropId) {
  const d = await env.DB.prepare(`${DROP_FOR_ALERT} WHERE d.id = ?`).bind(dropId).first();
  if (!d || d.status !== 'active') return 0;
  let n = 0;
  for (const s of await shieldsCovering(env, d.gps_lat, d.gps_lng, d.merchant_id)) if (await alertOwner(env, s.merchant_id, d, s.away)) n++;
  return n;
}

// When a shield is switched on or made bigger: tell the owner about live treasures already inside.
async function scanShield(env, ownerId) {
  const s = await env.DB.prepare('SELECT * FROM treasure_shields WHERE merchant_id = ? AND active = 1').bind(ownerId).first();
  if (!s) return 0;
  const pad = 0.05;
  const { results } = await env.DB.prepare(`${DROP_FOR_ALERT} WHERE d.status = 'active' AND d.merchant_id != ?
      AND d.gps_lat BETWEEN ? AND ? AND d.gps_lng BETWEEN ? AND ?`).bind(ownerId, s.lat - pad, s.lat + pad, s.lng - pad, s.lng + pad).all();
  let n = 0;
  for (const d of results) {
    const away = distanceM(s.lat, s.lng, d.gps_lat, d.gps_lng);
    if (away <= s.radius_m && (await alertOwner(env, ownerId, d, away))) n++;
  }
  return n;
}

// GET /api/merchant/shield
export async function getShield(req, env, user) {
  const mid = merchantIdOf(user, new URL(req.url));
  const m = await env.DB.prepare('SELECT lat, lng FROM merchants WHERE id = ?').bind(mid).first();
  if (!m) bad('Merchant not found', 404);
  const s = await env.DB.prepare('SELECT lat, lng, radius_m, active, updated_at FROM treasure_shields WHERE merchant_id = ?').bind(mid).first();
  const { shieldMaxRadius } = await getSettings(env.DB);
  return json({
    shield: s ? { lat: s.lat, lng: s.lng, radius: s.radius_m, active: !!s.active, updatedAt: s.updated_at } : null,
    business: { lat: m.lat, lng: m.lng }, maxRadius: shieldMaxRadius, maxCentreFromBusiness: MAX_CENTRE_FROM_BUSINESS_M,
  });
}

// PUT /api/merchant/shield { active, radius, lat?, lng? }
export async function saveShield(req, env, user) {
  const mid = merchantIdOf(user, new URL(req.url));
  const m = await env.DB.prepare('SELECT lat, lng, status FROM merchants WHERE id = ?').bind(mid).first();
  if (!m || m.status !== 'active') bad('Your merchant account is not active yet');
  const b = await body(req, 2_000);
  const { shieldMaxRadius } = await getSettings(env.DB);
  const radius = num(b.radius, { min: 10, max: shieldMaxRadius, int: true, name: `Shield size (10 to ${shieldMaxRadius} m)` });
  const active = b.active === false ? 0 : 1;
  let lat = m.lat, lng = m.lng;
  if (b.lat !== undefined || b.lng !== undefined) {
    lat = num(b.lat, { min: -90, max: 90, name: 'Latitude' });
    lng = num(b.lng, { min: -180, max: 180, name: 'Longitude' });
    if (user.role !== 'admin' && distanceM(m.lat, m.lng, lat, lng) > MAX_CENTRE_FROM_BUSINESS_M)
      bad(`Your shield must be centred within ${MAX_CENTRE_FROM_BUSINESS_M} m of your business.`);
  }
  await env.DB.prepare(`INSERT INTO treasure_shields(merchant_id, lat, lng, radius_m, active, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(merchant_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m, active = excluded.active, updated_at = excluded.updated_at`)
    .bind(mid, lat, lng, radius, active, nowIso()).run();
  const found = active ? await scanShield(env, mid) : 0;
  return json({ shield: { lat, lng, radius, active: !!active }, alerts: found });
}

// GET /api/merchant/shield-check?lat&lng — is this spot inside someone else's shield? (no names shared)
export async function shieldCheck(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantIdOf(user, url);
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) bad('lat and lng are required');
  return json({ inside: (await shieldsCovering(env, lat, lng, mid)).length });
}

// GET /api/merchant/messages
export async function listMessages(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantIdOf(user, url);
  const { results } = await env.DB.prepare(
    `SELECT x.id, x.kind, x.drop_id, x.drop_lat, x.drop_lng, x.body, x.state, x.created_at, x.read_at, x.acted_at,
            d.status AS drop_status, d.title AS drop_title
       FROM merchant_messages x LEFT JOIN treasure_drops d ON d.id = x.drop_id
      WHERE x.merchant_id = ? ORDER BY x.id DESC LIMIT 60`).bind(mid).all();
  const unread = results.filter((r) => !r.read_at).length;
  const open = results.filter((r) => r.kind === 'shield_alert' && r.state === 'open').length;
  if (url.searchParams.get('peek') !== '1' && unread)
    await env.DB.prepare('UPDATE merchant_messages SET read_at = ? WHERE merchant_id = ? AND read_at IS NULL').bind(nowIso(), mid).run();
  return json({ unread, open, messages: url.searchParams.get('peek') === '1' ? [] : results });
}

// POST /api/merchant/messages/:id/act { action: 'leave' | 'block' }
export async function actOnMessage(req, env, user, id) {
  const mid = merchantIdOf(user, new URL(req.url));
  const b = await body(req, 500);
  const action = b.action;
  if (!['leave', 'block'].includes(action)) bad('Choose leave or block');
  const msg = await env.DB.prepare(`SELECT * FROM merchant_messages WHERE id = ? AND merchant_id = ? AND kind = 'shield_alert'`).bind(id, mid).first();
  if (!msg) bad('Message not found', 404);
  if (msg.state !== 'open') bad('You already answered this one', 409);
  const now = nowIso();
  if (action === 'leave') {
    await env.DB.prepare(`UPDATE merchant_messages SET state = 'left', acted_at = ? WHERE id = ?`).bind(now, id).run();
    return json({ ok: true, state: 'left' });
  }
  const d = await env.DB.prepare('SELECT * FROM treasure_drops WHERE id = ?').bind(msg.drop_id).first();
  const shield = await env.DB.prepare('SELECT * FROM treasure_shields WHERE merchant_id = ? AND active = 1').bind(mid).first();
  const stillInside = d && shield && d.status === 'active' && distanceM(shield.lat, shield.lng, d.gps_lat, d.gps_lng) <= shield.radius_m;
  if (!stillInside) {
    await env.DB.prepare(`UPDATE merchant_messages SET state = 'closed', acted_at = ? WHERE id = ?`).bind(now, id).run();
    return json({ ok: true, state: 'closed', note: 'This treasure has moved, ended or your shield is off, so there was nothing to block.' });
  }
  // Take it down; unused drops go back to the merchant who paid for them.
  const took = await env.DB.prepare(`UPDATE treasure_drops SET status = 'rejected', blocked_by_merchant_id = ?, blocked_at = ?, remaining = 0
      WHERE id = ? AND status = 'active' RETURNING id`).bind(mid, now, d.id).first();
  if (!took) bad('This treasure changed a moment ago. Please refresh.', 409);
  const back = d.payment_status === 'prepaid' ? d.remaining : 0;
  if (back > 0) await changeCredits(env, d.merchant_id, back, 'refund', { ref: `blocked:${d.id}`, note: `Treasure “${d.title}” blocked by a Treasure Shield` });
  await env.DB.batch([
    env.DB.prepare(`UPDATE merchant_messages SET state = 'blocked', acted_at = ? WHERE id = ?`).bind(now, id),
    env.DB.prepare(`UPDATE merchant_messages SET state = 'closed', acted_at = ? WHERE drop_id = ? AND kind = 'shield_alert' AND state = 'open' AND id != ?`).bind(now, d.id, id),
    env.DB.prepare(`INSERT INTO merchant_messages(merchant_id, kind, drop_id, drop_lat, drop_lng, body, state) VALUES (?,?,?,?,?,?,NULL)`)
      .bind(d.merchant_id, 'drop_blocked', d.id, d.gps_lat, d.gps_lng,
        `🛡️ Your treasure ${d.emoji || '🎁'} “${d.title}” was blocked. It was inside another business's Treasure Shield, so it is no longer shown to explorers.${back ? ` ${back} unused drop credit${back === 1 ? ' is' : 's are'} back in your account.` : ''} Codes explorers already claimed can still be redeemed. You can drop it again somewhere else.`),
  ]);
  return json({ ok: true, state: 'blocked', refunded: back });
}
