# Token Vault — AI Image Generator: Implementation Plan

Prepared 2026-07-22. Architecture, build sequence, and running costs for adding an on-demand AI token generator page to the Token Vault site.

**Current site**: static HTML/JS/CSS, no build framework, no server. `tokens.js` is generated at build time from `images/` (see `npm run build`). Images are served from a Cloudflare R2 bucket via `IMAGE_BASE_URL` in `config.js`. Deployed behind a custom domain on Cloudflare, intended host is GitHub Pages.

## Summary

**Recommendation**: add a Cloudflare Worker as a thin proxy in front of OpenAI's Images API, storing generated art in the same R2 bucket the vault already uses. No new hosting platform, no framework migration — the static site keeps working exactly as it does today, with one new page and one new serverless endpoint.

**Cost at realistic personal-site volume** (a few hundred generations a month): **$5–20/month**, almost entirely OpenAI's per-image fee. Cloudflare's side of this sits inside its free tier.

## Why a backend is now required

Everything the site does today — the grid, search, pagination — runs in `app.js` against a token list baked in at build time. There's no server, and none is needed, because nothing on the page is a secret.

An image generator breaks that model: calling OpenAI requires an API key, and an API key placed in client-side JavaScript is public the moment the page loads — anyone can read it from the network tab and spend against your account. That key has to live behind a server we control. This is the one piece of new infrastructure this feature requires.

## Architecture

Cloudflare Workers is the natural fit rather than a new platform: `config.js` already points image URLs at an R2 bucket, so the account and DNS are already in Cloudflare's hands. A Worker can bind to that same R2 bucket directly, with no separate storage credentials to manage.

Request flow:

1. Browser POSTs `{ prompt, size }` to `/api/generate` on the Worker.
2. Worker checks the request count for this IP in Workers KV.
   - Over the limit → return 429, "try again later."
3. Within limit → Worker calls OpenAI's Images API using a server-side secret key.
4. Worker stores the returned image in R2 as `generated/<uuid>.webp`.
5. Worker increments the KV counter and returns `{ url, id }` to the browser.
6. Browser renders the preview and enables the download link.

Nothing here touches `tokens.js` or the build pipeline — generated images land in a separate `generated/` prefix in R2 and never enter the curated vault. This is deliberate: the vault only holds tokens you've made or vetted yourself, and generated art stays visitor-side (viewable/downloadable by whoever made it, not published to the shared library). See [Deferred](#deferred) below.

## The page

`generate.html`, linked from the banner nav alongside the vault grid. Kept in the same plain HTML/CSS/JS style as the rest of the site — no framework needed for one form and a result panel.

- **Prompt field** — a textarea, plus a row of style-preset chips ("ink sketch," "painted portrait," "pixel art") that prepend fixed phrasing to keep results looking like tokens rather than arbitrary art.
- **Generate button** — disabled while a request is in flight; generation typically takes 5–20 seconds, so the button should show that wait explicitly rather than appearing frozen.
- **Result panel** — the returned image and a **Download** link (mirrors the existing token-card pattern). No path back into the shared vault — generated images are the visitor's to keep, not added to the public library.
- **Inline errors** — rate-limit and content-policy rejections need plain-language messages ("You've hit the hourly limit — try again in a few minutes," not a raw API error).

## Keeping costs and abuse in check

This is the part that actually matters once the page is public: every click costs real money, and a static site has no login wall by default.

- **Rate limiting** — Workers KV tracks requests per IP (e.g. 5/hour). Cheap, and stops a single visitor from running up the bill.
- **Cloudflare Turnstile** (free) on the form — blocks scripted/bot submissions before they ever reach OpenAI.
- **Hard spend cap in the OpenAI dashboard** — set a monthly billing limit so a bug or a burst of traffic fails loudly instead of running an open tab.
- **Prompt length cap + OpenAI's built-in content moderation** — rejected prompts error out before an image is generated, so they aren't billed.

## Cost breakdown

### Per-image pricing

Verify at platform.openai.com/pricing before launch — these move.

| Model | Quality / size | Cost / image |
|---|---|---:|
| DALL·E 3 | Standard, 1024×1024 | $0.040 |
| DALL·E 3 | HD, 1024×1024 | $0.080 |
| DALL·E 3 | Standard, 1792×1024 | $0.080 |
| gpt-image-1 | Low, 1024×1024 | ~$0.01 |
| gpt-image-1 | Medium, 1024×1024 | ~$0.04 |
| gpt-image-1 | High, 1024×1024 | ~$0.17 |

DALL·E 3 is flat-rate and simplest to budget against. `gpt-image-1` is token-metered (its per-image cost above is an approximation from OpenAI's own published examples) but tends to render more faithfully to detailed prompts, and is the only one of the two that supports transparency: pass `background: "transparent"` (output as PNG or WebP — JPEG can't carry alpha) and it returns a clean cutout with no scene behind it. DALL·E 3 always composites a full background with no alpha channel option, so "transparent background" in the prompt is unreliable and would need manual keying afterward. For token art, that alone is a strong point in `gpt-image-1`'s favor.

### Monthly scenarios

| Volume | DALL·E 3 standard | gpt-image-1 medium |
|---|---:|---:|
| Light — 50 images/mo | $2.00 | $2.00 |
| Moderate — 200 images/mo | $8.00 | $8.00 |
| Heavy — 1,000 images/mo | $40.00 | $40.00 |

### Infrastructure (Cloudflare)

| Service | Free tier | Expected cost |
|---|---|---:|
| Workers | 100,000 requests/day | $0 |
| Workers KV (rate limiting) | 100k reads + 1k writes/day | $0 |
| R2 storage | 10 GB free, then $0.015/GB-mo | $0–1 |
| R2 egress | always free | $0 |
| Turnstile | unlimited | $0 |
| **Total infra, typical month** | | **≈ $0** |

**Bottom line**: at a hobby-project volume, the bill is essentially the OpenAI per-image fee — budget $5–20/month and set the OpenAI hard cap slightly above that.

## Build sequence

**01 — Foundation**
Create an OpenAI account/API key for this project, set a monthly billing limit. Stand up a Cloudflare Worker in the existing account, bind it to the R2 bucket already used for token images, add a KV namespace for rate limiting.

**02 — MVP generator** (ships the feature)
`/api/generate` endpoint (validate → rate-limit → Turnstile check → call OpenAI → store in R2 → return URL) plus `generate.html`/`generate.js` for the form, loading state, result panel, and download link. Nav link added from `index.html`.

**03 — Polish**
Prompt presets tuned for the token aesthetic, plus a border/frame overlay composited with `sharp` (already a project dependency). If generating with `gpt-image-1` and `background: "transparent"`, the cutout comes back clean from the API — no background-removal step needed, just the frame overlay.

## Deferred

**Vault submission** — a path for visitors to add a generated image to the shared, public token library. Explicitly out of scope for now: this site currently only hosts tokens you've made or personally vetted, and opening that up raises questions (moderation, consent/ownership of what gets published under your name, storage growth from unvetted uploads) that deserve their own design pass rather than being bolted onto the MVP. Can be picked up as a later phase once those questions are answered.

## Open questions

- **Access** — is this page open to any visitor, or gated to the D&D group specifically? Gating (even a shared passphrase behind Turnstile) meaningfully shrinks the abuse surface and the cost risk.
- **Model choice** — leaning `gpt-image-1`: DALL·E 3's pricing is flat and easier to reason about, but only `gpt-image-1` can return a transparent cutout (`background: "transparent"`), which matters for compositing into a token frame. Still worth generating the same handful of test prompts on both to confirm prompt fidelity before committing.
- **Content policy** — OpenAI will reject some fantasy-violence-adjacent prompts (weapons, gore descriptors) that are entirely normal for D&D art. Worth testing the specific kind of prompts this group will actually write before launch, not after.
