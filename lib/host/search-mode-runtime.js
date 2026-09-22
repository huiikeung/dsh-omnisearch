/** `/search` 注入的中文一次性提示。 */
export const SEARCH_NUDGE_TEXT = [
    "这一轮请先做一次联网检索再给结论。",
    "给了具体网址就用 web_fetch 抓取；否则用 web_search 检索。",
    "要针对某个平台，只用一个小红书: 或 X: 这样的路由前缀，不要把平台名再重复进关键词。",
    "搜索结果的摘要只算线索，不算页面正文和评论。",
    "评论/回复只有 web_fetch 真抓到内容才能说“已核实”。",
    "如果联网失败，直接说明哪些没能核实。",
].join("\n");
/** @deprecated 强制策略文案已移除；保留导出仅为兼容旧引用。 */
export const REQUIRED_SEARCH_TEXT = SEARCH_NUDGE_TEXT;
/** @deprecated 强制纠偏已移除；保留导出仅为兼容旧引用。 */
export const REQUIRED_SEARCH_CORRECTION_TEXT = "这一轮请先调用 web_search 或 web_fetch 再收尾。";
/**
 * Per-session mode map. The mode is now ADVISORY ONLY — nothing injects or
 * cancels based on it; `/search` is a one-shot steer instead of a mode flip.
 * Kept because the settings routes still read it, and removing the state would
 * break those callers.
 */
export class SearchModeRuntime {
    modes = new Map();
    turns = new Map();
    searchAvailable;
    constructor(searchAvailable = () => true) {
        this.searchAvailable = searchAvailable;
    }
    getMode(sessionId) {
        return this.modes.get(sessionId) ?? "auto";
    }
    setMode(sessionId, mode) {
        if (mode === "auto")
            this.modes.delete(sessionId);
        else
            this.modes.set(sessionId, mode);
    }
    /** Whether a usable search provider currently exists (display only). */
    available() {
        try {
            return this.searchAvailable() === true;
        }
        catch {
            return true;
        }
    }
    /** Open (or re-read) a turn record. */
    beginTurn(sessionId, turn) {
        const existing = this.turns.get(sessionId);
        if (existing?.turn === turn)
            return existing;
        const state = {
            turn,
            required: this.getMode(sessionId) === "required",
            webSearchCompleted: false,
            webFetchCompleted: false,
        };
        this.turns.set(sessionId, state);
        return state;
    }
    /** Record that a web_search call completed (display-only now). */
    markSearchResult(sessionId, _succeeded) {
        const state = this.turns.get(sessionId);
        if (state)
            state.webSearchCompleted = true;
    }
    /** Record that a web_fetch call completed. */
    markFetchResult(sessionId, _succeeded) {
        const state = this.turns.get(sessionId);
        if (state)
            state.webFetchCompleted = true;
    }
    getTurn(sessionId) {
        return this.turns.get(sessionId);
    }
    /** Drop every record for a disposed agent/session. */
    clear(sessionId) {
        this.modes.delete(sessionId);
        this.turns.delete(sessionId);
    }
    view(sessionId) {
        return { mode: this.getMode(sessionId), available: this.available() };
    }
}
/** Message factory for the one-shot nudge (official user-message shape). */
export function createSearchModeMessages(build) {
    return {
        /** The single message `/search` injects. */
        nudge: () => build({
            content: [{ type: "text", text: SEARCH_NUDGE_TEXT }],
            source: { kind: "plugin", plugin: "dsh-omnisearch", form: "notice", summary: "本轮先联网检索" },
        }),
    };
}
/** @deprecated 强制注入已移除；保留导出仅为兼容旧引用。 */
export function searchModeStepMessage(_state, _step) {
    return undefined;
}
/** @deprecated 强制判定已移除；保留导出仅为兼容旧引用。 */
export function webResearchCompleted(state) {
    return state.webSearchCompleted || state.webFetchCompleted;
}
/**
 * Install the `/search` command: steer the CURRENT turn with the Chinese nudge.
 * No injection, no cancellation, no session state change.
 */
export function installSearchModeRuntime(ctx, _deps, _runtime, messages) {
    return registerSearchCommands(ctx, messages) ?? (() => { });
}
/** Register the `/search` slash command (one-shot nudge, Chinese copy). */
export function registerSearchCommands(ctx, messages) {
    const commands = ctx.commands;
    if (!commands?.register)
        return undefined;
    return commands.register({
        name: "search",
        description: "联网搜索（search）：这一轮先联网检索再回答，一次性，不影响后续回合",
        handler: (invocation) => {
            invocation.agent?.steer?.(messages.nudge());
            return { kind: "success", text: "已提示本轮先联网检索" };
        },
    });
}
