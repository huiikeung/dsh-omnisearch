/**
 * dsh-omnisearch — `advanced_search` tool (merged from dsh-free-search).
 *
 * Wraps the native search chain with an EXPLICIT `timeRange` argument. Engines
 * that can filter by date are moved to the front of the chain for that call so
 * the window actually takes effect; engines that cannot are still usable as a
 * fallback and the result carries the dsh-free-search `Note:` line explaining
 * who served it.
 *
 * @module
 */
import { type WebToolsToolDefinition } from "../context-types.ts";
import { type ParsedTimeRange } from "../time-range.ts";
import type { SearchHints } from "../search-hints.ts";
/**
 * Engines that honour a date window (dsh-free-search's `timeEngines`).
 * Keep in sync with the per-engine time handling in the adapters.
 */
export declare const TIME_FILTER_ENGINES: string[];
/** Tool argument shape. */
export interface AdvancedSearchArgs {
    query: string;
    timeRange?: string | {
        days?: number;
        after?: string;
    };
    engine?: string;
    max_results?: number;
}
/** Tool result shape. */
export interface AdvancedSearchResult {
    query: string;
    timeRange?: string;
    engine?: string;
    content?: string;
    results: Array<{
        title: string;
        url: string;
        snippet?: string;
        publishedAt?: string;
    }>;
    count: number;
    error?: string;
}
/** Dependencies injected by the host plugin. */
export interface AdvancedSearchDeps {
    /** Run the search chain for one request (the plugin's search provider). */
    search: (request: {
        query: string;
        maxResults?: number;
        preferredProvider?: string;
        preferredSkippedReason?: "time-filter";
        timeRangeLabel?: string;
        chainOverride?: string[];
        hintsOverride?: Partial<SearchHints>;
    }, signal?: AbortSignal) => Promise<{
        content?: string;
        sources: Array<{
            url: string;
            title?: string;
            snippet?: string;
            publishedAt?: string;
        }>;
    }>;
    /** Full configured chain, in priority order ([default, ...fallback]). */
    chain: () => string[];
    /** Configured default provider. */
    defaultProvider: () => string;
    /** Enabled-state per provider. */
    isEnabled: (name: string) => boolean;
}
/**
 * Order the chain for one explicit time window: date-filtering engines first
 * (keeping the user's configured priority inside each group), the rest after.
 * Only engines that are actually in the configured chain participate — the
 * tool must never resurrect an engine the user ordered away.
 *
 * A requested engine stays first because the user asked for it explicitly; if
 * it cannot filter by date, `skippedReason` records that so the caller can emit
 * the dsh-free-search note form (a).
 */
export declare function orderChainForTimeRange(chain: string[], timeCapable: string[], requested: string | undefined): {
    chain: string[];
    preferred: string;
    skippedReason?: "time-filter";
};
/** Merge an explicit window into the query-derived hints (explicit wins). */
export declare function applyTimeRangeToHints(hints: SearchHints, parsed: ParsedTimeRange): SearchHints;
/** Build the `advanced_search` tool definition. */
export declare function createAdvancedSearchTool(deps: AdvancedSearchDeps): WebToolsToolDefinition<AdvancedSearchArgs, AdvancedSearchResult>;
