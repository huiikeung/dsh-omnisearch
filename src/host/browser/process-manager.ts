import { spawn, type ChildProcess } from "node:child_process";
import { allocateRandomPort } from "./port.ts";
import type { BrowserInfo } from "./types.ts";

export interface SpawnedBrowserProcess {
  process: ChildProcess;
  port: number;
  profileDir: string;
  browserKind: "edge" | "chrome";
  startedAt: number;
}

/** True when the harness process itself runs as root (fnOS / Docker / systemd). */
function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

export function buildSafeLaunchArgs(
  profileDir: string,
  port: number,
  initialUrl?: string,
  minimized = false,
  headless = false,
  /** Injected so tests can assert the non-root invariant deterministically. */
  rootUser: boolean = isRoot(),
): string[] {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--no-first-run`,
    `--no-default-browser-check`,
  ];

  // Chromium's sandbox refuses to initialise when the harness runs as root
  // (fnOS / Docker / systemd) — the process exits instantly and CDP never comes
  // up, which is indistinguishable from a broken login button. Add it ONLY in
  // that case so the upstream "no --no-sandbox" security invariant still holds
  // for every non-root run (the dedicated profile dir already isolates state).
  if (rootUser) {
    args.push("--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-crash-reporter");
  }

  if (headless) {
    args.push("--headless=new");
  } else if (minimized) {
    args.push("--start-minimized");
  }

  if (initialUrl) {
    args.push(initialUrl);
  }

  return args;
}

export async function launchBrowserProcess(
  browser: BrowserInfo,
  profileDir: string,
  initialUrl?: string,
  minimized = false,
  headless = false,
): Promise<SpawnedBrowserProcess> {
  const port = await allocateRandomPort();
  const args = buildSafeLaunchArgs(profileDir, port, initialUrl, minimized, headless);

  const cp = spawn(browser.executablePath, args, {
    stdio: "ignore",
    detached: false,
  });

  await new Promise<void>((resolve, reject) => {
    cp.once("spawn", () => {
      resolve();
    });
    cp.once("error", (err) => {
      reject(err);
    });
  });

  return {
    process: cp,
    port,
    profileDir,
    browserKind: browser.kind,
    startedAt: Date.now(),
  };
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}
