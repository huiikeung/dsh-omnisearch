/** Cache key inputs (engine + window + limits all participate). */
export function buildCacheKey(input) {
    return [input.query ?? "", input.maxResults ?? 5, input.timeRangeLabel ?? "", input.preferred ?? ""].join("\u0000");
}
/** Fixed cache capacity (dsh-free-search parity). */
export const CACHE_MAX_ENTRIES = 50;
/** Max configurable TTL (5 minutes). */
export const CACHE_MAX_TTL_MS = 300_000;
/** Small LRU cache with a per-entry TTL. */
export class SearchCache {
    entries = new Map();
    maxEntries;
    now;
    // NOTE: explicit fields, not TS parameter properties — the test runner uses
    // Node's strip-only TypeScript mode, which rejects parameter properties.
    constructor(maxEntries = CACHE_MAX_ENTRIES, now = () => Date.now()) {
        this.maxEntries = maxEntries;
        this.now = now;
    }
    /**
     * Look up one key. `ttlMs` is read per call so a settings change applies
     * immediately; TTL 0 disables the cache entirely.
     */
    get(key, ttlMs) {
        if (ttlMs <= 0)
            return undefined;
        const entry = this.entries.get(key);
        if (!entry)
            return undefined;
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
    set(key, value, ttlMs) {
        if (ttlMs <= 0)
            return;
        const effective = value.fallback ? Math.max(Math.floor(ttlMs / 5), 1_000) : ttlMs;
        this.entries.delete(key);
        this.entries.set(key, { ...value, storedAt: this.now(), expiresAt: this.now() + effective });
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next();
            if (oldest.done)
                break;
            this.entries.delete(oldest.value);
        }
    }
    /** Number of live entries. */
    get size() {
        return this.entries.size;
    }
    /** Drop everything (settings change / tests). */
    clear() {
        this.entries.clear();
    }
}
