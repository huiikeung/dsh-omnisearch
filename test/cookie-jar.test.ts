/**
 * dsh-omnisearch — cookie jar tests (sidebar-browser login flow).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  jarSatisfies,
  loadCookieJar,
  pruneCookies,
  saveCookieJar,
  toCdpCookies,
  cookieJarPath,
  type StoredCookie,
} from "../src/host/browser/cookie-jar.ts";

const NOW = 1_800_000_000; // fixed epoch for expiry math

function cookie(name: string, extra: Partial<StoredCookie> = {}): StoredCookie {
  return { name, value: `v-${name}`, domain: "xiaohongshu.com", path: "/", ...extra };
}

test("pruneCookies drops expired, session-less and nameless entries", () => {
  const kept = pruneCookies(
    [
      cookie("fresh", { expires: NOW + 60 }),
      cookie("expired", { expires: NOW - 1 }),
      cookie("session"),
      { name: "", value: "x", domain: "d.com", path: "/" },
      { name: "novalue", value: "", domain: "d.com", path: "/" },
    ],
    NOW,
  );
  assert.deepEqual(kept.map((c) => c.name), ["fresh", "session"]);
});

test("jar round-trips through disk and survives a corrupt file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-jar-"));
  const cookies = [cookie("a1"), cookie("web_session", { httpOnly: true, secure: true, expires: NOW + 3600 })];
  saveCookieJar(dir, "xiaohongshu", cookies);

  const loaded = loadCookieJar(dir, "xiaohongshu");
  assert.equal(loaded.length, 2);
  assert.equal(loaded.find((c) => c.name === "web_session")?.httpOnly, true);

  // Owner-only permissions.
  const mode = statSync(cookieJarPath(dir)).mode & 0o777;
  assert.equal(mode, 0o600, "cookie jar must be owner-only");

  // Corrupt file degrades to an empty jar rather than throwing.
  writeFileSync(cookieJarPath(dir), "{ not json");
  assert.deepEqual(loadCookieJar(dir, "xiaohongshu"), []);
});

test("jarSatisfies requires EVERY required cookie", () => {
  const partial = [cookie("a1")];
  assert.equal(jarSatisfies(partial, ["a1", "web_session"]), false);
  assert.equal(jarSatisfies([...partial, cookie("web_session")], ["a1", "web_session"]), true);
});

test("toCdpCookies produces Network.setCookies params", () => {
  const cdp = toCdpCookies([
    { name: "a1", value: "v", domain: ".xiaohongshu.com", path: "/", httpOnly: true, secure: true, sameSite: "None", expires: NOW + 60 },
    { name: "s", value: "v", domain: "x.com", path: "/" },
  ]);
  assert.equal(cdp.length, 2);
  assert.deepEqual(cdp[0], {
    name: "a1",
    value: "v",
    domain: ".xiaohongshu.com",
    path: "/",
    expires: NOW + 60,
    httpOnly: true,
    secure: true,
    sameSite: "None",
  });
  // Session cookies carry no expires; domain gets a leading dot for CDP.
  assert.equal(cdp[1].expires, undefined);
  assert.equal(cdp[1].domain, ".x.com");
  assert.equal(cdp[1].sameSite, "Lax");
  assert.equal(cdp[1].httpOnly, false);
});

test("loadCookieJar ignores a jar written for another platform", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-jar-"));
  saveCookieJar(dir, "x", [cookie("auth_token")]);
  assert.deepEqual(loadCookieJar(dir, "xiaohongshu"), []);
  assert.equal(loadCookieJar(dir, "x").length, 1);
});
