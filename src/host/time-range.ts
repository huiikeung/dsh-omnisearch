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

/** Days per fixed tier. */
const DAYS_BY_TIER: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

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
export function approximateTier(days: number): FreshnessPreset {
  if (days <= 2) return "day";
  if (days <= 14) return "week";
  if (days <= 90) return "month";
  return "year";
}

/** YYYY-MM-DD for `days` ago (UTC). */
export function isoDateDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a `timeRange` value. Returns undefined for empty/invalid input so a
 * bad argument degrades to "no explicit window" instead of failing the call.
 */
export function parseTimeRange(input: unknown): ParsedTimeRange | undefined {
  if (input === undefined || input === null) return undefined;

  if (typeof input === "object") {
    const obj = input as { days?: unknown; after?: unknown };
    if (typeof obj.after === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.after)) {
      return { after: obj.after, label: obj.after, tier: "year" };
    }
    if (typeof obj.days === "number" && Number.isFinite(obj.days) && obj.days > 0) {
      return { days: obj.days, label: `${obj.days}d`, tier: approximateTier(obj.days) };
    }
    return undefined;
  }

  const s = String(input).trim().toLowerCase();
  if (s.length === 0) return undefined;
  if (s in DAYS_BY_TIER) {
    const days = DAYS_BY_TIER[s];
    return { days, label: s, tier: s as FreshnessPreset };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { after: s, label: s, tier: "year" };

  const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)$/);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2][0];
    const days = unit === "h" ? n / 24 : unit === "d" ? n : unit === "w" ? n * 7 : unit === "m" ? n * 30 : n * 365;
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return { days, label: s, tier: approximateTier(days) };
  }
  return undefined;
}

/** Express a parsed window as SearchHints freshness (overrides query hints). */
export function timeRangeToFreshness(parsed: ParsedTimeRange, now: Date = new Date()): FreshnessHint {
  if (parsed.after) return { after: parsed.after };
  const days = parsed.days ?? 7;
  // Preset only when the window IS a fixed tier; otherwise pin an exact
  // after-date so engines with date support filter precisely and the rest can
  // still approximate from it.
  const fixed = Object.entries(DAYS_BY_TIER).find(([, d]) => d === days)?.[0];
  if (fixed) return { preset: fixed as FreshnessPreset, after: isoDateDaysAgo(days, now) };
  return { preset: parsed.tier, after: isoDateDaysAgo(days, now) };
}

/**
 * Effective day count for an engine that only understands fixed tiers:
 * derives from whichever freshness signal is present (hints after-date or
 * preset). Returns undefined when nothing constrains freshness.
 */
export function daysFromFreshness(freshness: FreshnessHint | undefined, now: Date = new Date()): number | undefined {
  if (!freshness) return undefined;
  if (freshness.after) {
    const parsed = Date.parse(`${freshness.after}T00:00:00Z`);
    if (Number.isFinite(parsed)) {
      const days = (now.getTime() - parsed) / 86_400_000;
      if (days > 0) return days;
    }
  }
  if (freshness.preset) return DAYS_BY_TIER[freshness.preset] ?? undefined;
  return undefined;
}

/** Human label for a freshness hint (used in notes and cache keys). */
export function freshnessLabel(freshness: FreshnessHint | undefined): string {
  if (!freshness) return "";
  if (freshness.preset && freshness.after) return `${freshness.preset}@${freshness.after}`;
  return freshness.after ?? freshness.preset ?? "";
}
