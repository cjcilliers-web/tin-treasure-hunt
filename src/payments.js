// Stripe Checkout for Treasure Drop fees ($1 per drop by default).
// Works without the Stripe SDK: plain fetch + form encoding + HMAC webhook check.
// If STRIPE_SECRET_KEY is not set, drops fall back to 'invoice' (TIN bills later).
import { bad, json, nowIso } from './lib.js';
import { requireRole } from './auth.js';
import { markCreditsPaid } from './credits.js';

const STRIPE = 'https://api.stripe.com/v1';
// Accepts a full secret key (sk_) or, preferably, a restricted key (rk_) with Checkout Sessions: Write.
export const stripeEnabled = (env) => typeof env.STRIPE_SECRET_KEY === 'string' && /^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY);
// Pin the API version per request so the account's default version (kept old for TIN) is never touched.
const STRIPE_VERSION = '2024-06-20';

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${env.STRIPE_API_BASE || STRIPE}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'stripe-version': STRIPE_VERSION, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) { console.error('stripe', res.status, data?.error?.message); bad(`Payment service error: ${data?.error?.message || res.status}`, 502); }
  return data;
}

// Create a Checkout Session for a drop and remember it.
export async function startCheckout(env, req, drop, merchant) {
  const origin = new URL(req.url).origin;
  const unit = Math.round((drop.fee_usd / drop.quantity) * 100);
  const session = await stripe(env, '/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      client_reference_id: `drop:${drop.id}`,
      customer_email: merchant.contact_email || undefined,
      line_items: { 0: { quantity: drop.quantity, price_data: { currency: 'usd', unit_amount: unit,
        product_data: { name: `Treasure Drop: ${drop.title}`, description: `${drop.quantity} × ${drop.item} · ${merchant.name}` } } } },
      metadata: { drop_id: drop.id, merchant_id: merchant.id },
      payment_intent_data: { metadata: { drop_id: drop.id, merchant_id: merchant.id } },
      success_url: `${origin}/app?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app?unpaid=${drop.id}`,
    },
  });
  await env.DB.batch([
    env.DB.prepare('UPDATE treasure_drops SET stripe_session_id = ?, payment_status = ? WHERE id = ?').bind(session.id, 'unpaid', drop.id),
    env.DB.prepare('INSERT INTO payments(drop_id, merchant_id, amount_usd, stripe_session_id) VALUES (?,?,?,?)').bind(drop.id, merchant.id, drop.fee_usd, session.id),
  ]);
  return session.url;
}

async function markPaid(env, sessionId, paymentIntent) {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE payments SET status = 'paid', paid_at = ?, stripe_payment_intent = ? WHERE stripe_session_id = ? AND status != 'paid'`).bind(now, paymentIntent || null, sessionId),
    env.DB.prepare(`UPDATE treasure_drops SET payment_status = 'paid', paid_at = ? WHERE stripe_session_id = ? AND payment_status = 'unpaid'`).bind(now, sessionId),
  ]);
}

// Merchant: pay (or retry paying) for an unpaid drop.
export async function payDrop(req, env, user, dropId) {
  requireRole(user, 'merchant', 'admin');
  if (!stripeEnabled(env)) bad('Online payment is not switched on yet. TIN will invoice you.');
  const mid = user.role === 'merchant' ? user.merchant_id : Number(new URL(req.url).searchParams.get('merchant'));
  const d = await env.DB.prepare('SELECT * FROM treasure_drops WHERE id = ? AND merchant_id = ?').bind(dropId, mid).first();
  if (!d) bad('Treasure not found', 404);
  if (d.payment_status !== 'unpaid') bad('This treasure does not need payment');
  const m = await env.DB.prepare('SELECT * FROM merchants WHERE id = ?').bind(mid).first();
  return json({ checkoutUrl: await startCheckout(env, req, d, m) });
}

// Merchant returns from Checkout: confirm straight away (webhook may lag).
export async function verifyCheckout(req, env, user, sessionId) {
  requireRole(user, 'merchant', 'admin');
  if (!stripeEnabled(env)) bad('Online payment is not switched on', 400);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) bad('Invalid session');
  const d = await env.DB.prepare('SELECT id, merchant_id, title FROM treasure_drops WHERE stripe_session_id = ?').bind(sessionId).first();
  if (!d || (user.role === 'merchant' && d.merchant_id !== user.merchant_id)) bad('Not found', 404);
  const s = await stripe(env, `/checkout/sessions/${sessionId}`);
  if (s.payment_status === 'paid') await markPaid(env, sessionId, s.payment_intent);
  return json({ paid: s.payment_status === 'paid', pending: s.status === 'complete' && s.payment_status !== 'paid', title: d.title });
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Stripe → us. Verifies the Stripe-Signature header (5-minute tolerance).
export async function stripeWebhook(req, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook not configured' }, 400);
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const v1s = sig.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - t) > 300) return json({ error: 'Bad signature' }, 400);
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`);
  let match = false;
  for (const v of v1s) { if (v.length === expected.length) { let diff = 0; for (let i = 0; i < v.length; i++) diff |= v.charCodeAt(i) ^ expected.charCodeAt(i); if (!diff) match = true; } }
  if (!match) return json({ error: 'Bad signature' }, 400);

  const event = JSON.parse(payload);
  const s = event.data?.object || {};
  const isCredits = String(s.client_reference_id || '').startsWith('credits:');
  if ((event.type === 'checkout.session.completed' && s.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded') {
    if (isCredits) await markCreditsPaid(env, s.id, s.payment_intent); else await markPaid(env, s.id, s.payment_intent);
  } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const table = isCredits ? 'credit_purchases' : 'payments';
    await env.DB.prepare(`UPDATE ${table} SET status = 'expired' WHERE stripe_session_id = ? AND status = 'created'`).bind(s.id).run();
  }
  return json({ received: true });
}
