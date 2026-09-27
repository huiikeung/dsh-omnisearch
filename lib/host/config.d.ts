/**
 * dsh-omnisearch — Host configuration: settings namespace + schema.
 *
 * The config (non-secret knobs) lives in a `dsh-omnisearch` settings namespace
 * registered through the settings service, so it persists with the deployment's
 * settings document. API keys are NOT here — they live in the credentials
 * domain (`DSH_OMNISEARCH_*` refs).
 * @module
 */
import z from "@deepseek-ai/schemastery";
import type { WebToolsContext } from "./context-types.ts";
import type { QuotaSnapshot } from "./quota.ts";
import type { StoredProviderOptions } from "../shared/provider-options.ts";
import type { SearchRoutingPolicy } from "../shared/api-types.ts";
import type { SafeSearchLevel } from "./free-engine-options.ts";
/** Persistent search routing policy id (shared with the client card). */
export type ToolSearchRoutingPolicy = SearchRoutingPolicy;
/** Settings namespace for this plugin. */
export declare const SETTINGS_NS = "dsh-omnisearch";
/** Default provider when nothing is configured. Changed from tavily to exa
 *  based on P5 evaluation: Exa achieves 72.2% Top-1, 97.2% Top-3 evidence,
 *  75% official source hit, 0% generic, 0% error across 36 tasks.
 *  dsh-omnisearch additionally falls back to Exa's public MCP endpoint when no key
 *  is configured, so this default also works on a fresh install with zero keys. */
export declare const DEFAULT_PROVIDER = "exa";
/**
 * Default fallback chain, applied when the user has not ordered the providers
 * themselves. Replaces the upstream "chain = [defaultProvider]" behaviour,
 * which silently disabled auto-failover on a fresh install.
 *
 * Order: JSON engines (best precision, keyless tiers available) → HTML engines
 * (always free) → self-hosted → CLI bridge (slowest, opt-in).
 */
export declare const DEFAULT_FALLBACK_ORDER: string[];
/**
 * Explicit defaults. The resolved settings type is `WebToolsSettings` (below);
 * `Config` is the schemastery schema annotated the official way
 * (`z<WebToolsSettings>`) so the emitted d.ts references only `schemastery`,
 * never the dsh-private cosmokit copy.
 */
export declare const DEFAULT_SETTINGS: {
    enabled: boolean;
    defaultProvider: string;
    providerAttemptTimeoutMs: number;
    fallbackOrder: string[];
    providerBaseUrls: Record<string, string>;
    providerEnabled: Record<string, boolean>;
    platformEnabled: Record<string, boolean>;
    providerOptions: StoredProviderOptions;
    braveQuotaCache: Record<string, QuotaSnapshot>;
    searchRoutingPolicy: ToolSearchRoutingPolicy;
    /** Bing market (mkt=) and, when set, the Accept-Language source. */
    bingMarket: string;
    /** DuckDuckGo region (kl=), e.g. "cn-zh". Empty = engine default. */
    region: string;
    /** Adult filter for engines that expose one (bing / ddg / ddg-lite). */
    safeSearch: SafeSearchLevel;
    /** Default result language profile ("zh" | "en" | ...). */
    lang: string;
    /** Identical-query cache TTL in ms; 0 disables caching. Max 5 minutes. */
    cacheTtlMs: number;
    /** Platforms enabled for the platform_search tool. */
    platformSearchEnabled: Record<string, boolean>;
    /** Inject the engine/status section into the system prompt. */
    promptSection: boolean;
};
/** Resolved settings shape (explicit interface — portable in emitted d.ts). */
export interface WebToolsSettings {
    enabled: boolean;
    defaultProvider: string;
    providerAttemptTimeoutMs: number;
    fallbackOrder: string[];
    providerBaseUrls: Record<string, string>;
    providerEnabled: Record<string, boolean>;
    platformEnabled: Record<string, boolean>;
    providerOptions: StoredProviderOptions;
    /** Brave per-key quota snapshots captured from search response headers. */
    braveQuotaCache: Record<string, QuotaSnapshot>;
    /** Search routing policy (see shared api-types). */
    searchRoutingPolicy: ToolSearchRoutingPolicy;
    /** Bing market (mkt=); also drives Bing's Accept-Language when set. */
    bingMarket: string;
    /** DuckDuckGo region (kl=). Empty = engine default. */
    region: string;
    /** Adult filter for bing / ddg / ddg-lite. */
    safeSearch: SafeSearchLevel;
    /** Default result language profile. */
    lang: string;
    /** Result-cache TTL in ms (0 = disabled, capped at 5 minutes). */
    cacheTtlMs: number;
    /** Platforms enabled for the platform_search tool (merged from free-search). */
    platformSearchEnabled: Record<string, boolean>;
    /** Whether the engine/status section is injected into the system prompt. */
    promptSection: boolean;
}
/**
 * Unwrap the live `Volatile<T>` references the Loader passes for `.volatile()`
 * fields into a plain object (once per read, so every read sees the latest
 * accepted value). Plain configs are returned as-is.
 */
export declare function resolvePluginConfig(config: unknown): Partial<WebToolsSettings>;
/**
 * The schema object for settings registration (official z<T> annotation).
 *
 * Every field carries BOTH a default and the `.volatile()` marker (merged from
 * dsh-free-search v0.4.36-37, the DSH 0.1.7 config migration):
 *  - the default lets the Loader resolve a profile entry that declares no
 *    `config:` at all (0.1.7 parses the entry against this schema);
 *  - `.volatile()` is what makes the fields live-editable through
 *    `settings/update` on 0.1.7+, and is ignored by older schemastery.
 */
export declare const Config: z<WebToolsSettings>;
/** A settings-scope handle: current value + write path. */
export interface ConfigHandle {
    /** Resolve the current effective section (re-read each call → live edits apply). */
    read: () => WebToolsSettings;
    /** Write a partial patch into the namespace; resolves when persisted. */
    write: (patch: Partial<WebToolsSettings>) => Promise<void>;
    /**
     * Called once the settings namespace is registered (ctx.inject callback).
     * Use it for anything that must read persisted settings at boot — the
     * synchronous apply() body runs BEFORE the inject callback, so reading
     * config there would only see the defaults.
     */
    onMounted: (cb: () => void) => void;
    /**
     * Run `cb` whenever the settings namespace changes (merged feature: the
     * free-engine knobs, the CLI bridge options and the system-prompt section all
     * have to refresh on a live edit). Returns a disposer.
     */
    onChange: (cb: () => void) => () => void;
}
/**
 * Register the settings namespace and return a handle for reads (live) and
 * Host-side writes. The browser card writes through the fenced routes, never
 * through settings/mutate (that proxy's whitelist excludes third-party
 * namespaces).
 *
 * Two host generations are supported (merged from dsh-free-search v0.4.36-37):
 *  - DSH ≤ 0.1.6: `settings.register(ns, schema, { base })` owns the section;
 *  - DSH 0.1.7+: the profile patch owns the entry config and the Loader hands it
 *    to `apply` (live refs for volatile fields), so we only declare that we ship
 *    our own page (`configure({ auto: false })`) and write through
 *    `settings.update(ns, patch)`.
 *
 * `pluginConfig` is the live entry config the Loader passed to `apply` (new
 * generation only; ignored on the legacy path).
 */
export declare function installConfig(ctx: WebToolsContext, pluginConfig?: unknown): ConfigHandle;
