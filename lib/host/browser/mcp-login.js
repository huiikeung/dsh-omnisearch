/**
 * dsh-omnisearch — login through the DSH sidebar browser (Playwright MCP).
 *
 * On a headless NAS the plugin's own chromium window is invisible to the user,
 * so an interactive 登录 click is useless there. The sidebar browser is the
 * one browser the user can actually see and type into, so the login flow drives
 * it through the MCP tool bridge (`mcp__playwright__*`), waits for the user to
 * sign in, and captures the resulting cookies (httpOnly included, via
 * browser_run_code_unsafe → page.context().cookies()) into the plugin cookie
 * jar. The dedicated CDP session then replays them on start.
 *
 * @module
 */
import { PLATFORM_AUTH_CONFIG } from "./session-manager-config.js";
import { saveCookieJar } from "./cookie-jar.js";
/** MCP public tool names (serverName "playwright" from the profile patch). */
const MCP_NAVIGATE = "mcp__playwright__browser_navigate";
const MCP_RUN_CODE = "mcp__playwright__browser_run_code_unsafe";
const MCP_TABS = "mcp__playwright__browser_tabs";
/** Poll cadence while waiting for the user to finish signing in. */
const POLL_INTERVAL_MS = 2_500;
/** Budget for one navigation call (the login page can be slow). */
const NAVIGATE_TIMEOUT_MS = 60_000;
/** Budget for one cookie-poll call. */
const POLL_TIMEOUT_MS = 20_000;
/** Budget for the availability probe. */
const PROBE_TIMEOUT_MS = 10_000;
/** How long to wait for a completed login before giving up. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
let callCounter = 0;
function nextCallId() {
    callCounter += 1;
    return `dsh-omnisearch-mcp-login-${process.pid}-${callCounter}`;
}
/** Join every text block of a tool result. */
function textOf(result) {
    return (result?.content ?? [])
        .filter((block) => typeof block?.text === "string")
        .map((block) => block.text)
        .join("\n");
}
/** Cheap liveness probe: list the sidebar browser's tabs. */
export async function mcpBrowserAvailable(tools) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        try {
            await tools.execute({
                callId: nextCallId(),
                name: MCP_TABS,
                arguments: { action: "list" },
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Drive the sidebar browser to the platform login page and wait until the
 * platform's auth cookies appear (the user signs in manually). Captures and
 * returns the full cookie set on success.
 */
export async function loginViaMcpBrowser(tools, platform, profileDir, opts = {}) {
    const config = PLATFORM_AUTH_CONFIG[platform];
    const pollMs = opts.pollMs ?? POLL_INTERVAL_MS;
    const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    // 1) Navigate the sidebar browser to the login entry.
    try {
        const navController = new AbortController();
        const navTimer = setTimeout(() => navController.abort(new Error("navigation timed out")), NAVIGATE_TIMEOUT_MS);
        try {
            await tools.execute({
                callId: nextCallId(),
                name: MCP_NAVIGATE,
                arguments: { url: config.initialUrl },
                signal: navController.signal,
            });
        }
        finally {
            clearTimeout(navTimer);
        }
    }
    catch (error) {
        return { ok: false, error: `sidebar browser navigation failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    // 2) Poll the browser's cookie jar (httpOnly included) until the auth
    //    predicate is satisfied — i.e. the user finished signing in.
    while (Date.now() < deadline) {
        if (opts.signal?.aborted)
            return { ok: false, error: "login aborted" };
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        if (opts.signal?.aborted)
            return { ok: false, error: "login aborted" };
        let cookies;
        try {
            const pollController = new AbortController();
            const pollTimer = setTimeout(() => pollController.abort(new Error("cookie poll timed out")), POLL_TIMEOUT_MS);
            let result;
            try {
                result = await tools.execute({
                    callId: nextCallId(),
                    name: MCP_RUN_CODE,
                    arguments: {
                        code: "async (page) => JSON.stringify(await page.context().cookies())",
                        description: "read the sidebar browser's cookies for dsh-omnisearch login detection",
                    },
                    signal: pollController.signal,
                });
            }
            finally {
                clearTimeout(pollTimer);
            }
            const text = textOf(result);
            const match = text.match(/\[[\s\S]*\]/);
            cookies = match ? JSON.parse(match[0]) : [];
        }
        catch {
            continue; // browser busy navigating; retry
        }
        const relevant = cookies.filter((c) => config.domains.some((d) => c.domain === d || c.domain.endsWith(`.${d}`)));
        const names = new Set(relevant.map((c) => c.name));
        if (config.verifyPredicate(names)) {
            saveCookieJar(profileDir, platform, relevant);
            return { ok: true, cookies: relevant };
        }
    }
    return { ok: false, timedOut: true, error: "登录等待超时（5 分钟未完成）" };
}
