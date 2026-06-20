import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium, type BrowserContext } from "playwright-core";
import { SidecarError } from "./protocol.js";

const WINDOWS_BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

export async function resolveChromiumExecutable(): Promise<string> {
  const configured = process.env.MULTICONNECT_BROWSER_EXECUTABLE?.trim();
  const candidates = configured
    ? [configured]
    : process.platform === "win32"
      ? WINDOWS_BROWSER_CANDIDATES
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known installation path.
    }
  }

  throw new SidecarError(
    "BROWSER_NOT_FOUND",
    "Google Chrome or Microsoft Edge was not found. Install a supported Chromium browser.",
    false,
  );
}

export async function launchPersistentBrowser(
  userDataDir: string,
): Promise<BrowserContext> {
  const executablePath = await resolveChromiumExecutable();
  return chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport: null,
    locale: "zh-CN",
    acceptDownloads: false,
    args: ["--start-maximized"],
  });
}
