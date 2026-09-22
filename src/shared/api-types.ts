/**
 * dsh-omnisearch — shared wire types between Host routes and the Client card.
 *
 * Single source of truth for the /omnisearch/api contract, so Host return
 * shapes and Client consumption cannot drift apart.
 * @module
 */

import type { ProviderOptionView } from "./provider-options.ts";

/** Search routing policy — how the host picks which provider to try first. */
export type SearchRoutingPolicy = "ordered" | "round-robin" | "random";

/** One provider as surfaced to the settings card. */
export interface ProviderView {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Resolved base URL (explicit setting or adapter default). */
  baseUrl?: string;
  /** True only when the operator explicitly configured a base URL (adapter defaults don't count). */
  baseUrlConfigured?: boolean;
  credRef: string;
  keyConfigured: boolean;
  keyWritable: boolean;
  /**
   * True when the engine works with NO credential (merged keyless family:
   * bing / ddg / ddg-lite / anysearch / keenable / the keyless tiers of
   * exa-tavily-firecrawl). The card treats these as
   * ready even with an empty key field.
   */
  keyless?: boolean;
  keyHint?: string;
  /** Number of keys in the credential pool (no per-key health — runtime state). */
  poolSize: number;
  /** Per-key masked hints + live health (no secrets; display only). */
  keys?: Array<{ id: string; hint: string; healthy: boolean }>;
  /** Provider-native execution settings (effective values + user overrides). */
  options?: ProviderOptionView;
}

/** Full config snapshot for the card. */
export interface ConfigView {
  enabled: boolean;
  defaultProvider: string;
  providerAttemptTimeoutMs: number;
  fallbackOrder: string[];
  providers: ProviderView[];
  platformEnabled?: Record<string, boolean>;
  /**
   * Proxy support state: whether a proxy is configured (env var or Windows
   * system proxy) and whether undici (the proxy engine) is loadable. When a
   * proxy is needed but undici is missing, outbound calls degrade to direct
   * fetch — the card should warn the operator.
   */
  proxy?: {
    configured: boolean;
    /** Proxy desired but undici unavailable → degraded to direct fetch. */
    degraded: boolean;
  };
  /** Search routing policy (ordered/round-robin/random). */
  searchRoutingPolicy?: SearchRoutingPolicy;

  // ---- merged knobs (dsh-free-search) ------------------------------------
  /** Bing market (mkt=), also the Accept-Language source when set explicitly. */
  bingMarket?: string;
  /** DuckDuckGo region (kl=). */
  region?: string;
  /** Adult filter for bing / ddg / ddg-lite. */
  safeSearch?: "off" | "moderate" | "strict";
  /** Default result language profile. */
  lang?: string;
  /** Result cache TTL in ms (0 = disabled, max 300000). */
  cacheTtlMs?: number;
  /** Whether the engine/status section is injected into the system prompt. */
  promptSection?: boolean;
  /** Platforms enabled for the platform_search tool. */
  platformSearchEnabled?: Record<string, boolean>;
  /** Whether interactive platform login can use the DSH sidebar browser (MCP). */
  sidebarLoginAvailable?: boolean;
}

/** One quota snapshot for the card (display only). */
export interface QuotaView {
  supported: boolean;
  authoritative: boolean;
  unit: string;
  remaining?: number;
  used?: number;
  limit?: number;
  resetAt?: string;
  breakdown?: Record<string, number>;
  source: string;
  fetchedAt?: number;
  note?: string;
}

/** Result of a Test Search run through the real executor. */
export interface TestSearchView {
  ok: boolean;
  backend?: string;
  latencyMs?: number;
  resultCount?: number;
  results?: Array<{ title: string; url: string; snippet: string }>;
  attempts?: Array<{ provider: string; outcome: string; latencyMs?: number }>;
  error?: { code: string; message: string };
}

/** Result of a single-provider connection test. */
export interface TestProviderView {
  ok: boolean;
  latencyMs?: number;
  resultCount?: number;
  title?: string;
  error?: { code: string; message: string };
}

/** A credential's configured state (values never cross the wire). */
export interface CredentialView {
  configured: boolean;
  source?: string;
  writable: boolean;
}

/** The full credentials/describe response. */
export interface CredentialsView {
  credentials: Record<string, CredentialView>;
}

/**
 * "Web Search mode" per-session policy: `auto` lets the agent decide whether
 * to call web_search; `required` demands at least one completed web_search
 * call (success OR failure) before that turn may end. Host-owned state, so it
 * survives browser refresh / relaunch.
 */
export type SearchMode = "auto" | "required";

/** The search-mode state surfaced to the client. */
export interface SearchModeView {
  mode: SearchMode;
  /** True when there is currently a usable search provider (button gray-out). */
  available: boolean;
}

/** The full quota/describe response. */
export interface QuotaDescribeView {
  quotas: Record<string, QuotaView>;
}

/** Non-blocking release check surfaced by the settings page. */
export interface VersionCheckView {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseName?: string;
  publishedAt?: string;
}
