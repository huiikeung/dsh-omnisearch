/** Days per fixed tier. */
const DAYS_BY_TIER = { day: 1, week: 7, month: 30, year: 365 };
/** Map a day count to the nearest fixed tier (dsh-free-search rule). */
export function approximateTier(days) {
    if (days <= 2)
        return "day";
    if (days <= 14)
        return "week";
    if (days <= 90)
        return "month";
    return "year";
}
/** YYYY-MM-DD for `days` ago (UTC). */
export function isoDateDaysAgo(days, now = new Date()) {
    const d = new Date(now.getTime() - days * 86_400_000);
    return d.toISOString().slice(0, 10);
}
/**
 * Parse a `timeRange` value. Returns undefined for empty/invalid input so a
 * bad argument degrades to "no explicit window" instead of failing the call.
 */
export function parseTimeRange(input) {
    if (input === undefined || input === null)
        return undefined;
    if (typeof input === "object") {
        const obj = input;
        if (typeof obj.after === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.after)) {
            return { after: obj.after, label: obj.after, tier: "year" };
        }
        if (typeof obj.days === "number" && Number.isFinite(obj.days) && obj.days > 0) {
            return { days: obj.days, label: `${obj.days}d`, tier: approximateTier(obj.days) };
        }
        return undefined;
    }
    const s = String(input).trim().toLowerCase();
    if (s.length === 0)
        return undefined;
    if (s in DAYS_BY_TIER) {
        const days = DAYS_BY_TIER[s];
        return { days, label: s, tier: s };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return { after: s, label: s, tier: "year" };
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)$/);
    if (m) {
        const n = parseFloat(m[1]);
        const unit = m[2][0];
        const days = unit === "h" ? n / 24 : unit === "d" ? n : unit === "w" ? n * 7 : unit === "m" ? n * 30 : n * 365;
        if (!Number.isFinite(days) || days <= 0)
            return undefined;
        return { days, label: s, tier: approximateTier(days) };
    }
    return undefined;
}
/** Express a parsed window as SearchHints freshness (overrides query hints). */
export function timeRangeToFreshness(parsed, now = new Date()) {
    if (parsed.after)
        return { after: parsed.after };
    const days = parsed.days ?? 7;
    // Preset only when the window IS a fixed tier; otherwise pin an exact
    // after-date so engines with date support filter precisely and the rest can
    // still approximate from it.
    const fixed = Object.entries(DAYS_BY_TIER).find(([, d]) => d === days)?.[0];
    if (fixed)
        return { preset: fixed, after: isoDateDaysAgo(days, now) };
    return { preset: parsed.tier, after: isoDateDaysAgo(days, now) };
}
/**
 * Effective day count for an engine that only understands fixed tiers:
 * derives from whichever freshness signal is present (hints after-date or
 * preset). Returns undefined when nothing constrains freshness.
 */
export function daysFromFreshness(freshness, now = new Date()) {
    if (!freshness)
        return undefined;
    if (freshness.after) {
        const parsed = Date.parse(`${freshness.after}T00:00:00Z`);
        if (Number.isFinite(parsed)) {
            const days = (now.getTime() - parsed) / 86_400_000;
            if (days > 0)
                return days;
        }
    }
    if (freshness.preset)
        return DAYS_BY_TIER[freshness.preset] ?? undefined;
    return undefined;
}
/** Human label for a freshness hint (used in notes and cache keys). */
export function freshnessLabel(freshness) {
    if (!freshness)
        return "";
    if (freshness.preset && freshness.after)
        return `${freshness.preset}@${freshness.after}`;
    return freshness.after ?? freshness.preset ?? "";
}
