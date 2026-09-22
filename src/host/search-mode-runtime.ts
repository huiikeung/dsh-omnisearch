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
export class SearchModeRuntime {
  private readonly modes = new Map<string, SearchMode>();
  private readonly turns = new Map<string, TurnState>();
  private readonly searchAvailable: () => boolean;

  constructor(searchAvailable: () => boolean = () => true) {
    this.searchAvailable = searchAvailable;
  }

  getMode(sessionId: string): SearchMode {
    return this.modes.get(sessionId) ?? "auto";
  }

  setMode(sessionId: string, mode: SearchMode): void {
    if (mode === "auto") this.modes.delete(sessionId);
    else this.modes.set(sessionId, mode);
  }

  /** Whether a usable search provider currently exists (display only). */
  available(): boolean {
    try {
      return this.searchAvailable() === true;
    } catch {
      return true;
    }
  }

  /** Open (or re-read) a turn record. */
  beginTurn(sessionId: string, turn: number): TurnState {
    const existing = this.turns.get(sessionId);
    if (existing?.turn === turn) return existing;
    const state: TurnState = {
      turn,
      required: this.getMode(sessionId) === "required",
      webSearchCompleted: false,
      webFetchCompleted: false,
    };
    this.turns.set(sessionId, state);
    return state;
  }

  /** Record that a web_search call completed (display-only now). */
  markSearchResult(sessionId: string, _succeeded: boolean): void {
    const state = this.turns.get(sessionId);
    if (state) state.webSearchCompleted = true;
  }

  /** Record that a web_fetch call completed. */
  markFetchResult(sessionId: string, _succeeded: boolean): void {
    const state = this.turns.get(sessionId);
    if (state) state.webFetchCompleted = true;
  }

  getTurn(sessionId: string): TurnState | undefined {
    return this.turns.get(sessionId);
  }

  /** Drop every record for a disposed agent/session. */
  clear(sessionId: string): void {
    this.modes.delete(sessionId);
    this.turns.delete(sessionId);
  }

  view(sessionId: string): SearchModeView {
    return { mode: this.getMode(sessionId), available: this.available() };
  }
}

/** Message factory for the one-shot nudge (official user-message shape). */
export function createSearchModeMessages(build: (input: unknown) => unknown) {
  return {
    /** The single message `/search` injects. */
    nudge: () =>
      build({
        content: [{ type: "text", text: SEARCH_NUDGE_TEXT }],
        source: { kind: "plugin", plugin: "dsh-omnisearch", form: "notice", summary: "本轮先联网检索" },
      }),
  };
}

/** @deprecated 强制注入已移除；保留导出仅为兼容旧引用。 */
export function searchModeStepMessage(_state: TurnState | undefined, _step: number): undefined {
  return undefined;
}

/** @deprecated 强制判定已移除；保留导出仅为兼容旧引用。 */
export function webResearchCompleted(state: TurnState): boolean {
  return state.webSearchCompleted || state.webFetchCompleted;
}

/**
 * Install the `/search` command: steer the CURRENT turn with the Chinese nudge.
 * No injection, no cancellation, no session state change.
 */
export function installSearchModeRuntime(
  ctx: WebToolsContext,
  _deps: unknown,
  _runtime: SearchModeRuntime,
  messages: { nudge: () => unknown },
): () => void {
  return registerSearchCommands(ctx, messages) ?? (() => {});
}

/** Register the `/search` slash command (one-shot nudge, Chinese copy). */
export function registerSearchCommands(
  ctx: WebToolsContext,
  messages: { nudge: () => unknown },
): (() => void) | undefined {
  const commands = ctx.commands;
  if (!commands?.register) return undefined;
  return commands.register({
    name: "search",
    description: "联网搜索（search）：这一轮先联网检索再回答，一次性，不影响后续回合",
    handler: (invocation) => {
      invocation.agent?.steer?.(messages.nudge());
      return { kind: "success", text: "已提示本轮先联网检索" };
    },
  });
}
