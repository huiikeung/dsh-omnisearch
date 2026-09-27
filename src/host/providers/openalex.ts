/**
 * dsh-omnisearch — OpenAlex academic literature adapter (keyless).
 *
 * Ported from dsh-web-search-enhanced (Yurzi) v0.1.4, MIT — adapted to the
 * dsh-omnisearch adapter contract. OpenAlex is the open scholarly graph:
 *
 *  - GET https://api.openalex.org/works?search=<q>&per-page=<n>
 *  - Works with NO credential at all; a polite pool is joined via `mailto`
 *    (faster, and a paid `api_key` query param is accepted when set);
 *  - Occasionally answers 429 from the shared anonymous pool — the shared
 *    fallback chain treats that as a normal cooldown + failover signal;
 *  - Snippets are reconstructed from OpenAlex `abstract_inverted_index`
 *    (word → positions), plus citation count / authors / OA-PDF annotations,
 *    mirroring upstream's diagnostics-friendly format.
 *
 * @module
 */
import { providerError, resolveContext, type ProviderAdapter, type Source } from "./types.ts";
import { fetchWithProxy } from "../fetch-proxy.ts";
import { cleanSnippet, knob, uniqueSources } from "./free-engines.ts";

const OPENALEX_URL = "https://api.openalex.org/works";

/** Default polite-pool mailbox (upstream's default). Overridable per engine options. */
const DEFAULT_MAILTO = "dsh-omnisearch@users.noreply.github.com";

/** Max snippet chars kept from a reconstructed abstract (matches upstream SNIPPET_LENGTH). */
const SNIPPET_LENGTH = 4000;

export const OPENALEX_META = {
  name: "openalex",
  label: "学术检索 OpenAlex（无 key 也可用）",
  description: "全球开放学术图谱，论文/文献/引用检索，无 key 也可用（礼貌池限流时自动回退）。",
  credSuffix: "OPENALEX",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

/** Reconstruct abstract text from OpenAlex's inverted index (word → [positions]). */
export function reconstructInvertedIndex(inverted: unknown): string | undefined {
  if (!inverted || typeof inverted !== "object" || Array.isArray(inverted)) return undefined;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inverted as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number" && Number.isSafeInteger(pos) && pos >= 0) words.push([pos, word]);
    }
  }
  if (words.length === 0) return undefined;
  words.sort((a, b) => a[0] - b[0]);
  return words.map((w) => w[1]).join(" ");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Build one Source from a raw OpenAlex work row (mirrors upstream normalization). */
export function openAlexSource(row: Record<string, unknown>): Source | undefined {
  const doi = asString(row.doi);
  const openAccess = (row.open_access ?? undefined) as Record<string, unknown> | undefined;
  const oaUrl = asString(openAccess?.oa_url);
  const primary = (row.primary_location ?? undefined) as Record<string, unknown> | undefined;
  const landing = asString(primary?.landing_page_url);
  const id = asString(row.id);
  const url = doi ?? oaUrl ?? landing ?? id;
  if (!url || !/^https?:\/\//.test(url)) return undefined;

  const title = asString(row.display_name) ?? asString(row.title);
  const parts: string[] = [];
  if (typeof row.cited_by_count === "number") parts.push(`[Citations: ${row.cited_by_count}]`);
  if (Array.isArray(row.authorships)) {
    const authors = (row.authorships as unknown[])
      .map((a) => asString((a as Record<string, unknown>)?.author ? ((a as Record<string, unknown>).author as Record<string, unknown>).display_name : undefined))
      .filter((n): n is string => Boolean(n))
      .slice(0, 5);
    if (authors.length > 0) parts.push(`[Authors: ${authors.join(", ")}]`);
  }
  if (oaUrl && oaUrl !== url) parts.push(`[OA PDF: ${oaUrl}]`);
  const abstract = reconstructInvertedIndex(row.abstract_inverted_index);
  if (abstract) parts.push(abstract.slice(0, SNIPPET_LENGTH));
  const rawSnippet = parts.length > 0 ? parts.join(" ") : undefined;

  const published =
    asString(row.publication_date) ??
    (typeof row.publication_year === "number" ? `${row.publication_year}-01-01` : undefined);

  return {
    url,
    ...(title ? { title } : {}),
    ...(rawSnippet ? { snippet: cleanSnippet(rawSnippet) } : {}),
    ...(published ? { publishedAt: published } : {}),
  };
}

export const OpenAlexProvider: ProviderAdapter = {
  ...OPENALEX_META,
  async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints, options } = resolveContext(contextOrSignal);
    // Academic graph: prefer the verbatim query — platform operators are noise here.
    const q = hints?.cleanQuery?.trim() || query;
    const limit = maxResults ?? 10;
    const params = new URLSearchParams({
      search: q,
      "per-page": String(Math.max(1, Math.min(limit, 50))),
      mailto: knob(options, "mailto", DEFAULT_MAILTO),
    });
    if (apiKey) params.set("api_key", apiKey);
    const filters: string[] = [];
    const filter = knob(options, "filter", "");
    if (typeof filter === "string" && filter.trim()) filters.push(filter.trim());
    const isOa = knob(options, "is_oa", undefined as boolean | undefined);
    if (typeof isOa === "boolean") filters.push(`is_oa:${isOa}`);
    const sort = knob(options, "sort", "");
    if (typeof sort === "string" && sort.trim()) params.set("sort", sort.trim());

    // Date window (advanced_search timeRange → FreshnessHint): OpenAlex speaks
    // `filter=from_publication_date:YYYY-MM-DD` (+ optional to-date).
    const freshness = hints?.freshness;
    const after = freshness?.after?.slice(0, 10);
    const before = freshness?.before?.slice(0, 10);
    if (after) filters.push(`from_publication_date:${after}`);
    if (before) filters.push(`to_publication_date:${before}`);
    if (filters.length > 0) params.set("filter", filters.join(","));

    let res: Response;
    try {
      res = await fetchWithProxy(`${OPENALEX_URL}?${params}`, { signal });
    } catch (error) {
      if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
      throw providerError("network", `OpenAlex request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) {
      if (res.status === 429) throw providerError("rate-limit", "OpenAlex polite pool rate-limited", res.status);
      if (res.status === 401 || res.status === 403) throw providerError("auth", `OpenAlex key rejected (HTTP ${res.status})`, res.status);
      if (res.status >= 500) throw providerError("server", `OpenAlex error (HTTP ${res.status})`, res.status);
      throw providerError("bad-request", `OpenAlex error (HTTP ${res.status})`, res.status);
    }
    const data = (await res.json()) as { results?: unknown[]; error?: string };
    if (data.error) throw providerError("invalid-response", `OpenAlex API error: ${data.error}`);
    const sources: Source[] = [];
    for (const row of data.results ?? []) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const source = openAlexSource(row as Record<string, unknown>);
      if (source) sources.push(source);
    }
    return { sources: uniqueSources(sources, limit) };
  },
  async fetch() {
    throw providerError("config", "openalex does not provide native fetch; use the generic path");
  },
};
