import { CdpClient } from "./cdp/client.ts";
import { type LiveSessionVerifier } from "./live-auth-verifier.ts";
import { type SpawnedBrowserProcess } from "./process-manager.ts";
import type { BrowserInfo, BrowserPlatform, BrowserRunMode, BrowserSessionStatus, CdpPageLease, NativeBrowserRuntime } from "./types.ts";
export type ProcessLauncher = (browser: BrowserInfo, profileDir: string, initialUrl?: string, minimized?: boolean, headless?: boolean) => Promise<SpawnedBrowserProcess>;
export type CdpClientFactory = (port: number, signal?: AbortSignal) => Promise<CdpClient>;
export type PidChecker = (pid: number) => boolean;
export type PidKiller = (pid: number) => void;
export declare class SessionManager implements NativeBrowserRuntime {
    private records;
    private profileStore;
    private stateStore;
    private readonly browserChoice;
    private readonly idleShutdownMs;
    private readonly launcher;
    private readonly cdpFactory;
    private readonly isPidAliveFn;
    private readonly killPidFn;
    private readonly liveSessionVerifier;
    private disposed;
    constructor(browserChoice?: "auto" | "edge" | "chrome" | string, baseDirOverride?: string, idleShutdownMs?: number, launcher?: ProcessLauncher, cdpFactory?: CdpClientFactory, isPidAliveFn?: PidChecker, killPidFn?: PidKiller, liveSessionVerifier?: LiveSessionVerifier);
    private getRecord;
    private enqueue;
    detect(): Promise<BrowserInfo | null>;
    /**
     * Synchronous browser probe: throws with the locateBrowser reason when no
     * supported executable exists. Lets the platform/login route fail LOUDLY
     * (previously the failure was swallowed and the card looked unresponsive).
     */
    assertBrowserAvailable(): void;
    /** Last login failure per platform, surfaced through status() so the card
     *  can explain why a 登录 click did nothing instead of staying silent. */
    private readonly loginFailures;
    /** Record a login failure for later status() reporting (clears on success). */
    noteLoginFailure(platform: BrowserPlatform, message: string): void;
    checkAuthentication(platform: BrowserPlatform): Promise<boolean>;
    verifyAuthenticationForOperation(platform: BrowserPlatform, signal?: AbortSignal, mode?: BrowserRunMode): Promise<boolean>;
    /**
     * Inject the platform's saved cookie jar into a freshly started CDP session
     * (Network.setCookies). Cookies captured from the sidebar browser therefore
     * make every headless operation start signed in.
     */
    private injectJarCookies;
    private internalCheckAuth;
    private hasRequiredCookies;
    status(platform: BrowserPlatform): Promise<BrowserSessionStatus>;
    login(platform: BrowserPlatform, signal?: AbortSignal): Promise<BrowserSessionStatus>;
    private prepareInteractiveLogin;
    openPage(platform: BrowserPlatform, url: string, signal?: AbortSignal, mode?: BrowserRunMode): Promise<CdpPageLease>;
    createPage(platform: BrowserPlatform, signal?: AbortSignal, mode?: BrowserRunMode): Promise<CdpPageLease>;
    private retainLease;
    private releaseLease;
    private scheduleIdleTimer;
    private acquireSession;
    private internalStop;
    stop(platform: BrowserPlatform): Promise<void>;
    resetSession(platform: BrowserPlatform): Promise<void>;
    dispose(): Promise<void>;
}
