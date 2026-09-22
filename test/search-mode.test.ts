/**
 * dsh-omnisearch — `/search` one-shot nudge tests (pure, no DSH/pnpm).
 *
 * 2026-09-21：会话级“强制联网”（每回合注入 + 收尾催办/掐回合）已整体移除。
 * 现在只有用户显式触发的一次性中文提示；本组测试锁定新契约。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SearchModeRuntime,
  createSearchModeMessages,
  installSearchModeRuntime,
  registerSearchCommands,
  searchModeStepMessage,
  webResearchCompleted,
  SEARCH_NUDGE_TEXT,
  REQUIRED_SEARCH_TEXT,
  type TurnState,
} from "../src/host/search-mode-runtime.ts";

function runtime(available = true): SearchModeRuntime {
  return new SearchModeRuntime(() => available);
}

test("nudge copy is Chinese and covers routing + honesty rules", () => {
  assert.match(SEARCH_NUDGE_TEXT, /这一轮请先做一次联网检索再给结论/);
  assert.match(SEARCH_NUDGE_TEXT, /web_fetch/);
  assert.match(SEARCH_NUDGE_TEXT, /小红书: 或 X:/);
  assert.match(SEARCH_NUDGE_TEXT, /已核实/);
  // 旧导出保留为兼容别名
  assert.equal(REQUIRED_SEARCH_TEXT, SEARCH_NUDGE_TEXT);
});

test("no per-turn policy injection remains (enforcement removed)", () => {
  // 任意状态/步骤都返回 undefined——不再有“第 1 步注入策略”这回事
  const state: TurnState = { turn: 1, required: true, webSearchCompleted: false, webFetchCompleted: false };
  assert.equal(searchModeStepMessage(state, 1), undefined);
  assert.equal(searchModeStepMessage(undefined, 1), undefined);
});

test("mode map is advisory only: default auto, view reports availability", () => {
  const r = runtime(true);
  assert.equal(r.getMode("s1"), "auto");
  assert.deepEqual(r.view("s1"), { mode: "auto", available: true });
  r.setMode("s1", "required");
  assert.equal(r.getMode("s1"), "required");
  r.setMode("s1", "auto");
  assert.equal(r.getMode("s1"), "auto");

  const down = runtime(false);
  assert.equal(down.view("s1").available, false);
});

test("turn records stay per session and track completion", () => {
  const r = runtime();
  const t1 = r.beginTurn("s1", 1);
  assert.equal(t1.required, false);
  r.markSearchResult("s1", true);
  assert.equal(webResearchCompleted(r.getTurn("s1")!), true);
  // 同一回合复用记录；换回合才新建
  assert.equal(r.beginTurn("s1", 1), t1);
  const t2 = r.beginTurn("s1", 2);
  assert.notEqual(t2, t1);
  // 会话互不污染
  assert.equal(r.getTurn("s2"), undefined);
  r.clear("s1");
  assert.equal(r.getTurn("s1"), undefined);
});

test("/search registers a one-shot Chinese nudge command", () => {
  const registered: any[] = [];
  const ctx = {
    commands: {
      register: (def: any) => {
        registered.push(def);
        return () => {};
      },
    },
  } as any;
  const messages = createSearchModeMessages((input) => input);
  const off = registerSearchCommands(ctx, messages);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "search");
  assert.match(registered[0].description, /这一轮先联网检索再回答/);

  // handler 只 steer 一次性提示，不动会话状态
  const steered: unknown[] = [];
  const agent = { steer: (input: unknown) => steered.push(input) };
  const result = registered[0].handler({ agent });
  assert.equal(result.kind, "success");
  assert.equal(steered.length, 1);
  assert.match((steered[0] as any).content[0].text, /这一轮请先做一次联网检索再给结论/);

  off?.();
});

test("installSearchModeRuntime returns a working disposer", () => {
  const registered: any[] = [];
  const ctx = {
    commands: { register: (def: any) => { registered.push(def); return () => {}; } },
  } as any;
  const messages = createSearchModeMessages((input) => input);
  const dispose = installSearchModeRuntime(ctx, undefined, runtime(), messages);
  assert.equal(registered.length, 1);
  assert.equal(typeof dispose, "function");
  dispose();
});
