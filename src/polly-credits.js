// Polly Credits — every explorer's allowance for Polly's AI (voice, listening, understanding).
// Charged at Cloudflare Workers AI's real price: 1 Polly Credit = 100 neurons (~US$0.0011).
// New explorers get a starting amount (HQ setting); they can top up with Stripe.
// The Polly Admin wallet records the money that pays Cloudflare (top-ups now; redemption share later).
import { json, bad, body, num, nowIso, str } from './lib.js';
import { requireRole } from './auth.js';
import { stripe, stripeEnabled } from './payments.js';

export const NEURONS_PER_CREDIT = 100;
// Cloudflare price list (neurons): per 1k characters, per audio minute, per million tokens.
const RATE = {
  '@cf/deepgram/aura-2-en': { perKChar: 2727.27 }, '@cf/deepgram/aura-2-es': { perKChar: 2727.27 },
  '@cf/deepgram/aura-1': { perKChar: 1363.64 }, '@cf/myshell-ai/melotts': { perMin: 18.63 },
  '@cf/openai/whisper': { perMin: 41.14 }, '@cf/openai/whisper-large-v3-turbo': { perMin: 46.63 },
  '@cf/meta/llama-3.1-8b-instruct': { inM: 25608, outM: 75147 },
};
export function costNeurons(model, { chars = 0, minutes = 0, inTokens = 0, outTokens = 0 } = {}) {
  const r = RATE[model] || {};
  const n = (r.perKChar || 0) * chars / 1000 + (r.perMin || 0) * minutes + (r.inM || 0) * inTokens / 1e6 + (r.outM || 0) * outTokens / 1e6;
  return Math.max(1, Math.ceil(n));
}

export const DEFAULT_SUGGESTIONS = {
  en: ['Help me find treasure', 'I only want food treasures', 'Treasures within walking distance', 'I have kids', "Make today's hunt last one hour", 'What is open now?', 'How many credits do I have?', 'How many Polly Credits do I have?'],
  es: ['Ayúdame a encontrar tesoros', 'Solo quiero tesoros de comida', 'Tesoros cerca a pie', 'Tengo niños', 'Haz que la búsqueda de hoy dure una hora', '¿Qué está abierto ahora?', '¿Cuántos créditos tengo?', '¿Cuántos Polly Credits tengo?'],
  pt: ['Me ajude a achar tesouros', 'Só quero tesouros de comida', 'Tesouros perto a pé', 'Tenho crianças', 'Faça a caça de hoje durar uma hora', 'O que está aberto agora?', 'Quantos créditos eu tenho?', 'Quantos Polly Credits eu tenho?'],
  fr: ['Aide-moi à trouver des trésors', 'Je veux seulement des trésors à manger', 'Trésors à pied tout près', "J'ai des enfants", "Fais une chasse d'une heure aujourd'hui", "Qu'est-ce qui est ouvert maintenant ?", 'Combien de crédits ai-je ?', 'Combien de Polly Credits ai-je ?'],
  de: ['Hilf mir, Schätze zu finden', 'Ich möchte nur Essens-Schätze', 'Schätze zu Fuß in der Nähe', 'Ich habe Kinder', 'Plane eine einstündige Schatzsuche', 'Was ist jetzt geöffnet?', 'Wie viele Credits habe ich?', 'Wie viele Polly Credits habe ich?'],
};
export async function pollySuggestions(env) {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'polly_suggestions'`).first().catch(() => null);
  const asItems = (list) => (list || []).map((x) => (typeof x === 'string' ? { q: x, a: '' } : { q: String(x.q || ''), a: String(x.a || '') })).filter((x) => x.q);
  const base = Object.fromEntries(Object.entries(DEFAULT_SUGGESTIONS).map(([l, v]) => [l, asItems(v)]));
  try { const v = JSON.parse(r?.value || ''); if (v && typeof v === 'object') { for (const [l, list] of Object.entries(v)) base[l] = asItems(list); } } catch {}
  return base;
}

async function settings(env) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('polly_start_credits','polly_packs')`).all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  let packs = [];
  try { packs = JSON.parse(s.polly_packs || '[]').filter((p) => p.credits > 0 && p.usd >= 0.5); } catch {}
  if (!packs.length) packs = [{ credits: 1500, usd: 5 }, { credits: 3500, usd: 10 }];
  return { startCredits: Number(s.polly_start_credits ?? 100), packs, suggestions: await pollySuggestions(env) };
}

// Make sure the explorer has a Polly Credits row (first use gets the starting amount).
export async function pollyAccount(env, userId) {
  let row = await env.DB.prepare('SELECT granted_neurons, used_neurons FROM polly_credits WHERE user_id = ?').bind(userId).first();
  if (!row) {
    const { startCredits } = await settings(env);
    await env.DB.prepare('INSERT OR IGNORE INTO polly_credits(user_id, granted_neurons) VALUES (?, ?)').bind(userId, Math.round(startCredits * NEURONS_PER_CREDIT)).run();
    row = await env.DB.prepare('SELECT granted_neurons, used_neurons FROM polly_credits WHERE user_id = ?').bind(userId).first();
  }
  const left = row.granted_neurons - row.used_neurons;
  return { leftNeurons: left, credits: Math.max(0, Math.floor(left / NEURONS_PER_CREDIT)), usedCredits: Math.round(row.used_neurons / NEURONS_PER_CREDIT * 10) / 10 };
}
export async function canAfford(env, userId, neurons) {
  if (!userId) return false;
  const a = await pollyAccount(env, userId);
  return a.leftNeurons >= neurons;
}
export async function chargePolly(env, userId, kind, model, units, neurons) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO polly_usage(user_id, kind, model, units, neurons) VALUES (?,?,?,?,?)').bind(userId || null, kind, model, units, neurons),
    ...(userId ? [env.DB.prepare('UPDATE polly_credits SET used_neurons = used_neurons + ?, updated_at = ? WHERE user_id = ?').bind(neurons, nowIso(), userId)] : []),
  ]);
}

// GET /api/polly/credits
export async function myPollyCredits(req, env, user) {
  requireRole(user);
  const a = await pollyAccount(env, user.id);
  const { packs } = await settings(env);
  return json({ credits: a.credits, used: a.usedCredits, packs, payments: stripeEnabled(env) ? 'stripe' : 'off', suggestions: await pollySuggestions(env) });
}

// POST /api/polly/credits/checkout { pack }
export async function buyPollyCredits(req, env, user) {
  requireRole(user);
  if (!stripeEnabled(env)) bad('Online payment is not switched on yet.');
  const b = await body(req, 1_000);
  const { packs } = await settings(env);
  const p = packs[num(b.pack, { min: 0, max: 20, int: true, name: 'Pack' })];
  if (!p) bad('That pack is no longer offered');
  const row = await env.DB.prepare('INSERT INTO polly_topups(user_id, credits, amount_usd) VALUES (?,?,?) RETURNING id').bind(user.id, p.credits, p.usd).first();
  const origin = new URL(req.url).origin;
  const session = await stripe(env, '/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment', client_reference_id: `polly:${row.id}`, customer_email: user.email || undefined,
      line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(p.usd * 100), product_data: { name: `${p.credits} Polly Credits`, description: 'Talk with Polly, your TIN treasure guide' } } } },
      metadata: { polly_topup_id: row.id, user_id: user.id, credits: p.credits },
      payment_intent_data: { metadata: { polly_topup_id: row.id, user_id: user.id, credits: p.credits } },
      success_url: `${origin}/app?polly={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/app?polly_cancel=1`,
    },
  });
  await env.DB.prepare('UPDATE polly_topups SET stripe_session_id = ? WHERE id = ?').bind(session.id, row.id).run();
  return json({ checkoutUrl: session.url });
}

// Exactly once (webhook and return page may both call this).
export async function markPollyPaid(env, sessionId, paymentIntent) {
  const row = await env.DB.prepare(`UPDATE polly_topups SET status = 'paid', paid_at = ?, stripe_payment_intent = ? WHERE stripe_session_id = ? AND status != 'paid' RETURNING id, user_id, credits, amount_usd`)
    .bind(nowIso(), paymentIntent || null, sessionId).first();
  if (row) {
    await pollyAccount(env, row.user_id);
    await env.DB.batch([
      env.DB.prepare('UPDATE polly_credits SET granted_neurons = granted_neurons + ?, updated_at = ? WHERE user_id = ?').bind(row.credits * NEURONS_PER_CREDIT, nowIso(), row.user_id),
      env.DB.prepare(`INSERT INTO polly_wallet(amount_usd, reason, ref, note) VALUES (?, 'topup', ?, ?)`).bind(row.amount_usd, `polly:${row.id}`, `${row.credits} Polly Credits`),
    ]);
  }
  return row;
}

// GET /api/polly/credits/checkout/:sessionId
export async function verifyPollyCheckout(req, env, user, sessionId) {
  requireRole(user);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) bad('Invalid session');
  const t = await env.DB.prepare('SELECT user_id, credits FROM polly_topups WHERE stripe_session_id = ?').bind(sessionId).first();
  if (!t || t.user_id !== user.id) bad('Not found', 404);
  const s = await stripe(env, `/checkout/sessions/${sessionId}`);
  if (s.payment_status === 'paid') await markPollyPaid(env, sessionId, s.payment_intent);
  const a = await pollyAccount(env, user.id);
  return json({ paid: s.payment_status === 'paid', added: t.credits, credits: a.credits });
}

// GET /api/admin/polly — usage and cost, wallet, settings
export async function adminPolly(req, env, user) {
  requireRole(user, 'admin');
  const day = new Date(Date.now() - 864e5).toISOString().slice(0, 19) + 'Z', month = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 19) + 'Z';
  const today = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
  const sum = (since) => env.DB.prepare('SELECT COALESCE(SUM(neurons),0) n, COUNT(*) c FROM polly_usage WHERE created_at >= ?').bind(since).first();
  const [utc, d1, d30] = await Promise.all([sum(today), sum(day), sum(month)]);
  const { results: byKind } = await env.DB.prepare('SELECT kind, COUNT(*) c, SUM(neurons) n FROM polly_usage WHERE created_at >= ? GROUP BY kind').bind(month).all();
  const { results: top } = await env.DB.prepare(`SELECT u.id, u.display_name AS name, u.email, p.granted_neurons, p.used_neurons,
      (SELECT COUNT(*) FROM polly_usage x WHERE x.user_id = u.id) AS uses FROM polly_credits p JOIN tin_users u ON u.id = p.user_id ORDER BY p.used_neurons DESC LIMIT 25`).all();
  const w = await env.DB.prepare('SELECT COALESCE(SUM(amount_usd),0) bal FROM polly_wallet').first();
  const { results: wallet } = await env.DB.prepare('SELECT amount_usd, reason, note, created_at FROM polly_wallet ORDER BY id DESC LIMIT 20').all();
  const usd = (n) => Math.round(n * 0.011 / 1000 * 10000) / 10000;
  return json({
    freeNeuronsPerDay: 10000,
    todayUtc: { neurons: utc.n, uses: utc.c, usd: usd(Math.max(0, utc.n - 10000)) },
    last24h: { neurons: d1.n, uses: d1.c }, last30d: { neurons: d30.n, uses: d30.c, usdBeforeFree: usd(d30.n) },
    byKind, users: top.map((t) => ({ ...t, credits: Math.floor((t.granted_neurons - t.used_neurons) / NEURONS_PER_CREDIT), usedCredits: Math.round(t.used_neurons / NEURONS_PER_CREDIT) })),
    wallet: { balance: w.bal, entries: wallet }, settings: await settings(env),
  });
}

// POST /api/admin/polly/credits { email, credits }  (negative takes credits away)
export async function adminGivePolly(req, env, user) {
  requireRole(user, 'admin');
  const b = await body(req, 1_000);
  const email = str(b.email, { min: 3, max: 200, name: 'Email' }).toLowerCase();
  const credits = num(b.credits, { min: -100000, max: 100000, int: true, name: 'Polly Credits' });
  const u = await env.DB.prepare('SELECT id FROM tin_users WHERE lower(email) = ?').bind(email).first();
  if (!u) bad('No explorer with that email', 404);
  await pollyAccount(env, u.id);
  await env.DB.prepare('UPDATE polly_credits SET granted_neurons = granted_neurons + ?, updated_at = ? WHERE user_id = ?').bind(credits * NEURONS_PER_CREDIT, nowIso(), u.id).run();
  // A gift lights up the explorer's notification bell (Treasure Hunt and TIN User Cockpit).
  if (credits > 0) await env.DB.prepare('INSERT INTO polly_gifts(user_id, credits, note) VALUES (?,?,?)').bind(u.id, credits, b.note ? str(b.note, { max: 200, name: 'Note' }) : null).run();
  return json({ ok: true, ...(await pollyAccount(env, u.id)) });
}

// PUT /api/admin/polly/settings { startCredits, packs:[{credits,usd}] }
export async function adminPollySettings(req, env, user) {
  requireRole(user, 'admin');
  const b = await body(req, 20_000);
  const stmts = [];
  if (b.startCredits !== undefined) stmts.push(env.DB.prepare(`INSERT INTO settings(key, value) VALUES ('polly_start_credits', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(String(num(b.startCredits, { min: 0, max: 100000, int: true, name: 'Starting Polly Credits' }))));
  if (b.packs !== undefined) {
    if (!Array.isArray(b.packs) || !b.packs.length || b.packs.length > 6) bad('Give 1 to 6 packs');
    const packs = b.packs.map((p) => ({ credits: num(p.credits, { min: 1, max: 1000000, int: true, name: 'Pack credits' }), usd: num(p.usd, { min: 0.5, max: 1000, name: 'Pack price' }) }));
    stmts.push(env.DB.prepare(`INSERT INTO settings(key, value) VALUES ('polly_packs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(packs)));
  }
  if (b.suggestions !== undefined) {
    if (!b.suggestions || typeof b.suggestions !== 'object') bad('Suggestions must be a list per language');
    const out = {};
    for (const l of ['en', 'es', 'pt', 'fr', 'de']) {
      const list = Array.isArray(b.suggestions[l]) ? b.suggestions[l] : [];
      const clean = list.map((x) => (typeof x === 'string' ? { q: x, a: '' } : x))
        .map((x) => ({ q: String(x.q || '').replace(/\s+/g, ' ').trim().slice(0, 80), a: String(x.a || '').trim().slice(0, 1200) })).filter((x) => x.q).slice(0, 20);
      out[l] = clean;
    }
    stmts.push(env.DB.prepare(`INSERT INTO settings(key, value) VALUES ('polly_suggestions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(out)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, settings: await settings(env) });
}

// ---------- gift notifications ----------
async function unseenGifts(env, userId) {
  const { results } = await env.DB.prepare('SELECT id, credits, note, created_at FROM polly_gifts WHERE user_id = ? AND seen_at IS NULL ORDER BY id DESC LIMIT 20').bind(userId).all();
  return results;
}
// GET /api/polly/gifts — the explorer's unseen gifts
export async function myPollyGifts(req, env, user) {
  requireRole(user);
  const gifts = await unseenGifts(env, user.id);
  return json({ count: gifts.length, credits: gifts.reduce((t, g) => t + g.credits, 0), gifts });
}
// POST /api/polly/gifts/seen — the explorer opened the notification: it goes off everywhere
export async function seenPollyGifts(req, env, user) {
  requireRole(user);
  await env.DB.prepare('UPDATE polly_gifts SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL').bind(nowIso(), user.id).run();
  return json({ ok: true });
}
// GET /api/tin/polly-gifts?ticket= — asked server-to-server by TIN Commerce (User Cockpit) with a one-time ticket
export async function tinPollyGifts(req, env) {
  const { verifyTinTicket } = await import('./auth.js');
  const who = await verifyTinTicket(env, new URL(req.url).searchParams.get('ticket'), 'user-sso');
  const email = String(who?.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'Not allowed' }, 401);
  const u = await env.DB.prepare('SELECT id FROM tin_users WHERE lower(email) = ?').bind(email).first();
  if (!u) return json({ count: 0, credits: 0 });
  const gifts = await unseenGifts(env, u.id);
  return json({ count: gifts.length, credits: gifts.reduce((t, g) => t + g.credits, 0) }, 200, { 'cache-control': 'no-store' });
}

// ---------- Polly's shortcut questions with HQ-written answers ----------
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** The answer TIN HQ wrote for this question (any language), or null. */
export async function customAnswer(env, q, lang) {
  const all = await pollySuggestions(env);
  const n = norm(q); if (n.length < 3) return null;
  const order = [lang, ...Object.keys(all).filter((l) => l !== lang)];
  for (const l of order) for (const it of all[l] || []) {
    if (!it.a) continue;
    const k = norm(it.q);
    if (k && (k === n || (k.length >= 10 && (n.includes(k) || k.includes(n) && n.length >= 10)))) return { answer: it.a, lang: l };
  }
  return null;
}
