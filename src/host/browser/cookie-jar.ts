/**
 * dsh-omnisearch — cookie jar for the sidebar-browser login flow.
 *
 * The NAS runs headless, so the interactive login the user actually performs
 * happens in the DSH sidebar browser (Playwright MCP). Cookies captured there
 * are persisted here as JSON and injected into the dedicated CDP browser
 * session on start (Network.setCookies), which keeps the existing headless
 * search/fetch paths working unchanged.
 *
 * Storage: <profile dir>/cookies.json (per platform), 0600.
 *
 * @module
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserPlatform } from "./types.ts";

/** One cookie in Playwright/CDP-compatible shape. */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since epoch; -1/undefined = session cookie. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** On-disk shape. */
interface CookieJarFile {
  version: 1;
  platform: BrowserPlatform;
  savedAt: number;
  cookies: StoredCookie[];
}

/** Path of one platform's jar file. */
export function cookieJarPath(profileDir: string): string {
  return path.join(profileDir, "cookies.json");
}

/** Drop session cookies and anything already expired. */
export function pruneCookies(cookies: StoredCookie[], nowSeconds = Math.floor(Date.now() / 1000)): StoredCookie[] {
  return cookies.filter((c) => {
    if (!c?.name || !c?.value) return false;
    if (typeof c.expires === "number" && c.expires > 0 && c.expires <= nowSeconds) return false;
    return true;
  });
}

/** Load one platform's jar (missing/corrupt = empty). */
export function loadCookieJar(profileDir: string, platform: BrowserPlatform): StoredCookie[] {
  const file = cookieJarPath(profileDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CookieJarFile;
    if (parsed?.platform !== platform || !Array.isArray(parsed.cookies)) return [];
    return pruneCookies(parsed.cookies);
  } catch {
    return [];
  }
}

/** Persist one platform's jar atomically with owner-only permissions. */
export function saveCookieJar(profileDir: string, platform: BrowserPlatform, cookies: StoredCookie[]): void {
  fs.mkdirSync(profileDir, { recursive: true });
  const file = cookieJarPath(profileDir);
  const payload: CookieJarFile = { version: 1, platform, savedAt: Date.now(), cookies: pruneCookies(cookies) };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort
  }
}

/** Whether the jar satisfies the platform's auth predicate (by cookie name). */
export function jarSatisfies(cookies: StoredCookie[], required: string[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return required.every((n) => names.has(n));
}

/** Convert stored cookies into CDP `Network.setCookies` params. */
export function toCdpCookies(cookies: StoredCookie[]): Array<Record<string, unknown>> {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain.startsWith(".") ? c.domain : `.${c.domain.replace(/^\./, "")}`,
    path: c.path || "/",
    ...(typeof c.expires === "number" && c.expires > 0 ? { expires: c.expires } : {}),
    httpOnly: c.httpOnly === true,
    secure: c.secure === true,
    sameSite: c.sameSite ?? "Lax",
  }));
}
