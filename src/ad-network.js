// TIN Video Ad Network: sponsor videos approved in the Treasure Hunt also play in TIN Spin & Win.
// One advertiser, one video, one budget, one report. A finished Spin & Win view charges the
// advertiser the same HQ price and adds the same share to the live Grand Treasure pot.
// No shared secrets: tincommerce.com sends a one-time ticket that we redeem with TIN
// (/api/treasure-hunt-sso/verify, purpose 'ad-view'), which tells us who watched what.
import { bad, body, json, getSettings } from './lib.js';
import { verifyTinTicket } from './auth.js';
import { chargeView, fillPot } from './grand.js';

const today = () => new Date().toISOString().slice(0, 10);

// GET /api/ad-network/videos — videos ready to play elsewhere in TIN (public; no viewer data)
export async function adNetworkVideos(req, env) {
  const s = await getSettings(env.DB);
  const { results } = await env.DB.prepare(`SELECT v.* FROM sponsor_videos v LEFT JOIN merchants m ON m.id = v.merchant_id
      WHERE v.status = 'active' AND (v.merchant_id IS NULL OR (m.status = 'active' AND m.video_balance_cents >= CASE v.length_s WHEN 30 THEN ? ELSE ? END))
      ORDER BY v.id DESC LIMIT 50`).bind(s.videoPrice30, s.videoPrice15).all();
  const g = await env.DB.prepare(`SELECT title, emoji, pot_cents, goal_cents FROM grand_treasures WHERE status = 'live' ORDER BY id DESC LIMIT 1`).first();
  return json({
    videos: results.map((v) => ({ id: v.id, sponsor: v.sponsor_name, title: v.title, youtubeId: v.youtube_id, length: v.length_s, coupon: v.coupon_text, link: v.link_url })),
    grand: g ? { title: g.title, emoji: g.emoji, potCents: g.pot_cents, goalCents: g.goal_cents, pct: Math.floor(Math.min(1, g.pot_cents / g.goal_cents) * 100) } : null,
  }, 200, { 'cache-control': 'public, max-age=30' });
}

// POST /api/ad-network/view { ticket } — called server-to-server by tincommerce.com after a
// Spin & Win player finished a sponsor video (TIN has already checked the full length was watched).
export async function adNetworkView(req, env) {
  const b = await body(req, 1_000);
  const who = await verifyTinTicket(env, b.ticket, 'ad-view');
  if (!who) bad('Ticket expired or not valid', 401);
  const videoId = Number(who.videoId), tinUser = String(who.tinUserId || ''), viewId = String(who.viewId || '');
  if (!Number.isInteger(videoId) || !tinUser || !/^[0-9a-f-]{36}$/.test(viewId)) bad('Ticket not valid', 401);
  const source = who.source === 'tours' ? 'tours' : 'spin';
  const v = await env.DB.prepare('SELECT * FROM sponsor_videos WHERE id = ?').bind(videoId).first();
  if (!v) bad('Video not found', 404);
  const coupon = { text: v.coupon_text, link: v.link_url, sponsor: v.sponsor_name };
  // Record first (once per video per player per day); only a new row is charged.
  const row = await env.DB.prepare(`INSERT INTO ad_network_views(video_id, source, tin_user_id, tin_view_id, day) VALUES (?,?,?,?,?)
      ON CONFLICT DO NOTHING RETURNING id`).bind(videoId, source, tinUser, viewId, today()).first();
  if (!row) return json({ counted: false, already: true, coupon });
  if (v.status !== 'active') return json({ counted: false, reason: 'paused', coupon });
  const done = await env.DB.prepare(`SELECT COUNT(*) n FROM ad_network_views WHERE source = ? AND tin_user_id = ? AND day = ? AND pot_cents > 0`).bind(source, tinUser, today()).first();
  const r = await chargeView(env, v, done.n);
  await env.DB.prepare('UPDATE ad_network_views SET charged_cents = ?, pot_cents = ?, grand_id = ? WHERE id = ?').bind(r.charged, r.pot, r.grandId, row.id).run();
  const g = await fillPot(env, r);
  return json({
    counted: r.pot > 0, charged: r.charged, potAdded: r.pot, reason: r.reason, coupon,
    grand: g ? { title: g.title, emoji: g.emoji, potCents: g.pot_cents, goalCents: g.goal_cents, pct: Math.floor(Math.min(1, g.pot_cents / g.goal_cents) * 100), status: g.status } : null,
  });
}
