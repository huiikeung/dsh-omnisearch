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
export const SETTINGS_NS = "dsh-omnisearch";

/** Default provider when nothing is configured. Changed from tavily to exa
 *  based on P5 evaluation: Exa achieves 72.2% Top-1, 97.2% Top-3 evidence,
 *  75% official source hit, 0% generic, 0% error across 36 tasks.
 *  dsh-omnisearch additionally falls back to Exa's public MCP endpoint when no key
 *  is configured, so this default also works on a fresh install with zero keys. */
export const DEFAULT_PROVIDER = "exa";

/**
 * Default fallback chain, applied when the user has not ordered the providers
 * themselves. Replaces the upstream "chain = [defaultProvider]" behaviour,
 * which silently disabled auto-failover on a fresh install.
 *
 * Order: JSON engines (best precision, keyless tiers available) → HTML engines
 * (always free) → self-hosted → CLI bridge (slowest, opt-in).
 */
export const DEFAULT_FALLBACK_ORDER: string[] = [
  "tavily",
  "firecrawl",
  "keenable",
  "bing",
  "anysearch",
  "ddg",
  "ddg-lite",
  "searxng",
  "parallel",
  "brave",
  "you",
  "jina",
];

/**
 * Explicit defaults. The resolved settings type is `WebToolsSettings` (below);
 * `Config` is the schemastery schema annotated the official way
 * (`z<WebToolsSettings>`) so the emitted d.ts references only `schemastery`,
 * never the dsh-private cosmokit copy.
 */
export const DEFAULT_SETTINGS = {
  enabled: true,
  defaultProvider: DEFAULT_PROVIDER,
  // Per-attempt budget for ONE provider call (the DSH tool owns the overall
  // web_search timeout). Distinct from tool-level timeout: this is how long a
  // single provider may run before we abort it and try the next one.
  providerAttemptTimeoutMs: 10000,
  fallbackOrder: [] as string[],
  providerBaseUrls: {} as Record<string, string>,
  providerEnabled: {} as Record<string, boolean>,
  platformEnabled: { xiaohongshu: true, x: true } as Record<string, boolean>,
  providerOptions: {} as StoredProviderOptions,
  // Brave has NO quota endpoint — its only quota signal is the X-RateLimit-*
  // response header captured during a real search. Persisted here so a
  // restart does not forget the last known balance (keyed by API key).
  braveQuotaCache: {} as Record<string, QuotaSnapshot>,
  // Search routing policy: how the runtime picks the starting provider per
  // search query. "ordered" = always from the first available; "round-robin"
  // and "random" rotate the start offset (see routing-policy.ts).
  searchRoutingPolicy: "ordered" as ToolSearchRoutingPolicy,

  // ---- keyless free-engine knobs (merged from dsh-free-search) ----------
  /** Bing market (mkt=) and, when set, the Accept-Language source. */
  bingMarket: "zh-CN",
  /** DuckDuckGo region (kl=), e.g. "cn-zh". Empty = engine default. */
  region: "",
  /** Adult filter for engines that expose one (bing / ddg / ddg-lite). */
  safeSearch: "off" as SafeSearchLevel,
  /** Default result language profile ("zh" | "en" | ...). */
  lang: "zh",

  // ---- result cache (protects the keyless quotas) -----------------------
  /** Identical-query cache TTL in ms; 0 disables caching. Max 5 minutes. */
  cacheTtlMs: 300_000,

  // ---- merged tool surfaces --------------------------------------------
  /** Platforms enabled for the platform_search tool. */
  platformSearchEnabled: {
    github: true,
    v2ex: true,
    bilibili: true,
    reddit: true,
    hn: true,
    stackoverflow: true,
    wikipedia: true,
    npm: true,
  } as Record<string, boolean>,
  /** Inject the engine/status section into the system prompt. */
  promptSection: true,
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

  // ---- merged from dsh-free-search --------------------------------------
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

/** The schema object for settings registration (official z<T> annotation). */
export const Config: z<WebToolsSettings> = z.object({
  enabled: z.boolean(),
  defaultProvider: z.string(),
  providerAttemptTimeoutMs: z.number().step(1).min(1000).max(60000),
  fallbackOrder: z.array(z.string()),
  providerBaseUrls: z.dict(z.string()),
  providerEnabled: z.dict(z.boolean()),
  platformEnabled: z.dict(z.boolean()),
  providerOptions: z.dict(z.any()),
  braveQuotaCache: z.dict(z.any()),
  searchRoutingPolicy: z.union([z.const("ordered"), z.const("round-robin"), z.const("random")]),
  bingMarket: z.string(),
  region: z.string(),
  safeSearch: z.union([z.const("off"), z.const("moderate"), z.const("strict")]),
  lang: z.string(),
  cacheTtlMs: z.number().step(1000).min(0).max(300_000),
  platformSearchEnabled: z.dict(z.boolean()),
  promptSection: z.boolean(),
});

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
 * Register the settings namespace; returns a handle for reads (live) and
 * Host-side writes. The browser card writes through the fenced routes, never
 * through settings/mutate (that proxy's whitelist excludes third-party
 * namespaces).
 */
export function installConfig(ctx: WebToolsContext): ConfigHandle {
  let current = () => DEFAULT_SETTINGS;
  let scope: { update: (patch: object) => Promise<void> } | undefined;
  const mountedCbs: Array<() => void> = [];
  const changeCbs: Array<() => void> = [];

  ctx.inject(["settings"], (sctx) => {
    const registered = sctx.settings.register(SETTINGS_NS, Config, {
      base: DEFAULT_SETTINGS,
    });
    scope = registered;
    current = () => registered.get() as WebToolsSettings;
    // Live edits refresh the runtime knobs, the prompt section and the card.
    registered.watch(() => {
      for (const cb of changeCbs.slice()) {
        try {
          cb();
        } catch {
          // A failing observer must never break the settings write itself.
        }
      }
    });
    // Settings are readable only from here on; run deferred boot work now.
    for (const cb of mountedCbs.splice(0)) cb();
  });

  return {
    read: () => current(),
    write: async (patch) => {
      if (!scope) throw new Error("dsh-omnisearch settings namespace is not mounted");
      await scope.update(patch);
    },
    onMounted: (cb) => {
      mountedCbs.push(cb);
    },
    onChange: (cb) => {
      changeCbs.push(cb);
      return () => {
        const index = changeCbs.indexOf(cb);
        if (index >= 0) changeCbs.splice(index, 1);
      };
    },
  };
}
