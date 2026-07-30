// Credit ledger (D1) and bearer-token helpers for the paid-generation system.
// See CREDIT_SYSTEM_PLAN.md for the design this implements.

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

async function importHmacKey(secret, hash) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign", "verify"]
  );
}

// Bearer tokens sign with SHA-256; Paystack's webhook signature is SHA-512
// (Paystack's own requirement), so both algorithms are supported here.
async function hmacHex(secret, message, hash = "SHA-256") {
  const key = await importHmacKey(secret, hash);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Uses crypto.subtle.verify (rather than comparing hex strings ourselves)
// so the comparison isn't a hand-rolled, potentially timing-unsafe check.
async function hmacVerify(secret, message, hexSig, hash = "SHA-256") {
  const sigBytes = hexToBytes(hexSig);
  if (!sigBytes) return false;
  const key = await importHmacKey(secret, hash);
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(message));
}

// --- Bearer tokens -----------------------------------------------------
// Format: "<base64url(json payload)>.<hex hmac signature>". No server-side
// session state — verification is just recomputing the signature.

export async function signCreditToken(secret, email, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ email, exp })));
  const sig = await hmacHex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyCreditToken(secret, token) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const valid = await hmacVerify(secret, payloadB64, sig);
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (!payload || typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { email: payload.email };
}

// --- Paystack REST helpers -------------------------------------------------
// Called via plain fetch (matching the OpenAI/Resend calls elsewhere in this
// worker) rather than pulling in an SDK. Paystack, not Stripe, because
// Stripe doesn't support South Africa as a seller country — Paystack (owned
// by Stripe, built for African markets) does.
//
// Unlike Stripe, there's no separate "Product/Price" catalog step for a
// one-off charge — the amount is just passed directly on each initialize
// call — and no separate webhook signing secret: Paystack signs webhook
// payloads with the same secret key used to authorize API calls.

const PAYSTACK_API_BASE = "https://api.paystack.co";

export async function initializeTransaction(env, { email, amountSubunits, pack, credits, callbackUrl }) {
  const res = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: amountSubunits,
      currency: "ZAR",
      callback_url: callbackUrl,
      metadata: { pack, credits },
    }),
  });
  if (!res.ok) {
    throw new Error(`Paystack transaction initialize failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  if (!body.status) {
    throw new Error(`Paystack transaction initialize rejected: ${body.message}`);
  }
  return body.data; // { authorization_url, access_code, reference }
}

export async function verifyTransaction(env, reference) {
  const res = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body.status) return null;
  return body.data; // { status: "success" | ..., reference, amount, customer: { email }, metadata }
}

// The x-paystack-signature header is a hex HMAC-SHA512 of the raw request
// body, keyed with the same secret key used for API auth (no separate
// webhook secret, unlike Stripe).
export async function verifyPaystackWebhookSignature(payload, signatureHeader, secret) {
  if (!signatureHeader) return false;
  return hmacVerify(secret, payload, signatureHeader, "SHA-512");
}

// --- D1 ledger -----------------------------------------------------------

export async function getBalance(db, email) {
  const row = await db.prepare("SELECT balance FROM credits WHERE email = ?").bind(email).first();
  return row ? row.balance : 0;
}

// Grants credits (positive delta). When providerEventId is set, the ledger's
// unique index on provider_event_id makes this idempotent against Paystack
// retrying a webhook delivery: a second delivery for the same event inserts
// zero ledger rows and grants nothing.
export async function grantCredits(db, { email, delta, reason, providerEventId }) {
  const now = new Date().toISOString();
  const ledgerId = crypto.randomUUID();

  if (providerEventId) {
    const inserted = await db
      .prepare(
        "INSERT OR IGNORE INTO ledger (id, email, delta, reason, provider_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(ledgerId, email, delta, reason, providerEventId, now)
      .run();
    if (inserted.meta.changes === 0) return; // already processed this event
  } else {
    await db
      .prepare(
        "INSERT INTO ledger (id, email, delta, reason, provider_event_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
      )
      .bind(ledgerId, email, delta, reason, now)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO credits (email, balance, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`
    )
    .bind(email, delta, now)
    .run();
}

// Spends credits (positive cost). The WHERE balance >= cost guard makes this
// a single atomic check-and-decrement — SQLite serializes writes per
// database, so two concurrent spend attempts can't both succeed against a
// balance that only covers one of them. Returns the new balance, or null if
// the balance was insufficient.
export async function spendCredits(db, { email, cost, reason }) {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      "UPDATE credits SET balance = balance - ?, updated_at = ? WHERE email = ? AND balance >= ? RETURNING balance"
    )
    .bind(cost, now, email, cost)
    .first();
  if (!result) return null;

  await db
    .prepare(
      "INSERT INTO ledger (id, email, delta, reason, provider_event_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
    )
    .bind(crypto.randomUUID(), email, -cost, reason, now)
    .run();

  return result.balance;
}
