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
import { defineTool } from "../context-types.js";
/** Probe one engine directly (no chain, no fallback). */
export async function probeEngine(deps, engine, query) {
    const adapter = deps.adapters[engine];
    if (!adapter)
        return { engine, status: "fail", error: "unknown engine" };
    if (!deps.isEnabled(engine))
        return { engine, status: "fail", error: "disabled in settings" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs());
    try {
        const key = (await deps.resolveKey(engine)) || "";
        const outcome = await adapter.search(query, 3, key, deps.baseUrl(engine), { signal: controller.signal });
        if (outcome.sources.length === 0)
            return { engine, status: "fail", error: "returned 0 results" };
        const first = outcome.sources[0];
        return {
            engine,
            status: "ok",
            results: outcome.sources.length,
            ...(first?.title ? { sampleTitle: String(first.title) } : {}),
            ...(first?.url ? { sampleUrl: String(first.url) } : {}),
        };
    }
    catch (error) {
        const code = error?.code;
        const message = error instanceof Error ? error.message : String(error);
        return { engine, status: "fail", error: code ? `${code}: ${message}` : message };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Build the `free_search_test` tool definition. */
export function createEngineTestTool(deps) {
    const allEngines = () => Object.keys(deps.adapters);
    return defineTool({
        name: "free_search_test",
        description: "体检所有已配置的搜索引擎，报告当前哪些可用。 Use this to diagnose search failures (rate limits, missing keys, unreachable engines) or to answer 'which engines are available?'.",
        parameters: {
            engines: {
                type: "array",
                description: "Engines to test (default: all configured engines).",
                items: { type: "string" },
            },
            query: { type: "string", description: 'Optional probe query (default: "DeepSeek Harness").' },
        },
        isConcurrencySafe: true,
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    results: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                engine: { type: "string" },
                                status: { type: "string" },
                                results: { type: "number" },
                                sampleTitle: { type: "string" },
                                sampleUrl: { type: "string" },
                                error: { type: "string" },
                            },
                            required: ["engine", "status"],
                        },
                    },
                },
                required: ["results"],
            },
            render: (_args, value) => {
                const lines = value.results.map((r) => r.status === "ok"
                    ? `- ${r.engine}: OK (${r.results} results${r.sampleTitle ? `, e.g. "${r.sampleTitle.slice(0, 40)}"` : ""})`
                    : `- ${r.engine}: FAIL - ${r.error}`);
                const extras = deps.extraNotes?.() ?? [];
                const body = [`Search engine test:`, ...lines, ...(extras.length ? ["", ...extras] : [])].join("\n");
                return [{ type: "text", text: body }];
            },
        },
        async execute(args) {
            const engines = args.engines && args.engines.length > 0 ? args.engines : allEngines();
            const query = args.query?.trim() || "DeepSeek Harness";
            const results = [];
            for (const engine of engines) {
                results.push(await probeEngine(deps, engine, query));
            }
            return { results };
        },
    });
}
