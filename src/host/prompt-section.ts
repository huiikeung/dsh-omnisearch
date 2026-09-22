/**
 * dsh-omnisearch — system-prompt section (merged from dsh-free-search).
 *
 * The model must know which engines exist, which need a key, which one is
 * preferred right now, and how to read the `Note:` line that a fallback adds.
 * The section is rebuilt whenever settings change (same dispose+recreate
 * pattern as dsh-free-search, order 500).
 *
 * @module
 */
import type { WebToolsSystemPrompt } from "./context-types.ts";

/** One engine descriptor shown to the model. */
export interface PromptEngine {
  name: string;
  label: string;
  /** Needs an API key (false = works out of the box). */
  keyed: boolean;
  /** Supports the advanced_search time window. */
  timeCapable: boolean;
  /** Enabled in settings. */
  enabled: boolean;
}

/** Everything the section text depends on. */
export interface PromptSectionInput {
  preferred: string;
  chain: string[];
  engines: PromptEngine[];
  safeSearch: string;
  bingMarket: string;
  lang: string;
  cacheTtlMs: number;
  platformSearchEnabled: Record<string, boolean>;
}

/** Section name (stable: settings changes dispose/recreate it). */
export const PROMPT_SECTION_NAME = "dsh-omnisearch:engines";

/** Section order (matches dsh-free-search, so it sits with the other tool copy). */
export const PROMPT_SECTION_ORDER = 500;

/** Build the injected text. Pure — unit-tested without a host. */
export function buildPromptText(input: PromptSectionInput): string {
  const enabled = input.engines.filter((e) => e.enabled);
  // 中文前缀（引擎 id 保留英文，供工具参数使用）
  const show = (e: { name: string; label: string }) => `${e.label}（${e.name}）`;
  const keyless = enabled.filter((e) => !e.keyed).map(show);
  const keyed = enabled.filter((e) => e.keyed).map(show);
  const timeCapable = enabled.filter((e) => e.timeCapable).map(show);
  const platforms = Object.entries(input.platformSearchEnabled)
    .filter(([, on]) => on)
    .map(([name]) => name);

  return [
    "## Web search engines (dsh-omnisearch plugin)",
    "",
    `Preferred engine: ${input.preferred}. Effective chain: ${input.chain.join(" → ") || input.preferred}.`,
    `Keyless engines (work with no API key): ${keyless.join(", ") || "none"}.`,
    `Keyed engines (skipped when their key is missing): ${keyed.join(", ") || "none"}.`,
    `Date-filtering engines used by advanced_search: ${timeCapable.join(", ") || "none"}.`,
    `Safe search: ${input.safeSearch} · Bing market: ${input.bingMarket} · Language: ${input.lang} · Result cache: ${
      input.cacheTtlMs > 0 ? `${Math.round(input.cacheTtlMs / 1000)}s` : "off"
    }.`,
    "",
    "Tools:",
    "- `web_search` / `web_fetch` run through the chain above and fall back automatically.",
    "- `advanced_search` takes an explicit `timeRange` (day|week|month|year, 12h/3d/2mo/1y, or YYYY-MM-DD) and prefers engines that can actually filter by date.",
    `- \`platform_search\` covers${platforms.length ? `: ${platforms.join(", ")}` : " no platform (all disabled in settings)"}.`,
    "- `free_search_test` probes every engine and reports what works right now.",
    "",
    "Reading a `Note:` line in a result:",
    "- `Note: X does not support time filtering (timeRange=...), using Y.` — X was skipped BEFORE any attempt because it cannot filter by date (it did not fail).",
    "- `Note: X unavailable or failed (reason), using Y.` — X was actually tried and failed (missing/invalid key, 401, rate limit, network error, or 0 results).",
    "Never tell the user that search is unavailable: the chain always falls back. Only report a failure when every engine in the chain failed.",
  ].join("\n");
}

/** Installer dependencies. */
export interface PromptSectionDeps {
  /** Snapshot the current prompt inputs. */
  input: () => PromptSectionInput;
}

/**
 * Install the section into the `systemPrompt` service and return a disposer.
 * Re-call after a settings change (dispose + recreate refreshes the text).
 */
export function installPromptSection(systemPrompt: WebToolsSystemPrompt, deps: PromptSectionDeps): () => void {
  return systemPrompt.section({
    name: PROMPT_SECTION_NAME,
    order: PROMPT_SECTION_ORDER,
    text: buildPromptText(deps.input()),
  });
}
