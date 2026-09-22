/**
 * dsh-omnisearch — global knobs for the keyless "free engine" family.
 *
 * dsh-free-search keeps `bingMarket` / `region` / `safeSearch` as plugin-wide
 * settings (not per-provider options). dsh-omnisearch keeps that model: the host
 * pushes the current values here whenever settings change, and the free-engine
 * adapters read them per call. Per-provider options, when present, win over the
 * global value so a future per-engine override needs no adapter change.
 *
 * @module
 */

/** Safe-search policy applied to engines that support an adult filter. */
export type SafeSearchLevel = "off" | "moderate" | "strict";

/** Plugin-wide knobs for Bing / DuckDuckGo style HTML engines. */
export interface FreeEngineOptions {
  /** Bing market (e.g. "zh-CN"); also drives Accept-Language for Bing. */
  bingMarket?: string;
  /** DuckDuckGo region (kl=), e.g. "cn-zh". */
  region?: string;
  /** Adult-filter level; engine default when omitted. */
  safeSearch?: SafeSearchLevel;
  /** Default result language ("zh" | "en" | ...), used for Accept-Language. */
  lang?: string;
}

let current: FreeEngineOptions = {};

/** Replace the effective knobs (called on boot and on every settings change). */
export function setFreeEngineOptions(options: FreeEngineOptions): void {
  current = { ...options };
}

/** Current effective knobs. */
export function getFreeEngineOptions(): Readonly<FreeEngineOptions> {
  return current;
}

/** Language → (Bing market, Accept-Language) profile, mirroring dsh-free-search. */
export const LANG_PROFILES: Record<string, { market: string; acceptLang: string }> = {
  zh: { market: "zh-CN", acceptLang: "zh-CN,zh;q=0.9,en;q=0.8" },
  en: { market: "en-US", acceptLang: "en-US,en;q=0.9" },
  ru: { market: "ru-RU", acceptLang: "ru-RU,ru;q=0.9,en;q=0.8" },
  ja: { market: "ja-JP", acceptLang: "ja-JP,ja;q=0.9,en;q=0.8" },
  ko: { market: "ko-KR", acceptLang: "ko-KR,ko;q=0.9,en;q=0.8" },
  de: { market: "de-DE", acceptLang: "de-DE,de;q=0.9,en;q=0.8" },
  fr: { market: "fr-FR", acceptLang: "fr-FR,fr;q=0.9,en;q=0.8" },
  es: { market: "es-ES", acceptLang: "es-ES,es;q=0.9,en;q=0.8" },
  pt: { market: "pt-BR", acceptLang: "pt-BR,pt;q=0.9,en;q=0.8" },
};

/** Accept-Language for a language code (falls back to the zh profile). */
export function acceptLanguageFor(lang: string | undefined): string {
  return (LANG_PROFILES[lang ?? "zh"] ?? LANG_PROFILES.zh).acceptLang;
}

/** Bing market for an explicit market or a language code. */
export function bingMarketFor(market: string | undefined, lang: string | undefined): string {
  if (market) return market;
  return (LANG_PROFILES[lang ?? "zh"] ?? LANG_PROFILES.zh).market;
}

/** Browser-like UA shared by the HTML engines. */
export const FREE_ENGINE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
