/**
 * dsh-omnisearch — `platform_search` tool (merged from dsh-free-search).
 *
 * Searches a specific platform's public API instead of the open web. All eight
 * platforms are keyless and zero-dependency. The enabled set comes from the
 * `platformSearchEnabled` settings map, so the model is never offered a
 * platform the user switched off.
 *
 * @module
 */
import { type WebToolsToolDefinition } from "../context-types.ts";
/** Supported platforms, in the order shown to the model. */
export declare const PLATFORM_IDS: readonly ["github", "v2ex", "bilibili", "reddit", "hn", "stackoverflow", "wikipedia", "npm"];
export type PlatformId = (typeof PLATFORM_IDS)[number];
/** One normalized platform hit. */
export interface PlatformHit {
    url: string;
    title?: string;
    snippet?: string;
}
/** GitHub repository search (public API, no key). */
export declare function searchGithub(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** V2EX has no search API: filter the public hot list locally. */
export declare function searchV2ex(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** Bilibili search (public endpoint; needs a Referer). */
export declare function searchBilibili(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** Reddit search via the old.reddit JSON endpoint (UA must be identifiable). */
export declare function searchReddit(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** Hacker News (Algolia API). */
export declare function searchHackerNews(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** Stack Overflow (Stack Exchange API, fixed filter for a compact shape). */
export declare function searchStackOverflow(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** Wikipedia (zh by default, en when lang === "en"). */
export declare function searchWikipedia(query: string, maxResults: number, signal?: AbortSignal, lang?: string): Promise<PlatformHit[]>;
/** npm registry package search. */
export declare function searchNpm(query: string, maxResults: number, signal?: AbortSignal): Promise<PlatformHit[]>;
/** Dispatch one platform search. */
export declare function searchPlatform(platform: PlatformId, query: string, maxResults: number, signal?: AbortSignal, lang?: string): Promise<PlatformHit[]>;
/** Tool argument shape. */
export interface PlatformSearchArgs {
    platform: PlatformId;
    query: string;
    max_results?: number;
    lang?: string;
}
/** Tool result shape. */
export interface PlatformSearchResult {
    platform: string;
    query: string;
    results: Array<{
        title: string;
        url: string;
        snippet?: string;
    }>;
    count: number;
    error?: string;
}
/** Dependencies injected by the host plugin. */
export interface PlatformSearchDeps {
    /** Platform → enabled map (from settings). */
    enabled: () => Record<string, boolean>;
    /** Default result language for the Wikipedia host choice. */
    lang: () => string;
}
/** Build the `platform_search` tool definition. */
export declare function createPlatformSearchTool(deps: PlatformSearchDeps): WebToolsToolDefinition<PlatformSearchArgs, PlatformSearchResult>;
