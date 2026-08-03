import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signCreditToken,
  verifyCreditToken,
  signRestoreToken,
  verifyRestoreToken,
  verifyPaystackWebhookSignature,
  getBalance,
  grantCredits,
  spendCredits,
} from "../src/credits.js";
import { createTestD1 } from "./test-d1.js";

const SECRET = "test-signing-secret";

describe("credit tokens", () => {
  it("round-trips a signed credit token back to its email", async () => {
    const token = await signCreditToken(SECRET, "player@example.com", 3600);
    const claims = await verifyCreditToken(SECRET, token);
    expect(claims).toEqual({ email: "player@example.com" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signCreditToken(SECRET, "player@example.com", 3600);
    const claims = await verifyCreditToken("wrong-secret", token);
    expect(claims).toBeNull();
  });

  it("rejects a tampered payload even if the signature segment is untouched", async () => {
    const token = await signCreditToken(SECRET, "player@example.com", 3600);
    const [payload, sig] = token.split(".");
    const tampered = `${payload}AA.${sig}`;
    expect(await verifyCreditToken(SECRET, tampered)).toBeNull();
  });

  it("rejects garbage input instead of throwing", async () => {
    expect(await verifyCreditToken(SECRET, "not-a-real-token")).toBeNull();
    expect(await verifyCreditToken(SECRET, "")).toBeNull();
    expect(await verifyCreditToken(SECRET, undefined)).toBeNull();
  });

  // The `purpose` claim is what stops a short-lived, emailed restore link
  // from being replayed as a long-lived spend credential (or vice versa) if
  // it leaks — see the comment above signPurposeToken in credits.js.
  it("never accepts a restore token as a credit token, or vice versa", async () => {
    const restoreToken = await signRestoreToken(SECRET, "player@example.com", 900);
    expect(await verifyCreditToken(SECRET, restoreToken)).toBeNull();

    const creditToken = await signCreditToken(SECRET, "player@example.com", 3600);
    expect(await verifyRestoreToken(SECRET, creditToken)).toBeNull();
  });

  it("expires a token once its TTL has elapsed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = await signRestoreToken(SECRET, "player@example.com", 900);

      vi.setSystemTime(new Date("2026-01-01T00:14:00Z")); // 14 min later, still valid
      expect(await verifyRestoreToken(SECRET, token)).toEqual({ email: "player@example.com" });

      vi.setSystemTime(new Date("2026-01-01T00:16:00Z")); // 16 min later, expired
      expect(await verifyRestoreToken(SECRET, token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("verifyPaystackWebhookSignature", () => {
  it("accepts a signature computed the same way Paystack does (hex HMAC-SHA512)", async () => {
    const payload = JSON.stringify({ event: "charge.success" });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("whsec"),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const sigHex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

    expect(await verifyPaystackWebhookSignature(payload, sigHex, "whsec")).toBe(true);
  });

  it("rejects a mismatched or missing signature", async () => {
    const payload = JSON.stringify({ event: "charge.success" });
    expect(await verifyPaystackWebhookSignature(payload, "deadbeef", "whsec")).toBe(false);
    expect(await verifyPaystackWebhookSignature(payload, null, "whsec")).toBe(false);
  });
});

describe("credit ledger (real SQLite, project migrations applied)", () => {
  let db;

  beforeEach(() => {
    db = createTestD1();
  });

  it("reports a zero balance for an email with no ledger history", async () => {
    expect(await getBalance(db, "nobody@example.com")).toBe(0);
  });

  it("grants credits and reflects them in the balance", async () => {
    await grantCredits(db, { email: "player@example.com", delta: 10, reason: "purchase:starter" });
    expect(await getBalance(db, "player@example.com")).toBe(10);
  });

  it("is idempotent against a duplicated webhook delivery for the same provider event", async () => {
    await grantCredits(db, {
      email: "player@example.com",
      delta: 10,
      reason: "purchase:starter",
      providerEventId: "evt_123",
    });
    // Simulates Paystack retrying delivery of the same event.
    await grantCredits(db, {
      email: "player@example.com",
      delta: 10,
      reason: "purchase:starter",
      providerEventId: "evt_123",
    });

    expect(await getBalance(db, "player@example.com")).toBe(10);
  });

  it("still grants credits for a genuinely different event on the same email", async () => {
    await grantCredits(db, { email: "player@example.com", delta: 10, reason: "a", providerEventId: "evt_1" });
    await grantCredits(db, { email: "player@example.com", delta: 25, reason: "b", providerEventId: "evt_2" });
    expect(await getBalance(db, "player@example.com")).toBe(35);
  });

  it("spends credits and returns the new balance", async () => {
    await grantCredits(db, { email: "player@example.com", delta: 5, reason: "purchase:starter" });
    const balance = await spendCredits(db, { email: "player@example.com", cost: 1, reason: "spend:generate:high" });
    expect(balance).toBe(4);
    expect(await getBalance(db, "player@example.com")).toBe(4);
  });

  it("refuses to spend past a zero or insufficient balance", async () => {
    expect(await spendCredits(db, { email: "broke@example.com", cost: 1, reason: "spend:generate:high" })).toBeNull();

    await grantCredits(db, { email: "player@example.com", delta: 1, reason: "purchase:starter" });
    expect(
      await spendCredits(db, { email: "player@example.com", cost: 2, reason: "spend:generate:high" })
    ).toBeNull();
    // A failed spend must not have decremented the balance anyway.
    expect(await getBalance(db, "player@example.com")).toBe(1);
  });

  it("supports the refund pattern (grantCredits after a failed generation)", async () => {
    await grantCredits(db, { email: "player@example.com", delta: 1, reason: "purchase:starter" });
    const afterSpend = await spendCredits(db, {
      email: "player@example.com",
      cost: 1,
      reason: "spend:generate:high",
    });
    expect(afterSpend).toBe(0);

    await grantCredits(db, { email: "player@example.com", delta: 1, reason: "refund:generate_rejected" });
    expect(await getBalance(db, "player@example.com")).toBe(1);
  });
});
