// Prepaid drop credits. Merchants buy drops upfront (single drops at the drop price, or packs),
// TIN HQ can give free drops, and every Treasure Drop spends one credit per drop.
import { bad, json, num, str, body, getSettings, nowIso } from './lib.js';
import { requireRole } from './auth.js';
import { stripe, stripeEnabled } from './payments.js';

const MIN_CHARGE_USD = 0.5; // Stripe's minimum card charge in USD

// Add (or remove) drop credits and write the ledger, atomically. Never lets a balance go below zero.
export async function changeCredits(env, merchantId, delta, reason, { ref = null, note = null, by = null } = {}) {
  delta = Math.trunc(delta);
  if (!delta) return null;
  const row = await env.DB.prepare('UPDATE merchants SET drop_credits = drop_credits + ? WHERE id = ? AND drop_credits + ? >= 0 RETURNING drop_credits')
    .bind(delta, merchantId, delta).first();
  if (!row) return null; // not enough credits, or no such merchant
  await env.DB.prepare('INSERT INTO merchant_drop_ledger(merchant_id, delta, reason, ref, note, created_by) VALUES (?,?,?,?,?,?)')
    .bind(merchantId, delta, reason, ref, note, by).run();
  return row.drop_credits;
}

// Welcome gift, once per merchant, when it becomes active.
export async function grantWelcome(env, merchantId) {
  const s = await getSettings(env.DB);
  if (!(s.welcomeDrops > 0)) return;
  const r = await env.DB.prepare('UPDATE merchants SET welcome_granted = 1 WHERE id = ? AND welcome_granted = 0 AND is_sample = 0 RETURNING id').bind(merchantId).first();
  if (r) await changeCredits(env, merchantId, s.welcomeDrops, 'welcome', { note: 'Welcome drops from TIN' });
}

// Spend credits for a new drop. Returns the new balance, or null if there are not enough.
export async function spendCredits(env, merchantId, quantity, dropRef) {
  return changeCredits(env, merchantId, -quantity, 'drop', { ref: dropRef });
}

export async function creditsInfo(env, merchantId, limit = 20) {
  const m = await env.DB.prepare('SELECT drop_credits FROM merchants WHERE id = ?').bind(merchantId).first();
  const { results } = await env.DB.prepare('SELECT delta, reason, note, created_at FROM merchant_drop_ledger WHERE merchant_id = ? ORDER BY id DESC LIMIT ?').bind(merchantId, limit).all();
  const s = await getSettings(env.DB);
  return { balance: m?.drop_credits ?? 0, ledger: results, dropPrice: s.dropPrice, packs: s.dropPacks, payments: stripeEnabled(env) ? 'stripe' : 'off' };
}

function merchantIdOf(user, url) {
  requireRole(user, 'merchant', 'admin');
  if (user.role === 'merchant') return user.merchant_id;
  const id = Number(url.searchParams.get('merchant'));
  if (!Number.isInteger(id) || id < 1) bad('Pick a merchant first');
  return id;
}

// GET /api/merchant/credits
export async function myDropCredits(req, env, user) {
  return json(await creditsInfo(env, merchantIdOf(user, new URL(req.url))));
}

// POST /api/merchant/credits/checkout  { pack: index } or { drops: n }
export async function buyCredits(req, env, user) {
  const url = new URL(req.url);
  const mid = merchantIdOf(user, url);
  if (!stripeEnabled(env)) bad('Online payment is not switched on yet. Please contact TIN.');
  const m = await env.DB.prepare('SELECT id, name, contact_email, status FROM merchants WHERE id = ?').bind(mid).first();
  if (!m) bad('Merchant not found', 404);
  const b = await body(req, 2_000);
  const s = await getSettings(env.DB);
  let drops, usd, label;
  if (b.pack !== undefined && b.pack !== null) {
    const p = s.dropPacks[num(b.pack, { min: 0, max: 20, int: true, name: 'Pack' })];
    if (!p) bad('That pack is no longer offered');
    ({ drops, usd } = p); label = `${drops} Treasure Drops pack`;
  } else {
    drops = num(b.drops, { min: 1, max: 10000, int: true, name: 'Number of drops' });
    usd = Math.round(drops * s.dropPrice * 100) / 100; label = `${drops} Treasure Drop${drops > 1 ? 's' : ''}`;
  }
  if (usd < MIN_CHARGE_USD) bad(`The minimum card payment is US$${MIN_CHARGE_USD.toFixed(2)}. Please buy a few more drops.`);
  const p = await env.DB.prepare('INSERT INTO credit_purchases(merchant_id, drops, amount_usd) VALUES (?,?,?) RETURNING id').bind(mid, drops, usd).first();
  const origin = url.origin;
  const session = await stripe(env, '/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      client_reference_id: `credits:${p.id}`,
      customer_email: m.contact_email || undefined,
      line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(usd * 100),
        product_data: { name: label, description: `TIN Treasure Hunt drop credits for ${m.name}` } } } },
      metadata: { purchase_id: p.id, merchant_id: mid, drops },
      payment_intent_data: { metadata: { purchase_id: p.id, merchant_id: mid, drops } },
      success_url: `${origin}/app?credits={CHECKOUT_SESSION_ID}${user.role === 'admin' ? `&merchant=${mid}` : ''}`,
      cancel_url: `${origin}/app?credits_cancel=1`,
    },
  });
  await env.DB.prepare('UPDATE credit_purchases SET stripe_session_id = ? WHERE id = ?').bind(session.id, p.id).run();
  return json({ checkoutUrl: session.url, drops, usd });
}

// Mark a purchase paid and add the drops, exactly once (webhook and return page may both call this).
export async function markCreditsPaid(env, sessionId, paymentIntent) {
  const row = await env.DB.prepare(`UPDATE credit_purchases SET status = 'paid', paid_at = ?, stripe_payment_intent = ?
      WHERE stripe_session_id = ? AND status != 'paid' RETURNING id, merchant_id, drops, amount_usd`).bind(nowIso(), paymentIntent || null, sessionId).first();
  if (row) await changeCredits(env, row.merchant_id, row.drops, 'purchase', { ref: `purchase:${row.id}`, note: `Bought ${row.drops} drops for US$${row.amount_usd}` });
  return row;
}

// GET /api/merchant/credits/checkout/:sessionId  (merchant returns from Stripe)
export async function verifyCreditsCheckout(req, env, user, sessionId) {
  const mid = merchantIdOf(user, new URL(req.url));
  if (!stripeEnabled(env)) bad('Online payment is not switched on', 400);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) bad('Invalid session');
  const p = await env.DB.prepare('SELECT merchant_id, drops FROM credit_purchases WHERE stripe_session_id = ?').bind(sessionId).first();
  if (!p || p.merchant_id !== mid) bad('Not found', 404);
  const s = await stripe(env, `/checkout/sessions/${sessionId}`);
  if (s.payment_status === 'paid') await markCreditsPaid(env, sessionId, s.payment_intent);
  const m = await env.DB.prepare('SELECT drop_credits FROM merchants WHERE id = ?').bind(mid).first();
  return json({ paid: s.payment_status === 'paid', drops: p.drops, balance: m?.drop_credits ?? 0 });
}

// POST /api/admin/merchants/:id/credits  { drops, note }   (negative drops take credits away)
export async function adminGiveCredits(req, env, user, id) {
  requireRole(user, 'admin');
  const b = await body(req, 2_000);
  const drops = num(b.drops, { min: -100000, max: 100000, int: true, name: 'Drops' });
  if (!drops) bad('Enter a number of drops');
  const note = b.note ? str(b.note, { max: 200, name: 'Note' }) : null;
  const bal = await changeCredits(env, id, drops, drops > 0 ? 'gift' : 'adjust', { note, by: user.id });
  if (bal === null) bad(drops < 0 ? 'That would take the balance below zero' : 'Merchant not found', drops < 0 ? 400 : 404);
  return json({ balance: bal });
}
