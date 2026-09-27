/**
 * dsh-omnisearch — keyless "free engine" adapters (merged from dsh-free-search).
 *
 * These engines need NO credential, which is what makes dsh-omnisearch work on a
 * fresh install with no API keys at all:
 *
 *  - bing      : HTML scrape of bing.com/search (default engine upstream)
 *  - ddg       : HTML scrape of html.duckduckgo.com
 *  - ddg-lite  : HTML scrape of lite.duckduckgo.com
 *  - anysearch : JSON REST (anonymous quota; optional key raises it)
 *  - keenable  : REST with key, keyless MCP endpoint without one
 *
 * Plus one KEYED engine merged from the same upstream spec:
 *
 *  - serpbase  : Google organic results via API (requires a SerpBase key)
 *
 * Every adapter follows the dsh-web-tools adapter contract (classified
 * ProviderError, SearchHints-driven parameters) so the shared fallback chain,
 * cooldown store and key pools treat them like any other provider.
 *
 * @module
 */
import { providerError, resolveContext, type ProviderAdapter, type Source } from "./types.ts";
import { fetchWithProxy } from "../fetch-proxy.ts";
import { daysFromFreshness, freshnessLabel, approximateTier } from "../time-range.ts";
import {
  acceptLanguageFor,
  bingMarketFor,
  FREE_ENGINE_USER_AGENT,
  getFreeEngineOptions,
  LANG_PROFILES,
  type SafeSearchLevel,
} from "../free-engine-options.ts";
import type { SearchHints } from "../search-hints.ts";

const BING_URL = "https://www.bing.com/search";
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";
const ANYSEARCH_URL = "https://api.anysearch.com/v1/search";
const KEENABLE_URL = "https://api.keenable.ai/v1/search";
const KEENABLE_MCP_URL = "https://api.keenable.ai/mcp";

const HTML_TIMEOUT_MS = 12_000;

/**
 * Read a per-provider option, falling back to the plugin-wide free-engine
 * knob. Keeps adapters working both from the settings card (global) and from a
 * future per-engine override.
 */
export function knob<T>(options: unknown, key: string, fallback: T): T {
  if (options && typeof options === "object") {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) return value as T;
  }
  return fallback;
}

function decodeEntities(text: string): string {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

/** Drop login/paywall noise, collapse whitespace, cap length (dsh-free-search rule). */
export function cleanSnippet(text: string | undefined): string | undefined {
  if (!text) return text;
  return String(text)
    .replace(
      /\b(sign up|sign in|log in|login|subscribe( to| for)?|member[- ]?only|become a member|create (a )?free account|read more|continue reading|story continues|get started|install (the )?app|view on|medium membership|join \w+ for free|stories in your inbox|remember me for|unlock this|free to read|become a patron)\b/gi,
      " ",
    )
    .replace(/^\s*(#{1,6}\s*|\[\s*x?\s*\]\s*|-\s*\[\s*x?\s*\]\s*|>\s*)/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** De-duplicate by URL and cap the list. */
export function uniqueSources(sources: Source[], limit: number): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Unwrap DuckDuckGo's `/l/?uddg=` redirect wrapper. */
export function extractDdgUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const m = href.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (href.startsWith("//")) return `https:${href}`;
  return href;
}

interface TextFetchOptions {
  signal?: AbortSignal;
  acceptLang?: string;
  method?: "GET" | "POST";
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Extra headers sent only on POST form requests (form encoding). */
  form?: boolean;
}

/**
 * Fetch a search page with one retry budget: 12s per attempt, up to 3
 * attempts, 1.5s apart (mirrors dsh-free-search). Rate-limit / anti-bot pages
 * become a `rate-limit` ProviderError so the chain cools the engine down and
 * moves on instead of hammering it.
 */
async function fetchText(url: string | URL, opts: TextFetchOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? HTML_TIMEOUT_MS;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const headers: Record<string, string> = {
        "user-agent": FREE_ENGINE_USER_AGENT,
        "accept-language": opts.acceptLang ?? acceptLanguageFor(getFreeEngineOptions().lang),
        ...(opts.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...opts.headers,
      };
      const res = await fetchWithProxy(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          throw providerError("rate-limit", `engine rate-limited (HTTP ${res.status})`, res.status);
        }
        if (res.status >= 500) throw providerError("server", `engine error (HTTP ${res.status})`, res.status);
        throw providerError("bad-request", `engine request failed (HTTP ${res.status})`, res.status);
      }
      const text = await res.text();
      if (res.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(text.slice(0, 4000))) {
        throw providerError(
          "rate-limit",
          "DuckDuckGo is rate-limited right now (anti-bot challenge, usually temporary) - Bing works",
        );
      }
      if (text.length > 500) return text;
      lastError = new Error(`empty response (${text.length} bytes)`);
    } catch (error) {
      if (opts.signal?.aborted) throw providerError("aborted", "search aborted by caller");
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (lastError && "code" in lastError) throw lastError;
  throw providerError("network", `engine unreachable: ${lastError?.message ?? "unknown"}`);
}

/** Bing adult-filter value. */
function bingAdultFilter(level: SafeSearchLevel): string {
  return level;
}

/** DuckDuckGo adult-filter value (-1 off / 0 moderate / 1 strict). */
function ddgAdultFilter(level: SafeSearchLevel): string {
  return level === "strict" ? "1" : level === "moderate" ? "0" : "-1";
}

/** DuckDuckGo `df` freshness value from hints, or undefined. */
function ddgFreshness(hints?: Readonly<SearchHints>): string | undefined {
  const days = daysFromFreshness(hints?.freshness);
  if (days === undefined) return undefined;
  return { day: "d", week: "w", month: "m", year: "y" }[approximateTier(days)];
}

/** Query text handed to an engine (operators stripped by SearchHints). */
function engineQuery(query: string, hints?: Readonly<SearchHints>): string {
  return hints?.cleanQuery?.trim() ? hints.cleanQuery : query;
}

//#region bing relevance guard (merged from dsh-free-search v0.4.35)

/**
 * Overlap tokens used to detect Bing's "cached SERP for another query" page.
 * CJK runs contribute 1-2 character n-grams; latin/digit runs contribute words
 * of length >= 2.
 */
export function queryOverlapTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) tokens.add(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  for (const word of String(query).toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 2) tokens.add(word);
  }
  return [...tokens];
}

/**
 * Whether ANY result looks related to the query at all.
 *
 * Bing answers a no-result query with a completely unrelated cached SERP
 * (`<li class="b_algo">` blocks are still there, but the content belongs to
 * another query/hot page — issue #38). Treating that as "0 results" hands the
 * query to the next engine instead of feeding the model garbage.
 *
 * A query made only of punctuation cannot be judged, so it is never blocked.
 */
export function looksRelevant(query: string, sources: Source[]): boolean {
  const tokens = queryOverlapTokens(query);
  if (tokens.length === 0) return true;
  return sources.some((s) => {
    const hay = `${s.title ?? ""} ${s.snippet ?? ""} ${s.url ?? ""}`.toLowerCase();
    return tokens.some((t) => hay.includes(t.toLowerCase()));
  });
}

//#endregion

//#region bing

export const BING_META = {
  name: "bing",
  label: "必应 Bing（无 key 也可用）",
  description: "免费 HTML 搜索，无 key 也可用；默认引擎，中文优化。",
  credSuffix: "BING",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

export const BingProvider: ProviderAdapter = {
  ...BING_META,
  async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints, options } = resolveContext(contextOrSignal);
    const globals = getFreeEngineOptions();
    const market = knob(options, "bingMarket", bingMarketFor(globals.bingMarket, globals.lang));
    const acceptLang = globals.bingMarket
      ? (LANG_PROFILES[Object.keys(LANG_PROFILES).find((k) => LANG_PROFILES[k].market === market) ?? "zh"]?.acceptLang ?? acceptLanguageFor(globals.lang))
      : acceptLanguageFor(globals.lang);
    const params = new URLSearchParams({ q: engineQuery(query, hints), mkt: market });
    const safe = knob<SafeSearchLevel>(
      options,
      "safeSearch",
      globals.safeSearch ?? "off",
    );
    if (safe) params.set("adlt", bingAdultFilter(safe));

    const html = await fetchText(`${BING_URL}?${params}`, { signal, acceptLang });
    const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
    const sources: Source[] = [];
    for (const block of blocks) {
      const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
      if (!hrefMatch) continue;
      const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const snippet = cleanSnippet(snippetMatch ? stripTags(snippetMatch[1]) : undefined);
      sources.push({
        url: decodeEntities(hrefMatch[1]),
        ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
        ...(snippet ? { snippet } : {}),
      });
    }
    // Bing serves an unrelated cached SERP when a query has no real results:
    // count that as 0 results so the shared chain falls over to the next engine.
    if (sources.length > 0 && !looksRelevant(engineQuery(query, hints), sources)) {
      return { sources: [] };
    }
    return { sources: uniqueSources(sources, maxResults ?? 10) };
  },
  async fetch() {
    throw providerError("config", "bing does not provide native fetch; use the generic path");
  },
};

//#endregion

//#region duckduckgo (html + lite)

export const DDG_META = {
  name: "ddg",
  label: "鸭鸭搜 DuckDuckGo（无 key 也可用）",
  description: "免费 HTML 搜索，无 key 也可用；可能被限流，会自动回退。",
  credSuffix: "DDG",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

export const DuckDuckGoProvider: ProviderAdapter = {
  ...DDG_META,
  async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints, options } = resolveContext(contextOrSignal);
    const globals = getFreeEngineOptions();
    const params = new URLSearchParams({ q: engineQuery(query, hints) });
    const region = knob<string | undefined>(options, "region", globals.region);
    if (region) params.set("kl", region);
    params.set("adlt", ddgAdultFilter(knob<SafeSearchLevel>(options, "safeSearch", globals.safeSearch ?? "off")));
    const df = ddgFreshness(hints);
    if (df) params.set("df", df);

    const html = await fetchText(`${DDG_HTML_URL}?${params}`, { signal });
    const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
    const sources: Source[] = [];
    for (const block of blocks) {
      const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
      if (!urlMatch) continue;
      const url = extractDdgUrl(urlMatch[1]);
      if (!url) continue;
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
      const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
      const snippet = cleanSnippet(snippetMatch ? stripTags(snippetMatch[1]) : undefined);
      sources.push({
        url,
        ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
        ...(snippet ? { snippet } : {}),
        ...(dateMatch ? { publishedAt: dateMatch[1] } : {}),
      });
    }
    return { sources: uniqueSources(sources, maxResults ?? 10) };
  },
  async fetch() {
    throw providerError("config", "ddg does not provide native fetch; use the generic path");
  },
};

export const DDG_LITE_META = {
  name: "ddg-lite",
  label: "鸭鸭搜轻量 DuckDuckGo Lite（无 key 也可用）",
  description: "DuckDuckGo 轻量端点，无 key 也可用；限流表现与 ddg 相同。",
  credSuffix: "DDG_LITE",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

export const DuckDuckGoLiteProvider: ProviderAdapter = {
  ...DDG_LITE_META,
  async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints, options } = resolveContext(contextOrSignal);
    const globals = getFreeEngineOptions();
    const params = new URLSearchParams({ q: engineQuery(query, hints) });
    params.set("adlt", ddgAdultFilter(knob<SafeSearchLevel>(options, "safeSearch", globals.safeSearch ?? "off")));
    const df = ddgFreshness(hints);
    if (df) params.set("df", df);

    const html = await fetchText(`${DDG_LITE_URL}?${params}`, { signal });
    const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
    const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
    const sources: Source[] = [];
    for (let i = 0; i < linkMatches.length; i++) {
      const tag = linkMatches[i];
      const hrefMatch = tag.match(/href="([^"]*)"/);
      if (!hrefMatch) continue;
      const url = extractDdgUrl(hrefMatch[1]);
      if (!url) continue;
      const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
      const snippetRaw = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
      const snippet = cleanSnippet(snippetRaw ? stripTags(snippetRaw) : undefined);
      sources.push({
        url,
        ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
        ...(snippet ? { snippet } : {}),
      });
    }
    return { sources: uniqueSources(sources, maxResults ?? 10) };
  },
  async fetch() {
    throw providerError("config", "ddg-lite does not provide native fetch; use the generic path");
  },
};

//#endregion

//#region anysearch

/**
 * Result note when a configured AnySearch key was rejected (merged from
 * dsh-free-search v0.4.39). It is surfaced as the outcome's `content`, so the
 * model sees why it fell back to the anonymous tier.
 */
export const ANYSEARCH_KEY_INVALID_NOTE = "AnySearch key 无效，本次已忽略该 key，改回免费匿名";

/**
 * In-process memory of a key AnySearch rejected with 401/403.
 *
 * Upstream semantics (v0.4.39): a bad key is ignored for the rest of this
 * process instead of being deleted from storage, so one bad credential cannot
 * take the engine down; an explicit user write of a key clears the memory.
 */
let ignoredAnysearchKey = "";

/** Allow the next AnySearch call to send a key again (called on key writes). */
export function resetIgnoredAnysearchKey(): void {
  ignoredAnysearchKey = "";
}

/** The key currently ignored in this process (diagnostics/tests). */
export function ignoredAnysearchKeyValue(): string {
  return ignoredAnysearchKey;
}

/**
 * Which key to send for one call, and whether the configured value is already
 * known-bad in this process. Pure: the caller owns the sticky state.
 */
export function decideAnysearchKey(apiKey: string | undefined): { sendKey: string; sticky: boolean } {
  const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
  const sticky = Boolean(trimmed) && trimmed === ignoredAnysearchKey;
  return { sendKey: trimmed && !sticky ? trimmed : "", sticky };
}

export const ANYSEARCH_META = {
  name: "anysearch",
  label: "AI 搜索 AnySearch（无 key 也可用）",
  description: "AI 搜索 REST 端点，匿名公共额度；可选 key 提额，key 被拒时自动回退匿名。",
  credSuffix: "ANYSEARCH",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

export const AnySearchProvider: ProviderAdapter = {
  ...ANYSEARCH_META,
  async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints } = resolveContext(contextOrSignal);
    const { sendKey, sticky } = decideAnysearchKey(apiKey);
    const doFetch = (key: string) =>
      fetchWithProxy(ANYSEARCH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ query: engineQuery(query, hints), max_results: maxResults ?? 5 }),
        signal,
      });

    let res: Response;
    let keyRejected = false;
    try {
      res = await doFetch(sendKey);
      if ((res.status === 401 || res.status === 403) && sendKey) {
        // Bad key: ignore it for THIS PROCESS only (never touch the stored
        // credential) and retry anonymously so the engine stays usable.
        ignoredAnysearchKey = sendKey;
        keyRejected = true;
        res = await doFetch("");
      }
    } catch (error) {
      if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
      throw providerError("network", `AnySearch request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw providerError(
        "auth",
        keyRejected
          ? `${ANYSEARCH_KEY_INVALID_NOTE} (HTTP ${res.status})`
          : `AnySearch API key rejected (HTTP ${res.status})`,
        res.status,
      );
    }
    if (!res.ok) {
      if (res.status === 429) throw providerError("rate-limit", "AnySearch anonymous quota exhausted", res.status);
      if (res.status >= 500) throw providerError("server", `AnySearch error (HTTP ${res.status})`, res.status);
      throw providerError("bad-request", `AnySearch error (HTTP ${res.status})`, res.status);
    }
    const data = (await res.json()) as {
      code?: number;
      message?: string;
      data?: { results?: Array<{ url?: string; title?: string; snippet?: string }> };
    };
    if (data.code !== 0) {
      throw providerError("bad-request", `AnySearch API error: ${data.message ?? data.code}`);
    }
    const results = data.data?.results ?? [];
    const sources: Source[] = [];
    for (const r of results) {
      if (!r?.url) continue;
      const snippet = cleanSnippet(r.snippet);
      sources.push({
        url: r.url,
        ...(r.title ? { title: String(r.title) } : {}),
        ...(snippet ? { snippet } : {}),
      });
    }
    return {
      sources: uniqueSources(sources, maxResults ?? 10),
      ...(keyRejected || sticky ? { content: ANYSEARCH_KEY_INVALID_NOTE } : {}),
    };
  },
  async fetch() {
    throw providerError("config", "anysearch does not provide native fetch; use the generic path");
  },
};

//#endregion

//#region serpbase (keyed, merged from dsh-free-search v0.4.32 spec 1.12)

const SERPBASE_URL = "https://api.serpbase.dev/google/search";

/** Google `hl`/`gl` per configured language (defaults to en/us, as upstream). */
const SERPBASE_LOCALE: Record<string, { hl: string; gl: string }> = {
  zh: { hl: "zh-CN", gl: "cn" },
  en: { hl: "en", gl: "us" },
  ru: { hl: "ru", gl: "ru" },
  ja: { hl: "ja", gl: "jp" },
  de: { hl: "de", gl: "de" },
  fr: { hl: "fr", gl: "fr" },
  es: { hl: "es", gl: "es" },
  ko: { hl: "ko", gl: "kr" },
};

/** SerpBase's Google hl/gl for a language code (unknown languages fall back to en). */
export function serpbaseLocale(lang: string | undefined): { hl: string; gl: string } {
  return SERPBASE_LOCALE[lang ?? ""] ?? SERPBASE_LOCALE.en;
}

/**
 * Parse a SerpBase success body into sources.
 *
 * SerpBase always answers HTTP 200 and puts the business status in the JSON
 * body (`status`: 0 ok / 1001 invalid-or-missing key / 1000 bad request), so
 * the status field — not the HTTP code — decides success or failure.
 */
export function parseSerpbaseBody(
  data: {
    status?: number;
    error?: unknown;
    organic?: Array<{ link?: string; title?: string; snippet?: string; published_at?: string; date?: string }>;
  },
  maxResults: number,
): Source[] {
  const sources: Source[] = [];
  for (const r of data.organic ?? []) {
    if (!r?.link) continue;
    const published = r.published_at ?? r.date;
    sources.push({
      url: r.link,
      ...(r.title ? { title: String(r.title) } : {}),
      ...(r.snippet ? { snippet: String(r.snippet) } : {}),
      ...(published ? { publishedAt: String(published) } : {}),
    });
  }
  return uniqueSources(sources, maxResults);
}

export const SERPBASE_META = {
  name: "serpbase",
  label: "Google 结果 SerpBase（需 API key）",
  description: "Google organic 结果 API，需配置 SerpBase key（注册含免费额度）；无 key 时自动跳过。",
  credSuffix: "SERPBASE",
  fetchCapable: false,
  needsBaseUrl: false,
  // Keyed engine: no credential → the executor skips it (see isKeyless).
} as const;

export const SerpBaseProvider: ProviderAdapter = {
  ...SERPBASE_META,
  async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints } = resolveContext(contextOrSignal);
    if (!apiKey) throw providerError("config", "SerpBase requires an API key (DSH_OMNISEARCH_SERPBASE)");
    const { hl, gl } = serpbaseLocale(getFreeEngineOptions().lang);
    let res: Response;
    try {
      res = await fetchWithProxy(SERPBASE_URL, {
        method: "POST",
        // SerpBase is a plain JSON API: never follow a redirect off-host.
        redirect: "error",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": FREE_ENGINE_USER_AGENT,
        },
        body: JSON.stringify({ q: engineQuery(query, hints), hl, gl, page: 1 }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
      throw providerError("network", `SerpBase request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const status = res.status;
      if (status === 401 || status === 403) throw providerError("auth", `SerpBase API key rejected (HTTP ${status})`, status);
      if (status === 429) throw providerError("rate-limit", "SerpBase rate-limited or out of free queries", status);
      if (status >= 500) throw providerError("server", `SerpBase error (HTTP ${status}): ${detail.slice(0, 200)}`, status);
      throw providerError("bad-request", `SerpBase API error (HTTP ${status}): ${detail.slice(0, 200)}`, status);
    }
    const data = (await res.json()) as {
      status?: number;
      error?: unknown;
      organic?: Array<{ link?: string; title?: string; snippet?: string; published_at?: string; date?: string }>;
    };
    if (data.status !== 0) {
      if (data.status === 1001) {
        throw providerError("auth", "SerpBase API key is invalid or missing (status 1001) — update the SerpBase credential");
      }
      throw providerError("bad-request", `SerpBase API error (status ${data.status}): ${String(data.error ?? "").slice(0, 200)}`);
    }
    return { sources: parseSerpbaseBody(data, maxResults ?? 10) };
  },
  async fetch() {
    throw providerError("config", "serpbase does not provide native fetch; use the generic path");
  },
};

//#endregion

//#region keenable

export const KEENABLE_META = {
  name: "keenable",
  label: "实时检索 Keenable",
  description: "实时网页搜索。无 key 也可用（公共 MCP 端点），配 key 提升额度。",
  credSuffix: "KEENABLE",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

/** Keenable relative window format ("12h" / "7d" / "2mo" / "1y"). */
export function formatKeenableRelative(days: number): string {
  if (days <= 0.5) return "12h";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Parse Keenable's "Title:/URL:/Published:/Snippets:" text blocks. */
export function extractKeenableSources(text: string, maxResults: number): Source[] {
  const sources: Source[] = [];
  for (const block of String(text).split(/\n(?=Title:)/)) {
    const url = block.match(/^URL: (\S+)$/m)?.[1];
    if (!url) continue;
    const title = block.match(/^Title: (.+)$/m)?.[1];
    const published = block.match(/^Published: (.+)$/m)?.[1] ?? block.match(/^Acquired: (.+)$/m)?.[1];
    const snippets = block
      .split(/^Snippets:$/m)[1]
      ?.split("\n")
      .filter((l) => l.trim())
      .slice(0, 3)
      .join(" ");
    const snippet = cleanSnippet(snippets);
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { publishedAt: published } : {}),
    });
  }
  return uniqueSources(sources, maxResults);
}

/** `published_after` value for a freshness hint (relative or absolute). */
function keenablePublishedAfter(hints?: Readonly<SearchHints>): string | undefined {
  if (!hints?.freshness) return undefined;
  if (hints.freshness.after) return hints.freshness.after;
  const days = daysFromFreshness(hints.freshness);
  return days === undefined ? undefined : formatKeenableRelative(days);
}

export const KeenableProvider: ProviderAdapter = {
  ...KEENABLE_META,
  async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints } = resolveContext(contextOrSignal);
    const q = engineQuery(query, hints);
    const limit = maxResults ?? 10;
    if (apiKey) {
      // Account tier: REST API with X-API-Key.
      const body: Record<string, unknown> = { query: q, mode: "realtime" };
      const after = keenablePublishedAfter(hints);
      if (after) body.published_after = after;
      let res: Response;
      try {
        res = await fetchWithProxy(KEENABLE_URL, {
          method: "POST",
          headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
        throw providerError("network", `Keenable request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw providerError("auth", `Keenable key rejected (HTTP ${res.status})`, res.status);
        if (res.status === 429) throw providerError("rate-limit", "Keenable rate-limited", res.status);
        if (res.status >= 500) throw providerError("server", `Keenable error (HTTP ${res.status})`, res.status);
        throw providerError("bad-request", `Keenable error (HTTP ${res.status})`, res.status);
      }
      const data = (await res.json()) as { results?: Array<{ url?: string; title?: string; snippet?: string }> };
      const sources: Source[] = [];
      for (const r of data.results ?? []) {
        if (!r?.url) continue;
        const snippet = cleanSnippet(r.snippet);
        sources.push({ url: r.url, ...(r.title ? { title: String(r.title) } : {}), ...(snippet ? { snippet } : {}) });
      }
      if (sources.length > 0) return { sources: uniqueSources(sources, limit) };
      // Fall through to MCP when the REST tier returns nothing usable.
    }

    // Keyless tier: public MCP endpoint (JSON-RPC tools/call).
    const args: Record<string, unknown> = { query: q };
    const after = keenablePublishedAfter(hints);
    if (after) args.published_after = after;
    let res: Response;
    try {
      res = await fetchWithProxy(KEENABLE_MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: "search_web_pages", arguments: args },
        }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
      throw providerError("network", `Keenable MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) {
      if (res.status === 429) throw providerError("rate-limit", "Keenable MCP rate-limited", res.status);
      throw providerError("server", `Keenable MCP error (HTTP ${res.status})`, res.status);
    }
    const raw = await res.text();
    const data = parseMcpJson(raw);
    if (!data || data.error) {
      throw providerError("invalid-response", `Keenable MCP error: ${data?.error?.message ?? "no data"}`);
    }
    const content = (data.result?.content ?? []) as Array<{ type?: string; text?: string }>;
    const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    if (data.result?.isError) {
      throw providerError("bad-request", `Keenable MCP error: ${text.slice(0, 200)}`);
    }
    return { sources: extractKeenableSources(text, limit) };
  },
  async fetch() {
    throw providerError("config", "keenable does not provide native fetch; use the generic path");
  },
};

//#endregion

/** MCP over HTTP answers either JSON or an SSE stream ("data: {...}"). */
export function parseMcpJson(text: string): {
  error?: { message?: string };
  result?: { content?: unknown[]; isError?: boolean };
} | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

/** Freshness label helper re-exported for callers that only hold hints. */
export { freshnessLabel };
