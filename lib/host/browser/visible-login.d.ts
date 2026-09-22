import { CdpClient } from "./cdp/client.ts";
import type { BrowserPlatform } from "./types.ts";
/** One running visible-login session. */
export interface VisibleSession {
    platform: BrowserPlatform;
    port: number;
    pid?: number;
    cdp: CdpClient;
    startedAt: number;
    /** Last known page URL (for the page header). */
    url: string;
}
/** Kill a session's browser and drop it. */
export declare function stopVisibleLogin(platform: BrowserPlatform): Promise<void>;
/** Active session for a platform (if any). */
export declare function getVisibleSession(platform: BrowserPlatform): VisibleSession | undefined;
/**
 * Launch (or reuse) the visible-login browser for a platform and navigate it
 * to the login entry. Returns the session; a second call reuses the running
 * window instead of spawning another one.
 */
export declare function startVisibleLogin(platform: BrowserPlatform): Promise<VisibleSession>;
/** Navigate the session's page and return the final URL. */
export declare function navigate(session: VisibleSession, url: string): Promise<string>;
/**
 * One JPEG frame (base64) of the current page.
 *
 * Screenshots BLOCK while the page is still loading, and a slow/blocked site
 * (X from a CN network, for instance) would stall the whole stream. Race the
 * CDP call so the caller can keep serving the previous frame instead.
 */
export declare function captureScreen(session: VisibleSession, quality?: number, timeoutMs?: number): Promise<string>;
/** Current page URL. */
export declare function currentUrl(session: VisibleSession): Promise<string>;
/** One input event from the remote page. */
export type VisibleInput = {
    type: "click";
    x: number;
    y: number;
} | {
    type: "text";
    text: string;
} | {
    type: "key";
    key: string;
} | {
    type: "scroll";
    deltaY: number;
};
/** Translate a remote input event into CDP input commands. */
export declare function dispatchInput(session: VisibleSession, input: VisibleInput): Promise<void>;
/**
 * Read the browser's cookies (httpOnly included) and, once the platform's auth
 * predicate passes, persist them to the cookie jar.
 */
export declare function pollCookies(session: VisibleSession): Promise<{
    authenticated: boolean;
    count: number;
}>;
/** Reap sessions idle for too long (called from a timer the host installs). */
export declare function reapIdleVisibleSessions(now?: number): void;
