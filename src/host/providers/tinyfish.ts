/**
 * dsh-omnisearch — Tinyfish web/news search adapter.
 *
 * Ported from dsh-web-search-enhanced (Yurzi) v0.1.4, MIT — adapted to the
 * dsh-omnisearch adapter contract. Two tiers, mirroring upstream:
 *
 *  - key:  GET https://api.search.tinyfish.ai?query=<q>&page=0 with `x-api-key`
 *  - no key: public MCP endpoint https://agent.tinyfish.ai/mcp with
 *    `X-TinyFish-Access-Mode: keyless` (stateless JSON-RPC tools/call; the
 *    server's own announcement: 30 requests/min, 50 searches per UTC day)
 *
 * Keyless covers `domain_type: web | news` only — `research_paper` requires a
 * key (upstream throws; we just drop the option so keyless still searches).
 *
 * @module
 */
import { providerError, resolveContext, type ProviderAdapter, type Source } from "./types.ts";
import { fetchWithProxy } from "../fetch-proxy.ts";
import { cleanSnippet, parseMcpJson, uniqueSources } from "./free-engines.ts";

const TINYFISH_REST_URL = "https://api.search.tinyfish.ai";
const TINYFISH_MCP_URL = "https://agent.tinyfish.ai/mcp";

export const TINYFISH_META = {
  name: "tinyfish",
  label: "跨语言 Tinyfish（无 key 也可用）",
  description: "跨语言/地域化网页与新闻搜索。无 key 走公共通道（每日 50 次限额，限流自动回退），配 key 提升额度。",
  credSuffix: "TINYFISH",
  fetchCapable: false,
  needsBaseUrl: false,
  keyless: true,
} as const;

/** Options accepted by Tinyfish (validated upstream; we mirror the safe subset). */
export interface TinyfishOptions {
  /** Two-letter country code (e.g. "us", "jp"). */
  location?: string;
  /** BCP-47-ish language tag (e.g. "zh", "en-US"). */
  language?: string;
  /** Free-text search purpose hint (<= 2000 chars). */
  purpose?: string;
  /** "web" | "news" | "research_paper" (research_paper needs a key). */
  domain_type?: string;
}

function opt(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Extract sources from Tinyfish's result payload (REST JSON or MCP text JSON). */
export function extractTinyfishSources(
  payload: { results?: unknown },
  maxResults: number,
): Source[] {
  const sources: Source[] = [];
  for (const row of Array.isArray(payload?.results) ? payload.results : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const url = opt(r.url);
    if (!url || !/^https?:\/\//.test(url)) continue;
    const title = opt(r.title);
    const snippet = cleanSnippet(opt(r.snippet));
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
    });
  }
  return uniqueSources(sources, maxResults);
}

/** Parse the MCP tool result: `content[].text` holds a JSON document. */
function parseMcpResults(data: ReturnType<typeof parseMcpJson>): { results?: unknown } {
  const content = (data?.result?.content ?? []) as Array<{ type?: string; text?: string }>;
  const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  try {
    return JSON.parse(text) as { results?: unknown };
  } catch {
    return {};
  }
}

export const TinyfishProvider: ProviderAdapter = {
  ...TINYFISH_META,
  async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
    const { signal, hints, options } = resolveContext<TinyfishOptions>(contextOrSignal);
    const q = hints?.cleanQuery?.trim() || query;
    const limit = maxResults ?? 10;

    const domainType = opt(options?.domain_type);
    const effectiveDomain = domainType === "news" ? "news" : domainType === "research_paper" && apiKey ? "research_paper" : "web";

    if (!apiKey) {
      // ---- Keyless tier: public MCP endpoint ---------------------------------
      const args: Record<string, unknown> = { query: q, page: 0 };
      if (effectiveDomain === "news") args.domain_type = "news";
      const location = opt(options?.location);
      if (location) args.location = location;
      const language = opt(options?.language);
      if (language) args.language = language;
      const purpose = opt(options?.purpose);
      if (purpose) args.purpose = purpose.slice(0, 2000);

      let res: Response;
      try {
        res = await fetchWithProxy(TINYFISH_MCP_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "X-TinyFish-Access-Mode": "keyless",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: { name: "search", arguments: args },
          }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
        throw providerError("network", `Tinyfish MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!res.ok) {
        if (res.status === 429) throw providerError("rate-limit", "Tinyfish keyless quota exhausted (50/day)", res.status);
        throw providerError("server", `Tinyfish MCP error (HTTP ${res.status})`, res.status);
      }
      const data = parseMcpJson(await res.text());
      if (!data || data.error) {
        throw providerError("invalid-response", `Tinyfish MCP error: ${data?.error?.message ?? "no data"}`);
      }
      if (data.result?.isError) {
        const text = ((data.result?.content ?? []) as Array<{ text?: string }>).map((b) => b.text ?? "").join(" ");
        throw providerError("bad-request", `Tinyfish MCP error: ${text.slice(0, 200)}`);
      }
      return { sources: extractTinyfishSources(parseMcpResults(data), limit) };
    }

    // ---- Keyed tier: REST ---------------------------------------------------
    const params = new URLSearchParams({ query: q, page: "0" });
    if (effectiveDomain !== "web") params.set("domain_type", effectiveDomain);
    const location = opt(options?.location);
    if (location) params.set("location", location);
    const language = opt(options?.language);
    if (language) params.set("language", language);
    const purpose = opt(options?.purpose);
    if (purpose) params.set("purpose", purpose.slice(0, 2000));

    let res: Response;
    try {
      res = await fetchWithProxy(`${TINYFISH_REST_URL}?${params}`, {
        headers: { "x-api-key": apiKey, accept: "application/json" },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw providerError("aborted", "search aborted by caller");
      throw providerError("network", `Tinyfish request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw providerError("auth", `Tinyfish key rejected (HTTP ${res.status})`, res.status);
      if (res.status === 429) throw providerError("rate-limit", "Tinyfish rate-limited", res.status);
      if (res.status >= 500) throw providerError("server", `Tinyfish error (HTTP ${res.status})`, res.status);
      throw providerError("bad-request", `Tinyfish error (HTTP ${res.status})`, res.status);
    }
    const data = (await res.json().catch(() => ({}))) as { results?: unknown };
    return { sources: extractTinyfishSources(data, limit) };
  },
  async fetch() {
    throw providerError("config", "tinyfish does not provide native fetch; use the generic path");
  },
};
