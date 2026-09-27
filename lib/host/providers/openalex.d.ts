/**
 * dsh-omnisearch — OpenAlex academic literature adapter (keyless).
 *
 * Ported from dsh-web-search-enhanced (Yurzi) v0.1.4, MIT — adapted to the
 * dsh-omnisearch adapter contract. OpenAlex is the open scholarly graph:
 *
 *  - GET https://api.openalex.org/works?search=<q>&per-page=<n>
 *  - Works with NO credential at all; a polite pool is joined via `mailto`
 *    (faster, and a paid `api_key` query param is accepted when set);
 *  - Occasionally answers 429 from the shared anonymous pool — the shared
 *    fallback chain treats that as a normal cooldown + failover signal;
 *  - Snippets are reconstructed from OpenAlex `abstract_inverted_index`
 *    (word → positions), plus citation count / authors / OA-PDF annotations,
 *    mirroring upstream's diagnostics-friendly format.
 *
 * @module
 */
import { type ProviderAdapter, type Source } from "./types.ts";
export declare const OPENALEX_META: {
    readonly name: "openalex";
    readonly label: "学术检索 OpenAlex（无 key 也可用）";
    readonly description: "全球开放学术图谱，论文/文献/引用检索，无 key 也可用（礼貌池限流时自动回退）。";
    readonly credSuffix: "OPENALEX";
    readonly fetchCapable: false;
    readonly needsBaseUrl: false;
    readonly keyless: true;
};
/** Reconstruct abstract text from OpenAlex's inverted index (word → [positions]). */
export declare function reconstructInvertedIndex(inverted: unknown): string | undefined;
/** Build one Source from a raw OpenAlex work row (mirrors upstream normalization). */
export declare function openAlexSource(row: Record<string, unknown>): Source | undefined;
export declare const OpenAlexProvider: ProviderAdapter;
