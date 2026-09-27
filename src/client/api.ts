/**
 * dsh-omnisearch — browser card: typed fetch client over the plugin's fenced
 * `/omnisearch/api` routes.
 *
 * The browser never talks to provider APIs directly and never receives
 * credential values — only configured/writable state and quota snapshots
 * (which contain no secrets).
 * @module
 */

/**
 * RELATIVE on purpose: the boot HTML carries `<base href="./">`, so this
 * resolves against the page URL and keeps working under path-prefix entries
 * (the fnOS gateway serves the app at /app/deepseek-harness/fngateway/). An
 * absolute "/omnisearch/..." would hit the fnOS nginx root and 404 with a
 * non-JSON body — the exact "API returned non-JSON (HTTP 404)" symptom the
 * dsh-context / dsh-vision-assistant panels hit before.
 */
export const API_PREFIX = "omnisearch/api";

/** One wire failure. */
export class WebToolsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Call one API method; throws WebToolsApiError on failure. */
export async function call<T>(method: string, payload?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
  } catch (e) {
    throw new WebToolsApiError("network", `omnisearch API unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new WebToolsApiError("bad-response", `omnisearch API returned non-JSON (HTTP ${res.status})`);
  }
  const body = json as { ok?: boolean; value?: T; error?: { code?: string; message?: string } };
  if (!body.ok || body.value === undefined) {
    throw new WebToolsApiError(body.error?.code ?? "error", body.error?.message ?? "omnisearch API error");
  }
  return body.value;
}

/**
 * Human `code: message` detail for a thrown API failure (merged from
 * dsh-free-search v0.4.38): a bare "save failed" leaves the user nothing to act
 * on, so the wire code — credentials-set / config-save / routing-set — is kept.
 */
export function describeApiError(e: unknown): string {
  if (e instanceof WebToolsApiError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// typed endpoint wrappers (wire types shared with the Host — see shared/api-types)
// ---------------------------------------------------------------------------

import type {
  ConfigView,
  CredentialsView,
  QuotaDescribeView,
  SearchMode,
  SearchModeView,
  TestProviderView,
  TestSearchView,
  SearchRoutingPolicy,
  VersionCheckView,
} from "../shared/api-types.ts";
import type {
  BrowserPlatform,
  PlatformStatusResponse,
} from "../shared/platform-types.ts";

export type {
  ConfigView,
  CredentialsView,
  ProviderView,
  QuotaDescribeView,
  QuotaView,
  SearchMode,
  SearchModeView,
  TestProviderView,
  TestSearchView,
  SearchRoutingPolicy,
  VersionCheckView,
} from "../shared/api-types.ts";
export type {
  BrowserPlatform,
  PlatformStatusResponse,
} from "../shared/platform-types.ts";

export const api = {
  configGet: () => call<ConfigView>("config/get"),
  configSave: (payload: Record<string, unknown>) => call<{ saved: true }>("config/save", payload),
  credentialsDescribe: () => call<CredentialsView>("credentials/describe"),
  credentialsSet: (provider: string, value: string) => call<{ configured: boolean; poolSize: number }>("credentials/set", { provider, value }),
  credentialsAddKey: (provider: string, value: string) => call<{ configured: boolean; poolSize: number }>("credentials/add-key", { provider, value }),
  credentialsRemoveKey: (provider: string, keyId: string) => call<{ configured: boolean; poolSize: number }>("credentials/remove-key", { provider, keyId }),
  testProvider: (provider: string, query?: string) => call<TestProviderView>("test/provider", { provider, query }),
  testSearch: (query: string) => call<TestSearchView>("test/search", { query }),
  quotaDescribe: (force = false) => call<QuotaDescribeView>("quota/describe", { force }),
  versionCheck: () => call<VersionCheckView>("version/check"),
  searchModeGet: (sessionId: string) => call<SearchModeView>("search-mode/get", { sessionId }),
  searchModeSet: (sessionId: string, mode: SearchMode) => call<SearchModeView>("search-mode/set", { sessionId, mode }),
  providerOptionsSet: (provider: string, options: Record<string, unknown>) =>
    call<{ saved: true; options: any }>("provider-options/set", { provider, options }),
  providerOptionsReset: (provider: string) =>
    call<{ reset: true; options: any }>("provider-options/reset", { provider }),
  providerOptionsBatch: (providers: Record<string, Record<string, unknown> | null>) =>
    call<Record<string, any>>("provider-options/batch", { providers }),
  routingSet: (policy: SearchRoutingPolicy, orderedProviders: string[]) =>
    call<{ saved: true; policy: SearchRoutingPolicy; defaultProvider: string; fallbackOrder: string[] }>("routing/set", { policy, orderedProviders }),
  platformStatus: () =>
    call<PlatformStatusResponse>("platform/status"),
  platformLogin: (platform: BrowserPlatform) =>
    call<{ status: string }>("platform/login", { platform }),
  platformImportCookies: (platform: BrowserPlatform, cookies: string) =>
    call<{ saved: number; platform: string }>("platform/cookies/set", { platform, cookies }),
  vncStart: (platform: BrowserPlatform) =>
    call<{ ok: boolean; platform: string; token?: string; error?: string }>("vnc/start", { platform }),
  vncStop: (platform: BrowserPlatform) => call<{ ok: true }>("vnc/stop", { platform }),
  platformStop: (platform: BrowserPlatform) =>
    call<{ ok: boolean }>("platform/stop", { platform }),
  platformReset: (platform: BrowserPlatform) =>
    call<{ ok: boolean }>("platform/reset", { platform }),
};
