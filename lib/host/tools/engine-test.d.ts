/**
 * dsh-omnisearch — `free_search_test` tool (merged from dsh-free-search).
 *
 * Runs one real query against EVERY configured engine, bypassing the fallback
 * chain, so the model (or the user through the model) can see which engines
 * actually work right now and which are missing a key. This is the diagnostic
 * surface for "search is broken" reports.
 *
 * @module
 */
import { type WebToolsToolDefinition } from "../context-types.ts";
import type { ProviderAdapterLike } from "../registry.ts";
/** One engine's probe outcome. */
export interface EngineTestEntry {
    engine: string;
    status: "ok" | "fail";
    results?: number;
    sampleTitle?: string;
    sampleUrl?: string;
    error?: string;
}
/** Tool argument shape. */
export interface EngineTestArgs {
    engines?: string[];
    query?: string;
}
/** Tool result shape. */
export interface EngineTestResult {
    results: EngineTestEntry[];
}
/** Dependencies injected by the host plugin. */
export interface EngineTestDeps {
    /** Adapters keyed by provider name. */
    adapters: Record<string, ProviderAdapterLike>;
    /** Provider → enabled state. */
    isEnabled: (name: string) => boolean;
    /** Resolve the credential for a provider (empty string when keyless). */
    resolveKey: (name: string) => Promise<string>;
    /** Base URL for self-hosted providers. */
    baseUrl: (name: string) => string | undefined;
    /** Per-engine probe budget in ms. */
    timeoutMs: () => number;
    /** Extra diagnostic lines appended to the render (e.g. engine capabilities). */
    extraNotes?: () => string[];
}
/** Probe one engine directly (no chain, no fallback). */
export declare function probeEngine(deps: EngineTestDeps, engine: string, query: string): Promise<EngineTestEntry>;
/** Build the `free_search_test` tool definition. */
export declare function createEngineTestTool(deps: EngineTestDeps): WebToolsToolDefinition<EngineTestArgs, EngineTestResult>;
