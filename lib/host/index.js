import { Config as PluginConfig, DEFAULT_FALLBACK_ORDER, installConfig } from "./config.js";
import { createSearchProvider, createFetchProvider, createPoolStore, PROVIDER_ID, WebToolsWebError } from "./registry.js";
import { registerRoutes } from "./routes.js";
import { Stats } from "./stats.js";
import { CURRENT_VERSION, compareVersions } from "../shared/version.js";
import { buildPool, selectIndex, markUsed, markUnhealthy, resetHealth } from "./pool.js";
import { credRefOf, getProvider, PROVIDERS, PROVIDER_LIST, quotaOf } from "./providers/index.js";
import { seedBraveQuota, setBraveQuotaPersist } from "./providers/brave.js";
import { isKeyless } from "./providers/types.js";
import { mergePoolQuota } from "./quota.js";
import { fetchWithProxy, proxyStatus } from "./fetch-proxy.js";
import { installSearchModeRuntime, SearchModeRuntime, SEARCH_NUDGE_TEXT } from "./search-mode-runtime.js";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { createProviderHealthStore } from "./provider-health.js";
import { setFreeEngineOptions } from "./free-engine-options.js";
import { buildCacheKey, SearchCache } from "./search-cache.js";
import { buildPromptText } from "./prompt-section.js";
import { TIME_FILTER_ENGINES, createAdvancedSearchTool } from "./tools/advanced-search.js";
import { createEngineTestTool } from "./tools/engine-test.js";
import { createPlatformSearchTool } from "./tools/platform-search.js";
import { SpecializedSourceRegistry } from "./sources/registry.js";
import { XiaohongshuSource } from "./sources/xiaohongshu.js";
import { XSource } from "./sources/x.js";
import { createNativeBrowserRuntime } from "./browser/index.js";
import { loginViaMcpBrowser } from "./browser/mcp-login.js";
import { getDedicatedProfileDir } from "./browser/paths.js";
import { saveCookieJar } from "./browser/cookie-jar.js";
import { extractSearchHints } from "./search-hints.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-omnisearch";
/** Services required by this plugin. */
export const inject = ["webServer", "webRuntime", "settings", "credentials", "web", "agents", "commands", "tools", "systemPrompt"];
/**
 * Plugin-level config: the same schemastery schema as the settings namespace.
 * Cordis requires `Config` to be a schema instance (it calls `.validate` when
 * resolving plugin config); an empty object would crash at load.
 */
export const Config = PluginConfig;
/**
 * Optional release-check endpoint. dsh-omnisearch is a locally developed merge of
 * three upstream plugins and is not published, so the update check is OFF
 * unless an operator points DSH_OMNISEARCH_RELEASES_API at a GitHub
 * `releases/latest` endpoint for their own fork.
 */
const RELEASES_API = process.env.DSH_OMNISEARCH_RELEASES_API ?? "";
const RELEASES_URL = process.env.DSH_OMNISEARCH_RELEASES_URL ?? "";
const VERSION_CACHE_MS = 6 * 60 * 60 * 1000;
let versionCache = null;
export function toRoutedFetchResponse(url, outcome) {
    if (outcome.error) {
        const error = new WebToolsWebError(`platform fetch failed (${outcome.error.code}): ${outcome.error.message}`);
        if (outcome.error.code === "aborted")
            error.code = "WEB_ABORTED";
        throw error;
    }
    const item = outcome.item;
    const rawContent = item?.text?.trim();
    if (!item || !rawContent) {
        throw new WebToolsWebError(`platform fetch returned empty content for ${url}`);
    }
    const sections = [];
    if (item.title?.trim() && !rawContent.startsWith(item.title.trim())) {
        sections.push(`# ${item.title.trim()}`);
    }
    const metadata = [];
    const author = item.author?.handle || item.author?.name;
    if (author)
        metadata.push(`Author: ${author}`);
    if (item.publishedAt)
        metadata.push(`Published: ${item.publishedAt}`);
    const engagement = [
        typeof item.likes === "number" ? `likes ${item.likes}` : undefined,
        typeof item.collects === "number" ? `collects ${item.collects}` : undefined,
        typeof item.retweets === "number" ? `retweets ${item.retweets}` : undefined,
        typeof item.replies === "number" ? `comments/replies ${item.replies}` : undefined,
    ].filter(Boolean);
    if (engagement.length > 0)
        metadata.push(`Engagement: ${engagement.join(", ")}`);
    if (metadata.length > 0)
        sections.push(metadata.join("\n"));
    sections.push(rawContent);
    if (item.images?.length)
        sections.push(`Images: ${item.images.length} attached`);
    const content = sections.join("\n\n");
    return {
        url,
        statusCode: 200,
        body: { kind: "text", content },
        truncated: false,
    };
}
/** Release lookup is best-effort: startup and settings must work offline. */
async function checkVersion() {
    const fallback = { currentVersion: CURRENT_VERSION, updateAvailable: false };
    // No endpoint configured (the default for this local merge) → never hit the network.
    if (!RELEASES_API)
        return fallback;
    if (versionCache && Date.now() - versionCache.fetchedAt < VERSION_CACHE_MS)
        return versionCache.value;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        timer.unref?.();
        let response;
        try {
            response = await fetchWithProxy(RELEASES_API, {
                signal: controller.signal,
                headers: {
                    accept: "application/vnd.github+json",
                    "user-agent": `dsh-omnisearch/${CURRENT_VERSION}`,
                },
            });
        }
        finally {
            clearTimeout(timer);
        }
        // A repository without releases is a valid "no update" state.
        if (response.status === 404) {
            versionCache = { fetchedAt: Date.now(), value: fallback };
            return fallback;
        }
        if (!response.ok)
            throw new Error(`GitHub releases returned HTTP ${response.status}`);
        const release = await response.json();
        const latestVersion = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/i, "") : "";
        if (!latestVersion || release.draft === true || release.prerelease === true)
            return fallback;
        const value = {
            currentVersion: CURRENT_VERSION,
            latestVersion,
            updateAvailable: compareVersions(latestVersion, CURRENT_VERSION) > 0,
            releaseUrl: typeof release.html_url === "string" ? release.html_url : RELEASES_URL,
            releaseName: typeof release.name === "string" && release.name.trim() ? release.name : `v${latestVersion}`,
            publishedAt: typeof release.published_at === "string" ? release.published_at : undefined,
        };
        versionCache = { fetchedAt: Date.now(), value };
        return value;
    }
    catch {
        // Do not cache transient network failures; the next settings open can retry.
        return fallback;
    }
}
/** Resolve one credential ref's state + optional value (Host side only). */
async function readCredential(ctx, ref) {
    try {
        const credentials = ctx.credentials;
        if (!credentials?.resolve)
            return { configured: false, writable: true };
        const resolved = await credentials.resolve(ref);
        const value = resolved?.value;
        return {
            configured: typeof value === "string" && value.length > 0,
            source: resolved?.source,
            writable: true,
            ...(typeof value === "string" ? { value } : {}),
        };
    }
    catch {
        return { configured: false, writable: true };
    }
}
/**
 * Write a credential value. An empty string UNSETS the credential — the
 * credentials-local provider refuses to store empty values ("use unset"),
 * so removing the last key must unset rather than set("").
 */
async function writeCredential(ctx, ref, value) {
    const credentials = ctx.credentials;
    if (!credentials?.set || !credentials?.unset)
        throw new Error("credentials service unavailable");
    if (typeof value === "string" && value.length === 0) {
        await credentials.unset(ref);
        return;
    }
    await credentials.set(ref, value);
}
export function apply(ctx) {
    const stats = new Stats();
    const configHandle = installConfig(ctx);
    const readConfig = () => configHandle.read();
    // ---- ctx.web search + fetch providers ----------------------------------
    const resolveRuntimeConfig = () => {
        const cfg = readConfig();
        return {
            enabled: cfg.enabled !== false,
            defaultProvider: cfg.defaultProvider,
            providerAttemptTimeoutMs: cfg.providerAttemptTimeoutMs,
            fallbackOrder: cfg.fallbackOrder,
            searchRoutingPolicy: cfg.searchRoutingPolicy,
            providerBaseUrls: cfg.providerBaseUrls,
            enabledProviders: cfg.providerEnabled,
            providerOptions: cfg.providerOptions,
        };
    };
    const resolveKeys = async (providerName) => {
        const ref = credRefOf(providerName);
        const cred = await readCredential(ctx, ref);
        return cred.value ?? "";
    };
    // ONE shared pool store for search + fetch: they see the same key usage
    // and health, and rebuild only when a credential actually changes.
    const poolStore = createPoolStore(resolveKeys);
    // ONE shared health store so search + fetch respect the same cooldowns.
    const healthStore = createProviderHealthStore();
    const sourceRegistry = new SpecializedSourceRegistry();
    const generalSearchProvider = createSearchProvider(resolveRuntimeConfig, resolveKeys, {
        record: (e) => stats.record({ ...e, at: Date.now() }),
    }, undefined, poolStore, healthStore);
    const generalFetchProvider = createFetchProvider(resolveRuntimeConfig, resolveKeys, undefined, poolStore, healthStore);
    sourceRegistry.setFallbackProviders(generalSearchProvider, generalFetchProvider);
    // Sync platformEnabled from config on boot and live updates
    configHandle.onMounted(() => {
        const cfg = readConfig();
        if (cfg.platformEnabled) {
            sourceRegistry.setPlatformEnabled(cfg.platformEnabled);
        }
    });
    // Wrap search provider with SpecializedSourceRouter for XHS / X transparent platform handling
    const routedSearchProvider = {
        id: PROVIDER_ID,
        available: () => generalSearchProvider.available(),
        search: async (request, signal) => {
            const outcome = await sourceRegistry.search(request.query, { maxResults: request.maxResults, hints: extractSearchHints(request.query) }, signal);
            if (outcome.error) {
                throw new Error(`[${outcome.error.code}] ${outcome.error.message}`);
            }
            return {
                sources: outcome.items.map((item) => ({
                    url: item.url,
                    title: item.title,
                    snippet: item.snippet,
                    publishedAt: item.publishedAt,
                })),
                // The general web path carries the fallback `Note:` line (merged from
                // dsh-free-search); keep it on the seam so the model sees which engine
                // actually answered.
                ...(outcome.content ? { content: outcome.content } : {}),
                truncated: false,
            };
        },
    };
    // ---- result cache (merged from dsh-free-search) --------------------------
    // Sits in front of the seam provider so BOTH the native web_search tool and
    // any other caller avoid re-spending keyless quota on an identical query.
    const searchCache = new SearchCache();
    const cachedSearchProvider = {
        id: PROVIDER_ID,
        available: () => routedSearchProvider.available(),
        search: async (request, signal) => {
            const cfg = readConfig();
            const key = buildCacheKey({
                query: request.query,
                maxResults: request.maxResults,
                preferred: cfg.defaultProvider,
            });
            const hit = searchCache.get(key, cfg.cacheTtlMs);
            if (hit) {
                return {
                    sources: hit.sources,
                    ...(hit.content ? { content: hit.content } : {}),
                    truncated: false,
                };
            }
            const result = await routedSearchProvider.search(request, signal);
            searchCache.set(key, {
                sources: result.sources,
                content: result.content,
                backend: cfg.defaultProvider,
                fallback: false,
            }, cfg.cacheTtlMs);
            return result;
        },
    };
    ctx.web.registerSearchProvider(cachedSearchProvider);
    // Wrap fetch provider with SpecializedSourceRouter
    const routedFetchProvider = {
        id: `${PROVIDER_ID}-fetch`,
        available: () => generalFetchProvider.available(),
        fetch: async (request, signal) => {
            const outcome = await sourceRegistry.fetch(request.url, signal);
            return toRoutedFetchResponse(request.url, outcome);
        },
    };
    ctx.web.registerFetchProvider(routedFetchProvider);
    // Specialized Sources: Register Xiaohongshu and Twitter/X with NativeBrowserRuntime
    const nativeRuntime = createNativeBrowserRuntime();
    const xhsSource = new XiaohongshuSource(nativeRuntime);
    const xSource = new XSource(nativeRuntime);
    sourceRegistry.registerSource(xhsSource);
    sourceRegistry.registerSource(xSource);
    // Hook NativeBrowserRuntime lifecycle into Cordis effect
    ctx.effect(() => {
        return () => {
            nativeRuntime.dispose().catch(() => { });
        };
    }, "dsh-omnisearch: native browser runtime");
    /** Run one real minimal search through a single provider (test connection). */
    async function testProviderSearch(providerName, query) {
        const adapter = getProvider(providerName);
        const started = Date.now();
        try {
            // Keyless providers (bing/ddg/anysearch/keenable-mcp) work
            // without any key; self-hosted ones do too.
            let key = "";
            if (!isKeyless(adapter)) {
                // Use the SHARED pool store so a failed probe marks the tested key
                // unhealthy — the card's per-key health must reflect reality, not a
                // fresh pool where every key always looks healthy.
                const entries = await poolStore.poolOf(providerName);
                if (entries.length === 0)
                    throw Object.assign(new Error("no API key configured"), { code: "config" });
                if (!entries.some((e) => e.healthy))
                    resetHealth(entries);
                const index = selectIndex(entries);
                const entry = entries[index];
                key = (entry?.key ?? "").trim();
                try {
                    const outcome = await adapter.search(query, 1, key, readConfig().providerBaseUrls[providerName]);
                    markUsed(entries, index);
                    if (!entry.healthy)
                        entry.healthy = true;
                    const latencyMs = Date.now() - started;
                    return {
                        ok: true,
                        latencyMs,
                        resultCount: outcome.sources.length,
                        title: outcome.sources[0]?.title,
                    };
                }
                catch (e) {
                    // Same policy as the executor: only an auth failure indicts the key.
                    const err = toProviderError(e);
                    if (err.code === "auth")
                        markUnhealthy(entries, index);
                    throw err;
                }
            }
            const outcome = await adapter.search(query, 1, key, readConfig().providerBaseUrls[providerName]);
            const latencyMs = Date.now() - started;
            return {
                ok: true,
                latencyMs,
                resultCount: outcome.sources.length,
                title: outcome.sources[0]?.title,
            };
        }
        catch (e) {
            const err = toProviderError(e);
            return { ok: false, error: { code: err.code, message: err.message } };
        }
    }
    /** Run the REAL search path (default provider + fallback) for the card.
     *  Delegates to the same provider used by agent web_search, so Test Search
     *  never drifts from production behavior. */
    /** Run the REAL search path (default provider + fallback) for the card.
     *  Delegates to the same provider used by agent web_search, so Test Search
     *  never drifts from production behavior. Total latency measured here. */
    async function testFullSearch(query) {
        const started = Date.now();
        try {
            const result = await routedSearchProvider.search({ query, maxResults: 5 }, undefined);
            return {
                ok: true,
                backend: result.backend,
                latencyMs: Date.now() - started,
                resultCount: result.sources.length,
                results: result.sources.slice(0, 5).map((s) => ({ title: s.title ?? s.url, url: s.url, snippet: s.snippet ?? "" })),
                attempts: result.attempts,
            };
        }
        catch (e) {
            const err = toProviderError(e);
            return {
                ok: false,
                latencyMs: Date.now() - started,
                error: { code: err.code, message: err.message },
            };
        }
    }
    /** Quota cache: { fetchedAt, per provider snapshot }. */
    let quotaCache = null;
    const QUOTA_CACHE_MS = 5 * 60 * 1000; // 5 min — quota is display-only, no 30s polling
    const QUOTA_TIMEOUT_MS = 8000;
    async function describeQuotas(force = false) {
        if (!force && quotaCache && Date.now() - quotaCache.fetchedAt < QUOTA_CACHE_MS)
            return quotaCache.quotas;
        const cfg = readConfig();
        const chainNames = new Set([cfg.defaultProvider, ...cfg.fallbackOrder]);
        const summary = stats.summary();
        // Read all credentials in parallel ONCE
        const credentialEntries = await Promise.all(PROVIDER_LIST.map(async (meta) => {
            const ref = credRefOf(meta.name);
            const cred = await readCredential(ctx, ref);
            return { meta, ref, cred };
        }));
        const wanted = new Set(chainNames);
        for (const { meta, cred } of credentialEntries) {
            if ((cred.value ?? "").trim().length > 0)
                wanted.add(meta.name);
        }
        const credMap = new Map(credentialEntries.map((e) => [e.meta.name, e.cred]));
        // Parallel, timeout-bounded, only providers that can report quota.
        const results = await Promise.allSettled(PROVIDER_LIST.filter((meta) => wanted.has(meta.name)).map(async (meta) => {
            const cred = credMap.get(meta.name);
            const localSearches = summary.byProvider[meta.name]?.success ?? 0;
            // Multi-key pool: query EVERY key and merge — the card shows the
            // TOTAL pool balance, not one key's. Each key is authenticated
            // separately (never join the raw string).
            const keys = buildPool(cred?.value ?? "").map((e) => e.key);
            if (keys.length === 0) {
                const snapshot = await withTimeoutMs(quotaOf(meta.name, "", cfg.providerBaseUrls[meta.name], localSearches), QUOTA_TIMEOUT_MS);
                return [meta.name, snapshot];
            }
            const perKey = await Promise.allSettled(keys.map((k) => withTimeoutMs(quotaOf(meta.name, k, cfg.providerBaseUrls[meta.name], localSearches), QUOTA_TIMEOUT_MS)));
            const fulfilled = perKey.filter((p) => p.status === "fulfilled").map((p) => p.value);
            if (fulfilled.length === 0) {
                const first = perKey.find((p) => p.status === "rejected");
                throw Object.assign(new Error(`quota check failed: ${first?.reason instanceof Error ? first.reason.message : String(first?.reason)}`), {
                    provider: meta.name,
                });
            }
            return [meta.name, mergePoolQuota(fulfilled)];
        }));
        const quotas = {};
        for (const r of results) {
            if (r.status === "fulfilled") {
                const [name, snap] = r.value;
                quotas[name] = snap;
            }
            else {
                const name = r.reason?.provider ?? "unknown";
                quotas[name] = {
                    supported: false,
                    authoritative: false,
                    unit: "unknown",
                    source: "dashboard",
                    fetchedAt: Date.now(),
                    note: `Quota check failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
                };
            }
        }
        quotaCache = { fetchedAt: Date.now(), quotas };
        return quotas;
    }
    // ---- Brave quota persistence --------------------------------------------
    // Brave has no quota endpoint; its only quota signal is the X-RateLimit-*
    // header captured during a real search. Persist those snapshots into the
    // settings namespace so a restart does not forget the last known balance.
    // Seeding MUST wait for the settings namespace (ctx.inject is async) — in
    // the synchronous apply() body readConfig() would only return defaults.
    configHandle.onMounted(() => {
        const braveCache = readConfig().braveQuotaCache ?? {};
        for (const [key, snap] of Object.entries(braveCache)) {
            if (key && snap && typeof snap === "object")
                seedBraveQuota(key, snap);
        }
        // Materialize the default fallback chain on first boot: without it the
        // executor would run [defaultProvider] alone (no failover at all), and the
        // card would show every keyless engine as "not in order" even though the
        // free-engine family is exactly what makes a zero-key install work.
        const cfg = readConfig();
        if (!Array.isArray(cfg.fallbackOrder) || cfg.fallbackOrder.length === 0) {
            void configHandle.write({ fallbackOrder: [...DEFAULT_FALLBACK_ORDER] }).catch(() => { });
        }
    });
    setBraveQuotaPersist((apiKey, snapshot) => {
        void configHandle
            .write({ braveQuotaCache: { ...readConfig().braveQuotaCache, [apiKey]: snapshot } })
            .catch(() => { });
    });
    // ---- Search Mode (per-session "required web search" turn policy) ---------
    // Host-owned state riding the provider seam: `available()` means the search
    // provider service is enabled with a chain provider. Messages use the
    // OFFICIAL @deepseek-ai/dsh-llm createUserMessage ({ content, source }):
    // required = durable snapshot section, correction = one-shot notice.
    // 一次性联网提示：只用官方 createUserMessage 包一段中文提示。
    // 会话级“强制联网”的注入/催办/掐回合逻辑已整体移除（见 search-mode-runtime.ts）。
    const searchModeRuntime = new SearchModeRuntime(() => routedSearchProvider.available());
    const searchModeMessages = {
        nudge: () => createUserMessage({
            content: [{ type: "text", text: SEARCH_NUDGE_TEXT }],
            source: { kind: "plugin", plugin: "dsh-omnisearch", form: "notice", summary: "本轮先联网检索" },
        }),
    };
    ctx.effect(() => installSearchModeRuntime(ctx, undefined, searchModeRuntime, searchModeMessages), "dsh-omnisearch: search nudge command");
    // 模式状态仍保留给 /search 与路由读取（但不再有任何强制行为）。
    const searchMode = {
        view: (sessionId) => searchModeRuntime.view(sessionId),
        set: (sessionId, mode) => {
            searchModeRuntime.setMode(sessionId, mode);
            return searchModeRuntime.view(sessionId);
        },
    };
    // ---- merged free-engine knobs (dsh-free-search) -------------------------
    // The keyless adapters read module-level knobs; push the current settings
    // into them at boot and on every change.
    const syncRuntimeKnobs = () => {
        const cfg = readConfig();
        setFreeEngineOptions({
            bingMarket: cfg.bingMarket,
            region: cfg.region ? cfg.region : undefined,
            safeSearch: cfg.safeSearch,
            lang: cfg.lang,
        });
    };
    configHandle.onMounted(syncRuntimeKnobs);
    configHandle.onChange(syncRuntimeKnobs);
    // ---- merged tool surfaces -----------------------------------------------
    // Declared BEFORE any ctx.inject: inject callbacks can run synchronously
    // inside apply(), and a `let` initialised later would be in TDZ (which
    // aborted the whole plugin load once already).
    let toolExecutor;
    ctx.inject(["tools"], (sctx) => {
        // Defensive: an older host (or a partial test context) may not expose the
        // tool registry. The plugin must degrade to search-only, not crash.
        if (typeof sctx.tools?.register !== "function")
            return;
        // Same registry also EXECUTES tools — used to drive the sidebar browser.
        if (typeof sctx.tools.execute === "function") {
            toolExecutor = sctx.tools;
        }
        sctx.effect(() => {
            const disposers = [];
            disposers.push(sctx.tools.register(createAdvancedSearchTool({
                // advanced_search speaks to the GENERAL chain (not the platform
                // router): an explicit date window is never a platform query.
                search: (req, signal) => generalSearchProvider.search(req, signal),
                chain: () => {
                    const cfg = readConfig();
                    return [cfg.defaultProvider, ...(cfg.fallbackOrder.length > 0 ? cfg.fallbackOrder : DEFAULT_FALLBACK_ORDER)];
                },
                defaultProvider: () => readConfig().defaultProvider,
                isEnabled: (n) => readConfig().providerEnabled?.[n] !== false,
            })));
            disposers.push(sctx.tools.register(createPlatformSearchTool({
                enabled: () => readConfig().platformSearchEnabled ?? {},
                lang: () => readConfig().lang,
            })));
            disposers.push(sctx.tools.register(createEngineTestTool({
                adapters: PROVIDERS,
                isEnabled: (n) => readConfig().providerEnabled?.[n] !== false,
                resolveKey: (n) => resolveKeys(n),
                baseUrl: (n) => readConfig().providerBaseUrls?.[n],
                timeoutMs: () => readConfig().providerAttemptTimeoutMs,
                extraNotes: () => [
                    `Date-filtering engines (advanced_search): ${TIME_FILTER_ENGINES.join(", ")}`,
                ],
            })));
            return () => {
                for (const dispose of disposers)
                    dispose();
            };
        }, "dsh-omnisearch: merged tools");
    });
    // ---- system-prompt section (merged from dsh-free-search) ----------------
    ctx.inject(["systemPrompt"], (sctx) => {
        // Defensive: no systemPrompt service → skip the engine/status section.
        if (typeof sctx.systemPrompt?.section !== "function")
            return;
        let disposeSection;
        const refresh = () => {
            disposeSection?.();
            disposeSection = undefined;
            if (readConfig().promptSection === false)
                return;
            const cfg = readConfig();
            const chain = [cfg.defaultProvider, ...(cfg.fallbackOrder.length > 0 ? cfg.fallbackOrder : DEFAULT_FALLBACK_ORDER)];
            disposeSection = sctx.systemPrompt.section({
                name: "dsh-omnisearch:engines",
                order: 500,
                text: buildPromptText({
                    preferred: cfg.defaultProvider,
                    chain,
                    engines: PROVIDER_LIST.map((meta) => ({
                        name: meta.name,
                        label: meta.label,
                        keyed: !isKeyless(meta),
                        timeCapable: TIME_FILTER_ENGINES.includes(meta.name),
                        enabled: cfg.providerEnabled?.[meta.name] !== false,
                    })),
                    safeSearch: cfg.safeSearch ?? "off",
                    bingMarket: cfg.bingMarket ?? "zh-CN",
                    lang: cfg.lang ?? "zh",
                    cacheTtlMs: cfg.cacheTtlMs ?? 0,
                    platformSearchEnabled: cfg.platformSearchEnabled ?? {},
                }),
            });
        };
        sctx.effect(() => {
            refresh();
            return () => {
                disposeSection?.();
                disposeSection = undefined;
            };
        }, "dsh-omnisearch: prompt section");
        configHandle.onMounted(refresh);
        configHandle.onChange(refresh);
    });
    // ---- sidebar-browser login (Playwright MCP) -----------------------------
    // The NAS is headless: the plugin's own chromium window is invisible, so an
    // interactive login has to happen in the browser the user can actually see
    // — the DSH sidebar browser. Drive it through the MCP tool bridge, capture
    // the cookies, and let the CDP session replay them (see cookie-jar).
    const sidebarLogin = {
        available: () => toolExecutor !== undefined,
        /** Starts the sidebar login; the client polls platform/status for the result. */
        login: async (platform) => {
            if (!toolExecutor)
                throw new Error("tool runtime unavailable");
            const profileDir = getDedicatedProfileDir(platform);
            const outcome = await loginViaMcpBrowser(toolExecutor, platform, profileDir);
            if (!outcome.ok) {
                nativeRuntime.noteLoginFailure(platform, outcome.error ?? "sidebar login failed");
            }
            return { ok: outcome.ok, ...(outcome.error ? { error: outcome.error } : {}) };
        },
    };
    // ---- fenced HTTP routes for the card ------------------------------------
    ctx.effect(() => registerRoutes(ctx, {
        readConfig: () => readConfig(),
        writeConfig: (patch) => configHandle.write(patch),
        readCredential: (ref) => readCredential(ctx, ref),
        writeCredential: (ref, value) => writeCredential(ctx, ref, value),
        testProviderSearch,
        testFullSearch,
        describeQuotas,
        nativeRuntime,
        sourceRegistry,
        checkVersion,
        poolEntries: (providerName) => poolStore.poolOf(providerName),
        proxyStatus,
        searchMode,
        sidebarLogin,
        savePlatformCookies: (platform, cookies) => {
            const dir = getDedicatedProfileDir(platform);
            saveCookieJar(dir, platform, cookies);
            // 让 status() 重新读 jar（旧元数据可能还写着未登录）
            try {
                nativeRuntime.noteLoginFailure; // no-op
            }
            catch {
                // ignore
            }
        },
    }), "dsh-omnisearch: /omnisearch/api routes");
}
function toProviderError(error) {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
        return error;
    }
    const message = describeFetchError(error);
    const err = new Error(message);
    err.code = "network";
    return err;
}
/**
 * Human-readable network failure. undici's global fetch throws a generic
 * `TypeError: fetch failed` whose real cause (ECONNREFUSED, DNS, TLS,
 * timeout, proxy refusal) sits in `error.cause` — surface it so the settings
 * card shows why a provider is unreachable instead of the bare wrapper.
 */
function describeFetchError(error) {
    const top = error instanceof Error ? error.message : String(error);
    let cause = error?.cause;
    const seen = new Set([error]);
    while (cause !== undefined && cause !== null && !seen.has(cause)) {
        seen.add(cause);
        if (cause instanceof AggregateError) {
            const first = cause.errors?.[0];
            if (first instanceof Error && first.message && !seen.has(first)) {
                cause = first;
                continue;
            }
        }
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (msg && msg !== top)
            return `${top}: ${msg}`;
        cause = cause?.cause;
    }
    return top;
}
/** Simple timeout wrapper for side-channel quota lookups (no abort needed). */
function withTimeoutMs(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
            // Never keep the process alive just for an expired quota timer.
            timer.unref?.();
        }),
    ]);
}
export { PROVIDER_ID };
