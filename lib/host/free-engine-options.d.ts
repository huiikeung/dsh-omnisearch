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
/** Replace the effective knobs (called on boot and on every settings change). */
export declare function setFreeEngineOptions(options: FreeEngineOptions): void;
/** Current effective knobs. */
export declare function getFreeEngineOptions(): Readonly<FreeEngineOptions>;
/** Language → (Bing market, Accept-Language) profile, mirroring dsh-free-search. */
export declare const LANG_PROFILES: Record<string, {
    market: string;
    acceptLang: string;
}>;
/** Accept-Language for a language code (falls back to the zh profile). */
export declare function acceptLanguageFor(lang: string | undefined): string;
/** Bing market for an explicit market or a language code. */
export declare function bingMarketFor(market: string | undefined, lang: string | undefined): string;
/** Browser-like UA shared by the HTML engines. */
export declare const FREE_ENGINE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
