/**
 * dsh-omnisearch — tests for the features merged in from dsh-free-search and
 * liustack/modsearch: explicit time ranges, fallback notes, the result cache,
 * the keyless engine parsers, the prompt section and the platform dispatch.
 *
 * Offline only: every case is pure logic or a parser over fixture text.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  approximateTier,
  daysFromFreshness,
  freshnessLabel,
  isoDateDaysAgo,
  parseTimeRange,
  timeRangeToFreshness,
} from "../src/host/time-range.ts";
import { buildSearchNote, describeAttempt } from "../src/host/registry.ts";
import { buildCacheKey, CACHE_MAX_ENTRIES, SearchCache } from "../src/host/search-cache.ts";
import { buildPromptText } from "../src/host/prompt-section.ts";
import { orderChainForTimeRange, TIME_FILTER_ENGINES } from "../src/host/tools/advanced-search.ts";
import {
  cleanSnippet,
  extractDdgUrl,
  extractKeenableSources,
  formatKeenableRelative,
  parseMcpJson,
  uniqueSources,
} from "../src/host/providers/free-engines.ts";
import { buildExaSearchBody } from "../src/host/providers/exa.ts";
import { isKeyless } from "../src/host/providers/types.ts";
import { PROVIDERS, KEYLESS_PROVIDER_NAMES } from "../src/host/providers/index.ts";

// ---------------------------------------------------------------------------
// timeRange (dsh-free-search parity)
// ---------------------------------------------------------------------------

test("parseTimeRange accepts fixed tiers, relative values and absolute dates", () => {
  assert.deepEqual(parseTimeRange("day"), { days: 1, label: "day", tier: "day" });
  assert.deepEqual(parseTimeRange("week"), { days: 7, label: "week", tier: "week" });
  assert.deepEqual(parseTimeRange("month"), { days: 30, label: "month", tier: "month" });
  assert.deepEqual(parseTimeRange("year"), { days: 365, label: "year", tier: "year" });

  assert.equal(parseTimeRange("12h")?.days, 0.5);
  assert.equal(parseTimeRange("3d")?.days, 3);
  assert.equal(parseTimeRange("2mo")?.days, 60);
  assert.equal(parseTimeRange("1y")?.days, 365);

  assert.deepEqual(parseTimeRange("2026-07-01"), { after: "2026-07-01", label: "2026-07-01", tier: "year" });
});

test("parseTimeRange rejects garbage instead of throwing", () => {
  assert.equal(parseTimeRange(undefined), undefined);
  assert.equal(parseTimeRange(""), undefined);
  assert.equal(parseTimeRange("last tuesday"), undefined);
  assert.equal(parseTimeRange("0d"), undefined);
  assert.equal(parseTimeRange({ days: -3 }), undefined);
});

test("approximateTier follows the dsh-free-search mapping", () => {
  assert.equal(approximateTier(1), "day");
  assert.equal(approximateTier(2), "day");
  assert.equal(approximateTier(3), "week");
  assert.equal(approximateTier(14), "week");
  assert.equal(approximateTier(30), "month");
  assert.equal(approximateTier(90), "month");
  assert.equal(approximateTier(365), "year");
});

test("timeRangeToFreshness pins an after-date for custom windows", () => {
  const fixed = timeRangeToFreshness({ days: 7, label: "week", tier: "week" });
  assert.equal(fixed.preset, "week");
  assert.equal(fixed.after, isoDateDaysAgo(7));

  const custom = timeRangeToFreshness({ days: 3, label: "3d", tier: "week" });
  assert.equal(custom.preset, "week");
  assert.equal(custom.after, isoDateDaysAgo(3));

  const absolute = timeRangeToFreshness({ after: "2026-07-01", label: "2026-07-01", tier: "year" });
  assert.deepEqual(absolute, { after: "2026-07-01" });
});

test("daysFromFreshness reads both presets and after-dates", () => {
  assert.equal(daysFromFreshness({ preset: "week" }), 7);
  assert.equal(daysFromFreshness(undefined), undefined);
  const threeDaysAgo = isoDateDaysAgo(3);
  const days = daysFromFreshness({ after: threeDaysAgo });
  // The date is midnight-aligned, so "days ago" lands in (3, 4].
  assert.ok(days !== undefined && days > 2.9 && days < 4.1, `expected ~3 days, got ${days}`);
  assert.equal(freshnessLabel({ preset: "day", after: "2026-07-01" }), "day@2026-07-01");
});

// ---------------------------------------------------------------------------
// fallback notes (dsh-free-search `Note:` contract)
// ---------------------------------------------------------------------------

test("no note when the preferred engine served the results", () => {
  assert.equal(
    buildSearchNote({ serving: "bing", preferred: "bing", attempts: [{ provider: "bing", outcome: "success" }] }),
    undefined,
  );
});

test("note form (a): preferred skipped for time filtering", () => {
  const note = buildSearchNote({
    serving: "exa",
    preferred: "bing",
    attempts: [{ provider: "bing", outcome: "skipped-time-filter" }],
    skippedReason: "time-filter",
    timeRangeLabel: "3d",
  });
  assert.equal(note, "Note: bing does not support time filtering (timeRange=3d), using exa.");
});

test("note form (b): preferred failed with a concrete reason", () => {
  const note = buildSearchNote({
    serving: "ddg",
    preferred: "exa",
    attempts: [
      { provider: "exa", outcome: "failed:rate-limit" },
      { provider: "ddg", outcome: "success" },
    ],
  });
  assert.equal(note, "Note: exa unavailable or failed (rate limited), using ddg.");
});

test("note form (b) covers a missing key as a skip", () => {
  const note = buildSearchNote({
    serving: "bing",
    preferred: "tavily",
    attempts: [
      { provider: "tavily", outcome: "skipped-no-keys" },
      { provider: "bing", outcome: "success" },
    ],
  });
  assert.equal(note, "Note: tavily unavailable or failed (no API key configured), using bing.");
});

test("note form (c): fallback without a recorded failure", () => {
  const note = buildSearchNote({ serving: "ddg", preferred: "exa", attempts: [{ provider: "ddg", outcome: "success" }] });
  assert.equal(note, "Note: exa unavailable or failed, using ddg.");
});

test("describeAttempt maps codes to human text", () => {
  assert.equal(describeAttempt("failed:auth"), "missing or invalid API key");
  assert.equal(describeAttempt("failed:empty"), "returned 0 results");
  assert.equal(describeAttempt("skipped-cooldown"), "cooling down");
  assert.equal(describeAttempt("success"), undefined);
});

// ---------------------------------------------------------------------------
// result cache
// ---------------------------------------------------------------------------

test("cache keys separate query, limit, window and preferred engine", () => {
  const base = { query: "dsh", maxResults: 5, timeRangeLabel: "week", preferred: "exa" };
  assert.notEqual(buildCacheKey(base), buildCacheKey({ ...base, timeRangeLabel: "day" }));
  assert.notEqual(buildCacheKey(base), buildCacheKey({ ...base, preferred: "bing" }));
  assert.notEqual(buildCacheKey(base), buildCacheKey({ ...base, query: "dsh2" }));
  assert.equal(buildCacheKey(base), buildCacheKey({ ...base }));
});

test("cache honours TTL and 0 disables it", () => {
  let now = 1_000;
  const cache = new SearchCache(CACHE_MAX_ENTRIES, () => now);
  cache.set("k", { sources: [{ url: "https://a" }], backend: "bing", fallback: false }, 60_000);
  assert.ok(cache.get("k", 60_000));
  now += 61_000;
  assert.equal(cache.get("k", 60_000), undefined);

  cache.set("k2", { sources: [{ url: "https://b" }], backend: "bing", fallback: false }, 60_000);
  assert.equal(cache.get("k2", 0), undefined);
});

test("fallback-served entries expire at one fifth of the TTL", () => {
  let now = 0;
  const cache = new SearchCache(CACHE_MAX_ENTRIES, () => now);
  cache.set("fallback", { sources: [{ url: "https://a" }], backend: "ddg", fallback: true }, 50_000);
  now = 11_000;
  assert.equal(cache.get("fallback", 50_000), undefined, "fallback entry should expire after ~10s");
});

test("cache evicts the oldest entry past capacity", () => {
  const cache = new SearchCache(3, () => 0);
  for (const key of ["a", "b", "c", "d"]) {
    cache.set(key, { sources: [{ url: `https://${key}` }], backend: "bing", fallback: false }, 60_000);
  }
  assert.equal(cache.size, 3);
  assert.equal(cache.get("a", 60_000), undefined);
  assert.ok(cache.get("d", 60_000));
});

// ---------------------------------------------------------------------------
// keyless engine parsers
// ---------------------------------------------------------------------------

test("DuckDuckGo redirect URLs are unwrapped", () => {
  assert.equal(
    extractDdgUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=x"),
    "https://example.com/a",
  );
  assert.equal(extractDdgUrl("//example.com/b"), "https://example.com/b");
  assert.equal(extractDdgUrl("https://example.com/c"), "https://example.com/c");
  assert.equal(extractDdgUrl(undefined), undefined);
});

test("snippets are de-noised and capped", () => {
  // Parity with dsh-free-search: the noise PHRASES are stripped (stray
  // connective words may remain), whitespace is collapsed, length is capped.
  const cleaned = cleanSnippet("Sign up to read more. Real content here") ?? "";
  assert.doesNotMatch(cleaned, /sign up|read more/i);
  assert.match(cleaned, /Real content here/);
  assert.equal(cleanSnippet("   spaced    out   "), "spaced out");
  assert.equal(cleanSnippet(undefined), undefined);
  assert.equal(cleanSnippet("x".repeat(500))?.length, 300);
});

test("sources are de-duplicated by URL and capped", () => {
  const sources = uniqueSources(
    [
      { url: "https://a" },
      { url: "https://a" },
      { url: "https://b" },
      { url: "https://c" },
    ],
    2,
  );
  assert.deepEqual(sources.map((s) => s.url), ["https://a", "https://b"]);
});

test("Keenable relative windows match dsh-free-search", () => {
  assert.equal(formatKeenableRelative(0.25), "12h");
  assert.equal(formatKeenableRelative(0.5), "12h");
  assert.equal(formatKeenableRelative(7), "7d");
  assert.equal(formatKeenableRelative(60), "2mo");
  assert.equal(formatKeenableRelative(730), "2y");
});

test("Keenable MCP text blocks become sources", () => {
  const text = [
    "Title: Node.js v24 release",
    "URL: https://nodejs.org/en/blog/release/v24",
    "Published: 2026-08-03",
    "Snippets:",
    "Krypton is the active LTS line.",
    "",
    "Title: Placeholder",
    "URL: https://example.com/x",
    "Published: N/A",
    "Snippets:",
    "no date here",
  ].join("\n");
  const sources = extractKeenableSources(text, 5);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].url, "https://nodejs.org/en/blog/release/v24");
  assert.equal(sources[0].publishedAt, "2026-08-03");
  assert.equal(sources[0].snippet, "Krypton is the active LTS line.");
  // "N/A" is a placeholder, never a publish date.
  assert.equal(sources[1].publishedAt, undefined);
});

test("MCP answers are parsed from JSON and SSE frames", () => {
  const json = parseMcpJson('{"result":{"content":[{"type":"text","text":"ok"}]}}');
  assert.equal(json?.result?.content?.[0]?.text, "ok");
  const sse = parseMcpJson('event: message\ndata: {"result":{"isError":true}}\n');
  assert.equal(sse?.result?.isError, true);
  assert.equal(parseMcpJson("not json at all"), null);
});

// ---------------------------------------------------------------------------
// parser-free guards: keyless registry + chain ordering
// ---------------------------------------------------------------------------

test("the merged engines are registered and marked keyless", () => {
  for (const name of ["bing", "ddg", "ddg-lite", "anysearch", "keenable"]) {
    assert.ok(PROVIDERS[name], `provider ${name} should be registered`);
    assert.equal(isKeyless(PROVIDERS[name]), true, `${name} should be keyless`);
  }
  for (const name of ["exa", "tavily", "firecrawl", "parallel"]) {
    assert.equal(isKeyless(PROVIDERS[name]), true, `${name} gained a keyless tier`);
  }
  for (const name of ["brave", "you", "jina"]) {
    assert.equal(isKeyless(PROVIDERS[name]), false, `${name} still needs a key`);
  }
  for (const name of KEYLESS_PROVIDER_NAMES) {
    assert.ok(PROVIDERS[name], `keyless list references an unregistered provider: ${name}`);
  }
});

test("time windows put filtering engines first and keep the requested engine on top", () => {
  const chain = ["exa", "tavily", "firecrawl", "bing", "anysearch", "ddg", "modsearch"];
  const ordered = orderChainForTimeRange(chain, TIME_FILTER_ENGINES, undefined);
  assert.equal(ordered.preferred, "exa");
  // Every time-capable engine must precede every engine that ignores dates.
  const firstNonFiltering = ordered.chain.findIndex((name) => !TIME_FILTER_ENGINES.includes(name));
  const lastFiltering = ordered.chain.reduce(
    (acc, name, i) => (TIME_FILTER_ENGINES.includes(name) ? i : acc),
    -1,
  );
  assert.ok(
    lastFiltering < firstNonFiltering,
    `filtering engines must come first, got ${ordered.chain.join(",")}`,
  );
  assert.deepEqual([...ordered.chain].sort(), [...chain].sort(), "reordering must not drop engines");

  const requested = orderChainForTimeRange(chain, TIME_FILTER_ENGINES, "ddg");
  assert.equal(requested.preferred, "ddg");
  assert.equal(requested.chain[0], "ddg");
  assert.equal(requested.skippedReason, undefined);

  const unsupported = orderChainForTimeRange(chain, TIME_FILTER_ENGINES, "bing");
  assert.equal(unsupported.preferred, "bing");
  assert.equal(unsupported.skippedReason, "time-filter");
});

test("exa search body keeps working for the keyed and keyless paths", () => {
  const body = buildExaSearchBody("dsh search", 5, undefined, {
    cleanQuery: "dsh search",
    rawQuery: "dsh search",
  });
  assert.equal(body.query, "dsh search");
  assert.equal(body.numResults, 5);
});

// ---------------------------------------------------------------------------
// prompt section
// ---------------------------------------------------------------------------

test("prompt section names the engines, the note contract and the tools", () => {
  const text = buildPromptText({
    preferred: "exa",
    chain: ["exa", "tavily", "bing"],
    engines: [
      { name: "exa", label: "Exa", keyed: false, timeCapable: true, enabled: true },
      { name: "bing", label: "Bing", keyed: false, timeCapable: false, enabled: true },
      { name: "brave", label: "Brave", keyed: true, timeCapable: false, enabled: true },
      { name: "you", label: "You.com", keyed: true, timeCapable: false, enabled: false },
    ],
    safeSearch: "off",
    bingMarket: "zh-CN",
    lang: "zh",
    cacheTtlMs: 300_000,
    cliAvailable: true,
    platformSearchEnabled: { github: true, npm: false },
  });
  assert.match(text, /Preferred engine: exa/);
  assert.match(text, /exa → tavily → bing/);
  assert.match(text, /advanced_search/);
  assert.match(text, /platform_search.*github/);
  assert.doesNotMatch(text, /npm/, "disabled platforms must not be advertised");
  assert.match(text, /does not support time filtering/);
  assert.match(text, /unavailable or failed/);
});
