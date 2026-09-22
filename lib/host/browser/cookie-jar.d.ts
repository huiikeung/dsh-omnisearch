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
/** Path of one platform's jar file. */
export declare function cookieJarPath(profileDir: string): string;
/** Drop session cookies and anything already expired. */
export declare function pruneCookies(cookies: StoredCookie[], nowSeconds?: number): StoredCookie[];
/** Load one platform's jar (missing/corrupt = empty). */
export declare function loadCookieJar(profileDir: string, platform: BrowserPlatform): StoredCookie[];
/** Persist one platform's jar atomically with owner-only permissions. */
export declare function saveCookieJar(profileDir: string, platform: BrowserPlatform, cookies: StoredCookie[]): void;
/** Whether the jar satisfies the platform's auth predicate (by cookie name). */
export declare function jarSatisfies(cookies: StoredCookie[], required: string[]): boolean;
/** Convert stored cookies into CDP `Network.setCookies` params. */
export declare function toCdpCookies(cookies: StoredCookie[]): Array<Record<string, unknown>>;
