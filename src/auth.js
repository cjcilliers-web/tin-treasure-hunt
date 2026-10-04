// Phase 1 — login foundation.
// PBKDF2-SHA256 at 100,000 iterations: the Cloudflare Workers ceiling.
// Do NOT raise this (210,000 fails on Workers).
import { bad, body, json, str, nowIso, addHours } from './lib.js';

export const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const COOKIE = 'tin_session';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Math.min(iterations, PBKDF2_ITERATIONS) }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: b64(hash), salt: b64(salt), iter: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password, row) {
  const got = new Uint8Array(await pbkdf2(password, unb64(row.password_salt), row.password_iter));
  const want = unb64(row.password_hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

async function sha256(s) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

function cookieHeader(token, req, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function startSession(env, req, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO tin_user_sessions(token_hash, user_id, expires_at, user_agent) VALUES (?,?,?,?)')
      .bind(await sha256(token), userId, addHours(SESSION_DAYS * 24), (req.headers.get('user-agent') || '').slice(0, 200)),
    env.DB.prepare('UPDATE tin_users SET last_login_at = ? WHERE id = ?').bind(nowIso(), userId),
  ]);
  return cookieHeader(token, req, SESSION_DAYS * 86400);
}

export async function currentUser(req, env) {
  const token = readCookie(req);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.merchant_id, u.language, u.home_destination
       FROM tin_user_sessions s JOIN tin_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(await sha256(token), nowIso()).first();
}

export function publicUser(u) {
  return u && { id: u.id, email: u.email, name: u.display_name, role: u.role, merchantId: u.merchant_id, language: u.language, destination: u.home_destination };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register(req, env) {
  const b = await body(req, 10_000);
  const email = str(b.email, { min: 3, max: 200, name: 'Email' }).toLowerCase();
  if (!EMAIL_RE.test(email)) bad('Please enter a valid email');
  const name = str(b.name, { min: 1, max: 80, name: 'Name' });
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) bad('Password must be at least 8 characters');
  if (password.length > 200) bad('Password is too long');
  const language = ['en', 'es', 'pt', 'fr', 'de'].includes(b.language) ? b.language : 'en';
  const destination = typeof b.destination === 'string' ? b.destination : null;

  const exists = await env.DB.prepare('SELECT 1 FROM tin_users WHERE email = ?').bind(email).first();
  if (exists) bad('An account with this email already exists. Please sign in.', 409);

  const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const role = admins.includes(email) ? 'admin' : 'traveler';
  const { hash, salt, iter } = await hashPassword(password);
  const dest = destination && (await env.DB.prepare('SELECT id FROM destinations WHERE id = ?').bind(destination).first());
  const row = await env.DB.prepare(
    `INSERT INTO tin_users(email, display_name, password_hash, password_salt, password_iter, role, language, home_destination)
     VALUES (?,?,?,?,?,?,?,?) RETURNING id, email, display_name, role, merchant_id, language, home_destination`
  ).bind(email, name, hash, salt, iter, role, language, dest ? dest.id : null).first();
  await env.DB.prepare('INSERT OR IGNORE INTO treasure_hunt_credits(user_id, balance) VALUES (?, 0)').bind(row.id).run();
  const cookie = await startSession(env, req, row.id);
  return json({ user: publicUser(row) }, 201, { 'set-cookie': cookie });
}

export async function login(req, env) {
  const b = await body(req, 10_000);
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const row = await env.DB.prepare('SELECT * FROM tin_users WHERE email = ?').bind(email).first();
  // Same message either way so emails can't be probed.
  if (!row || !(await verifyPassword(password, row))) bad('Email or password is incorrect', 401);
  const cookie = await startSession(env, req, row.id);
  return json({ user: publicUser(row) }, 200, { 'set-cookie': cookie });
}

export async function logout(req, env) {
  const token = readCookie(req);
  if (token) await env.DB.prepare('DELETE FROM tin_user_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', req, 0) });
}

export function requireRole(user, ...roles) {
  if (!user) bad('Please sign in', 401);
  if (roles.length && !roles.includes(user.role)) bad('Not allowed', 403);
  return user;
}

// GET /sso?ticket=…  — single sign-on from the TIN User cockpit (tincommerce.com).
// The ticket is one-time and short-lived; TIN confirms it server-to-server and returns the
// verified email. The explorer is signed in here (account created on first visit) and sent to /app.
export async function tinSso(req, env, url) {
  const home = (q = '') => new Response(null, { status: 302, headers: { location: `/app${q}`, 'cache-control': 'no-store' } });
  const ticket = url.searchParams.get('ticket') || '';
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(ticket)) return home();
  const base = String(env.TIN_COMMERCE_URL || 'https://tincommerce.com').replace(/\/$/, '');
  let who;
  try {
    const res = await fetch(`${base}/api/treasure-hunt-sso/verify`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ticket }) });
    if (!res.ok) return home('?sso=expired');
    who = await res.json();
  } catch { return home('?sso=expired'); }
  const email = String(who?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return home('?sso=expired');
  let row = await env.DB.prepare('SELECT id FROM tin_users WHERE email = ?').bind(email).first();
  if (!row) {
    const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    // No password is known here; a random one is stored so the account can only be entered via TIN.
    const { hash, salt, iter } = await hashPassword(b64(crypto.getRandomValues(new Uint8Array(24))));
    const name = String(who?.name || email.split('@')[0]).slice(0, 80) || 'Explorer';
    row = await env.DB.prepare(
      `INSERT INTO tin_users(email, display_name, password_hash, password_salt, password_iter, role, home_destination)
       VALUES (?,?,?,?,?,?,?) RETURNING id`
    ).bind(email, name, hash, salt, iter, admins.includes(email) ? 'admin' : 'traveler', 'cozumel').first();
    await env.DB.prepare('INSERT OR IGNORE INTO treasure_hunt_credits(user_id, balance) VALUES (?, 0)').bind(row.id).run();
  }
  const cookie = await startSession(env, req, row.id);
  return new Response(null, { status: 302, headers: { location: '/app', 'set-cookie': cookie, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
