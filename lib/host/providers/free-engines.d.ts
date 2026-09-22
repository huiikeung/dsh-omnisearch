/**
 * dsh-omnisearch — keyless "free engine" adapters (merged from dsh-free-search).
 *
 * These engines need NO credential, which is what makes dsh-omnisearch work on a
 * fresh install with no API keys at all:
 *
 *  - bing      : HTML scrape of bing.com/search (default engine upstream)
 *  - ddg       : HTML scrape of html.duckduckgo.com
 *  - ddg-lite  : HTML scrape of lite.duckduckgo.com
 *  - anysearch : JSON REST (anonymous quota)
 *  - keenable  : REST with key, keyless MCP endpoint without one
 *
 * Every adapter follows the dsh-web-tools adapter contract (classified
 * ProviderError, SearchHints-driven parameters) so the shared fallback chain,
 * cooldown store and key pools treat them like any other provider.
 *
 * @module
 */
import { type ProviderAdapter, type Source } from "./types.ts";
import { freshnessLabel } from "../time-range.ts";
/** Drop login/paywall noise, collapse whitespace, cap length (dsh-free-search rule). */
export declare function cleanSnippet(text: string | undefined): string | undefined;
/** De-duplicate by URL and cap the list. */
export declare function uniqueSources(sources: Source[], limit: number): Source[];
/** Unwrap DuckDuckGo's `/l/?uddg=` redirect wrapper. */
export declare function extractDdgUrl(href: string | undefined): string | undefined;
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
export declare const ANYSEARCH_META: {
    readonly name: "anysearch";
    readonly label: "AI 搜索 AnySearch（无 key 也可用）";
    readonly description: "AI 搜索 REST 端点，匿名公共额度，无 key 也可用。";
    readonly credSuffix: "ANYSEARCH";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
export declare const AnySearchProvider: ProviderAdapter;
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
