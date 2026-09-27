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
import { type ProviderAdapter, type Source } from "./types.ts";
import { freshnessLabel } from "../time-range.ts";
/**
 * Read a per-provider option, falling back to the plugin-wide free-engine
 * knob. Keeps adapters working both from the settings card (global) and from a
 * future per-engine override.
 */
export declare function knob<T>(options: unknown, key: string, fallback: T): T;
/** Drop login/paywall noise, collapse whitespace, cap length (dsh-free-search rule). */
export declare function cleanSnippet(text: string | undefined): string | undefined;
/** De-duplicate by URL and cap the list. */
export declare function uniqueSources(sources: Source[], limit: number): Source[];
/** Unwrap DuckDuckGo's `/l/?uddg=` redirect wrapper. */
export declare function extractDdgUrl(href: string | undefined): string | undefined;
/**
 * Overlap tokens used to detect Bing's "cached SERP for another query" page.
 * CJK runs contribute 1-2 character n-grams; latin/digit runs contribute words
 * of length >= 2.
 */
export declare function queryOverlapTokens(query: string): string[];
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
export declare function looksRelevant(query: string, sources: Source[]): boolean;
export declare const BING_META: {
    readonly name: "bing";
    readonly label: "必应 Bing（无 key 也可用）";
    readonly description: "免费 HTML 搜索，无 key 也可用；默认引擎，中文优化。";
    readonly credSuffix: "BING";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
export declare const BingProvider: ProviderAdapter;
export declare const DDG_META: {
    readonly name: "ddg";
    readonly label: "鸭鸭搜 DuckDuckGo（无 key 也可用）";
    readonly description: "免费 HTML 搜索，无 key 也可用；可能被限流，会自动回退。";
    readonly credSuffix: "DDG";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
export declare const DuckDuckGoProvider: ProviderAdapter;
export declare const DDG_LITE_META: {
    readonly name: "ddg-lite";
    readonly label: "鸭鸭搜轻量 DuckDuckGo Lite（无 key 也可用）";
    readonly description: "DuckDuckGo 轻量端点，无 key 也可用；限流表现与 ddg 相同。";
    readonly credSuffix: "DDG_LITE";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
export declare const DuckDuckGoLiteProvider: ProviderAdapter;
/**
 * Result note when a configured AnySearch key was rejected (merged from
 * dsh-free-search v0.4.39). It is surfaced as the outcome's `content`, so the
 * model sees why it fell back to the anonymous tier.
 */
export declare const ANYSEARCH_KEY_INVALID_NOTE = "AnySearch key \u65E0\u6548\uFF0C\u672C\u6B21\u5DF2\u5FFD\u7565\u8BE5 key\uFF0C\u6539\u56DE\u514D\u8D39\u533F\u540D";
/** Allow the next AnySearch call to send a key again (called on key writes). */
export declare function resetIgnoredAnysearchKey(): void;
/** The key currently ignored in this process (diagnostics/tests). */
export declare function ignoredAnysearchKeyValue(): string;
/**
 * Which key to send for one call, and whether the configured value is already
 * known-bad in this process. Pure: the caller owns the sticky state.
 */
export declare function decideAnysearchKey(apiKey: string | undefined): {
    sendKey: string;
    sticky: boolean;
};
export declare const ANYSEARCH_META: {
    readonly name: "anysearch";
    readonly label: "AI 搜索 AnySearch（无 key 也可用）";
    readonly description: "AI 搜索 REST 端点，匿名公共额度；可选 key 提额，key 被拒时自动回退匿名。";
    readonly credSuffix: "ANYSEARCH";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
export declare const AnySearchProvider: ProviderAdapter;
/** SerpBase's Google hl/gl for a language code (unknown languages fall back to en). */
export declare function serpbaseLocale(lang: string | undefined): {
    hl: string;
    gl: string;
};
/**
 * Parse a SerpBase success body into sources.
 *
 * SerpBase always answers HTTP 200 and puts the business status in the JSON
 * body (`status`: 0 ok / 1001 invalid-or-missing key / 1000 bad request), so
 * the status field — not the HTTP code — decides success or failure.
 */
export declare function parseSerpbaseBody(data: {
    status?: number;
    error?: unknown;
    organic?: Array<{
        link?: string;
        title?: string;
        snippet?: string;
        published_at?: string;
        date?: string;
    }>;
}, maxResults: number): Source[];
export declare const SERPBASE_META: {
    readonly name: "serpbase";
    readonly label: "Google 结果 SerpBase（需 API key）";
    readonly description: "Google organic 结果 API，需配置 SerpBase key（注册含免费额度）；无 key 时自动跳过。";
    readonly credSuffix: "SERPBASE";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
};
export declare const SerpBaseProvider: ProviderAdapter;
export declare const KEENABLE_META: {
    readonly name: "keenable";
    readonly label: "实时检索 Keenable";
    readonly description: "实时网页搜索。无 key 也可用（公共 MCP 端点），配 key 提升额度。";
    readonly credSuffix: "KEENABLE";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
/** Keenable relative window format ("12h" / "7d" / "2mo" / "1y"). */
export declare function formatKeenableRelative(days: number): string;
/** Parse Keenable's "Title:/URL:/Published:/Snippets:" text blocks. */
export declare function extractKeenableSources(text: string, maxResults: number): Source[];
export declare const KeenableProvider: ProviderAdapter;
/** MCP over HTTP answers either JSON or an SSE stream ("data: {...}"). */
export declare function parseMcpJson(text: string): {
    error?: {
        message?: string;
    };
    result?: {
        content?: unknown[];
        isError?: boolean;
    };
} | null;
/** Freshness label helper re-exported for callers that only hold hints. */
export { freshnessLabel };
