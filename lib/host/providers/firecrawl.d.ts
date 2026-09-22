/**
 * dsh-omnisearch — Firecrawl provider adapter.
 *
 * API reference: https://docs.firecrawl.dev
 * - Base URL: https://api.firecrawl.dev/v2
 * - Auth: `Authorization: Bearer fc-...`
 * - POST /search — discover pages by query
 * - POST /scrape — extract clean markdown from a single URL
 *
 * @module
 */
import { type ProviderAdapter } from "./types.ts";
import type { SearchHints } from "../search-hints.ts";
/**
 * Build the /v2/search request body for Firecrawl.
 * Maps:
 *  - topic=code → categories: ["github"] (repositories, code, issues, and documentation)
 *  - topic=research → categories: ["research"]
 *  - freshness preset → tbs (qdr:d for day, qdr:w for week, qdr:m for month, qdr:y for year)
 *  - hard domains → includeDomains / excludeDomains (mutually exclusive)
 *  - locale country → country
 */
export declare function buildFirecrawlSearchBody(query: string, limit: number, hints?: Readonly<SearchHints>): Record<string, unknown>;
export declare const FIRECRAWL_META: {
    readonly name: "firecrawl";
    readonly label: "抓取搜索 Firecrawl";
    readonly description: "搜索 + 干净正文抓取（markdown）。无 key 也可用，配 key 提高限额。";
    readonly credSuffix: "FIRECRAWL";
    readonly fetchCapable: true;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
export declare const FirecrawlProvider: ProviderAdapter;
