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

export const PLATFORM_AUTH_CONFIG: Record<
  BrowserPlatform,
  {
    initialUrl: string;
    domains: string[];
    requiredCookies: string[];
    verifyPredicate: (cookieNames: Set<string>) => boolean;
  }
> = {
  xiaohongshu: {
    initialUrl: "https://www.xiaohongshu.com/explore",
    domains: ["xiaohongshu.com"],
    requiredCookies: ["a1", "web_session"],
    verifyPredicate: (names) => names.has("a1") && names.has("web_session"),
  },
  x: {
    initialUrl: "https://x.com/home",
    domains: ["x.com", "twitter.com"],
    requiredCookies: ["auth_token", "ct0"],
    verifyPredicate: (names) => names.has("auth_token") && names.has("ct0"),
  },
};
