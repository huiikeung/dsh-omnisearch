/**
 * pinNavGlyph — runtime settings-nav glyph pinning.
 *
 * Same algorithm as the sibling plugins (dsh-plugin-mobile-gateway,
 * dsh-context-compactor): find our own nav cell by its visible label text,
 * rewrite only that <svg>, stamp a mark attribute, and re-apply from a
 * MutationObserver while the settings panel is open. Everything here runs
 * against a hand-rolled DOM stub — no browser needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { navGlyph, pinNavGlyph } from "../src/client/nav-glyph.ts";

const MARK = "data-omnisearch-nav-icon";
const NAV_LABELS = ["网页搜索 Web Search"];

type FakeSvg = {
  attrs: Record<string, string>;
  innerHTML: string;
  setCalls: number;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
};

function fakeSvg(shellMarkup = "<gear/>"): FakeSvg {
  const svg: FakeSvg = {
    attrs: {},
    innerHTML: shellMarkup,
    setCalls: 0,
    setAttribute(name, value) {
      svg.attrs[name] = value;
      svg.setCalls += 1;
    },
    getAttribute(name) {
      return svg.attrs[name] ?? null;
    },
  };
  return svg;
}

type FakeCell = {
  textContent: string;
  svg: FakeSvg;
  querySelector(selector: string): FakeSvg | null;
};

function fakeCell(label: string, shellMarkup = "<gear/>"): FakeCell {
  const svg = fakeSvg(shellMarkup);
  return {
    textContent: label,
    svg,
    querySelector(selector) {
      return selector === "svg" ? svg : null;
    },
  };
}

type FakeDoc = {
  querySelector(selector: string): Record<string, unknown> | null;
  querySelectorAll(selector: string): FakeCell[];
  body: Record<string, unknown>;
};

function fakeDocument(cells: FakeCell[], dialogOpen: boolean): FakeDoc {
  return {
    querySelector(selector: string) {
      if (selector === '[role="dialog"]') return dialogOpen ? {} : null;
      return null;
    },
    querySelectorAll(selector: string) {
      return selector === '[role="dialog"] nav button' ? cells : [];
    },
    body: {},
  };
}

type ObserverRecord = { target: unknown; options: { childList?: boolean; subtree?: boolean } };

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  records: ObserverRecord[] = [];
  callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }
  observe(target: unknown, options: { childList?: boolean; subtree?: boolean }) {
    this.records.push({ target, options });
  }
}

/**
 * Install the stubs on the real global scope (the module reads `document` /
 * `MutationObserver` off the globals), run `body`, then restore the scope.
 * Returns every observer `body` created, so tests can poke its callbacks.
 */
function withDom(cells: FakeCell[], dialogOpen: boolean, body: (doc: FakeDoc) => void): FakeMutationObserver[] {
  const scope = globalThis as unknown as Record<string, unknown>;
  const doc = fakeDocument(cells, dialogOpen);
  scope.document = doc;
  scope.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  let observers: FakeMutationObserver[] = [];
  try {
    body(doc);
  } finally {
    observers = FakeMutationObserver.instances.slice();
    delete scope.document;
    delete scope.MutationObserver;
    FakeMutationObserver.instances = [];
  }
  return observers;
}

test("pinNavGlyph rewrites only our own nav cell and stamps its mark", () => {
  const mine = fakeCell("网页搜索 Web Search");
  const other = fakeCell("模型");
  let body: Record<string, unknown> | undefined;
  const observers = withDom([other, mine], true, (doc) => {
    body = doc.body;
    pinNavGlyph(NAV_LABELS, MARK, navGlyph);
  });

  const spec = navGlyph();
  // Ours: shell box kept, geometry replaced, marked, hidden from a11y tree.
  assert.equal(mine.svg.attrs.viewBox, spec.viewBox);
  assert.equal(mine.svg.attrs.fill, "none");
  assert.equal(mine.svg.attrs["aria-hidden"], "true");
  assert.equal(mine.svg.getAttribute(MARK), "1");
  assert.equal(mine.svg.innerHTML, spec.markup);
  // Theirs: the shell's gear is untouched, no mark, no attributes at all.
  assert.equal(other.svg.innerHTML, "<gear/>");
  assert.deepEqual(other.svg.attrs, {});

  // The shell re-render hook is armed on the real document body.
  assert.equal(observers.length, 1);
  assert.equal(observers[0].records.length, 1);
  assert.equal(observers[0].records[0].target, body);
  assert.deepEqual(observers[0].records[0].options, { childList: true, subtree: true });
});

test("pinNavGlyph re-applies on MutationObserver callbacks without double work", () => {
  const mine = fakeCell("网页搜索 Web Search");
  const observers = withDom([mine], true, () => {
    pinNavGlyph(NAV_LABELS, MARK, navGlyph);
    assert.equal(mine.svg.setCalls, 4); // viewBox, fill, aria-hidden, mark
    const observer = FakeMutationObserver.instances[0];
    // Mark recognized → the cell is skipped entirely, nothing set again.
    observer.callback();
    observer.callback();
    assert.equal(mine.svg.setCalls, 4);
    assert.equal(mine.svg.innerHTML, navGlyph().markup);
  });
  assert.equal(observers.length, 1);
});

test("pinNavGlyph does nothing while the settings panel is closed", () => {
  const mine = fakeCell("网页搜索 Web Search");
  const observers = withDom([mine], false, () => {
    pinNavGlyph(NAV_LABELS, MARK, navGlyph);
    // Cheap guard: no dialog → no DOM work at all.
    assert.equal(mine.svg.setCalls, 0);
    assert.equal(mine.svg.innerHTML, "<gear/>");
    // The observer arms regardless of the dialog state; while the dialog stays
    // absent its callbacks are no-ops.
    assert.equal(FakeMutationObserver.instances.length, 1);
    FakeMutationObserver.instances[0].callback();
    assert.equal(mine.svg.setCalls, 0);
  });
  assert.equal(observers.length, 1);
});

test("pinNavGlyph keeps the shell icon when the glyph throws", () => {
  const mine = fakeCell("网页搜索 Web Search");
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  let observers: FakeMutationObserver[] = [];
  try {
    observers = withDom([mine], true, () => {
      pinNavGlyph(NAV_LABELS, MARK, () => {
        throw new Error("bad geometry");
      });
    });
  } finally {
    console.warn = originalWarn;
  }
  // The pure glyph runs to completion BEFORE any DOM mutation, so its failure
  // leaves the shell's own icon in place instead of blanking the nav cell.
  assert.equal(mine.svg.setCalls, 0);
  assert.equal(mine.svg.innerHTML, "<gear/>");
  assert.equal(warnings.length, 1);
  // The observer is still armed: a later re-render retries the glyph.
  assert.equal(observers.length, 1);
});

test("pinNavGlyph is a no-op without a DOM", () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  delete scope.document;
  delete scope.MutationObserver;
  assert.doesNotThrow(() => pinNavGlyph(NAV_LABELS, MARK, navGlyph));
});
