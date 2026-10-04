// Pulls the merchants TIN HQ switched on (tincommerce.com merchant cockpit) into the Treasure Hunt.
// Runs hourly from the cron and on demand from TIN HQ. Only public business data is read.
import { json } from './lib.js';
import { requireRole } from './auth.js';
import { grantWelcome } from './credits.js';

// [TIN feed, Treasure Hunt destination id]. 'all' brings in switched-on merchants from every TIN market;
// treasures are found by distance, so a merchant outside Cozumel still works where it really is.
// If TIN Commerce does not know 'all' yet, the Cozumel feed is used instead.
const FEEDS = [['all', 'cozumel']];
const FALLBACK_FEED = 'mexico-quintana-roo-cozumel';

export async function syncTinMerchants(env) {
  const base = String(env.TIN_COMMERCE_URL || 'https://tincommerce.com').replace(/\/$/, '');
  const result = { added: 0, updated: 0, paused: 0 };
  for (const [market, dest] of FEEDS) {
    let res = await fetch(`${base}/api/treasure-hunt-merchants?feed=${market}`, { headers: { accept: 'application/json' } });
    if (market === 'all' && res.status === 404) res = await fetch(`${base}/api/treasure-hunt-merchants?feed=${FALLBACK_FEED}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`TIN feed ${market}: HTTP ${res.status}`);
    const { merchants = [] } = await res.json();
    const d = await env.DB.prepare('SELECT center_lat AS lat, center_lng AS lng FROM destinations WHERE id = ?').bind(dest).first();
    if (!d) continue;
    const seen = [];
    for (const m of merchants) {
      const id = Number(m.tinMerchantId); if (!Number.isInteger(id)) continue;
      seen.push(id);
      const lat = Number.isFinite(Number.parseFloat(m.latitude)) ? Number.parseFloat(m.latitude) : d.lat;
      const lng = Number.isFinite(Number.parseFloat(m.longitude)) ? Number.parseFloat(m.longitude) : d.lng;
      const hasLoc = Number.isFinite(Number.parseFloat(m.latitude)) && Number.isFinite(Number.parseFloat(m.longitude));
      const name = String(m.name || '').slice(0, 100), category = String(m.category || 'Business').slice(0, 60);
      const cur = await env.DB.prepare('SELECT id FROM merchants WHERE tin_merchant_id = ?').bind(id).first();
      if (cur) {
        // Keep a location set in the Treasure Hunt when TIN has none for this merchant.
        if (hasLoc) await env.DB.prepare(`UPDATE merchants SET name = ?, category = ?, address = ?, lat = ?, lng = ?, needs_location = 0, status = 'active' WHERE id = ?`)
          .bind(name, category, m.address || null, lat, lng, cur.id).run();
        else await env.DB.prepare(`UPDATE merchants SET name = ?, category = ?, address = COALESCE(?, address), status = 'active' WHERE id = ?`)
          .bind(name, category, m.address || null, cur.id).run();
        result.updated++;
      } else {
        const ins = await env.DB.prepare(`INSERT INTO merchants(destination_id, name, category, address, lat, lng, status, tin_merchant_id, needs_location) VALUES (?,?,?,?,?,?,'active',?,?) RETURNING id`)
          .bind(dest, name, category, m.address || null, lat, lng, id, hasLoc ? 0 : 1).first();
        await grantWelcome(env, ins.id);
        result.added++;
      }
    }
    // Switched off in TIN -> paused here (their drops stop showing, data is kept).
    const linked = await env.DB.prepare(`SELECT id, tin_merchant_id FROM merchants WHERE destination_id = ? AND tin_merchant_id IS NOT NULL AND status = 'active'`).bind(dest).all();
    for (const r of linked.results) {
      if (!seen.includes(r.tin_merchant_id)) { await env.DB.prepare(`UPDATE merchants SET status = 'paused' WHERE id = ?`).bind(r.id).run(); result.paused++; }
    }
  }
  return result;
}

export async function adminSyncTin(req, env, user) {
  requireRole(user, 'admin');
  return json(await syncTinMerchants(env));
}

// POST /api/tin-sync — TIN Commerce calls this right after a merchant switches the Treasure Hunt
// on or off, so the change shows up now instead of at the next hourly sync. It only re-reads
// TIN's public feed, so no sign-in is needed; it runs at most once every 3 seconds (the hourly sync catches anything skipped).
export async function publicSyncTin(req, env) {
  const last = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'last_tin_sync'`).first();
  if (last && Date.now() - Date.parse(last.value) < 3_000) return json({ ok: true, skipped: true });
  await env.DB.prepare(`INSERT INTO settings(key, value) VALUES ('last_tin_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(new Date().toISOString()).run();
  return json({ ok: true, ...(await syncTinMerchants(env)) });
}
