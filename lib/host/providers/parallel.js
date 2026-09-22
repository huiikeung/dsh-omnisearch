/**
 * dsh-omnisearch — Parallel provider adapter.
 *
 * Parallel is an agent-native web tools API: Search returns LLM-ranked
 * compressed excerpts, Extract returns page bodies as markdown.
 *
 * Search  : POST https://api.parallel.ai/v1/search
 *           x-api-key: <apiKey>, Content-Type: application/json
 *           body { objective, search_queries[], mode, advanced_settings }
 *           → results[] (url / title / publish_date / excerpts[])
 * Extract : POST https://api.parallel.ai/v1/extract
 *           body { urls[], advanced_settings: { full_content: true } }
 *           → results[] (url / title / excerpts[] / full_content)
 *
 * Keyless tier (merged from dsh-free-search): without a key, search goes
 * through Parallel's public Search MCP endpoint (search.parallel.ai/mcp,
 * JSON-RPC `tools/call` with the `web_search` tool and a fixed per-process
 * 32-hex session id). The MCP path has no date parameter, so a freshness
 * window degrades into a soft hint appended to the objective. Extract still
 * requires the REST API and reports a retryable auth error without a key.
 *
 * Other scope notes:
 *   - mode defaults to "advanced" (deep agent-optimized retrieval);
 *   - quota is dashboard-only — Parallel exposes usage/spend in its
 *     Platform dashboard, not through a balance endpoint an ordinary API
 *     key can call.
 * @module
 */
import { providerError, throwIfHttp, resolveContext } from "./types.js";
import { fetchWithProxy } from "../fetch-proxy.js";
import { parseMcpJson } from "./free-engines.js";
const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";
const PARALLEL_EXTRACT_URL = "https://api.parallel.ai/v1/extract";
/** Public keyless Search MCP endpoint (merged from dsh-free-search). */
const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";
/** Fixed per-process MCP session id (32 random hex chars, dsh-free-search parity). */
const PARALLEL_MCP_SESSION = (() => {
    let id = "";
    for (let i = 0; i < 32; i++)
        id += Math.floor(Math.random() * 16).toString(16);
    return id;
})();
/** Parallel caps max_results at 20 per search. */
const PARALLEL_MAX_RESULTS = 20;
/** Each entry in search_queries may be at most 200 characters. */
const PARALLEL_QUERY_MAX_CHARS = 200;
/** Snippet budget: excerpts are dense but several may add up — cap the joined text. */
const PARALLEL_SNIPPET_MAX_CHARS = 500;
export const PARALLEL_META = {
    name: "parallel",
    label: "智能检索 Parallel",
    description: "Agent 优化的搜索 + 正文抽取（LLM 排序摘录）。无 key 也可用（公共 Search MCP），配 key 解锁 extract 与日期过滤。",
    credSuffix: "PARALLEL",
    fetchCapable: true,
    needsBaseUrl: false,
    keyless: true,
};
export const ParallelProvider = {
    ...PARALLEL_META,
    async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
        const token = (apiKey ?? "").trim();
        const { signal, options, hints } = resolveContext(contextOrSignal);
        const count = clampParallelCount(maxResults);
        // Keyless path (merged from dsh-free-search): public Search MCP endpoint.
        if (!token)
            return searchParallelKeyless(query, count, hints, signal);
        const res = await fetchWithProxy(PARALLEL_SEARCH_URL, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": token },
            body: JSON.stringify(buildParallelSearchBody(query, count, options, hints)),
            signal,
        });
        throwIfHttp("Parallel", res);
        let raw;
        try {
            raw = await res.json();
        }
        catch {
            throw providerError("invalid-response", "Parallel returned invalid JSON");
        }
        return { sources: parseParallelSearchResults(raw, count) };
    },
    async fetch(url, apiKey, _baseUrl, contextOrSignal) {
        const { signal } = resolveContext(contextOrSignal);
        const token = (apiKey ?? "").trim();
        if (!token)
            throw providerError("auth", "Parallel API key is not configured");
        // full_content must be explicitly requested — Extract defaults to
        // excerpts-only, which would return a snippet where web_fetch wants the
        // page body.
        const res = await fetchWithProxy(PARALLEL_EXTRACT_URL, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": token },
            body: JSON.stringify({ urls: [url], advanced_settings: { full_content: true } }),
            signal,
        });
        throwIfHttp("Parallel", res);
        let raw;
        try {
            raw = await res.json();
        }
        catch {
            throw providerError("invalid-response", "Parallel Extract returned invalid JSON");
        }
        const text = parseParallelExtractText(raw);
        if (!text)
            throw providerError("server", `Parallel Extract returned no content for ${url}`);
        return { text };
    },
};
/** Clamp the requested result count into Parallel's accepted range (1..20). */
export function clampParallelCount(maxResults) {
    return Math.min(Math.max(maxResults ?? 5, 1), PARALLEL_MAX_RESULTS);
}
/**
 * Normalize one raw query into a Parallel search_queries entry: whitespace
 * collapsed, trimmed, and capped at 200 characters (the per-query API limit).
 */
export function normalizeParallelQuery(query) {
    return query.replace(/\s+/g, " ").trim().slice(0, PARALLEL_QUERY_MAX_CHARS);
}
/**
 * Build the /v1/search request body. `objective` carries the natural
 * language goal (with soft steering for preferred sources); `search_queries`
 * carries clean keyword queries without syntax junk. `advanced_settings`
 * carries hard constraints (source_policy, max_results).
 */
export function buildParallelSearchBody(query, count, options, hints) {
    let objective = query;
    const cleanQ = hints?.cleanQuery ? hints.cleanQuery : query;
    // Soft steering via objective (Parallel official best practice)
    if (hints?.domains?.preferOfficial) {
        objective += "\nPrefer primary documentation and official sources when available.";
    }
    else if (hints?.domains?.prefer && hints.domains.prefer.length > 0 && !hints.domains.include) {
        objective += `\nPrefer sources from: ${hints.domains.prefer.join(", ")}.`;
    }
    // Advanced settings & source policy
    const advancedSettings = {
        max_results: count,
    };
    const sourcePolicy = {};
    if (hints?.domains?.include && hints.domains.include.length > 0) {
        sourcePolicy.include_domains = hints.domains.include;
    }
    if (hints?.domains?.exclude && hints.domains.exclude.length > 0) {
        sourcePolicy.exclude_domains = hints.domains.exclude;
    }
    if (hints?.freshness?.after) {
        sourcePolicy.after_date = hints.freshness.after;
    }
    if (Object.keys(sourcePolicy).length > 0) {
        advancedSettings.source_policy = sourcePolicy;
    }
    const body = {
        objective,
        search_queries: [normalizeParallelQuery(cleanQ)],
        mode: options?.mode ?? "advanced",
        advanced_settings: advancedSettings,
    };
    // max_chars_total is a top-level /v1/search field (docs.parallel.ai).
    if (typeof options?.maxCharsTotal === "number") {
        body.max_chars_total = options.maxCharsTotal;
    }
    return body;
}
/**
 * Parse Parallel's search envelope ({ results: [...] }) into normalized
 * sources. `url` is required per item; `excerpts` (an array of LLM-ranked
 * compressed passages) are joined into the snippet and capped so a multi-
 * excerpt result cannot balloon the DSH search payload.
 */
export function parseParallelSearchResults(body, maxResults) {
    const results = body?.results;
    if (!Array.isArray(results))
        return [];
    const sources = [];
    for (const item of results) {
        if (sources.length >= maxResults)
            break;
        if (!item || typeof item !== "object")
            continue;
        const { url, title, publish_date, excerpts } = item;
        if (typeof url !== "string" || url.length === 0)
            continue;
        const source = { url };
        if (typeof title === "string" && title)
            source.title = title;
        const excerptText = Array.isArray(excerpts)
            ? excerpts
                .filter((x) => typeof x === "string")
                .join("\n\n")
                .trim()
            : "";
        if (excerptText)
            source.snippet = excerptText.slice(0, PARALLEL_SNIPPET_MAX_CHARS);
        if (typeof publish_date === "string" && publish_date)
            source.publishedAt = publish_date;
        sources.push(source);
    }
    return sources;
}
/**
 * Extract the page text from Parallel's extract envelope. Prefers
 * `full_content` (only present when requested); falls back to the joined
 * excerpts. Returns undefined when neither carries usable text — the caller
 * classifies that as a server failure.
 */
export function parseParallelExtractText(body) {
    const results = body?.results;
    const first = Array.isArray(results) ? results[0] : undefined;
    if (!first || typeof first !== "object")
        return undefined;
    const { full_content, excerpts } = first;
    if (typeof full_content === "string" && full_content.trim())
        return full_content;
    if (Array.isArray(excerpts)) {
        const text = excerpts
            .filter((x) => typeof x === "string")
            .join("\n\n")
            .trim();
        if (text)
            return text;
    }
    return undefined;
}
/**
 * Keyless Parallel search through the public Search MCP endpoint (merged from
 * dsh-free-search). The MCP tool has no date parameter, so a freshness window
 * becomes a soft preference appended to the objective. Each text content block
 * carries a JSON payload whose `results[]` uses the REST field names.
 */
async function searchParallelKeyless(query, count, hints, signal) {
    const cleanQ = hints?.cleanQuery ? hints.cleanQuery : query;
    const after = hints?.freshness?.after;
    const objective = after ? `${cleanQ} (prefer results published after ${after})` : cleanQ;
    const res = await fetchWithProxy(PARALLEL_MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
                name: "web_search",
                arguments: {
                    objective,
                    search_queries: [normalizeParallelQuery(cleanQ)],
                    session_id: PARALLEL_MCP_SESSION,
                },
            },
        }),
        signal,
    });
    if (!res.ok) {
        if (res.status === 429)
            throw providerError("rate-limit", "Parallel MCP anonymous quota exhausted", res.status);
        if (res.status >= 500)
            throw providerError("server", `Parallel MCP error (HTTP ${res.status})`, res.status);
        throw providerError("bad-request", `Parallel MCP error (HTTP ${res.status})`, res.status);
    }
    const raw = await res.text();
    const json = parseMcpJson(raw);
    if (!json || json.error) {
        throw providerError("invalid-response", `Parallel MCP error: ${json?.error?.message ?? "no data"}`);
    }
    const blocks = (json.result?.content ?? []);
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    if (json.result?.isError) {
        throw providerError("bad-request", `Parallel MCP error: ${text.slice(0, 200) || "tool call failed"}`);
    }
    // The text block is a JSON payload — pretty-printed across many lines in
    // practice, so parse the WHOLE text first and only then fall back to
    // line-by-line candidates.
    let payload = undefined;
    const candidates = [text.trim(), ...text.split("\n").map((l) => l.trim())];
    for (const candidate of candidates) {
        if (!candidate.startsWith("{"))
            continue;
        try {
            payload = JSON.parse(candidate);
            break;
        }
        catch {
            // keep scanning
        }
    }
    const sources = parseParallelSearchResults(payload, count);
    if (sources.length === 0) {
        throw providerError("invalid-response", "Parallel MCP returned 0 results");
    }
    return { sources };
}
