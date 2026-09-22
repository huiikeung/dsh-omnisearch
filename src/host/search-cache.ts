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
export function buildCacheKey(input: {
  query: string;
  maxResults?: number;
  timeRangeLabel?: string;
  preferred?: string;
}): string {
  return [input.query ?? "", input.maxResults ?? 5, input.timeRangeLabel ?? "", input.preferred ?? ""].join("\u0000");
}

interface CacheEntry extends CachedSearch {
  expiresAt: number;
}

/** Fixed cache capacity (dsh-free-search parity). */
export const CACHE_MAX_ENTRIES = 50;

/** Max configurable TTL (5 minutes). */
export const CACHE_MAX_TTL_MS = 300_000;

/** Small LRU cache with a per-entry TTL. */
export class SearchCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  // NOTE: explicit fields, not TS parameter properties — the test runner uses
  // Node's strip-only TypeScript mode, which rejects parameter properties.
  constructor(maxEntries: number = CACHE_MAX_ENTRIES, now: () => number = () => Date.now()) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  /**
   * Look up one key. `ttlMs` is read per call so a settings change applies
   * immediately; TTL 0 disables the cache entirely.
   */
  get(key: string, ttlMs: number): CachedSearch | undefined {
    if (ttlMs <= 0) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // LRU touch: re-insert to move the key to the newest position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  /** Store one result. Fallback-served entries get a shorter TTL. */
  set(key: string, value: Omit<CachedSearch, "storedAt">, ttlMs: number): void {
    if (ttlMs <= 0) return;
    const effective = value.fallback ? Math.max(Math.floor(ttlMs / 5), 1_000) : ttlMs;
    this.entries.delete(key);
    this.entries.set(key, { ...value, storedAt: this.now(), expiresAt: this.now() + effective });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Number of live entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Drop everything (settings change / tests). */
  clear(): void {
    this.entries.clear();
  }
}
