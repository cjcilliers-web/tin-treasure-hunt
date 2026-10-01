// Shared helpers for the Treasure Hunt worker.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

export async function body(req, maxBytes = 400_000) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) bad('Request too large', 413);
  const text = await req.text();
  if (text.length > maxBytes) bad('Request too large', 413);
  try { return text ? JSON.parse(text) : {}; } catch { bad('Invalid JSON'); }
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const addHours = (h, from = Date.now()) => new Date(from + h * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function str(v, { min = 0, max = 200, name = 'field' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) bad(min > 1 ? `${name} must be at least ${min} characters` : `${name} is required`);
  if (s.length > max) bad(`${name} is too long (max ${max})`);
  return s;
}

export function num(v, { min = -Infinity, max = Infinity, name = 'number', int = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) bad(`${name} is out of range`);
  return n;
}

export function oneOf(v, list, name) {
  if (!list.includes(v)) bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}

// Great-circle distance in metres.
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371e3, t = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * t / 2) ** 2 +
    Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin((lng2 - lng1) * t / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// Walking minutes at ~4.8 km/h with a 1.3 street-grid factor.
export const walkMin = (m) => Math.max(1, Math.round((m * 1.3) / 80));

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len = 6) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    creditsPerFind: Number(s.credits_per_find ?? 10),
    rafflePrize: Number(s.raffle_prize_credits ?? 500),
    dropPrice: Number(s.drop_price_usd ?? 1),
    claimHours: Number(s.claim_hours ?? 24),
    claimRadius: Number(s.claim_radius_m ?? 10),
  };
}

export const CATEGORIES = ['Food', 'Drink', 'Dessert', 'Adventure', 'Shopping', 'Mystery'];
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

// Next Sunday 14:00 UTC strictly after `from`.
export function nextRaffleAt(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 14, 0, 0));
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  if (d <= from) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}
// Most recent Sunday 14:00 UTC at or before `from`.
export function lastRaffleAt(from = new Date()) {
  const n = nextRaffleAt(from);
  n.setUTCDate(n.getUTCDate() - 7);
  return n;
}
export const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
