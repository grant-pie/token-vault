# Token Vault — Credit System: Implementation Plan

Prepared 2026-07-30, revised 2026-07-30 (Stripe → Paystack). Architecture and build sequence for adding paid generation credits on top of the existing AI generator, so heavy use pays for its own OpenAI bill instead of one person's Cloudflare/OpenAI account absorbing it.

**Status: code written, D1 half-provisioned, payment processor still needs an account.** The Cloudflare side is live: the `token-vault-credits` D1 database exists and the `credits`/`ledger` schema is applied, `TOKEN_SIGNING_SECRET` is set. What's left is entirely on the Paystack side — see **Manual setup checklist** below.

**Why Paystack, not Stripe**: this plan originally targeted Stripe Checkout, but Stripe doesn't support South Africa as a seller country. Paystack (acquired by Stripe, built specifically for African markets, live in South Africa since 2021) is the replacement — same shape of integration (hosted checkout page, server-to-server webhook, signature verification), different API surface. One thing it simplifies versus the original Stripe plan: there's no separate "Product/Price" catalog step for a one-off charge (the amount is just passed directly on each call), and no separate webhook-signing secret — Paystack signs webhooks with the same secret key used for API auth.

**Current site**: static HTML/JS/CSS on GitHub Pages, with a Cloudflare Worker (`worker/src/index.js`) proxying `gpt-image-1` and storing results in R2. Generation is free and gated only by a per-IP rate limit in Workers KV (`RATE_LIMIT`). No accounts existed before this — `feedback.html` collects an optional email but nothing is tied to identity.

## Summary

**Recommendation**: Paystack's hosted checkout (no card data ever touches the Worker) for purchases, a Cloudflare D1 database for the credit ledger, and a signed bearer token in `localStorage` standing in for a login system. No passwords, no session cookies, no new hosting platform — the static site and existing Worker keep their current shape, with a few new endpoints and one new binding (D1).

**Why not "real" accounts**: this is a hobby fan site with no accounts today. A username/password system is a disproportionate amount of new surface area (password resets, email verification, session security) for what's fundamentally a prepaid-balance problem. Paystack already handles identity via the checkout email; the Worker only needs to remember "this token is worth N credits," not who's holding it.

## Architecture

### Request flow — buying credits

1. Visitor clicks **Buy Credits** on `generate.html` / `monster.html`, enters an email (Paystack requires this up front — unlike Stripe's hosted page, Paystack's checkout doesn't collect it for you), picks a pack, hits `POST /api/checkout` on the Worker with `{ pack: "small" | "medium" | "large", email }`.
2. Worker calls Paystack's `POST /transaction/initialize` with the pack's amount (in cents — ZAR's smallest unit — from `worker/src/config.js`'s `CREDIT_PACKS`) and redirects the browser to the returned `authorization_url`, Paystack's hosted payment page.
3. Paystack handles card entry entirely off our infrastructure — this keeps the Worker out of PCI scope completely.
4. On success, Paystack fires a `charge.success` webhook to `POST /api/paystack-webhook`. The Worker verifies the signature (HMAC-SHA512 over the raw body, keyed with `PAYSTACK_SECRET_KEY`), reads the customer email and the pack purchased from `metadata`, and **credits the ledger in D1** — this is the actual source of truth for the purchase, not the redirect.
5. The browser lands back on the site with `?reference=...&trxref=...` appended to the callback URL (both the same value — Paystack adds these automatically, there's no placeholder syntax to configure like Stripe's `{CHECKOUT_SESSION_ID}`). Client JS calls `POST /api/claim-session { reference }`. The Worker asks Paystack (`GET /transaction/verify/:reference`) to confirm the transaction succeeded, looks up the associated email, and mints a signed token (HMAC-SHA256 over `{ email, exp }` using a Worker secret) with no server-side session state to manage.
6. Client stores the token in `localStorage` and strips the query params from the URL. From here on, `Authorization: Bearer <token>` goes on every generate/balance request.

Steps 4 and 5 are deliberately separate: the webhook is the only place credits are actually granted, so a visitor closing the tab before the redirect completes doesn't lose paid-for credits — they'd just need to re-request a token via a "restore my credits" flow (see Deferred).

### Request flow — spending credits

`handleGenerate` in `worker/src/index.js` has a check inserted before the OpenAI call:

1. If `Authorization: Bearer <token>` is present and verifies (signature + not expired), spend from the email's balance in D1.
   - Balance ≥ cost for the requested `quality` → atomic decrement (`UPDATE ... WHERE balance >= cost RETURNING balance`), skip the anonymous IP rate limit, proceed.
   - Balance < cost → `402` JSON error: "You're out of credits — buy more or wait for the free hourly limit to reset."
2. No token, or an invalid/expired one → fall through to **today's behavior unchanged**: the existing per-IP KV rate limit. Free, anonymous generation keeps working exactly as it does now — paying is additive, not a paywall replacing the current free tier.
3. Paid requests still pass through a *loose* per-token rate limit (50/hour) even with credits available. This isn't about revenue — it's insurance against a leaked token (someone copies their `localStorage` value) being used to run up a bill faster than the credit balance itself would naturally throttle.
4. If the OpenAI call fails, gets rejected, or the R2 upload fails, the spent credit is **refunded** automatically — a paying user shouldn't lose credits to a content-policy rejection or a flaky upstream.

Credit cost per generation maps to the existing `ALLOWED_QUALITIES` tiers, roughly mirroring OpenAI's real per-image cost ratio so a user picking HD isn't quietly subsidized by one picking low:

| Quality | OpenAI cost | Credit cost |
|---|---:|---:|
| Low | ~$0.01 | 1 credit |
| Medium | ~$0.04 | 3 credits |
| High | ~$0.17 | 10 credits |

### D1 schema

```sql
CREATE TABLE credits (
  email TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE ledger (
  id TEXT PRIMARY KEY,        -- uuid
  email TEXT NOT NULL,
  delta INTEGER NOT NULL,     -- positive for purchases, negative for spends
  reason TEXT NOT NULL,       -- 'purchase:small' | 'spend:generate:high' | 'refund:...' | ...
  provider_event_id TEXT,     -- Paystack transaction reference; null for spends/refunds
  created_at TEXT NOT NULL
);
```

(`provider_event_id` was named `stripe_event_id` in the original migration, before the Paystack switch — renamed via `migrations/0002_rename_provider_event_id.sql`, already applied.)

The `ledger` table isn't strictly needed for balance math (that lives in `credits.balance`) but matters the first time a customer emails asking "where did my credits go" — without it there's no way to answer that question.

### New endpoints on the existing Worker

| Route | Purpose |
|---|---|
| `POST /api/checkout` | Initialize a Paystack transaction, return the redirect URL |
| `POST /api/paystack-webhook` | Paystack → Worker, grants credits, source of truth for purchases |
| `POST /api/claim-session` | Exchange a completed transaction `reference` for a bearer token |
| `GET /api/balance` | Return the current credit balance for a bearer token |

### Secrets / bindings

- `PAYSTACK_SECRET_KEY` — `wrangler secret put`, used for both API auth and webhook signature verification (Paystack has no separate webhook secret).
- `TOKEN_SIGNING_SECRET` — HMAC secret for minting/verifying bearer tokens. **Already set.**
- `CREDITS_DB` — D1 binding in `wrangler.toml`. **Already created and migrated.**

## The UI

- A **"Buy Credits"** button next to the existing Generate button on `generate.html` and `monster.html`, opening a small modal: an email field, then three pack buttons, then Paystack-hosted checkout on click — no in-page card form to build or secure.
- A **credit balance indicator** near the generate button once a token exists in `localStorage` ("12 credits"), fetched via `/api/balance` on page load.
- Inline messaging when a paid user runs out: reuses the existing `generator-status` element pattern — "You're out of credits — buy more, or keep going on the free hourly limit."
- No new page needed; this rides inside the existing generator pages rather than introducing a separate account/dashboard page.

## Cost breakdown

| Item | Cost |
|---|---:|
| Paystack fees | Check [Paystack's South Africa pricing page](https://paystack.com/pricing) before launch — historically around 2.9% + a small fixed fee per successful local-card transaction, but verify the current number rather than trusting this document. |
| D1 | Free tier: 5 GB storage, 5M rows read/day — effectively $0 at hobby-site volume |
| Additional Worker requests | Inside existing free tier (100k req/day) |

Net: at this scale, the only real new cost is Paystack's per-transaction cut — everything else stays inside free tiers already in use.

## Build sequence

**01 — Foundation** ✅ done
D1 database created, `credits`/`ledger` tables migrated, `TOKEN_SIGNING_SECRET` set.

**02 — Purchase path** — blocked on Paystack account
`/api/checkout` + `/api/paystack-webhook` + `/api/claim-session` are written. Needs a Paystack account, `PAYSTACK_SECRET_KEY` set, and the webhook registered before a real purchase can be tested end-to-end.

**03 — Spend path** ✅ done
Bearer-token check wired into `handleGenerate`, credit-cost table in place, loose per-token rate limit as a backstop, automatic refund on generation failure. Buy button, balance indicator, and out-of-credits messaging live on `generate.html`/`monster.html`.

**04 — Polish** — after first live test
Confirm webhook retries are idempotent (verified via the `ledger.provider_event_id` unique index), add a support path for "I paid but don't see my credits" (manual balance lookup by email against the `ledger` table), decide on the "restore my credits" flow (see Deferred).

## Manual setup checklist

These steps touch your actual Paystack account, so they need to be run by hand — nothing here can be done on your behalf without your login.

**1. Create a Paystack account** at [dashboard.paystack.com/#/signup](https://dashboard.paystack.com), selecting South Africa as the business country. Business verification can take a few days — start this early if you want to launch on a deadline.

**2. Get the API secret key**
Dashboard → Settings → API Keys & Webhooks → copy the **Secret Key** (`sk_test_...` while in test mode, `sk_live_...` once verified and ready to go live).

**3. Register the webhook**
Same page → **Webhook URL** field → set it to:
```
https://token-vault-generator.grant-public1.workers.dev/api/paystack-webhook
```
Paystack doesn't let you subscribe to individual event types the way Stripe does — it sends all events to the one URL, which is why `handlePaystackWebhook` in `worker/src/index.js` explicitly checks `event.event === "charge.success"` and ignores everything else.

**4. Set the Worker secret**
```
wrangler secret put PAYSTACK_SECRET_KEY
```
(paste the secret key from step 2 when prompted — nothing else needs setting; `TOKEN_SIGNING_SECRET` is already in place.)

**5. Sanity-check the pack prices** in `worker/src/config.js`'s `CREDIT_PACKS` (currently R55/15 credits, R150/50 credits, R350/150 credits — drafts, not commitments) and the display copy in `js/credits.js`'s `CREDIT_PACK_DISPLAY`, which has to be kept in sync by hand since nothing cross-checks them.

**6. Test in Paystack test mode end-to-end** before flipping to a live key: buy a pack with a [Paystack test card](https://paystack.com/docs/payments/test-payments/), confirm the webhook fires (visible in the dashboard's webhook log), confirm `/api/balance` shows the right credit count, then spend a credit via the generator and confirm the balance drops by the expected amount for the quality picked.

**7. Deploy**: `wrangler deploy` from `worker/`, then push the already-updated static pages live.

## Deferred

- **"Restore my credits" flow** — if someone loses their `localStorage` token (new device, cleared storage), they need a way to get a fresh one without re-paying. Simplest version: a "resend my access link" form that emails a claim link for a given email address, reusing the `sendResendEmail` helper already in `worker/src/index.js`. Skipped from the MVP because it's only needed once someone actually loses a token, and can ship after the purchase path is validated.
- **Subscriptions** — Paystack supports recurring "Plans" with a similar hosted-checkout flow; the ledger model above (grant N credits on each successful charge via the same webhook) drops in without restructuring anything. Worth a follow-up once one-time packs prove people will pay at all.
- **Refunds/chargebacks** — a webhook handler for Paystack's refund event that debits the ledger. Not needed for MVP but should exist before this handles real volume, since a refund with no corresponding debit is a silent loss.

## Open questions

- **Pack sizes and prices** — needs real numbers. The current draft (R55 → 15 credits, R150 → 50 credits, R350 → 150 credits) was back-converted from the original USD draft at a rough exchange rate — check it against a current rate and what comparable hobby/fan-content tools charge locally before launch.
- **Free tier size going forward** — once paid credits exist, is the current free hourly limit left as-is (paid just removes the wait) or tightened (to make paying meaningfully faster/more)? Affects how hard the incentive to pay actually is.
- **Fan-site framing** — the footer already carries a Wizards of the Coast/Hasbro non-affiliation disclaimer for the free generator; worth having that disclaimer equally visible on the purchase flow itself (credit modal copy / Paystack checkout page description), not just the main site footer, since money is now changing hands on an unofficial fan project.
