// Numbers for the TIN Commerce Merchant Cockpit's Treasure Hunt box.
// TIN sends a one-time ticket; we confirm it with TIN before sharing anything.
import { bad, body, json, nowIso, normalizeCode } from './lib.js';
import { verifyTinTicket, userForEmail } from './auth.js';
import { finishRedemption } from './hunt.js';

// POST /api/tin/merchant-summary { ticket }
export async function merchantSummary(req, env) {
  const b = await body(req, 1_000);
  const who = await verifyTinTicket(env, b.ticket, 'merchant-summary');
  if (!who) bad('Ticket expired or not valid', 401);
  const m = await env.DB.prepare('SELECT id, name, status, drop_credits FROM merchants WHERE tin_merchant_id = ?').bind(Number(who.tinMerchantId)).first();
  if (!m) return json({ found: false });
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const one = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
  const [live, pending, week, total, shield, alerts, unread] = await Promise.all([
    one(`SELECT COUNT(*) n FROM treasure_drops WHERE merchant_id = ? AND status = 'active'`, m.id),
    one(`SELECT COUNT(*) n FROM treasure_drops WHERE merchant_id = ? AND status = 'pending'`, m.id),
    one(`SELECT COUNT(*) n FROM redemptions WHERE merchant_id = ? AND redeemed_at >= ?`, m.id, weekAgo),
    one(`SELECT COUNT(*) n FROM redemptions WHERE merchant_id = ?`, m.id),
    one(`SELECT active, radius_m FROM treasure_shields WHERE merchant_id = ?`, m.id),
    one(`SELECT COUNT(*) n FROM merchant_messages WHERE merchant_id = ? AND kind = 'shield_alert' AND state = 'open'`, m.id),
    one(`SELECT COUNT(*) n FROM merchant_messages WHERE merchant_id = ? AND read_at IS NULL`, m.id),
  ]);
  return json({
    found: true, name: m.name, status: m.status, credits: m.drop_credits ?? 0,
    live: live.n, pending: pending.n, redeemedWeek: week.n, redeemedTotal: total.n,
    shield: shield ? { active: !!shield.active, radius: shield.radius_m } : null,
    openAlerts: alerts.n, unread: unread.n,
  });
}

// POST /api/tin/redeem { ticket, code, action: 'verify' | 'redeem', type?, proof? }
// One scanner for everything: the TIN Commerce merchant Scan & Verify tool asks here when a code is not a
// TIN Commerce coupon. TIN sends a one-time ticket naming the merchant and the staff member; we confirm it
// with TIN, then check the code belongs to that merchant. Redeeming still needs a photo, as on our own screen.
export async function tinRedeem(req, env) {
  const b = await body(req, 450_000);
  const who = await verifyTinTicket(env, b.ticket, 'merchant-redeem');
  if (!who) bad('Ticket expired or not valid', 401);
  const m = await env.DB.prepare('SELECT id, name FROM merchants WHERE tin_merchant_id = ?').bind(Number(who.tinMerchantId)).first();
  if (!m) bad('Code not found', 404);
  const code = normalizeCode(b.code);
  const c = await env.DB.prepare(
    `SELECT c.id, c.code, c.status, c.expires_at, c.user_id, c.drop_id, d.title, d.item, d.emoji, d.merchant_id, d.difficulty, u.display_name
       FROM claims c JOIN treasure_drops d ON d.id = c.drop_id JOIN tin_users u ON u.id = c.user_id WHERE c.code = ?`).bind(code).first();
  if (!c) bad('Code not found', 404);
  if (c.merchant_id !== m.id) bad('This treasure is for a different business', 403);
  if (c.status === 'redeemed') bad('This treasure was already redeemed', 409);
  if (c.status !== 'claimed') bad('This treasure code is no longer valid', 410);
  if (c.expires_at <= nowIso()) bad('This treasure code has expired', 410);
  const claim = { code: c.code, title: c.title, item: c.item, emoji: c.emoji, traveler: String(c.display_name || '').split(' ')[0], expiresAt: c.expires_at, merchant: m.name };
  if (b.action !== 'redeem') return json({ claim });
  const type = b.type === 'signature' ? 'signature' : 'photo';
  const proof = typeof b.proof === 'string' ? b.proof : '';
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(proof)) bad('A photo is required to confirm');
  if (proof.length > 400_000) bad('The photo is too large');
  if (proof.length < 800) bad('The photo looks empty. Please take it again.');
  const email = String(who.email || '').trim().toLowerCase();
  const staff = await userForEmail(env, email, who.name, 'merchant');
  if (staff.role !== 'admin' && who.admin !== true) await env.DB.prepare(`UPDATE tin_users SET role = 'merchant', merchant_id = ? WHERE id = ? AND role != 'admin'`).bind(m.id, staff.id).run();
  const done = await finishRedemption(env, c, staff.id, type, proof);
  return json({ ok: true, claim, ...done }, 201);
}
