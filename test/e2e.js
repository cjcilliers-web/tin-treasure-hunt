// End-to-end test of the full Treasure Hunt loop against `wrangler dev` on :8787.
// Run: npm run dev (other terminal), then: node test/e2e.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = process.env.OUT || 'test/shots';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now();
const errors = [];
const ok = (cond, msg) => { if (!cond) { errors.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };

(async () => {
  const b = await chromium.launch();
  const ctx = (w = 1280, h = 900) => b.newContext({ viewport: { width: w, height: h }, geolocation: { latitude: 20.5090, longitude: -86.9490 }, permissions: ['geolocation'] });
  const watch = (p, name) => { p.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`)); };

  // 1) Admin (email listed in ADMIN_EMAILS) signs up on the homepage.
  const A = await (await ctx()).newPage(); watch(A, 'admin');
  await A.goto(BASE + '/');
  await A.click('#sw');
  await A.fill('[name=name]', 'Christiaan Cilliers');
  await A.fill('[name=email]', process.env.ADMIN_EMAIL || 'cjcilliers@gmail.com');
  await A.fill('[name=password]', 'Treasure#2026');
  await A.click('#lf button');
  await Promise.race([A.waitForURL(/\/app/), A.waitForSelector('#le:has-text("already exists")')]);
  if (!/\/app/.test(A.url())) { // re-run against the same database: sign in instead
    await A.click('#sw'); await A.fill('[name=email]', process.env.ADMIN_EMAIL || 'cjcilliers@gmail.com'); await A.fill('[name=password]', 'Treasure#2026');
    await A.click('#lf button'); await A.waitForURL(/\/app/);
  }
  await A.waitForSelector('#viewsw:not([hidden])');
  ok(await A.locator('[data-mode="hq"]').isVisible(), 'admin sees TIN HQ switch');

  // 2) Explorer signs up from the Cozumel page (second login surface).
  const T = await (await ctx(390, 844)).newPage(); watch(T, 'explorer');
  await T.goto(BASE + '/cozumel');
  await T.waitForSelector('#counts .tt');
  await T.screenshot({ path: `${OUT}/01-cozumel-page.png` });
  await T.click('#sw');
  await T.fill('[name=name]', 'Laura Martinez');
  await T.fill('[name=email]', `laura+${stamp}@example.com`);
  await T.fill('[name=password]', 'explorer123');
  await T.click('#lf button');
  await T.waitForURL(/\/app/);
  await T.waitForSelector('.drop');
  await T.waitForTimeout(600);
  await T.screenshot({ path: `${OUT}/02-hunt.png` });
  ok((await T.locator('.drop').count()) >= 5, 'explorer sees live treasures');
  await T.waitForSelector('#tip:not([hidden])');
  ok(true, `Polly tip shows: ${(await T.locator('#tip').innerText()).split('\n')[0].slice(0, 70)}`);

  // Detail -> claim -> QR
  await T.click('.drop >> nth=0');
  await T.waitForSelector('#claim');
  const title = await T.locator('.hero h2').innerText();
  await T.screenshot({ path: `${OUT}/03-detail.png` });
  await T.click('#claim');
  await T.waitForSelector('.qrcard .code');
  const code = (await T.locator('.qrcard .code').innerText()).trim();
  await T.screenshot({ path: `${OUT}/04-qr.png` });
  ok(/^[A-Z0-9]{6}$/.test(code), `claim code issued (${code}) for ${title}`);
  const credBefore = await T.locator('#credBtn').innerText();
  ok(credBefore.includes('0'), 'no credits before confirmation');

  // 3) Admin runs the merchant counter for that treasure's merchant.
  const dropMerchant = await T.evaluate(async () => (await fetch('/api/me/claims').then((x) => x.json())).claims[0].merchant);
  await A.click('[data-mode="merchant"]');
  await A.locator('.pending button').filter({ has: A.locator('span', { hasText: new RegExp(`^${dropMerchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
  await A.waitForSelector('#code');
  await A.fill('#code', 'ZZZZZZ'); await A.click('#cf button');
  await A.waitForSelector('#er:has-text("not found")');
  ok(true, 'bad code rejected');
  await A.fill('#code', code.toLowerCase()); await A.click('#cf button');
  await A.waitForSelector('canvas.sig', { timeout: 8000 }).catch(async (e) => { await A.screenshot({ path: `${OUT}/fail.png` }); throw e; });
  await A.click('#fin');
  ok(await A.locator('#per:has-text("signature")').count() === 1, 'cannot confirm without a signature');
  const cb = await A.locator('canvas.sig').boundingBox();
  await A.mouse.move(cb.x + 30, cb.y + 60); await A.mouse.down();
  for (let i = 0; i < 14; i++) await A.mouse.move(cb.x + 30 + i * 18, cb.y + 60 + (i % 2 ? 30 : -15));
  await A.mouse.up();
  await A.screenshot({ path: `${OUT}/05-merchant-proof.png` });
  await A.click('#fin');
  await A.waitForSelector('text=earned');
  ok(true, 'merchant confirmed redemption with signature');
  await A.click('#nx');

  // Code cannot be reused.
  await A.fill('#code', code); await A.click('#cf button');
  await A.waitForSelector('#er:has-text("already redeemed")');
  ok(true, 'code cannot be redeemed twice');

  // 4) Explorer sees the celebration, credits, rates the visit.
  await T.waitForSelector('#ok2', { timeout: 10000 });
  await T.screenshot({ path: `${OUT}/06-found.png` });
  await T.click('#ok2');
  await T.waitForSelector('.scale');
  for (const k of ['ease', 'speed', 'overall']) await T.click(`.scale[data-k="${k}"] button[data-n="9"]`);
  await T.fill('#cm', 'Delicious and super quick!');
  await T.screenshot({ path: `${OUT}/07-rate.png` });
  await T.click('#send');
  await T.waitForSelector('.drop');
  ok((await T.locator('#credBtn').innerText()).includes('10'), 'explorer has 10 credits after confirmation');

  // 5) Polly
  await T.click('[data-go="polly"]');
  await T.click('[data-s="Make today\'s hunt last one hour"]');
  await T.waitForSelector('.msg.p .mini b');
  await T.waitForTimeout(300);
  await T.screenshot({ path: `${OUT}/08-polly-hour.png` });
  ok(await T.locator('.msg.p:has-text("1-hour hunt")').count() === 1, 'Polly builds a one-hour route');
  await T.fill('#q', 'Tengo niños, ¿qué hay de comida?');
  await T.click('#askf button');
  await T.waitForTimeout(800);
  ok(await T.locator('.msg.p >> text=/Encontré|No encontré/').count() >= 1, 'Polly answers in Spanish');
  await T.fill('#q', 'How many credits do I have?');
  await T.click('#askf button');
  await T.waitForSelector('.msg.p:has-text("10 Treasure Hunt credits")');
  ok(true, 'Polly knows the credit balance');
  await T.fill('#q', 'Olá! Tenho crianças, o que há perto?');
  await T.click('#askf button');
  await T.waitForTimeout(800);
  ok(await T.locator('.msg.p >> text=/Encontrei|Não encontrei/').count() >= 1, 'Polly answers in Portuguese');
  await T.fill('#q', 'Bonjour, je veux une glace');
  await T.click('#askf button');
  await T.waitForTimeout(800);
  ok(await T.locator('.msg.p >> text=/J\'ai trouvé|Je n\'ai trouvé/').count() >= 1, 'Polly answers in French');
  await T.screenshot({ path: `${OUT}/09-polly.png` });

  // Wallet
  await T.click('[data-go="wallet"]');
  await T.waitForSelector('.bal');
  await T.screenshot({ path: `${OUT}/10-wallet.png` });

  // 6) A business owner applies; HQ approves; they create a treasure; HQ approves it.
  const M = await (await ctx(390, 844)).newPage(); watch(M, 'merchant');
  await M.goto(BASE + '/cozumel'); await M.click('#sw');
  await M.fill('[name=name]', 'Rosa Pérez'); await M.fill('[name=email]', `rosa+${stamp}@example.com`); await M.fill('[name=password]', 'merchant123');
  await M.click('#lf button'); await M.waitForURL(/\/app/); await M.waitForSelector('.drop');
  await M.click('[data-go="wallet"]'); await M.click('#biz');
  await M.fill('#bn', `Shrimp Shack ${stamp % 1000}`); await M.fill('#bc', 'Restaurant'); await M.fill('#bh', '12:00–21:00');
  await M.click('#f button'); await M.waitForSelector('text=Application sent');
  ok(true, 'merchant application sent');

  await A.click('[data-mode="hq"]'); await A.click('[data-t="merchants"]');
  await A.click(`tr:has-text("Shrimp Shack ${stamp % 1000}") >> text=Approve`);
  await A.waitForTimeout(500);
  await M.goto(BASE + '/app'); await M.waitForSelector('#viewsw:not([hidden])');
  await M.click('[data-mode="merchant"]'); await M.click('[data-go="mList"]'); await M.click('#nd');
  await M.fill('#tn', `The Shrimp Shack Secret ${stamp % 1000}`); await M.fill('#it', 'Free shrimp taco');
  await M.fill('#cl', 'Where the fishermen tie up at dawn, a taco waits for the first brave explorer.');
  await M.fill('#qt', '15');
  await M.screenshot({ path: `${OUT}/11-merchant-create.png` });
  ok(await M.locator('text=Secure payment by Stripe').count() === 1, 'Stripe payment note shown');
  await M.click('#f button[type=submit]');
  await M.waitForURL(/localhost:8799\/pay/);
  ok((await M.locator('body').innerText()).includes('$15.00'), 'Stripe checkout for $15 (15 drops × $1)');
  await M.click('#paybtn');
  await M.waitForURL(/localhost:8787\/app/);
  await M.waitForSelector('text=Payment received');
  await M.waitForSelector('.pill.pending');
  ok(await M.locator('text=💳 Paid').count() === 1, 'merchant paid via Stripe; treasure waiting for HQ');
  await M.screenshot({ path: `${OUT}/11b-merchant-paid.png` });

  await A.click('[data-t="drops"]');
  await A.click(`tr:has-text("The Shrimp Shack Secret ${stamp % 1000}") >> text=Approve`);
  await A.waitForTimeout(600);
  await T.click('[data-go="hunt"]');
  await T.click('#rad'); // no-op focus
  await T.waitForSelector('.drop');
  ok(await T.locator(`.drop:has-text("The Shrimp Shack Secret ${stamp % 1000}")`).count() === 1, 'approved treasure visible to explorers');

  // Webhook signature check
  const wh = await T.evaluate(() => fetch('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad' }, body: '{}' }).then((r) => r.status));
  ok(wh === 400, 'webhook rejects bad signatures');

  // Merchant import (paste from Excel)
  await A.click('[data-t="merchants"]');
  await A.fill('#imt', `Name\tCategory\tAddress\tLatitude\tLongitude\tEmail\nPunta Sur Snorkel ${stamp % 1000}\tTours\tCarretera Sur km 27\t20.2990\t-86.9920\t\nMercado Maya ${stamp % 1000}\tCrafts\tAv. Rafael Melgar 5\t\t\tmaya@example.com\nEl Faro Tacos\tRestaurant\t\t20.51\t-86.94\t`);
  await A.waitForSelector('#imgo');
  await A.screenshot({ path: `${OUT}/15-hq-import.png`, fullPage: true });
  await A.click('#imgo');
  await A.waitForSelector('text=Imported 2 merchants, skipped 1, 1 need GPS');
  ok(true, 'import: 2 added, duplicate skipped, 1 flagged for GPS');
  await A.waitForSelector(`tr:has-text("Mercado Maya ${stamp % 1000}") [data-loc]`);
  A.once('dialog', (d) => d.accept('20.5101, -86.9477'));
  await A.click(`tr:has-text("Mercado Maya ${stamp % 1000}") [data-loc]`);
  await A.waitForSelector('text=Location saved');
  ok(true, 'HQ fixed a missing GPS location');

  // 7) HQ screens
  await A.click('[data-t="overview"]'); await A.waitForSelector('.kpi'); await A.waitForTimeout(300);
  await A.screenshot({ path: `${OUT}/12-hq-overview.png`, fullPage: true });
  await A.click('[data-t="hunts"]'); await A.waitForSelector('table');
  await A.screenshot({ path: `${OUT}/13-hq-hunts.png`, fullPage: true });
  await A.click('[data-t="raffle"]'); await A.waitForSelector('#drum');
  await A.screenshot({ path: `${OUT}/14-hq-raffle.png`, fullPage: true });

  // 8) Security spot-checks
  const anon = await (await ctx()).newPage();
  await anon.goto(BASE + '/');
  const r1 = await anon.evaluate(() => fetch('/api/admin/overview').then((r) => r.status));
  ok(r1 === 401, 'admin API requires sign-in');
  const r2 = await T.evaluate(() => fetch('/api/admin/overview').then((r) => r.status));
  ok(r2 === 403, 'explorer cannot open admin API');
  const r3 = await T.evaluate(() => fetch('/api/merchant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status));
  ok(r3 === 403, 'explorer cannot confirm redemptions');

  console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nALL PASSED');
  await b.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
