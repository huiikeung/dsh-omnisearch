/**
 * dsh-omnisearch — Tinyfish web/news search adapter.
 *
 * Ported from dsh-web-search-enhanced (Yurzi) v0.1.4, MIT — adapted to the
 * dsh-omnisearch adapter contract. Two tiers, mirroring upstream:
 *
 *  - key:  GET https://api.search.tinyfish.ai?query=<q>&page=0 with `x-api-key`
 *  - no key: public MCP endpoint https://agent.tinyfish.ai/mcp with
 *    `X-TinyFish-Access-Mode: keyless` (stateless JSON-RPC tools/call; the
 *    server's own announcement: 30 requests/min, 50 searches per UTC day)
 *
 * Keyless covers `domain_type: web | news` only — `research_paper` requires a
 * key (upstream throws; we just drop the option so keyless still searches).
 *
 * @module
 */
import { type ProviderAdapter, type Source } from "./types.ts";
export declare const TINYFISH_META: {
    readonly name: "tinyfish";
    readonly label: "跨语言 Tinyfish（无 key 也可用）";
    readonly description: "跨语言/地域化网页与新闻搜索。无 key 走公共通道（每日 50 次限额，限流自动回退），配 key 提升额度。";
    readonly credSuffix: "TINYFISH";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
/** Options accepted by Tinyfish (validated upstream; we mirror the safe subset). */
export interface TinyfishOptions {
    /** Two-letter country code (e.g. "us", "jp"). */
    location?: string;
    /** BCP-47-ish language tag (e.g. "zh", "en-US"). */
    language?: string;
    /** Free-text search purpose hint (<= 2000 chars). */
    purpose?: string;
    /** "web" | "news" | "research_paper" (research_paper needs a key). */
    domain_type?: string;
}
/** Extract sources from Tinyfish's result payload (REST JSON or MCP text JSON). */
export declare function extractTinyfishSources(payload: {
    results?: unknown;
}, maxResults: number): Source[];
export declare const TinyfishProvider: ProviderAdapter;
