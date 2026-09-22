/**
 * dsh-omnisearch — result cache (merged from dsh-free-search).
 *
 * Identical queries hit an LRU cache so a repeated question never burns the
 * keyless quotas twice. dsh-free-search's rules are kept: 50 entries max, TTL
 * configurable 0-5 minutes (0 disables), and fallback-served entries expire at
 * 1/5 of the TTL so a recovered preferred engine is picked up quickly.
 *
 * @module
 */
import type { Source } from "./providers/types.ts";
/** Cached search payload. */
export interface CachedSearch {
    content?: string;
    sources: Source[];
    /** Provider that produced the entry. */
    backend: string;
    /** Whether the entry came from a fallback (not the preferred engine). */
    fallback: boolean;
    storedAt: number;
}
/** Cache key inputs (engine + window + limits all participate). */
export declare function buildCacheKey(input: {
    query: string;
    maxResults?: number;
    timeRangeLabel?: string;
    preferred?: string;
}): string;
/** Fixed cache capacity (dsh-free-search parity). */
export declare const CACHE_MAX_ENTRIES = 50;
/** Max configurable TTL (5 minutes). */
export declare const CACHE_MAX_TTL_MS = 300000;
/** Small LRU cache with a per-entry TTL. */
export declare class SearchCache {
    private readonly entries;
    private readonly maxEntries;
    private readonly now;
    constructor(maxEntries?: number, now?: () => number);
    /**
     * Look up one key. `ttlMs` is read per call so a settings change applies
     * immediately; TTL 0 disables the cache entirely.
     */
    get(key: string, ttlMs: number): CachedSearch | undefined;
    /** Store one result. Fallback-served entries get a shorter TTL. */
    set(key: string, value: Omit<CachedSearch, "storedAt">, ttlMs: number): void;
    /** Number of live entries. */
    get size(): number;
    /** Drop everything (settings change / tests). */
    clear(): void;
}
