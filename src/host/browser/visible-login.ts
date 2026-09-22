/**
 * dsh-omnisearch — visible login over plain HTTP (no VNC / no Xvfb needed).
 *
 * The NAS is headless and the DSH GUI has no interactive browser panel, so an
 * interactive login used to be impossible. This module closes that gap without
 * installing anything: it launches the platform's dedicated chromium (headless
 * is fine — it still renders), and streams its screen to ANY browser through
 * the plugin's fenced routes:
 *
 *   GET  /omnisearch/api/vnc/page?platform=x   → the remote-screen page
 *   GET  /omnisearch/api/vnc/screen?platform=x → one JPEG frame
 *   POST /omnisearch/api/vnc/input             → click / type / scroll / key
 *
 * Because everything rides the existing DSH web server, it works over the
 * external reverse-proxy URL too (phone included). Cookies are polled through
 * CDP and stored in the platform cookie jar once the auth predicate passes.
 *
 * @module
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { allocateRandomPort } from "./port.ts";
import { locateBrowser } from "./locator.ts";
import { getDedicatedProfileDir } from "./paths.ts";
import { PLATFORM_AUTH_CONFIG } from "./session-manager-config.ts";
import { saveCookieJar, type StoredCookie } from "./cookie-jar.ts";
import { CdpClient } from "./cdp/client.ts";
import type { BrowserPlatform } from "./types.ts";


/** Kill any chromium whose command line references this profile dir. */
function killStaleProfileChromium(profileDir: string): void {
  let pids: string[] = [];
  try {
    pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return;
  }
  for (const pid of pids) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmdline.includes("chromium") && !cmdline.includes("chrome")) continue;
      if (!cmdline.includes(profileDir)) continue;
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // process vanished or unreadable
    }
  }
}

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

const sessions = new Map<BrowserPlatform, VisibleSession>();

/** Idle reaper: a login window left open is closed after this long. */
const SESSION_IDLE_MS = 15 * 60 * 1000;

/** Kill a session's browser and drop it. */
export async function stopVisibleLogin(platform: BrowserPlatform): Promise<void> {
  const session = sessions.get(platform);
  if (!session) return;
  sessions.delete(platform);
  try {
    session.cdp.close?.();
  } catch {
    // already closed
  }
  if (session.pid) {
    try {
      process.kill(session.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

/** Active session for a platform (if any). */
export function getVisibleSession(platform: BrowserPlatform): VisibleSession | undefined {
  return sessions.get(platform);
}

/**
 * Launch (or reuse) the visible-login browser for a platform and navigate it
 * to the login entry. Returns the session; a second call reuses the running
 * window instead of spawning another one.
 */
export async function startVisibleLogin(platform: BrowserPlatform): Promise<VisibleSession> {
  const existing = sessions.get(platform);
  if (existing) {
    await navigate(existing, PLATFORM_AUTH_CONFIG[platform].initialUrl).catch(() => {});
    return existing;
  }

  const browser = locateBrowser("auto");
  // 独立 profile：与 CDP 专用会话的 profile 分开，否则 chromium 的单例机制
  // 会让新进程直接退出（CDP 端口永不就绪）。
  const profileDir = `${getDedicatedProfileDir(platform)}-login`;
  // A chromium left over from a previous host process still holds the profile
  // singleton, which makes a fresh launch exit instantly (CDP never opens).
  killStaleProfileChromium(profileDir);
  const port = await allocateRandomPort();
  const url = PLATFORM_AUTH_CONFIG[platform].initialUrl;

  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Same root/NAS hardening the dedicated profile uses.
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-crash-reporter",
    // Headless: this NAS has no X server, and the screen is streamed as frames
    // anyway — a real display would add nothing.
    "--headless=new",
    // A phone-sized viewport keeps the streamed frames small.
    "--window-size=420,860",
    url,
  ];

  const child = spawn(browser.executablePath, args, { stdio: "ignore", detached: false, windowsHide: true });
  const session: VisibleSession = { platform, port, pid: child.pid, cdp: undefined as unknown as CdpClient, startedAt: Date.now(), url };
  sessions.set(platform, session);
  child.on("exit", () => {
    if (sessions.get(platform) === session) sessions.delete(platform);
  });

  // Connect CDP and wait for the page target.
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const target = await findPageTarget(port);
      const wsPath = target.webSocketDebuggerUrl.slice(target.webSocketDebuggerUrl.indexOf("/", "ws://".length));
      const cdp = new CdpClient(`ws://127.0.0.1:${port}${wsPath}`);
      await cdp.connect(10_000);
      session.cdp = cdp;
      await cdp.send("Page.enable", {});
      await cdp.send("Runtime.enable", {});
      return session;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  sessions.delete(platform);
  try {
    process.kill(child.pid!, "SIGKILL");
  } catch {
    // ignore
  }
  throw new Error(`visible login browser did not start: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** CDP /json/list entry. */
interface PageTarget {
  webSocketDebuggerUrl: string;
  type: string;
  url: string;
}

async function findPageTarget(port: number): Promise<PageTarget> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list -> HTTP ${res.status}`);
  const list = (await res.json()) as PageTarget[];
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("no page target yet");
  return page;
}

/** Navigate the session's page and return the final URL. */
export async function navigate(session: VisibleSession, url: string): Promise<string> {
  await session.cdp.send("Page.navigate", { url });
  // Give the page a moment; the next screen poll shows whatever loaded.
  await new Promise((r) => setTimeout(r, 800));
  session.url = url;
  return url;
}

/**
 * One JPEG frame (base64) of the current page.
 *
 * Screenshots BLOCK while the page is still loading, and a slow/blocked site
 * (X from a CN network, for instance) would stall the whole stream. Race the
 * CDP call so the caller can keep serving the previous frame instead.
 */
export async function captureScreen(session: VisibleSession, quality = 55, timeoutMs = 4_000): Promise<string> {
  try {
    const result = (await Promise.race([
      session.cdp.send(
        "Page.captureScreenshot",
        { format: "jpeg", quality, captureBeyondViewport: false, fromSurface: false },
        undefined,
        undefined,
        timeoutMs,
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("screenshot timeout")), timeoutMs + 500)),
    ])) as { data?: string };
    return result.data ?? "";
  } catch {
    return "";
  }
}

/** Current page URL. */
export async function currentUrl(session: VisibleSession): Promise<string> {
  try {
    const result = (await session.cdp.send("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    })) as { result?: { value?: string } };
    if (typeof result.result?.value === "string") session.url = result.result.value;
  } catch {
    // keep the last known URL
  }
  return session.url;
}

/** One input event from the remote page. */
export type VisibleInput =
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; deltaY: number };

/** Translate a remote input event into CDP input commands. */
export async function dispatchInput(session: VisibleSession, input: VisibleInput): Promise<void> {
  switch (input.type) {
    case "click":
      await session.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: input.x, y: input.y, button: "left", buttons: 1, clickCount: 1 });
      await session.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: input.x, y: input.y, button: "left", buttons: 0, clickCount: 1 });
      return;
    case "text":
      for (const ch of input.text) {
        await session.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
        await session.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      }
      return;
    case "key":
      await session.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: input.key, windowsVirtualKeyCode: vkOf(input.key), nativeVirtualKeyCode: vkOf(input.key) });
      await session.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: input.key, windowsVirtualKeyCode: vkOf(input.key), nativeVirtualKeyCode: vkOf(input.key) });
      return;
    case "scroll":
      await session.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 210, y: 430, deltaX: 0, deltaY: input.deltaY });
      return;
  }
}

/** Virtual-key codes for the few keys the remote page sends. */
function vkOf(key: string): number {
  const map: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  return map[key] ?? 0;
}

/**
 * Read the browser's cookies (httpOnly included) and, once the platform's auth
 * predicate passes, persist them to the cookie jar.
 */
export async function pollCookies(session: VisibleSession): Promise<{ authenticated: boolean; count: number }> {
  const raw = (await session.cdp.send("Network.getCookies", {})) as {
    cookies?: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }>;
  };
  const config = PLATFORM_AUTH_CONFIG[session.platform];
  const relevant: StoredCookie[] = (raw.cookies ?? [])
    .filter((c) => config.domains.some((d) => c.domain === d || c.domain.endsWith(`.${d}`)))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
      httpOnly: c.httpOnly === true,
      secure: c.secure !== false,
      sameSite: (c.sameSite as StoredCookie["sameSite"]) ?? "Lax",
    }));
  const names = new Set(relevant.map((c) => c.name));
  const authenticated = config.verifyPredicate(names);
  if (authenticated) {
    saveCookieJar(getDedicatedProfileDir(session.platform), session.platform, relevant);
  }
  return { authenticated, count: relevant.length };
}

/** Reap sessions idle for too long (called from a timer the host installs). */
export function reapIdleVisibleSessions(now = Date.now()): void {
  for (const [platform, session] of sessions) {
    if (now - session.startedAt > SESSION_IDLE_MS) void stopVisibleLogin(platform);
  }
}
