// TIN Treasure Hunt — Cloudflare Worker entry point.
import { HttpError, json, lastRaffleAt } from './lib.js';
import { register, login, logout, currentUser, publicUser, requireRole, tinSso } from './auth.js';
import * as H from './hunt.js';
import { askPolly, pollyTip } from './polly.js';
import { runRaffle, raffleStatus, raffleDrawNow } from './raffle.js';
import { payDrop, verifyCheckout, stripeWebhook } from './payments.js';
import { syncTinMerchants, adminSyncTin, publicSyncTin } from './tin-sync.js';
import { merchantSummary } from './tin-link.js';
import * as G from './grand.js';
import { adNetworkVideos, adNetworkView } from './ad-network.js';
import { myDropCredits, buyCredits, verifyCreditsCheckout, adminGiveCredits } from './credits.js';
import { getShield, saveShield, shieldCheck, listMessages, actOnMessage } from './shield.js';

const routes = [
  ['POST', /^\/api\/auth\/register$/, (r, e) => register(r, e)],
  ['POST', /^\/api\/auth\/login$/, (r, e) => login(r, e)],
  ['POST', /^\/api\/auth\/logout$/, (r, e) => logout(r, e)],
  ['GET', /^\/api\/me$/, async (r, e, u) => json({ user: publicUser(u) })],

  ['GET', /^\/api\/destinations\/([a-z0-9-]+)$/, (r, e, u, id) => H.getDestination(r, e, id)],
  ['GET', /^\/api\/drops$/, (r, e, u) => H.listDrops(r, e, u)],
  ['GET', /^\/api\/drops\/(\d+)$/, (r, e, u, id) => H.getDrop(r, e, u, Number(id))],
  ['GET', /^\/api\/drops\/(\d+)\/photo$/, (r, e, u, id) => H.dropPhoto(r, e, Number(id))],
  ['GET', /^\/api\/drops\/(\d+)\/photos\/(\d)$/, (r, e, u, id, n) => H.dropPhoto(r, e, Number(id), Number(n))],
  ['GET', /^\/api\/merchants\/(\d+)\/logo$/, (r, e, u, id) => H.merchantLogo(r, e, Number(id))],
  ['PATCH', /^\/api\/merchant\/me$/, (r, e, u) => H.updateMerchantProfile(r, e, u)],
  ['POST', /^\/api\/drops\/(\d+)\/claim$/, (r, e, u, id) => H.claimDrop(r, e, u, Number(id))],
  ['DELETE', /^\/api\/drops\/(\d+)\/claim$/, (r, e, u, id) => H.cancelClaim(r, e, u, Number(id))],
  ['GET', /^\/api\/me\/claims$/, (r, e, u) => H.myClaims(r, e, u)],
  ['GET', /^\/api\/me\/credits$/, (r, e, u) => H.myCredits(r, e, u)],
  ['POST', /^\/api\/redemptions\/(\d+)\/rating$/, (r, e, u, id) => H.rateRedemption(r, e, u, Number(id))],
  ['POST', /^\/api\/polly$/, (r, e, u) => askPolly(r, e, u)],
  ['GET', /^\/api\/polly\/tip$/, (r, e, u) => pollyTip(r, e, u)],

  ['POST', /^\/api\/merchant\/apply$/, (r, e, u) => H.applyMerchant(r, e, u)],
  ['GET', /^\/api\/merchant\/me$/, (r, e, u) => H.merchantMe(r, e, u)],
  ['GET', /^\/api\/merchant\/drops$/, (r, e, u) => H.merchantDrops(r, e, u)],
  ['POST', /^\/api\/merchant\/drops$/, (r, e, u) => H.createDrop(r, e, u)],
  ['PATCH', /^\/api\/merchant\/drops\/(\d+)$/, (r, e, u, id) => H.updateDrop(r, e, u, Number(id))],
  ['POST', /^\/api\/merchant\/drops\/(\d+)\/pay$/, (r, e, u, id) => payDrop(r, e, u, Number(id))],
  ['GET', /^\/api\/merchant\/checkout\/([A-Za-z0-9_]+)$/, (r, e, u, sid) => verifyCheckout(r, e, u, sid)],
  ['POST', /^\/api\/stripe\/webhook$/, (r, e) => stripeWebhook(r, e)],
  ['GET', /^\/api\/merchant\/credits$/, (r, e, u) => myDropCredits(r, e, u)],
  ['POST', /^\/api\/merchant\/credits\/checkout$/, (r, e, u) => buyCredits(r, e, u)],
  ['GET', /^\/api\/merchant\/credits\/checkout\/([A-Za-z0-9_]+)$/, (r, e, u, sid) => verifyCreditsCheckout(r, e, u, sid)],
  ['POST', /^\/api\/admin\/merchants\/(\d+)\/credits$/, (r, e, u, id) => adminGiveCredits(r, e, u, Number(id))],
  ['GET', /^\/api\/merchant\/shield$/, (r, e, u) => getShield(r, e, u)],
  ['PUT', /^\/api\/merchant\/shield$/, (r, e, u) => saveShield(r, e, u)],
  ['GET', /^\/api\/merchant\/shield-check$/, (r, e, u) => shieldCheck(r, e, u)],
  ['GET', /^\/api\/merchant\/messages$/, (r, e, u) => listMessages(r, e, u)],
  ['POST', /^\/api\/merchant\/messages\/(\d+)\/act$/, (r, e, u, id) => actOnMessage(r, e, u, Number(id))],
  ['GET', /^\/api\/grand$/, (r, e, u) => G.getGrand(r, e, u)],
  ['POST', /^\/api\/grand\/claim$/, (r, e, u) => G.claimGrand(r, e, u)],
  ['GET', /^\/api\/videos$/, (r, e, u) => G.nextVideos(r, e, u)],
  ['POST', /^\/api\/videos\/(\d+)\/start$/, (r, e, u, id) => G.startVideo(r, e, u, Number(id))],
  ['POST', /^\/api\/videos\/(\d+)\/complete$/, (r, e, u, id) => G.completeVideo(r, e, u, Number(id))],
  ['POST', /^\/api\/videos\/(\d+)\/click$/, (r, e, u, id) => G.clickVideo(r, e, u, Number(id))],
  ['GET', /^\/api\/merchant\/videos$/, (r, e, u) => G.merchantVideos(r, e, u)],
  ['POST', /^\/api\/merchant\/videos$/, (r, e, u) => G.addMerchantVideo(r, e, u)],
  ['PATCH', /^\/api\/merchant\/videos\/(\d+)$/, (r, e, u, id) => G.updateMerchantVideo(r, e, u, Number(id))],
  ['POST', /^\/api\/merchant\/video-budget\/checkout$/, (r, e, u) => G.buyVideoBudget(r, e, u)],
  ['GET', /^\/api\/merchant\/video-budget\/checkout\/([A-Za-z0-9_]+)$/, (r, e, u, sid) => G.verifyVideoBudget(r, e, u, sid)],
  ['POST', /^\/api\/admin\/merchants\/(\d+)\/video-budget$/, (r, e, u, id) => G.adminGiveVideoBudget(r, e, u, Number(id))],
  ['GET', /^\/api\/admin\/videos$/, (r, e, u) => G.adminVideos(r, e, u)],
  ['POST', /^\/api\/admin\/videos$/, (r, e, u) => G.adminAddVideo(r, e, u)],
  ['PATCH', /^\/api\/admin\/videos\/(\d+)$/, (r, e, u, id) => G.adminUpdateVideo(r, e, u, Number(id))],
  ['GET', /^\/api\/admin\/grand$/, (r, e, u) => G.adminGrand(r, e, u)],
  ['POST', /^\/api\/admin\/grand$/, (r, e, u) => G.adminCreateGrand(r, e, u)],
  ['PATCH', /^\/api\/admin\/grand\/(\d+)$/, (r, e, u, id) => G.adminUpdateGrand(r, e, u, Number(id))],
  ['POST', /^\/api\/merchant\/lookup$/, (r, e, u) => H.lookupCode(r, e, u)],
  ['POST', /^\/api\/merchant\/confirm$/, (r, e, u) => H.confirmRedemption(r, e, u)],
  ['GET', /^\/api\/merchant\/stats$/, (r, e, u) => H.merchantStats(r, e, u)],
  ['GET', /^\/api\/redemptions\/(\d+)\/proof$/, (r, e, u, id) => H.adminProof(r, e, u, Number(id))],

  ['GET', /^\/api\/admin\/overview$/, (r, e, u) => H.adminOverview(r, e, u)],
  ['GET', /^\/api\/admin\/merchants$/, (r, e, u) => H.adminMerchants(r, e, u)],
  ['POST', /^\/api\/admin\/merchants$/, (r, e, u) => H.adminCreateMerchant(r, e, u)],
  ['POST', /^\/api\/admin\/merchants\/import$/, (r, e, u) => H.adminImportMerchants(r, e, u)],
  ['PATCH', /^\/api\/admin\/merchants\/(\d+)$/, (r, e, u, id) => H.adminUpdateMerchant(r, e, u, Number(id))],
  ['GET', /^\/api\/admin\/drops$/, (r, e, u) => H.adminDrops(r, e, u)],
  ['GET', /^\/api\/admin\/hunts$/, (r, e, u) => H.adminHunts(r, e, u)],
  ['POST', /^\/api\/admin\/hunts$/, (r, e, u) => H.adminHunts(r, e, u)],
  ['PATCH', /^\/api\/admin\/hunts\/(\d+)$/, (r, e, u, id) => H.adminUpdateHunt(r, e, u, Number(id))],
  ['GET', /^\/api\/admin\/settings$/, (r, e, u) => H.adminSettings(r, e, u)],
  ['PUT', /^\/api\/admin\/settings$/, (r, e, u) => H.adminSettings(r, e, u)],
  ['GET', /^\/api\/admin\/raffle$/, (r, e, u) => raffleStatus(r, e, u)],
  ['POST', /^\/api\/admin\/raffle\/draw$/, (r, e, u) => raffleDrawNow(r, e, u)],
  ['POST', /^\/api\/admin\/sync-tin$/, (r, e, u) => adminSyncTin(r, e, u)],
  ['POST', /^\/api\/tin-sync$/, (r, e) => publicSyncTin(r, e)],
  ['GET', /^\/api\/ad-network\/videos$/, (r, e) => adNetworkVideos(r, e)],
  ['POST', /^\/api\/ad-network\/view$/, (r, e) => adNetworkView(r, e)],
  ['POST', /^\/api\/tin\/merchant-summary$/, (r, e) => merchantSummary(r, e)],
];

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(self), camera=(self)',
};

function withHeaders(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!h.has(k)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function handleApi(req, env, url) {
  // Basic CSRF guard for cookie-authenticated writes.
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'Cross-site request blocked' }, 403);
  }
  for (const [method, re, fn] of routes) {
    const m = url.pathname.match(re);
    if (m && method === req.method) {
      const user = await currentUser(req, env);
      return fn(req, env, user, ...m.slice(1));
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return withHeaders(await handleApi(req, env, url));
      if (url.pathname === '/sso' && req.method === 'GET') return withHeaders(await tinSso(req, env, url));
      // Per-destination landing page (same login, same tin_users table).
      if (/^\/(cozumel)\/?$/.test(url.pathname)) {
        return withHeaders(await env.ASSETS.fetch(new Request(new URL('/destination', url), req)));
      }
      return withHeaders(await env.ASSETS.fetch(req));
    } catch (e) {
      if (e instanceof HttpError) return withHeaders(json({ error: e.message }, e.status));
      console.error(e);
      return withHeaders(json({ error: 'Something went wrong. Please try again.' }, 500));
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 14 * * SUN') {
      ctx.waitUntil(runRaffle(env, "cron", lastRaffleAt(new Date(event.scheduledTime + 60000))).then((r) => console.log('raffle', JSON.stringify(r))));
    } else {
      ctx.waitUntil(H.expireClaims(env).then((n) => n && console.log('expired claims', n)));
      ctx.waitUntil(syncTinMerchants(env).then((r) => console.log('tin sync', JSON.stringify(r))).catch((e) => console.error('tin sync', e.message)));
    }
  },
};

export { requireRole };
