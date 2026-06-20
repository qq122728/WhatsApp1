import { mkdir } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright-core";
import { launchPersistentBrowser } from "./browser-runtime.js";
import { SidecarError } from "./protocol.js";

export type WhatsAppLoginState =
  | "starting"
  | "awaiting_qr"
  | "authenticated"
  | "closed"
  | "error";

export interface WhatsAppStatus {
  accountId: string;
  state: WhatsAppLoginState;
  url?: string;
  title?: string;
  checkedAt: string;
  errorCode?: string;
}

interface AccountRuntime {
  accountId: string;
  context: BrowserContext;
  page: Page;
  state: WhatsAppLoginState;
  targetUrl: string;
  errorCode?: string;
}

const runtimes = new Map<string, AccountRuntime>();

function validateAccountId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value)
  ) {
    throw new SidecarError(
      "INVALID_ACCOUNT_ID",
      "Account ID must contain 8-64 safe characters.",
    );
  }
  return value;
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "https://web.whatsapp.com/";
  }
  const url = new URL(value);
  const isWhatsApp = url.protocol === "https:" && url.hostname === "web.whatsapp.com";
  const isLocalFixture =
    process.env.MULTICONNECT_ALLOW_TEST_URLS === "1" &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!isWhatsApp && !isLocalFixture) {
    throw new SidecarError(
      "UNSAFE_LOGIN_URL",
      "Only WhatsApp Web or an explicitly enabled local test URL is allowed.",
    );
  }
  return url.toString();
}

async function detectState(runtime: AccountRuntime): Promise<WhatsAppLoginState> {
  if (runtime.page.isClosed()) return "closed";

  const fixtureState = await runtime.page
    .locator('meta[name="multiconnect-auth-state"]')
    .getAttribute("content")
    .catch(() => null);
  if (fixtureState === "authenticated") return "authenticated";
  if (fixtureState === "awaiting_qr") return "awaiting_qr";

  const authenticatedSelectors = [
    "#pane-side",
    '[data-testid="chat-list"]',
    '[aria-label*="Chat list"]',
    '[aria-label*="聊天列表"]',
  ];
  for (const selector of authenticatedSelectors) {
    if (await runtime.page.locator(selector).count()) {
      return "authenticated";
    }
  }

  const qrSelectors = [
    'canvas[aria-label*="QR"]',
    '[data-testid="qrcode"]',
    'div[data-ref] canvas',
    "canvas",
  ];
  for (const selector of qrSelectors) {
    if (await runtime.page.locator(selector).count()) {
      return "awaiting_qr";
    }
  }

  return "starting";
}

async function statusOf(runtime: AccountRuntime): Promise<WhatsAppStatus> {
  try {
    runtime.state = await detectState(runtime);
    return {
      accountId: runtime.accountId,
      state: runtime.state,
      url: runtime.page.url(),
      title: await runtime.page.title(),
      checkedAt: new Date().toISOString(),
      ...(runtime.errorCode ? { errorCode: runtime.errorCode } : {}),
    };
  } catch {
    runtime.state = "error";
    runtime.errorCode = "LOGIN_STATE_CHECK_FAILED";
    return {
      accountId: runtime.accountId,
      state: runtime.state,
      checkedAt: new Date().toISOString(),
      errorCode: runtime.errorCode,
    };
  }
}

export async function startWhatsAppLogin(params: unknown): Promise<WhatsAppStatus> {
  const input = (params ?? {}) as Record<string, unknown>;
  const accountId = validateAccountId(input.accountId);
  const userDataDir = input.userDataDir;
  if (typeof userDataDir !== "string" || userDataDir.trim().length === 0) {
    throw new SidecarError(
      "PROFILE_PATH_REQUIRED",
      "A persistent profile path is required.",
    );
  }
  const targetUrl = validateUrl(input.targetUrl);

  const existing = runtimes.get(accountId);
  if (existing && !existing.page.isClosed()) {
    await existing.page.bringToFront();
    return statusOf(existing);
  }

  await mkdir(userDataDir, { recursive: true });
  const context = await launchPersistentBrowser(userDataDir);
  const page = context.pages()[0] ?? (await context.newPage());
  const runtime: AccountRuntime = {
    accountId,
    context,
    page,
    state: "starting",
    targetUrl,
  };
  runtimes.set(accountId, runtime);

  context.on("close", () => {
    runtime.state = "closed";
    runtimes.delete(accountId);
  });

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.bringToFront();
    return statusOf(runtime);
  } catch {
    runtime.state = "error";
    runtime.errorCode = "LOGIN_PAGE_NAVIGATION_FAILED";
    throw new SidecarError(
      runtime.errorCode,
      "The WhatsApp login page could not be opened.",
      true,
    );
  }
}

export async function getWhatsAppStatus(params: unknown): Promise<WhatsAppStatus> {
  const input = (params ?? {}) as Record<string, unknown>;
  const accountId = validateAccountId(input.accountId);
  const runtime = runtimes.get(accountId);
  if (!runtime) {
    return {
      accountId,
      state: "closed",
      checkedAt: new Date().toISOString(),
    };
  }
  return statusOf(runtime);
}

export async function closeWhatsApp(params: unknown): Promise<WhatsAppStatus> {
  const input = (params ?? {}) as Record<string, unknown>;
  const accountId = validateAccountId(input.accountId);
  const runtime = runtimes.get(accountId);
  if (runtime) {
    await runtime.context.close();
    runtimes.delete(accountId);
  }
  return {
    accountId,
    state: "closed",
    checkedAt: new Date().toISOString(),
  };
}

export async function closeAllWhatsApp(): Promise<void> {
  const contexts = [...runtimes.values()].map((runtime) => runtime.context);
  runtimes.clear();
  await Promise.allSettled(contexts.map((context) => context.close()));
}
