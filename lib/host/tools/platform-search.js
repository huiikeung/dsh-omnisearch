/**
 * dsh-omnisearch — `platform_search` tool (merged from dsh-free-search).
 *
 * Searches a specific platform's public API instead of the open web. All eight
 * platforms are keyless and zero-dependency. The enabled set comes from the
 * `platformSearchEnabled` settings map, so the model is never offered a
 * platform the user switched off.
 *
 * @module
 */
import { defineTool } from "../context-types.js";
import { fetchWithProxy } from "../fetch-proxy.js";
import { FREE_ENGINE_USER_AGENT } from "../free-engine-options.js";
/** Supported platforms, in the order shown to the model. */
export const PLATFORM_IDS = [
    "github",
    "v2ex",
    "bilibili",
    "reddit",
    "hn",
    "stackoverflow",
    "wikipedia",
    "npm",
];
const UA = FREE_ENGINE_USER_AGENT;
async function getJson(url, headers, signal) {
    const res = await fetchWithProxy(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal });
    if (!res.ok)
        throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
}
function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
/** GitHub repository search (public API, no key). */
export async function searchGithub(query, maxResults, signal) {
    const data = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults}`, { accept: "application/vnd.github+json" }, signal);
    return (data.items ?? []).map((item) => ({
        url: item.html_url,
        title: item.full_name ?? item.name,
        snippet: `${item.description ?? ""}${item.stargazers_count ? ` ⭐${item.stargazers_count}` : ""}`.trim(),
    }));
}
/** V2EX has no search API: filter the public hot list locally. */
export async function searchV2ex(query, maxResults, signal) {
    const topics = await getJson("https://www.v2ex.com/api/topics/hot.json", {}, signal);
    const q = query.toLowerCase();
    const matched = Array.isArray(topics)
        ? topics.filter((t) => (t.title ?? "").toLowerCase().includes(q) || (t.content ?? "").toLowerCase().includes(q))
        : [];
    return matched.slice(0, maxResults).map((t) => ({
        url: `https://www.v2ex.com/t/${t.id}`,
        title: t.title,
        ...(t.content ? { snippet: String(t.content).slice(0, 200) } : {}),
    }));
}
/** Bilibili search (public endpoint; needs a Referer). */
export async function searchBilibili(query, maxResults, signal) {
    const data = await getJson(`https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(query)}`, { referer: "https://www.bilibili.com" }, signal);
    if (data.code !== 0)
        throw new Error(`Bilibili API error: ${data.message ?? data.code}`);
    const hits = [];
    for (const section of data.data?.result ?? []) {
        for (const item of section.data ?? []) {
            if (!item.arcurl)
                continue;
            hits.push({
                url: item.arcurl,
                title: item.title ? stripTags(String(item.title)) : item.bvid,
                ...(item.desc ? { snippet: String(item.desc).slice(0, 200) } : {}),
            });
            if (hits.length >= maxResults)
                break;
        }
        if (hits.length >= maxResults)
            break;
    }
    return hits;
}
/** Reddit search via the old.reddit JSON endpoint (UA must be identifiable). */
export async function searchReddit(query, maxResults, signal) {
    const data = await getJson(`https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&sort=relevance`, { "user-agent": `${UA} (dsh-omnisearch; +https://github.com/A3Boy/dsh-web-tools)` }, signal);
    return (data.data?.children ?? [])
        .map((c) => c.data)
        .filter((p) => p && p.url)
        .map((p) => ({
        url: p.url,
        title: p.title ?? "",
        ...(p.selftext ? { snippet: String(p.selftext).slice(0, 200) } : {}),
    }));
}
/** Hacker News (Algolia API). */
export async function searchHackerNews(query, maxResults, signal) {
    const data = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${maxResults}`, {}, signal);
    return (data.hits ?? [])
        .filter((h) => h.title || h.story_title)
        .map((h) => ({
        // External link when present, otherwise the HN discussion page.
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title ?? h.story_title,
        ...(h.points !== undefined || h.num_comments !== undefined
            ? { snippet: `HN discussion · ${h.points ?? 0} points · ${h.num_comments ?? 0} comments` }
            : {}),
    }));
}
/** Stack Overflow (Stack Exchange API, fixed filter for a compact shape). */
export async function searchStackOverflow(query, maxResults, signal) {
    const data = await getJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${maxResults}&filter=!nNPvSNVZJS`, {}, signal);
    if (data.error_message)
        throw new Error(`Stack Exchange API error: ${data.error_message}`);
    return (data.items ?? []).map((it) => ({
        url: it.link,
        title: it.title,
        ...(it.score !== undefined || it.answer_count !== undefined
            ? { snippet: `${it.is_answered ? "✓ answered" : "unanswered"} · score ${it.score ?? 0} · ${it.answer_count ?? 0} answers` }
            : {}),
    }));
}
/** Wikipedia (zh by default, en when lang === "en"). */
export async function searchWikipedia(query, maxResults, signal, lang) {
    const host = lang === "en" ? "en.wikipedia.org" : "zh.wikipedia.org";
    const data = await getJson(`https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}`, {}, signal);
    return (data.query?.search ?? []).map((s) => ({
        url: `https://${host}/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
        title: s.title,
        ...(s.snippet ? { snippet: stripTags(s.snippet).slice(0, 200) } : {}),
    }));
}
/** npm registry package search. */
export async function searchNpm(query, maxResults, signal) {
    const data = await getJson(`https://registry.npmjs.com/-/v1/search?text=${encodeURIComponent(query)}&size=${maxResults}`, {}, signal);
    return (data.objects ?? [])
        .map((o) => o.package)
        .filter((p) => p && p.name)
        .map((p) => ({
        url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
        title: p.name,
        ...(p.description || p.version
            ? { snippet: `v${p.version ?? "?"}${p.description ? ` — ${String(p.description).slice(0, 160)}` : ""}` }
            : {}),
    }));
}
/** Dispatch one platform search. */
export async function searchPlatform(platform, query, maxResults, signal, lang) {
    switch (platform) {
        case "github":
            return searchGithub(query, maxResults, signal);
        case "v2ex":
            return searchV2ex(query, maxResults, signal);
        case "bilibili":
            return searchBilibili(query, maxResults, signal);
        case "reddit":
            return searchReddit(query, maxResults, signal);
        case "hn":
            return searchHackerNews(query, maxResults, signal);
        case "stackoverflow":
            return searchStackOverflow(query, maxResults, signal);
        case "wikipedia":
            return searchWikipedia(query, maxResults, signal, lang);
        case "npm":
            return searchNpm(query, maxResults, signal);
        default:
            throw new Error(`unknown platform: ${String(platform)}`);
    }
}
/** Build the `platform_search` tool definition. */
export function createPlatformSearchTool(deps) {
    return defineTool({
        name: "platform_search",
        description: "在指定平台内搜索（而非公开网页）。 Platforms: github (repositories), v2ex (forum threads), bilibili (videos), reddit (posts), hn (Hacker News discussions), stackoverflow (Q&A), wikipedia (articles), npm (packages). Use it when the user names a platform or wants community discussion rather than general web results.",
        parameters: {
            platform: {
                type: "string",
                description: "Platform to search. One of: github, v2ex, bilibili, reddit, hn, stackoverflow, wikipedia, npm.",
                enum: [...PLATFORM_IDS],
            },
            query: { type: "string", description: "Search keywords (one topic, no platform name, no site: operator)." },
            max_results: { type: "number", description: "Maximum results to return (default 5)." },
            lang: { type: "string", description: 'Optional language for Wikipedia ("zh" default, "en" for English).' },
        },
        isConcurrencySafe: true,
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    platform: { type: "string" },
                    query: { type: "string" },
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
                            },
                            required: ["title", "url"],
                        },
                    },
                },
                required: ["platform", "query", "count", "results"],
            },
            render: (_args, value) => {
                if (value.error)
                    return [{ type: "text", text: `platform_search(${value.platform}) failed: ${value.error}` }];
                const lines = value.results.map((r, i) => {
                    const snippet = r.snippet ? `\n   ${r.snippet}` : "";
                    return `${i + 1}. ${r.title} — ${r.url}${snippet}`;
                });
                return [
                    {
                        type: "text",
                        text: `platform_search ${value.platform} for "${value.query}" — ${value.count} result(s):\n${lines.join("\n")}`,
                    },
                ];
            },
        },
        async execute(args) {
            const platform = args.platform;
            const query = (args.query ?? "").trim();
            const max = typeof args.max_results === "number" && args.max_results > 0 ? Math.min(args.max_results, 20) : 5;
            if (deps.enabled()[platform] === false) {
                return { platform, query, count: 0, results: [], error: `platform "${platform}" is disabled in the dsh-omnisearch settings` };
            }
            try {
                const hits = await searchPlatform(platform, query, max, undefined, args.lang ?? deps.lang());
                return {
                    platform,
                    query,
                    count: hits.length,
                    results: hits.map((h) => ({ title: h.title ?? h.url, url: h.url, ...(h.snippet ? { snippet: h.snippet } : {}) })),
                };
            }
            catch (error) {
                return { platform, query, count: 0, results: [], error: error instanceof Error ? error.message : String(error) };
            }
        },
    });
}
