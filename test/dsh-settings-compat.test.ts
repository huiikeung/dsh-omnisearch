/**
 * dsh-omnisearch — DSH 0.1.7 settings-compat tests (dsh-free-search v0.4.36-37).
 *
 * The host moved plugin configuration from a registered settings namespace
 * (`settings.register`, DSH ≤ 0.1.6) to the profile-owned entry Config
 * (DSH 0.1.7+): the Loader hands `apply` live `.volatile()` refs, the plugin
 * only claims its own page via `settings.configure({ auto: false })`, and edits
 * go through `settings.update(ns, patch)`.
 *
 * These cases exercise BOTH service shapes with a fake context, so the compat
 * branch is verified without a running host.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Config, installConfig, resolvePluginConfig, DEFAULT_SETTINGS, SETTINGS_NS } from "../src/host/config.ts";

interface Listener {
  (...args: unknown[]): unknown;
}

/** Minimal cordis-like context: inject runs the callback synchronously. */
function fakeCtx(settings: unknown) {
  const listeners = new Map<string, Listener[]>();
  const context = {
    settings,
    fiber: { fake: true },
    inject(_services: string[], callback: (ctx: unknown) => void) {
      callback(context);
      return undefined;
    },
    effect(fn: () => void | (() => void)) {
      fn();
    },
    on(event: string, listener: Listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {};
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return context;
}

test("Config declares a default and volatile marker for every field", () => {
  const dict = (Config as unknown as { dict: Record<string, { meta?: { default?: unknown; volatile?: boolean } }> }).dict;
  const fields = Object.keys(DEFAULT_SETTINGS) as Array<keyof typeof DEFAULT_SETTINGS>;
  for (const field of fields) {
    const node = dict[field];
    assert.ok(node, `schema field ${field} missing`);
    assert.equal(node.meta?.volatile, true, `${field} must be .volatile() on DSH 0.1.7+`);
    assert.ok("default" in (node.meta ?? {}), `${field} must carry a schema default`);
  }
  // Every default is materialized from one source of truth.
  assert.deepEqual(dict.defaultProvider.meta?.default, DEFAULT_SETTINGS.defaultProvider);
  assert.deepEqual(dict.cacheTtlMs.meta?.default, DEFAULT_SETTINGS.cacheTtlMs);
  assert.deepEqual(dict.platformSearchEnabled.meta?.default, DEFAULT_SETTINGS.platformSearchEnabled);
});

test("resolvePluginConfig unwraps live Volatile refs and passes plain values through", () => {
  const resolved = resolvePluginConfig({
    defaultProvider: { get: () => "serpbase" },
    cacheTtlMs: 0,
    platformSearchEnabled: { github: false },
  });
  assert.equal(resolved.defaultProvider, "serpbase");
  assert.equal(resolved.cacheTtlMs, 0);
  assert.deepEqual(resolved.platformSearchEnabled, { github: false });
  assert.deepEqual(resolvePluginConfig(undefined), {});
  assert.deepEqual(resolvePluginConfig("nope"), {});
});

test("installConfig on DSH 0.1.7+ reads the Loader config and writes via settings.update", async () => {
  const writes: Array<{ ns: string; patch: object }> = [];
  let claimed: { auto?: boolean } | undefined;
  const settings = {
    configure(presentation: { auto?: boolean }) {
      claimed = presentation;
      return () => {};
    },
    async update(ns: string, patch: object) {
      writes.push({ ns, patch });
    },
  };
  const ctx = fakeCtx(settings);

  const handle = installConfig(ctx as never, { defaultProvider: { get: () => "bing" }, cacheTtlMs: 1_000 });
  assert.deepEqual(claimed, { auto: false }, "the plugin must claim its own settings page");
  assert.equal(handle.read().defaultProvider, "bing");
  assert.equal(handle.read().cacheTtlMs, 1_000);
  assert.equal(handle.read().bingMarket, "zh-CN", "defaults fill the rest");

  let changes = 0;
  handle.onChange(() => {
    changes += 1;
  });
  await handle.write({ defaultProvider: "ddg" });
  assert.deepEqual(writes, [{ ns: SETTINGS_NS, patch: { defaultProvider: "ddg" } }]);

  ctx.emit("settings/document-updated", "someone-else");
  assert.equal(changes, 0, "other plugin namespaces must not refresh us");
  ctx.emit("settings/document-updated", SETTINGS_NS);
  assert.equal(changes, 1);
});

test("installConfig still supports the legacy settings.register host", async () => {
  let registeredNs = "";
  let watched = 0;
  let stored = { ...DEFAULT_SETTINGS, defaultProvider: "tavily" };
  const settings = {
    register(ns: string) {
      registeredNs = ns;
      return {
        get: () => stored,
        watch() {
          watched += 1;
          return () => {};
        },
        async update(patch: object) {
          stored = { ...stored, ...(patch as object) } as typeof stored;
        },
        async replace(section: object) {
          stored = section as typeof stored;
        },
      };
    },
    async update() {
      throw new Error("legacy host must use the registered scope");
    },
  };
  const ctx = fakeCtx(settings);
  const handle = installConfig(ctx as never, { ignored: true });

  assert.equal(registeredNs, SETTINGS_NS);
  assert.equal(watched, 1, "the registered scope is watched for live edits");
  assert.equal(handle.read().defaultProvider, "tavily");

  let changes = 0;
  handle.onChange(() => {
    changes += 1;
  });
  await handle.write({ defaultProvider: "bing" });
  assert.equal(handle.read().defaultProvider, "bing");
  assert.equal(changes, 0, "change callbacks fire from the namespace watcher, not the write");
});
