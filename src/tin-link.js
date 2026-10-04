// Numbers for the TIN Commerce Merchant Cockpit's Treasure Hunt box.
// TIN sends a one-time ticket; we confirm it with TIN before sharing anything.
import { bad, body, json } from './lib.js';
import { verifyTinTicket } from './auth.js';

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
