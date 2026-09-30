# TIN Treasure Hunt™

**Explore. Discover. Reward.** Don't collect coupons. Collect Adventures™.

This app lets merchants hide free Treasure Drops around a destination. Explorers find them by location or by asking Polly. They redeem them in person, and they earn Treasure Hunt Credits **only after the merchant confirms** the redemption with a photo or signature. Every verified find is also a ticket in the Sunday raffle.

The pilot destination is **Cozumel**.

## What's in the box

| Spec phase | Status | Where |
|---|---|---|
| 1. Login foundation | ✅ | `src/auth.js` has PBKDF2-SHA256 at **100,000** iterations (the Workers cap), HttpOnly session cookies and `tin_user_sessions`. There are two login surfaces: `/` (home) and `/cozumel` (destination). Both use the same `tin_users` table. |
| 2. Core Treasure Hunt | ✅ | `src/hunt.js` + `public/app.js`. Covers drops with a required story, a GPS distance filter (100 m / 1 km / 5 km / 10 km), map + list, category filters, the claim → QR code flow, and merchant scan (camera or typed code). Photo or signature is **required** to confirm. Credits are awarded on confirmation only, followed by the 1–10 ratings for ease, speed and overall. |
| 3. Polly | ✅ | `src/polly.js` is geo-aware and answers in English or Spanish. It handles "help me find treasure", food only, only free, walking distance, "I have kids" and "make today's hunt last one hour" (it builds a walking route). It also answers credits, raffle and how-it-works questions. Optionally uses Workers AI to understand free-form questions. It never invents treasures; answers always come from live data. |
| 4. Raffle + QA | ✅ | `src/raffle.js` draws Sundays at 14:00 UTC from that week's confirmed redeemers, with one ticket per find and a 500-credit prize. Each week is drawn only once. `test/e2e.js` covers the full redemption flow. |

**Also included:**

- **Stripe payments:** a merchant pays the drop fee ($1 × number of drops) through Stripe Checkout when they create a treasure. Card payments work, and OXXO does too if it's switched on in Stripe. A webhook plus an instant check on return mark the treasure as paid. HQ can only approve paid treasures, but can waive the fee. Without Stripe keys, drops fall back to "invoice".
- **Merchant import:** in TIN HQ → Merchants, upload an Excel/CSV file or paste rows straight from Excel.
  - Columns are detected by their header name, in English or Spanish.
  - Duplicate names are skipped.
  - Rows without GPS are flagged 📍 and fixed by pasting Google Maps coordinates.
- **Polly:**
  - Speaks English, Spanish, Portuguese, French and German.
  - Knows opening hours ("what's open now?", and routes only include open places).
  - Shows a proactive tip on the Hunt screen: an open code that's about to expire, meal-time treasures nearby, or a raffle closing soon.

There are three views in one app, switched by account role:

- **Explorer:** Hunt, Map, Polly, My codes, Credits.
- **Merchant:** Redeem (scan), Drops (create/edit/pause), Today, Ratings.
- **TIN HQ (admin):**
  - Overview KPIs, including the verification rate and average rating against the spec targets.
  - Approve merchants and drops.
  - Themed hunts.
  - Raffle.
  - Settings: credits per find, raffle prize, $ per drop, and how long a claim code stays valid.

**Credit pools are isolated.** `treasure_hunt_credits` and `treasure_hunt_credit_ledger` belong to Treasure Hunt only. TIN Commerce and Spin & Win credits are never read or written here.

## Tech

- Cloudflare Worker (`src/`) with Static Assets (`public/`).
- D1 database (`migrations/0001_init.sql`).
- Cron triggers: hourly claim expiry and the Sunday 14:00 UTC raffle.
- No build step, no framework.
- The map uses Leaflet + OpenStreetMap/CARTO tiles.
- QR codes are made with `qrcode-generator`, and camera scanning uses `jsQR`. Both are vendored in `public/vendor/`.

## Deploy (Daphne)

```bash
npm install
npx wrangler login
npx wrangler d1 create tin-treasure-hunt      # copy the database_id into wrangler.toml
npm run db:migrate                            # creates the tables in the real D1
npm run deploy                                # publishes the Worker + pages
```

### Stripe (drop-fee payments)

```bash
npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_… (or sk_test_… to try it first)
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_… from the webhook below
```

Then set up the webhook:

1. In Stripe, go to **Developers → Webhooks → Add endpoint**.
2. Enter the URL `https://<your-domain>/api/stripe/webhook`.
3. Select these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

Optional: turn on OXXO under Stripe → Settings → Payment methods.

Then, in the Cloudflare dashboard, go to **Workers → tin-treasure-hunt → Settings → Domains & Routes** and add a custom domain, e.g. `hunt.tincommerce.com`.

- **Admin:** the email in `ADMIN_EMAILS` (wrangler.toml) becomes TIN HQ admin when it signs up. Change or add emails there (comma-separated) and redeploy.
- **Polly AI (optional):** uncomment the `[ai]` block in `wrangler.toml` and redeploy. Without it Polly uses the built-in rules, which cover every example in the spec.
- **Demo data:** `seed/demo-cozumel.sql` has 10 **invented** Cozumel merchants, marked `is_sample=1`. Load it only for demos, never into production: `npx wrangler d1 execute tin-treasure-hunt --remote --file seed/demo-cozumel.sql`.
- **Auto-deploy from GitHub (optional):** in Cloudflare, go to Workers → Create → Import a repository → `cjcilliers-web/tin-treasure-hunt`. The build command is empty and the deploy command is `npx wrangler deploy`.

## Run locally

```bash
npm install
npm run db:migrate:local && npm run db:seed:local
npm run dev                      # http://localhost:8787
node test/mock-stripe.js &       # fake Stripe for local tests (see .dev.vars below)
npm run test:e2e                 # in a second terminal (needs Playwright)
curl "http://localhost:8787/__scheduled?cron=0+14+*+*+SUN"   # fire the raffle
```

For local tests, a `.dev.vars` file is used (it is not committed):

```
STRIPE_SECRET_KEY=sk_test_mock
STRIPE_WEBHOOK_SECRET=whsec_testsecret
STRIPE_API_BASE=http://localhost:8799/v1
```

## Onboarding a real merchant

1. The owner creates a TIN account at `/cozumel`, then goes to **Credits → "I own a business"** and applies. Alternatively, HQ adds the merchant directly under **TIN HQ → Merchants → Add a merchant**, using the owner's email.
2. HQ clicks **Approve**, and the owner's account gets the Merchant view.
3. The merchant creates a treasure and fills in the name, reward and **required story**. It goes to HQ for approval, at $1 per drop.
4. HQ approves the treasure, and explorers see it immediately.

## Integrating with the existing TIN platform

- The spec says `tin_users`, `tin_user_sessions` and `merchants` already exist in the TIN platform. The schema here matches the fields Treasure Hunt needs. When merging into the main TIN D1, apply only the Treasure Hunt tables, and add any missing columns to the existing tables:
  - Treasure Hunt tables: `treasure_drops`, `claims`, `redemptions`, `redemption_proofs`, `redemption_ratings`, `treasure_hunt_credits`, `treasure_hunt_credit_ledger`, `hunts`, `raffles`, `settings`.
  - Columns needed on `merchants`: `destination_id`, `lat`, `lng`, `status`.
- Password hashing is PBKDF2-SHA256 with a stored iteration count, capped at 100,000. **Do not raise it to 210,000**, because Workers rejects that.

## Not in this build (per spec)

- Spin & Win, the Love Drops Marketplace and Merchant Hunter.
- Proof photos are stored in D1 as small compressed images. Move them to R2 if volume grows.

## Pilot success metrics (first 48 h)

The metrics are:

- Under 2 s load time
- 100+ users
- 50+ redemptions
- 0 critical errors
- 80%+ verification rate
- An 8.5+ average rating

TIN HQ → Overview shows the verification rate and the average rating live.
