/**
 * Tests for the engines ported from dsh-web-search-enhanced (tinyfish, openalex).
 * Covers pure parsing/normalization plus registry wiring; no network calls.
 * @module
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PROVIDERS, FREE_ENGINE_PROVIDERS, KEYLESS_PROVIDER_NAMES } from "../src/host/providers/index.ts";
import { DEFAULT_FALLBACK_ORDER } from "../src/host/config.ts";
import { reconstructInvertedIndex, openAlexSource } from "../src/host/providers/openalex.ts";
import { extractTinyfishSources } from "../src/host/providers/tinyfish.ts";

//#region registry wiring

test("ported engines are registered, keyless, and in the default chain", () => {
  for (const name of ["tinyfish", "openalex"]) {
    const p = PROVIDERS[name];
    assert.ok(p, `${name} registered in PROVIDERS`);
    assert.equal(p.keyless, true, `${name} is keyless`);
    assert.ok(KEYLESS_PROVIDER_NAMES.includes(name), `${name} in KEYLESS_PROVIDER_NAMES`);
    assert.ok(DEFAULT_FALLBACK_ORDER.includes(name), `${name} in DEFAULT_FALLBACK_ORDER`);
    assert.ok(FREE_ENGINE_PROVIDERS.some((e) => e.name === name), `${name} in FREE_ENGINE_PROVIDERS`);
    assert.equal(p.fetchCapable, false, `${name} has no native fetch (generic path applies)`);
    assert.match(p.credSuffix, /^[A-Z_]+$/, `${name} credSuffix is upper snake`);
  }
  // Engine-list metadata used by the system prompt stays consistent with the registry.
  const keylessFromList = FREE_ENGINE_PROVIDERS.map((e) => e.name);
  assert.ok(keylessFromList.includes("tinyfish") && keylessFromList.includes("openalex"));
});

//#endregion

//#region openalex

test("reconstructInvertedIndex rebuilds abstract word order", () => {
  const abstract = reconstructInvertedIndex({
    hello: [0],
    world: [2],
    big: [1],
  });
  assert.equal(abstract, "hello big world");
  assert.equal(reconstructInvertedIndex(undefined), undefined);
  assert.equal(reconstructInvertedIndex({ a: ["bad"] }), undefined);
  assert.equal(reconstructInvertedIndex({}), undefined);
});

test("openAlexSource normalizes a work row (url fallbacks, snippet parts, date)", () => {
  const src = openAlexSource({
    doi: "https://doi.org/10.1000/x",
    display_name: "A Study",
    cited_by_count: 12,
    authorships: [{ author: { display_name: "Alice" } }, { author: { display_name: "Bob" } }],
    open_access: { oa_url: "https://example.com/pdf.pdf" },
    primary_location: { landing_page_url: "https://journals.example/a" },
    abstract_inverted_index: { deep: [0], learning: [1], rocks: [2] },
    publication_date: "2024-05-01",
  });
  assert.ok(src);
  assert.equal(src.url, "https://doi.org/10.1000/x");
  assert.equal(src.title, "A Study");
  assert.ok(src.snippet?.includes("[Citations: 12]"));
  assert.ok(src.snippet?.includes("[Authors: Alice, Bob]"));
  assert.ok(src.snippet?.includes("[OA PDF: https://example.com/pdf.pdf]"));
  assert.ok(src.snippet?.endsWith("deep learning rocks"));
  assert.equal(src.publishedAt, "2024-05-01");

  // Falls back doi → oa_url → landing → id; skips rows without any URL.
  const noUrl = openAlexSource({ display_name: "orphan" });
  assert.equal(noUrl, undefined);
  const byId = openAlexSource({ id: "https://openalex.org/W1" });
  assert.equal(byId?.url, "https://openalex.org/W1");
});

//#endregion

//#region tinyfish

test("extractTinyfishSources keeps http(s) rows and caps/dedupes", () => {
  const rows = {
    results: [
      { url: "https://a.example/1", title: "One", snippet: "first  result" },
      { url: "http://b.example/2", title: "Two", snippet: "second" },
      { url: "ftp://bad.example/3", title: "Bad" },
      { url: "https://a.example/1", title: "Dup" },
      {},
    ],
  };
  const sources = extractTinyfishSources(rows, 10);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].url, "https://a.example/1");
  assert.equal(sources[0].title, "One");
  assert.equal(sources[0].snippet, "first result");
  assert.equal(sources[1].url, "http://b.example/2");

  assert.deepEqual(extractTinyfishSources({}, 10), []);
  assert.deepEqual(extractTinyfishSources({ results: "nope" }, 10), []);
});

//#endregion
