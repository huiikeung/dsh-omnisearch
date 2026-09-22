/**
 * dsh-omnisearch — `/search` 一次性联网提示（中文）。
 *
 * 2026-09-21：会话级“强制联网”已整体移除。原实现会在每个回合第 1 步注入一段
 * 英文策略，并在收尾时催办、再不搜直接 `agent.cancel()` 掐掉整个回合——每一轮都
 * 付注入开销，用户还会遇到“回答突然没了”的硬中断。
 *
 * 现在只保留用户显式触发的**一次性**提示：在聊天框输入 `/search`，当前回合会
 * 收到一段“这轮先联网再结论”的中文提示；不改变会话状态，不影响后续回合。
 * 平时搜不搜完全由模型自主判断（工具始终可用，免 Key 链路开箱即用）。
 *
 * @module
 */
import type { WebToolsContext } from "./context-types.ts";
import type { SearchMode, SearchModeView } from "../shared/api-types.ts";
/** `/search` 注入的中文一次性提示。 */
export declare const SEARCH_NUDGE_TEXT: string;
/** @deprecated 强制策略文案已移除；保留导出仅为兼容旧引用。 */
export declare const REQUIRED_SEARCH_TEXT: string;
/** @deprecated 强制纠偏已移除；保留导出仅为兼容旧引用。 */
export declare const REQUIRED_SEARCH_CORRECTION_TEXT = "\u8FD9\u4E00\u8F6E\u8BF7\u5148\u8C03\u7528 web_search \u6216 web_fetch \u518D\u6536\u5C3E\u3002";
/** One turn's research record (kept for the settings routes). */
export interface TurnState {
    turn: number;
    /** Whether the session had asked for guaranteed research that turn. */
    required: boolean;
    webSearchCompleted: boolean;
    webFetchCompleted: boolean;
}
/**
 * Per-session mode map. The mode is now ADVISORY ONLY — nothing injects or
 * cancels based on it; `/search` is a one-shot steer instead of a mode flip.
 * Kept because the settings routes still read it, and removing the state would
 * break those callers.
 */
export declare class SearchModeRuntime {
    private readonly modes;
    private readonly turns;
    private readonly searchAvailable;
    constructor(searchAvailable?: () => boolean);
    getMode(sessionId: string): SearchMode;
    setMode(sessionId: string, mode: SearchMode): void;
    /** Whether a usable search provider currently exists (display only). */
    available(): boolean;
    /** Open (or re-read) a turn record. */
    beginTurn(sessionId: string, turn: number): TurnState;
    /** Record that a web_search call completed (display-only now). */
    markSearchResult(sessionId: string, _succeeded: boolean): void;
    /** Record that a web_fetch call completed. */
    markFetchResult(sessionId: string, _succeeded: boolean): void;
    getTurn(sessionId: string): TurnState | undefined;
    /** Drop every record for a disposed agent/session. */
    clear(sessionId: string): void;
    view(sessionId: string): SearchModeView;
}
/** Message factory for the one-shot nudge (official user-message shape). */
export declare function createSearchModeMessages(build: (input: unknown) => unknown): {
    /** The single message `/search` injects. */
    nudge: () => unknown;
};
/** @deprecated 强制注入已移除；保留导出仅为兼容旧引用。 */
export declare function searchModeStepMessage(_state: TurnState | undefined, _step: number): undefined;
/** @deprecated 强制判定已移除；保留导出仅为兼容旧引用。 */
export declare function webResearchCompleted(state: TurnState): boolean;
/**
 * Install the `/search` command: steer the CURRENT turn with the Chinese nudge.
 * No injection, no cancellation, no session state change.
 */
export declare function installSearchModeRuntime(ctx: WebToolsContext, _deps: unknown, _runtime: SearchModeRuntime, messages: {
    nudge: () => unknown;
}): () => void;
/** Register the `/search` slash command (one-shot nudge, Chinese copy). */
export declare function registerSearchCommands(ctx: WebToolsContext, messages: {
    nudge: () => unknown;
}): (() => void) | undefined;
