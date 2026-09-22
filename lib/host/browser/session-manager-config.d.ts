/**
 * dsh-omnisearch — per-platform browser auth requirements (login URLs, cookie
 * domains and the predicate that proves a session is signed in).
 *
 * Extracted from session-manager so both the dedicated-CDP flow and the
 * sidebar-browser (MCP) login flow share ONE definition.
 *
 * @module
 */
import type { BrowserPlatform } from "./types.ts";
export declare const PLATFORM_AUTH_CONFIG: Record<BrowserPlatform, {
    initialUrl: string;
    domains: string[];
    requiredCookies: string[];
    verifyPredicate: (cookieNames: Set<string>) => boolean;
}>;
