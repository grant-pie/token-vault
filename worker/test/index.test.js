import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GENERATED_ID_SHAPE,
  isAllowedOrigin,
  corsHeaders,
  parsePrompt,
  buildTokenPrompt,
  buildEditPrompt,
  pruneStaleGenerations,
  paginateGenerations,
  resolveGeneratedImageKey,
  checkAndConsumeRateLimit,
  acquireGenerationSlot,
  releaseGenerationSlot,
  incrementGenerationCount,
} from "../src/index.js";
import {
  RECENT_GENERATIONS_MAX_AGE_MS,
  RECENT_GENERATIONS_PAGE_SIZE,
  THUMBNAIL_KEY_SUFFIX,
  GENERATED_IMAGE_KEY_PREFIX,
  MAX_CONCURRENT_OPENAI_REQUESTS,
  DEFAULT_STYLE,
} from "../src/config.js";
import { createTestKV } from "./test-kv.js";

describe("isAllowedOrigin", () => {
  it("allows the configured production origins", () => {
    expect(isAllowedOrigin("https://grant-pie.github.io")).toBe(true);
    expect(isAllowedOrigin("https://grantpieterse.com")).toBe(true);
  });

  it("allows local dev hosts on any port", () => {
    expect(isAllowedOrigin("http://localhost:5500")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.42:5500")).toBe(true);
  });

  it("rejects an arbitrary outside origin", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
  });

  it("rejects empty or malformed origins without throwing", () => {
    expect(isAllowedOrigin("")).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin("not-a-url")).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("reflects Access-Control-Allow-Origin only for an allowed origin", () => {
    const allowed = corsHeaders("https://grantpieterse.com");
    expect(allowed["Access-Control-Allow-Origin"]).toBe("https://grantpieterse.com");

    const disallowed = corsHeaders("https://evil.example.com");
    expect(disallowed["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("always varies on Origin, even for a disallowed one", () => {
    // Required so a cached response for one origin can never be replayed to
    // another — see the comment on corsHeaders in index.js.
    expect(corsHeaders("https://evil.example.com").Vary).toBe("Origin");
  });
});

describe("parsePrompt", () => {
  const template = "Before. [[shadow]]Add a [shadow color] shadow.[[/shadow]] Subject: [description], facing [direction]. [[shadow]]Reminder: [shadow color] shadow.[[/shadow]] After.";

  it("fills in every shadow span with the chosen color and strips the markers", () => {
    const result = parsePrompt(template, "a goblin", "blue");
    expect(result).not.toContain("[[shadow]]");
    expect(result).not.toContain("[shadow color]");
    expect(result).toContain("Add a blue shadow.");
    expect(result).toContain("Reminder: blue shadow.");
  });

  it("replaces every shadow span with a no-shadow instruction when no color is chosen", () => {
    const result = parsePrompt(template, "a goblin", "");
    expect(result).not.toContain("shadow color");
    // Both spans get the same explicit no-shadow sentence, not just one.
    const occurrences = result.split("Do not add any shadow, glow, halo, or highlight beneath or around the creature.").length - 1;
    expect(occurrences).toBe(2);
  });

  it("substitutes the description and facing direction placeholders", () => {
    const result = parsePrompt(template, "a goblin", "");
    expect(result).toContain("Subject: a goblin");
    expect(result).toContain("facing forward"); // RANDOMIZE_FACING_DIRECTION is false
  });
});

describe("buildTokenPrompt", () => {
  it("falls back to the default style's template for an unknown style", () => {
    const known = buildTokenPrompt("a goblin", DEFAULT_STYLE, "");
    const unknown = buildTokenPrompt("a goblin", "not-a-real-style", "");
    expect(unknown).toBe(known);
  });

  it("produces different output for different valid styles", () => {
    const standard = buildTokenPrompt("a goblin", "standard", "");
    const grimdark = buildTokenPrompt("a goblin", "grimdark", "");
    expect(standard).not.toBe(grimdark);
  });
});

describe("buildEditPrompt", () => {
  it("embeds the requested instruction and calls out equipment preservation", () => {
    const prompt = buildEditPrompt("make the cloak red");
    expect(prompt).toContain("make the cloak red");
    expect(prompt.toLowerCase()).toContain("equipment");
  });
});

describe("GENERATED_ID_SHAPE", () => {
  it("accepts a real crypto.randomUUID()", () => {
    expect(GENERATED_ID_SHAPE.test(crypto.randomUUID())).toBe(true);
  });

  it("rejects anything that isn't exactly a UUID", () => {
    expect(GENERATED_ID_SHAPE.test("../secrets")).toBe(false);
    expect(GENERATED_ID_SHAPE.test("")).toBe(false);
    expect(GENERATED_ID_SHAPE.test("not-a-uuid")).toBe(false);
    // A valid UUID with anything appended/prepended must not sneak through
    // an unanchored match.
    expect(GENERATED_ID_SHAPE.test(`${crypto.randomUUID()}/../../secrets`)).toBe(false);
  });
});

describe("pruneStaleGenerations", () => {
  const now = Date.now();

  it("drops entries older than the max age", () => {
    const list = [
      { id: "fresh", createdAt: now },
      { id: "stale", createdAt: now - RECENT_GENERATIONS_MAX_AGE_MS - 1000 },
    ];
    const result = pruneStaleGenerations(list, 200);
    expect(result.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("caps the result to the given max count even within the age window", () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ id: i, createdAt: now }));
    expect(pruneStaleGenerations(list, 3)).toHaveLength(3);
  });
});

describe("paginateGenerations", () => {
  const list = Array.from({ length: 50 }, (_, i) => ({ id: i }));

  it("defaults to the first page at the default page size", () => {
    const { items, offset, limit } = paginateGenerations(list, null, null);
    expect(items).toHaveLength(RECENT_GENERATIONS_PAGE_SIZE);
    expect(items[0].id).toBe(0);
    expect(offset).toBe(0);
    expect(limit).toBe(RECENT_GENERATIONS_PAGE_SIZE);
  });

  it("honors a valid offset", () => {
    const { items } = paginateGenerations(list, "10", null);
    expect(items[0].id).toBe(10);
  });

  it("clamps limit to the page-size ceiling even if a larger value is requested", () => {
    const { items, limit } = paginateGenerations(list, "0", "1000");
    expect(limit).toBe(RECENT_GENERATIONS_PAGE_SIZE);
    expect(items).toHaveLength(RECENT_GENERATIONS_PAGE_SIZE);
  });

  it("treats negative, non-numeric, or missing offset/limit as their defaults", () => {
    expect(paginateGenerations(list, "-5", "abc").offset).toBe(0);
    expect(paginateGenerations(list, "-5", "abc").limit).toBe(RECENT_GENERATIONS_PAGE_SIZE);
    expect(paginateGenerations(list, undefined, "0").limit).toBe(1);
  });

  it("returns an empty page once the offset runs past the list", () => {
    expect(paginateGenerations(list, "1000", null).items).toEqual([]);
  });
});

describe("resolveGeneratedImageKey", () => {
  const id = crypto.randomUUID();

  it("resolves a full-res png path", () => {
    expect(resolveGeneratedImageKey(`/${GENERATED_IMAGE_KEY_PREFIX}${id}.png`)).toBe(
      `${GENERATED_IMAGE_KEY_PREFIX}${id}.png`
    );
  });

  it("resolves a thumbnail path", () => {
    expect(resolveGeneratedImageKey(`/${GENERATED_IMAGE_KEY_PREFIX}${id}${THUMBNAIL_KEY_SUFFIX}`)).toBe(
      `${GENERATED_IMAGE_KEY_PREFIX}${id}${THUMBNAIL_KEY_SUFFIX}`
    );
  });

  it("rejects a malformed or path-traversing id", () => {
    expect(resolveGeneratedImageKey(`/${GENERATED_IMAGE_KEY_PREFIX}../../secrets.png`)).toBeNull();
    expect(resolveGeneratedImageKey(`/${GENERATED_IMAGE_KEY_PREFIX}not-a-uuid.png`)).toBeNull();
  });

  it("rejects an unknown suffix", () => {
    expect(resolveGeneratedImageKey(`/${GENERATED_IMAGE_KEY_PREFIX}${id}.jpg`)).toBeNull();
  });
});

describe("checkAndConsumeRateLimit", () => {
  let kv;

  beforeEach(() => {
    kv = createTestKV();
  });

  it("allows up to max requests then blocks the next one", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await checkAndConsumeRateLimit(kv, "rl:", "1.2.3.4", 3, 3600)).allowed).toBe(true);
    }
    expect((await checkAndConsumeRateLimit(kv, "rl:", "1.2.3.4", 3, 3600)).allowed).toBe(false);
  });

  it("tracks separate IPs independently", async () => {
    await checkAndConsumeRateLimit(kv, "rl:", "1.1.1.1", 1, 3600);
    const other = await checkAndConsumeRateLimit(kv, "rl:", "2.2.2.2", 1, 3600);
    expect(other.allowed).toBe(true);
  });

  it("resets the count once the window has elapsed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await checkAndConsumeRateLimit(kv, "rl:", "1.2.3.4", 1, 60);
      expect((await checkAndConsumeRateLimit(kv, "rl:", "1.2.3.4", 1, 60)).allowed).toBe(false);

      vi.setSystemTime(new Date("2026-01-01T00:01:01Z")); // window (60s) has passed
      expect((await checkAndConsumeRateLimit(kv, "rl:", "1.2.3.4", 1, 60)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("generation concurrency slot", () => {
  let kv;

  beforeEach(() => {
    kv = createTestKV();
  });

  it("caps concurrent acquisitions at MAX_CONCURRENT_OPENAI_REQUESTS", async () => {
    for (let i = 0; i < MAX_CONCURRENT_OPENAI_REQUESTS; i++) {
      expect(await acquireGenerationSlot(kv)).toBe(true);
    }
    expect(await acquireGenerationSlot(kv)).toBe(false);
  });

  it("frees a slot on release so a subsequent acquire succeeds", async () => {
    for (let i = 0; i < MAX_CONCURRENT_OPENAI_REQUESTS; i++) {
      await acquireGenerationSlot(kv);
    }
    expect(await acquireGenerationSlot(kv)).toBe(false);

    await releaseGenerationSlot(kv);
    expect(await acquireGenerationSlot(kv)).toBe(true);
  });
});

describe("incrementGenerationCount", () => {
  it("starts at 1 on the first call and keeps counting up", async () => {
    const env = { ANALYTICS: createTestKV() };
    await incrementGenerationCount(env);
    expect(await env.ANALYTICS.get("generation_count")).toBe("1");

    await incrementGenerationCount(env);
    await incrementGenerationCount(env);
    expect(await env.ANALYTICS.get("generation_count")).toBe("3");
  });

  it("never expires or resets — unlike the capped/pruned admin log", async () => {
    const env = { ANALYTICS: createTestKV() };
    for (let i = 0; i < 10; i++) {
      await incrementGenerationCount(env);
    }
    expect(await env.ANALYTICS.get("generation_count")).toBe("10");
  });
});
