/**
 * dsh-omnisearch — provider registry.
 * @module
 */
import { BraveProvider, braveQuota } from "./brave.ts";
import { ExaProvider } from "./exa.ts";
import { FirecrawlProvider } from "./firecrawl.ts";
import { JinaProvider, jinaQuota } from "./jina.ts";
import { ParallelProvider } from "./parallel.ts";
import { SearxngProvider } from "./searxng.ts";
import { TavilyProvider } from "./tavily.ts";
import { YouProvider, youQuota } from "./you.ts";
import {
  AnySearchProvider,
  BingProvider,
  DuckDuckGoLiteProvider,
  DuckDuckGoProvider,
  KeenableProvider,
} from "./free-engines.ts";
import type { QuotaProvider, QuotaSnapshot } from "../quota.ts";
import { dashboardOnlyQuota, localUsageQuota, selfHostedQuota } from "../quota.ts";
import { tavilyQuota } from "./tavily-quota.ts";
import { firecrawlQuota } from "./firecrawl-quota.ts";
import type { ProviderAdapter } from "./types.ts";
import { providerError } from "./types.ts";

/** Adapter + optional quota reporter. */
export interface ProviderWithQuota extends ProviderAdapter {
  quota?: QuotaProvider["quota"];
}

/**
 * Keyless engine ids, tried after the keyed providers when no credential is
 * configured. Kept as a named list so the client UI, the system-prompt section
 * and the docs describe the same set.
 */
export const FREE_ENGINE_PROVIDERS: ProviderWithQuota[] = [
  BingProvider,
  DuckDuckGoProvider,
  DuckDuckGoLiteProvider,
  AnySearchProvider,
  KeenableProvider,
];

/** Providers that run without any credential at all. */
export const KEYLESS_PROVIDER_NAMES: string[] = [
  "exa",
  "tavily",
  "firecrawl",
  "keenable",
  "parallel",
  "anysearch",
  "bing",
  "ddg",
  "ddg-lite",
  "searxng",
];

/** All built-in adapters, keyed by name. */
export const PROVIDERS: Record<string, ProviderWithQuota> = {
  tavily: { ...TavilyProvider, quota: (key, _base, signal) => tavilyQuota(key, signal) },
  exa: ExaProvider,
  firecrawl: { ...FirecrawlProvider, quota: (key, _base, signal) => firecrawlQuota(key, signal) },
  parallel: ParallelProvider,
  brave: { ...BraveProvider, quota: (key, _base, signal) => braveQuota(key, _base, signal) },
  you: { ...YouProvider, quota: (key, _base, signal) => youQuota(key, signal) },
  jina: { ...JinaProvider, quota: (key, _base, signal) => jinaQuota(key, signal) },
  searxng: SearxngProvider,
  // ---- keyless free engines (merged from dsh-free-search) ----
  bing: BingProvider,
  ddg: DuckDuckGoProvider,
  "ddg-lite": DuckDuckGoLiteProvider,
  anysearch: AnySearchProvider,
  keenable: KeenableProvider,
};

/** Ordered adapter list for UI/fallback iteration. */
export const PROVIDER_LIST: ProviderWithQuota[] = [
  TavilyProvider,
  ExaProvider,
  FirecrawlProvider,
  ParallelProvider,
  BraveProvider,
  YouProvider,
  JinaProvider,
  SearxngProvider,
  ...FREE_ENGINE_PROVIDERS,
];

/** Look up an adapter; throws a classified config error when unknown. */
export function getProvider(name: string): ProviderWithQuota {
  const p = PROVIDERS[name];
  if (!p) throw providerError("config", `Unknown provider "${name}"`);
  return p;
}

/**
 * Fetch a provider's quota snapshot with sensible defaults for providers
 * without a quota API (never throws for unsupported providers).
 */
export async function quotaOf(
  providerName: string,
  apiKey: string,
  baseUrl: string | undefined,
  localCount?: number,
  signal?: AbortSignal,
): Promise<QuotaSnapshot> {
  const p = getProvider(providerName);
  if (p.quota) {
    if (!apiKey && p.needsBaseUrl) return selfHostedQuota("Self-hosted — no platform quota");
    return p.quota(apiKey, baseUrl, signal);
  }
  if (p.needsBaseUrl) return selfHostedQuota("Self-hosted — no platform quota");
  if (localCount !== undefined && localCount > 0) {
    return localUsageQuota(localCount, "Estimated local usage — official balance lives in the provider dashboard");
  }
  return dashboardOnlyQuota("Balance is available in the provider dashboard only");
}

/** Credential ref for one provider ("DSH_OMNISEARCH_TAVILY"). */
export function credRefOf(providerName: string): string {
  const p = getProvider(providerName);
  return `DSH_OMNISEARCH_${p.credSuffix}`;
}

export { providerError };
export type { ProviderError, ProviderAdapter, SearchOutcome, Source } from "./types.ts";
