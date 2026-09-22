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
export declare const PROMPT_SECTION_NAME = "dsh-omnisearch:engines";
/** Section order (matches dsh-free-search, so it sits with the other tool copy). */
export declare const PROMPT_SECTION_ORDER = 500;
/** Build the injected text. Pure — unit-tested without a host. */
export declare function buildPromptText(input: PromptSectionInput): string;
/** Installer dependencies. */
export interface PromptSectionDeps {
    /** Snapshot the current prompt inputs. */
    input: () => PromptSectionInput;
}
/**
 * Install the section into the `systemPrompt` service and return a disposer.
 * Re-call after a settings change (dispose + recreate refreshes the text).
 */
export declare function installPromptSection(systemPrompt: WebToolsSystemPrompt, deps: PromptSectionDeps): () => void;
