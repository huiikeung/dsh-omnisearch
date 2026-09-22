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
import { defineTool, type WebToolsTextBlock, type WebToolsToolDefinition } from "../context-types.ts";
import { parseTimeRange, timeRangeToFreshness, type ParsedTimeRange } from "../time-range.ts";
import type { SearchHints } from "../search-hints.ts";

/**
 * Engines that honour a date window (dsh-free-search's `timeEngines`).
 * Keep in sync with the per-engine time handling in the adapters.
 */
export const TIME_FILTER_ENGINES: string[] = [
  "tavily",
  "exa",
  "keenable",
  "firecrawl",
  "parallel",
  "searxng",
  "ddg",
  "ddg-lite",
];

/** Tool argument shape. */
export interface AdvancedSearchArgs {
  query: string;
  timeRange?: string | { days?: number; after?: string };
  engine?: string;
  max_results?: number;
}

/** Tool result shape. */
export interface AdvancedSearchResult {
  query: string;
  timeRange?: string;
  engine?: string;
  content?: string;
  results: Array<{ title: string; url: string; snippet?: string; publishedAt?: string }>;
  count: number;
  error?: string;
}

/** Dependencies injected by the host plugin. */
export interface AdvancedSearchDeps {
  /** Run the search chain for one request (the plugin's search provider). */
  search: (
    request: {
      query: string;
      maxResults?: number;
      preferredProvider?: string;
      preferredSkippedReason?: "time-filter";
      timeRangeLabel?: string;
      chainOverride?: string[];
      hintsOverride?: Partial<SearchHints>;
    },
    signal?: AbortSignal,
  ) => Promise<{
    content?: string;
    sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>;
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
export function orderChainForTimeRange(
  chain: string[],
  timeCapable: string[],
  requested: string | undefined,
): { chain: string[]; preferred: string; skippedReason?: "time-filter" } {
  const capable = new Set(timeCapable);
  const preferred = requested && chain.includes(requested) ? requested : chain[0];
  const ordered = [...chain.filter((n) => capable.has(n)), ...chain.filter((n) => !capable.has(n))];
  if (requested && ordered.includes(requested)) {
    ordered.splice(ordered.indexOf(requested), 1);
    ordered.unshift(requested);
  }
  const skippedReason = requested && !capable.has(requested) ? ("time-filter" as const) : undefined;
  return { chain: ordered, preferred, ...(skippedReason ? { skippedReason } : {}) };
}

/** Merge an explicit window into the query-derived hints (explicit wins). */
export function applyTimeRangeToHints(hints: SearchHints, parsed: ParsedTimeRange): SearchHints {
  return { ...hints, freshness: timeRangeToFreshness(parsed) };
}

/** Build the `advanced_search` tool definition. */
export function createAdvancedSearchTool(deps: AdvancedSearchDeps): WebToolsToolDefinition<AdvancedSearchArgs, AdvancedSearchResult> {
  return defineTool<AdvancedSearchArgs, AdvancedSearchResult>({
    name: "advanced_search",
    description:
      "联网搜索（可指定时间范围）。 Use it when the user asks for results from a specific period: fixed tiers (day|week|month|year), relative values (12h, 3d, 2mo, 1y), or an absolute date (2026-07-01 = published on or after that date). Prefers engines that support date filtering and says which engine actually served the results.",
    parameters: {
      query: { type: "string", description: "Search query." },
      timeRange: {
        type: "string",
        description: "Time window: day|week|month|year, or 12h/3d/2mo/1y, or an absolute date like 2026-07-01.",
      },
      engine: {
        type: "string",
        description: "Optional engine to prefer for this call (e.g. bing, exa, tavily, ddg). Falls back automatically if it fails.",
      },
      max_results: { type: "number", description: "Maximum results (default 5)." },
    },
    isConcurrencySafe: true,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          timeRange: { type: "string" },
          engine: { type: "string" },
          content: { type: "string" },
          count: { type: "number" },
          error: { type: "string" },
          results: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                snippet: { type: "string" },
                publishedAt: { type: "string" },
              },
              required: ["title", "url"],
            },
          },
        },
        required: ["query", "count", "results"],
      },
      render: (_args, value): WebToolsTextBlock[] => {
        if (value.error) return [{ type: "text", text: `advanced_search failed: ${value.error}` }];
        const header = [
          `advanced_search "${value.query}"`,
          value.timeRange ? `timeRange=${value.timeRange}` : "",
          value.engine ? `engine=${value.engine}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const lines = value.results.map((r, i) => {
          const published = r.publishedAt ? ` [${r.publishedAt}]` : "";
          const snippet = r.snippet ? `\n   ${r.snippet}` : "";
          return `${i + 1}. ${r.title}${published} — ${r.url}${snippet}`;
        });
        const note = value.content ? `\n${value.content}` : "";
        return [{ type: "text", text: `${header}\n${lines.join("\n")}${note}` }];
      },
    },
    async execute(args) {
      const query = (args.query ?? "").trim();
      const max = typeof args.max_results === "number" && args.max_results > 0 ? args.max_results : 5;
      const parsed = parseTimeRange(args.timeRange);
      if (!query) return { query, count: 0, results: [], error: "query is required" };
      if (args.timeRange !== undefined && !parsed) {
        return {
          query,
          count: 0,
          results: [],
          error: `unrecognized timeRange "${String(args.timeRange)}" (use day|week|month|year, 12h/3d/2mo/1y, or YYYY-MM-DD)`,
        };
      }

      const configured = deps.chain().filter((name) => deps.isEnabled(name));
      const requested = typeof args.engine === "string" && args.engine.trim() ? args.engine.trim() : undefined;
      const ordering = parsed
        ? orderChainForTimeRange(configured, TIME_FILTER_ENGINES, requested)
        : { chain: configured, preferred: requested ?? deps.defaultProvider(), skippedReason: undefined as "time-filter" | undefined };

      try {
        const outcome = await deps.search(
          {
            query,
            maxResults: max,
            preferredProvider: ordering.preferred,
            ...(ordering.skippedReason ? { preferredSkippedReason: ordering.skippedReason } : {}),
            ...(parsed ? { timeRangeLabel: parsed.label } : {}),
            ...(parsed ? { hintsOverride: { freshness: timeRangeToFreshness(parsed) } } : {}),
            chainOverride: ordering.chain,
          },
          undefined,
        );
        return {
          query,
          ...(parsed ? { timeRange: parsed.label } : {}),
          ...(ordering.preferred ? { engine: ordering.preferred } : {}),
          ...(outcome.content ? { content: outcome.content } : {}),
          count: outcome.sources.length,
          results: outcome.sources.map((s) => ({
            title: s.title ?? s.url,
            url: s.url,
            ...(s.snippet ? { snippet: s.snippet } : {}),
            ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
          })),
        };
      } catch (error) {
        return { query, count: 0, results: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
