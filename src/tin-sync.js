// Pulls the merchants TIN HQ switched on (tincommerce.com merchant cockpit) into the Treasure Hunt.
// Runs hourly from the cron and on demand from TIN HQ. Only public business data is read.
import { json } from './lib.js';
import { requireRole } from './auth.js';
import { grantWelcome } from './credits.js';

const FEEDS = [['mexico-quintana-roo-cozumel', 'cozumel']]; // [TIN market slug, Treasure Hunt destination id]

export async function syncTinMerchants(env) {
  const base = String(env.TIN_COMMERCE_URL || 'https://tincommerce.com').replace(/\/$/, '');
  const result = { added: 0, updated: 0, paused: 0 };
  for (const [market, dest] of FEEDS) {
    const res = await fetch(`${base}/api/treasure-hunt-merchants?feed=${market}`, { headers: { accept: 'application/json' } });
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
      const name = String(m.name || '').slice(0, 100), category = String(m.category || 'Business').slice(0, 60);
      const cur = await env.DB.prepare('SELECT id FROM merchants WHERE tin_merchant_id = ?').bind(id).first();
      if (cur) {
        await env.DB.prepare(`UPDATE merchants SET name = ?, category = ?, address = ?, lat = ?, lng = ?, status = 'active' WHERE id = ?`)
          .bind(name, category, m.address || null, lat, lng, cur.id).run();
        result.updated++;
      } else {
        const ins = await env.DB.prepare(`INSERT INTO merchants(destination_id, name, category, address, lat, lng, status, tin_merchant_id) VALUES (?,?,?,?,?,?,'active',?) RETURNING id`)
          .bind(dest, name, category, m.address || null, lat, lng, id).first();
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
