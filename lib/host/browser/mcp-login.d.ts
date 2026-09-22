import { type StoredCookie } from "./cookie-jar.ts";
import type { BrowserPlatform } from "./types.ts";
/** Minimal face of the harness ToolRegistry this bridge needs. */
export interface ToolExecutor {
    execute(exec: {
        callId: string;
        name: string;
        arguments: unknown;
        /** Required caller-owned cancellation (the registry reads signal.aborted). */
        signal: AbortSignal;
    }): Promise<{
        content?: Array<{
            type?: string;
            text?: string;
        }>;
    }>;
}
/** Outcome of one sidebar-browser login attempt. */
export interface McpLoginOutcome {
    ok: boolean;
    cookies?: StoredCookie[];
    error?: string;
    /** True when the wait hit the timeout without a completed login. */
    timedOut?: boolean;
}
/** Cheap liveness probe: list the sidebar browser's tabs. */
export declare function mcpBrowserAvailable(tools: ToolExecutor): Promise<boolean>;
/**
 * Drive the sidebar browser to the platform login page and wait until the
 * platform's auth cookies appear (the user signs in manually). Captures and
 * returns the full cookie set on success.
 */
export declare function loginViaMcpBrowser(tools: ToolExecutor, platform: BrowserPlatform, profileDir: string, opts?: {
    signal?: AbortSignal;
    pollMs?: number;
    timeoutMs?: number;
}): Promise<McpLoginOutcome>;
