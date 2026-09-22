/**
 * dsh-omnisearch — explicit `timeRange` support (merged from dsh-free-search).
 *
 * dsh-free-search exposes an `advanced_search` tool whose `timeRange`
 * parameter accepts three forms. dsh-web-tools instead derives freshness from
 * the query text (SearchHints). dsh-omnisearch keeps both: query text still yields
 * hints, and an EXPLICIT timeRange (tool argument) overrides them.
 *
 * Accepted forms (identical to dsh-free-search):
 *  - fixed tiers: `day` | `week` | `month` | `year`  (1 / 7 / 30 / 365 days)
 *  - relative values: `12h`, `3d`, `2mo`, `1y`
 *  - absolute date: `2026-07-01` (results published on or after that date)
 *
 * @module
 */
import type { FreshnessHint, FreshnessPreset } from "./search-hints.ts";
/** A parsed, engine-agnostic time window. */
export interface ParsedTimeRange {
    /** Relative window in days (mutually exclusive with {@link after}). */
    days?: number;
    /** Absolute lower bound, YYYY-MM-DD (mutually exclusive with {@link days}). */
    after?: string;
    /** Normalized label used in cache keys and user-facing notes. */
    label: string;
    /**
     * Nearest fixed tier for engines that only understand `day|week|month|year`
     * (`≤2d → day`, `≤14d → week`, `≤90d → month`, else `year`).
     */
    tier: FreshnessPreset;
}
/** Map a day count to the nearest fixed tier (dsh-free-search rule). */
export declare function approximateTier(days: number): FreshnessPreset;
/** YYYY-MM-DD for `days` ago (UTC). */
export declare function isoDateDaysAgo(days: number, now?: Date): string;
/**
 * Parse a `timeRange` value. Returns undefined for empty/invalid input so a
 * bad argument degrades to "no explicit window" instead of failing the call.
 */
export declare function parseTimeRange(input: unknown): ParsedTimeRange | undefined;
/** Express a parsed window as SearchHints freshness (overrides query hints). */
export declare function timeRangeToFreshness(parsed: ParsedTimeRange, now?: Date): FreshnessHint;
/**
 * Effective day count for an engine that only understands fixed tiers:
 * derives from whichever freshness signal is present (hints after-date or
 * preset). Returns undefined when nothing constrains freshness.
 */
export declare function daysFromFreshness(freshness: FreshnessHint | undefined, now?: Date): number | undefined;
/** Human label for a freshness hint (used in notes and cache keys). */
export declare function freshnessLabel(freshness: FreshnessHint | undefined): string;
