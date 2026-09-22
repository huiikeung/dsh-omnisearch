/**
 * dsh-omnisearch — keyless "free engine" adapters (merged from dsh-free-search).
 *
 * These engines need NO credential, which is what makes dsh-omnisearch work on a
 * fresh install with no API keys at all:
 *
 *  - bing      : HTML scrape of bing.com/search (default engine upstream)
 *  - ddg       : HTML scrape of html.duckduckgo.com
 *  - ddg-lite  : HTML scrape of lite.duckduckgo.com
 *  - anysearch : JSON REST (anonymous quota)
 *  - keenable  : REST with key, keyless MCP endpoint without one
 *
 * Every adapter follows the dsh-web-tools adapter contract (classified
 * ProviderError, SearchHints-driven parameters) so the shared fallback chain,
 * cooldown store and key pools treat them like any other provider.
 *
 * @module
 */
import { providerError, resolveContext } from "./types.js";
import { fetchWithProxy } from "../fetch-proxy.js";
import { daysFromFreshness, freshnessLabel, approximateTier } from "../time-range.js";
import { acceptLanguageFor, bingMarketFor, FREE_ENGINE_USER_AGENT, getFreeEngineOptions, LANG_PROFILES, } from "../free-engine-options.js";
const BING_URL = "https://www.bing.com/search";
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";
const ANYSEARCH_URL = "https://api.anysearch.com/v1/search";
const KEENABLE_URL = "https://api.keenable.ai/v1/search";
const KEENABLE_MCP_URL = "https://api.keenable.ai/mcp";
const HTML_TIMEOUT_MS = 12_000;
/**
 * Read a per-provider option, falling back to the plugin-wide free-engine
 * knob. Keeps adapters working both from the settings card (global) and from a
 * future per-engine override.
 */
function knob(options, key, fallback) {
    if (options && typeof options === "object") {
        const value = options[key];
        if (value !== undefined && value !== null)
            return value;
    }
    return fallback;
}
function decodeEntities(text) {
    return String(text)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function stripTags(html) {
    return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
/** Drop login/paywall noise, collapse whitespace, cap length (dsh-free-search rule). */
export function cleanSnippet(text) {
    if (!text)
        return text;
    return String(text)
        .replace(/\b(sign up|sign in|log in|login|subscribe( to| for)?|member[- ]?only|become a member|create (a )?free account|read more|continue reading|story continues|get started|install (the )?app|view on|medium membership|join \w+ for free|stories in your inbox|remember me for|unlock this|free to read|become a patron)\b/gi, " ")
        .replace(/^\s*(#{1,6}\s*|\[\s*x?\s*\]\s*|-\s*\[\s*x?\s*\]\s*|>\s*)/gm, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
}
/** De-duplicate by URL and cap the list. */
export function uniqueSources(sources, limit) {
    const seen = new Set();
    const out = [];
    for (const s of sources) {
        if (s.url && !seen.has(s.url)) {
            seen.add(s.url);
            out.push(s);
        }
        if (out.length >= limit)
            break;
    }
    return out;
}
/** Unwrap DuckDuckGo's `/l/?uddg=` redirect wrapper. */
export function extractDdgUrl(href) {
    if (!href)
        return undefined;
    const m = href.match(/uddg=([^&]+)/);
    if (m) {
        try {
            return decodeURIComponent(m[1]);
        }
        catch {
            return m[1];
        }
    }
    if (href.startsWith("//"))
        return `https:${href}`;
    return href;
}
/**
 * Fetch a search page with one retry budget: 12s per attempt, up to 3
 * attempts, 1.5s apart (mirrors dsh-free-search). Rate-limit / anti-bot pages
 * become a `rate-limit` ProviderError so the chain cools the engine down and
 * moves on instead of hammering it.
 */
async function fetchText(url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? HTML_TIMEOUT_MS;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onAbort = () => controller.abort();
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        try {
            const headers = {
                "user-agent": FREE_ENGINE_USER_AGENT,
                "accept-language": opts.acceptLang ?? acceptLanguageFor(getFreeEngineOptions().lang),
                ...(opts.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
                ...opts.headers,
            };
            const res = await fetchWithProxy(url, {
                method: opts.method ?? "GET",
                headers,
                body: opts.body,
                signal: controller.signal,
                redirect: "follow",
            });
            if (!res.ok) {
                if (res.status === 429 || res.status === 503) {
                    throw providerError("rate-limit", `engine rate-limited (HTTP ${res.status})`, res.status);
                }
                if (res.status >= 500)
                    throw providerError("server", `engine error (HTTP ${res.status})`, res.status);
                throw providerError("bad-request", `engine request failed (HTTP ${res.status})`, res.status);
            }
            const text = await res.text();
            if (res.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(text.slice(0, 4000))) {
                throw providerError("rate-limit", "DuckDuckGo is rate-limited right now (anti-bot challenge, usually temporary) - Bing works");
            }
            if (text.length > 500)
                return text;
            lastError = new Error(`empty response (${text.length} bytes)`);
        }
        catch (error) {
            if (opts.signal?.aborted)
                throw providerError("aborted", "search aborted by caller");
            lastError = error instanceof Error ? error : new Error(String(error));
        }
        finally {
            clearTimeout(timer);
            opts.signal?.removeEventListener("abort", onAbort);
        }
        if (attempt < 3)
            await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (lastError && "code" in lastError)
        throw lastError;
    throw providerError("network", `engine unreachable: ${lastError?.message ?? "unknown"}`);
}
/** Bing adult-filter value. */
function bingAdultFilter(level) {
    return level;
}
/** DuckDuckGo adult-filter value (-1 off / 0 moderate / 1 strict). */
function ddgAdultFilter(level) {
    return level === "strict" ? "1" : level === "moderate" ? "0" : "-1";
}
/** DuckDuckGo `df` freshness value from hints, or undefined. */
function ddgFreshness(hints) {
    const days = daysFromFreshness(hints?.freshness);
    if (days === undefined)
        return undefined;
    return { day: "d", week: "w", month: "m", year: "y" }[approximateTier(days)];
}
/** Query text handed to an engine (operators stripped by SearchHints). */
function engineQuery(query, hints) {
    return hints?.cleanQuery?.trim() ? hints.cleanQuery : query;
}
//#region bing
export const BING_META = {
    name: "bing",
    label: "必应 Bing（无 key 也可用）",
    description: "免费 HTML 搜索，无 key 也可用；默认引擎，中文优化。",
    credSuffix: "BING",
    fetchCapable: false,
    needsBaseUrl: false,
    keyless: true,
};
export const BingProvider = {
    ...BING_META,
    async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
        const { signal, hints, options } = resolveContext(contextOrSignal);
        const globals = getFreeEngineOptions();
        const market = knob(options, "bingMarket", bingMarketFor(globals.bingMarket, globals.lang));
        const acceptLang = globals.bingMarket
            ? (LANG_PROFILES[Object.keys(LANG_PROFILES).find((k) => LANG_PROFILES[k].market === market) ?? "zh"]?.acceptLang ?? acceptLanguageFor(globals.lang))
            : acceptLanguageFor(globals.lang);
        const params = new URLSearchParams({ q: engineQuery(query, hints), mkt: market });
        const safe = knob(options, "safeSearch", globals.safeSearch ?? "off");
        if (safe)
            params.set("adlt", bingAdultFilter(safe));
        const html = await fetchText(`${BING_URL}?${params}`, { signal, acceptLang });
        const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
        const sources = [];
        for (const block of blocks) {
            const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
            if (!hrefMatch)
                continue;
            const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
            const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
            const snippet = cleanSnippet(snippetMatch ? stripTags(snippetMatch[1]) : undefined);
            sources.push({
                url: decodeEntities(hrefMatch[1]),
                ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
                ...(snippet ? { snippet } : {}),
            });
        }
        return { sources: uniqueSources(sources, maxResults ?? 10) };
    },
    async fetch() {
        throw providerError("config", "bing does not provide native fetch; use the generic path");
    },
};
//#endregion
//#region duckduckgo (html + lite)
export const DDG_META = {
    name: "ddg",
    label: "鸭鸭搜 DuckDuckGo（无 key 也可用）",
    description: "免费 HTML 搜索，无 key 也可用；可能被限流，会自动回退。",
    credSuffix: "DDG",
    fetchCapable: false,
    needsBaseUrl: false,
    keyless: true,
};
export const DuckDuckGoProvider = {
    ...DDG_META,
    async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
        const { signal, hints, options } = resolveContext(contextOrSignal);
        const globals = getFreeEngineOptions();
        const params = new URLSearchParams({ q: engineQuery(query, hints) });
        const region = knob(options, "region", globals.region);
        if (region)
            params.set("kl", region);
        params.set("adlt", ddgAdultFilter(knob(options, "safeSearch", globals.safeSearch ?? "off")));
        const df = ddgFreshness(hints);
        if (df)
            params.set("df", df);
        const html = await fetchText(`${DDG_HTML_URL}?${params}`, { signal });
        const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
        const sources = [];
        for (const block of blocks) {
            const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
            if (!urlMatch)
                continue;
            const url = extractDdgUrl(urlMatch[1]);
            if (!url)
                continue;
            const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
            const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
            const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
            const snippet = cleanSnippet(snippetMatch ? stripTags(snippetMatch[1]) : undefined);
            sources.push({
                url,
                ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
                ...(snippet ? { snippet } : {}),
                ...(dateMatch ? { publishedAt: dateMatch[1] } : {}),
            });
        }
        return { sources: uniqueSources(sources, maxResults ?? 10) };
    },
    async fetch() {
        throw providerError("config", "ddg does not provide native fetch; use the generic path");
    },
};
export const DDG_LITE_META = {
    name: "ddg-lite",
    label: "鸭鸭搜轻量 DuckDuckGo Lite（无 key 也可用）",
    description: "DuckDuckGo 轻量端点，无 key 也可用；限流表现与 ddg 相同。",
    credSuffix: "DDG_LITE",
    fetchCapable: false,
    needsBaseUrl: false,
    keyless: true,
};
export const DuckDuckGoLiteProvider = {
    ...DDG_LITE_META,
    async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
        const { signal, hints, options } = resolveContext(contextOrSignal);
        const globals = getFreeEngineOptions();
        const params = new URLSearchParams({ q: engineQuery(query, hints) });
        params.set("adlt", ddgAdultFilter(knob(options, "safeSearch", globals.safeSearch ?? "off")));
        const df = ddgFreshness(hints);
        if (df)
            params.set("df", df);
        const html = await fetchText(`${DDG_LITE_URL}?${params}`, { signal });
        const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
        const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
        const sources = [];
        for (let i = 0; i < linkMatches.length; i++) {
            const tag = linkMatches[i];
            const hrefMatch = tag.match(/href="([^"]*)"/);
            if (!hrefMatch)
                continue;
            const url = extractDdgUrl(hrefMatch[1]);
            if (!url)
                continue;
            const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
            const snippetRaw = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
            const snippet = cleanSnippet(snippetRaw ? stripTags(snippetRaw) : undefined);
            sources.push({
                url,
                ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
                ...(snippet ? { snippet } : {}),
            });
        }
        return { sources: uniqueSources(sources, maxResults ?? 10) };
    },
    async fetch() {
        throw providerError("config", "ddg-lite does not provide native fetch; use the generic path");
    },
};
//#endregion
//#region anysearch
export const ANYSEARCH_META = {
    name: "anysearch",
    label: "AI 搜索 AnySearch（无 key 也可用）",
    description: "AI 搜索 REST 端点，匿名公共额度，无 key 也可用。",
    credSuffix: "ANYSEARCH",
    fetchCapable: false,
    needsBaseUrl: false,
    keyless: true,
};
export const AnySearchProvider = {
    ...ANYSEARCH_META,
    async search(query, maxResults, _apiKey, _baseUrl, contextOrSignal) {
        const { signal, hints } = resolveContext(contextOrSignal);
        let res;
        try {
            res = await fetchWithProxy(ANYSEARCH_URL, {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({ query: engineQuery(query, hints), max_results: maxResults ?? 5 }),
                signal,
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw providerError("aborted", "search aborted by caller");
            throw providerError("network", `AnySearch request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!res.ok) {
            if (res.status === 429)
                throw providerError("rate-limit", "AnySearch anonymous quota exhausted", res.status);
            if (res.status >= 500)
                throw providerError("server", `AnySearch error (HTTP ${res.status})`, res.status);
            throw providerError("bad-request", `AnySearch error (HTTP ${res.status})`, res.status);
        }
        const data = (await res.json());
        if (data.code !== 0) {
            throw providerError("bad-request", `AnySearch API error: ${data.message ?? data.code}`);
        }
        const results = data.data?.results ?? [];
        const sources = [];
        for (const r of results) {
            if (!r?.url)
                continue;
            const snippet = cleanSnippet(r.snippet);
            sources.push({
                url: r.url,
                ...(r.title ? { title: String(r.title) } : {}),
                ...(snippet ? { snippet } : {}),
            });
        }
        return { sources: uniqueSources(sources, maxResults ?? 10) };
    },
    async fetch() {
        throw providerError("config", "anysearch does not provide native fetch; use the generic path");
    },
};
//#endregion
//#region keenable
export const KEENABLE_META = {
    name: "keenable",
    label: "实时检索 Keenable",
    description: "实时网页搜索。无 key 也可用（公共 MCP 端点），配 key 提升额度。",
    credSuffix: "KEENABLE",
    fetchCapable: false,
    needsBaseUrl: false,
    keyless: true,
};
/** Keenable relative window format ("12h" / "7d" / "2mo" / "1y"). */
export function formatKeenableRelative(days) {
    if (days <= 0.5)
        return "12h";
    if (days < 1)
        return `${Math.round(days * 24)}h`;
    if (days < 30)
        return `${Math.round(days)}d`;
    if (days < 365)
        return `${Math.round(days / 30)}mo`;
    return `${Math.round(days / 365)}y`;
}
/** Parse Keenable's "Title:/URL:/Published:/Snippets:" text blocks. */
export function extractKeenableSources(text, maxResults) {
    const sources = [];
    for (const block of String(text).split(/\n(?=Title:)/)) {
        const url = block.match(/^URL: (\S+)$/m)?.[1];
        if (!url)
            continue;
        const title = block.match(/^Title: (.+)$/m)?.[1];
        const published = block.match(/^Published: (.+)$/m)?.[1] ?? block.match(/^Acquired: (.+)$/m)?.[1];
        const snippets = block
            .split(/^Snippets:$/m)[1]
            ?.split("\n")
            .filter((l) => l.trim())
            .slice(0, 3)
            .join(" ");
        const snippet = cleanSnippet(snippets);
        sources.push({
            url,
            ...(title ? { title } : {}),
            ...(snippet ? { snippet } : {}),
            ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { publishedAt: published } : {}),
        });
    }
    return uniqueSources(sources, maxResults);
}
/** `published_after` value for a freshness hint (relative or absolute). */
function keenablePublishedAfter(hints) {
    if (!hints?.freshness)
        return undefined;
    if (hints.freshness.after)
        return hints.freshness.after;
    const days = daysFromFreshness(hints.freshness);
    return days === undefined ? undefined : formatKeenableRelative(days);
}
export const KeenableProvider = {
    ...KEENABLE_META,
    async search(query, maxResults, apiKey, _baseUrl, contextOrSignal) {
        const { signal, hints } = resolveContext(contextOrSignal);
        const q = engineQuery(query, hints);
        const limit = maxResults ?? 10;
        if (apiKey) {
            // Account tier: REST API with X-API-Key.
            const body = { query: q, mode: "realtime" };
            const after = keenablePublishedAfter(hints);
            if (after)
                body.published_after = after;
            let res;
            try {
                res = await fetchWithProxy(KEENABLE_URL, {
                    method: "POST",
                    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
                    body: JSON.stringify(body),
                    signal,
                });
            }
            catch (error) {
                if (signal?.aborted)
                    throw providerError("aborted", "search aborted by caller");
                throw providerError("network", `Keenable request failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (!res.ok) {
                if (res.status === 401 || res.status === 403)
                    throw providerError("auth", `Keenable key rejected (HTTP ${res.status})`, res.status);
                if (res.status === 429)
                    throw providerError("rate-limit", "Keenable rate-limited", res.status);
                if (res.status >= 500)
                    throw providerError("server", `Keenable error (HTTP ${res.status})`, res.status);
                throw providerError("bad-request", `Keenable error (HTTP ${res.status})`, res.status);
            }
            const data = (await res.json());
            const sources = [];
            for (const r of data.results ?? []) {
                if (!r?.url)
                    continue;
                const snippet = cleanSnippet(r.snippet);
                sources.push({ url: r.url, ...(r.title ? { title: String(r.title) } : {}), ...(snippet ? { snippet } : {}) });
            }
            if (sources.length > 0)
                return { sources: uniqueSources(sources, limit) };
            // Fall through to MCP when the REST tier returns nothing usable.
        }
        // Keyless tier: public MCP endpoint (JSON-RPC tools/call).
        const args = { query: q };
        const after = keenablePublishedAfter(hints);
        if (after)
            args.published_after = after;
        let res;
        try {
            res = await fetchWithProxy(KEENABLE_MCP_URL, {
                method: "POST",
                headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: Date.now(),
                    method: "tools/call",
                    params: { name: "search_web_pages", arguments: args },
                }),
                signal,
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw providerError("aborted", "search aborted by caller");
            throw providerError("network", `Keenable MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!res.ok) {
            if (res.status === 429)
                throw providerError("rate-limit", "Keenable MCP rate-limited", res.status);
            throw providerError("server", `Keenable MCP error (HTTP ${res.status})`, res.status);
        }
        const raw = await res.text();
        const data = parseMcpJson(raw);
        if (!data || data.error) {
            throw providerError("invalid-response", `Keenable MCP error: ${data?.error?.message ?? "no data"}`);
        }
        const content = (data.result?.content ?? []);
        const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
        if (data.result?.isError) {
            throw providerError("bad-request", `Keenable MCP error: ${text.slice(0, 200)}`);
        }
        return { sources: extractKeenableSources(text, limit) };
    },
    async fetch() {
        throw providerError("config", "keenable does not provide native fetch; use the generic path");
    },
};
//#endregion
/** MCP over HTTP answers either JSON or an SSE stream ("data: {...}"). */
export function parseMcpJson(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
        try {
            return JSON.parse(trimmed);
        }
        catch {
            return null;
        }
    }
    for (const line of trimmed.split("\n")) {
        if (line.startsWith("data: ")) {
            try {
                return JSON.parse(line.slice(6));
            }
            catch {
                // keep scanning
            }
        }
    }
    return null;
}
/** Freshness label helper re-exported for callers that only hold hints. */
export { freshnessLabel };
