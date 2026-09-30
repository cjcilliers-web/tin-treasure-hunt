// Phase 4 — weekly raffle: Sundays 14:00 UTC, drawn from that week's
// confirmed redeemers. One ticket per verified find. Idempotent per week.
import { json, getSettings, lastRaffleAt, nextRaffleAt, iso, nowIso } from './lib.js';
import { requireRole } from './auth.js';

export async function runRaffle(env, trigger = 'cron', drawTime = lastRaffleAt()) {
  const weekEnd = iso(drawTime);
  const weekStart = iso(new Date(drawTime.getTime() - 7 * 86400e3));
  const done = await env.DB.prepare('SELECT * FROM raffles WHERE week_end = ?').bind(weekEnd).first();
  if (done) return { already: true, raffle: done };

  const { results: tickets } = await env.DB.prepare(
    `SELECT user_id FROM redemptions WHERE redeemed_at >= ? AND redeemed_at < ?`).bind(weekStart, weekEnd).all();
  const s = await getSettings(env.DB);
  let winner = null;
  if (tickets.length) {
    const r = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    winner = tickets[Math.floor(r * tickets.length)].user_id;
  }
  const entrants = new Set(tickets.map((t) => t.user_id)).size;
  const stmts = [
    env.DB.prepare(`INSERT INTO raffles(week_start, week_end, prize_credits, entrant_count, winner_user_id, trigger) VALUES (?,?,?,?,?,?)`)
      .bind(weekStart, weekEnd, s.rafflePrize, entrants, winner, trigger),
  ];
  if (winner && s.rafflePrize > 0) {
    const now = nowIso();
    stmts.push(
      env.DB.prepare(`INSERT INTO treasure_hunt_credits(user_id, balance, last_updated) VALUES (?,?,?)
                      ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance, last_updated = excluded.last_updated`).bind(winner, s.rafflePrize, now),
      env.DB.prepare(`INSERT INTO treasure_hunt_credit_ledger(user_id, amount, reason, ref) VALUES (?, ?, 'raffle', ?)`).bind(winner, s.rafflePrize, `raffle:${weekEnd}`),
    );
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Another run won the race for this week (UNIQUE week_end): nothing to do.
    if (String(e.message).includes('UNIQUE')) return { already: true };
    throw e;
  }
  return { already: false, weekStart, weekEnd, tickets: tickets.length, entrants, winner, prize: s.rafflePrize };
}

export async function raffleStatus(req, env, user) {
  requireRole(user, 'admin');
  const since = iso(lastRaffleAt());
  const t = await env.DB.prepare(`SELECT COUNT(*) tickets, COUNT(DISTINCT user_id) entrants FROM redemptions WHERE redeemed_at >= ?`).bind(since).first();
  const { results: history } = await env.DB.prepare(
    `SELECT r.*, u.display_name AS winner_name FROM raffles r LEFT JOIN tin_users u ON u.id = r.winner_user_id ORDER BY r.id DESC LIMIT 12`).all();
  const s = await getSettings(env.DB);
  return json({ nextDrawAt: iso(nextRaffleAt()), weekStart: since, tickets: t.tickets, entrants: t.entrants, prize: s.rafflePrize, history });
}

// HQ fallback: draw last week's raffle by hand if the cron ever missed it.
export async function raffleDrawNow(req, env, user) {
  requireRole(user, 'admin');
  const r = await runRaffle(env, 'manual');
  if (r.already) return json({ error: 'This week\'s raffle was already drawn. The next one runs Sunday at 2pm UTC.' }, 409);
  let winnerName = null;
  if (r.winner) winnerName = (await env.DB.prepare('SELECT display_name FROM tin_users WHERE id = ?').bind(r.winner).first())?.display_name;
  return json({ ...r, winnerName });
}
