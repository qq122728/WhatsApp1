import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContactRound,
  SendHorizontal,
} from "lucide-react";
import { AccountActionDialog } from "./components/AccountActionDialog";
import { AccountSettingsModal } from "./components/AccountSettingsModal";
import { AddAccountModal } from "./components/AddAccountModal";
import { NewAccountForm } from "./components/NewAccountForm";
import { PanelTabBar } from "./components/PanelTabBar";
import { Sidebar, type View } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { Topbar } from "./components/Topbar";
import { TranslationBar } from "./components/TranslationBar";
import { initialAccounts, initialMessages } from "./data";
import {
  connectRemoteControl,
  disconnectRemoteControl,
  getRemoteControlStatus,
  isTauriRuntime,
  loadRemoteConfig,
  mapRemoteStatus,
  saveRemoteConfig,
  updateRemoteControlAccounts,
} from "./lib/remote-api";
import {
  onTranslationLogEntry,
  type TranslationLogEntry,
} from "./lib/translation-logs";
import {
  closeWaPanel,
  deleteWaAccount,
  hideWaPanel,
  listWaPanels,
  onWaPanelLayoutInvalidated,
  onWaPanelState,
  openWaPanel,
  resetWaPanelSession,
  setWaPanelBounds,
  setWaPanelTranslationConfig,
  showWaPanel,
  type WaPanelState,
} from "./lib/panels";
import { createWhatsAppAccountId } from "./lib/whatsapp";
import type {
  Account,
  AccountConfig,
  ClientAccountDiagnostics,
  Platform,
  RemoteConnectionState,
  RemoteControlAccountSummary,
  TranslationCacheSettings,
} from "./types";
import { defaultAccountConfig, defaultTranslationCacheSettings } from "./types";
import { AccountsView } from "./views/AccountsView";
import { MessagesView } from "./views/MessagesView";
import { Overview } from "./views/Overview";
import { PlaceholderView } from "./views/PlaceholderView";
import { SettingsView } from "./views/SettingsView";

const SAVED_ACCOUNTS_KEY = "multiconnect.saved-accounts";
const ACCOUNT_CONFIGS_KEY = "multiconnect.account-configs";
const PANEL_SESSION_KEY = "multiconnect.panel-session";
const TRANSLATION_CACHE_SETTINGS_KEY = "multiconnect.translation-cache-settings";
const UNREAD_NOTIFICATION_COOLDOWN_MS = 8000;
const MAX_TRANSLATION_LOGS = 160;
let unreadAudioContext: AudioContext | null = null;
let unreadAudioCloseTimer: number | undefined;

interface WaPanelHealth {
  state: WaPanelState;
  occurredAt: string;
  reasonCode?: string;
  summary?: string;
}

function formatUnreadBadge(value: number): string {
  return value > 99 ? "99+" : String(value);
}

function loadPanelSession(): { openPanels: string[]; activePanelId: string | null } {
  try {
    const raw = sessionStorage.getItem(PANEL_SESSION_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const openPanels = Array.isArray(saved.openPanels)
      ? saved.openPanels.filter((id: unknown): id is string => typeof id === "string")
      : [];
    const activePanelId =
      typeof saved.activePanelId === "string" ? saved.activePanelId : null;
    return { openPanels, activePanelId };
  } catch {
    return { openPanels: [], activePanelId: null };
  }
}

function savePanelSession(openPanels: string[], activePanelId: string | null) {
  try {
    sessionStorage.setItem(
      PANEL_SESSION_KEY,
      JSON.stringify({ openPanels, activePanelId }),
    );
  } catch {
    // Session persistence is best-effort only.
  }
}

function playUnreadSound() {
  try {
    const AudioContextCtor =
      window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;

    const context =
      unreadAudioContext && unreadAudioContext.state !== "closed"
        ? unreadAudioContext
        : new AudioContextCtor();
    unreadAudioContext = context;
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    if (unreadAudioCloseTimer) {
      window.clearTimeout(unreadAudioCloseTimer);
    }
    const gain = context.createGain();
    const firstTone = context.createOscillator();
    const secondTone = context.createOscillator();
    const now = context.currentTime;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    gain.connect(context.destination);

    firstTone.type = "sine";
    firstTone.frequency.setValueAtTime(880, now);
    firstTone.connect(gain);
    firstTone.start(now);
    firstTone.stop(now + 0.14);

    secondTone.type = "sine";
    secondTone.frequency.setValueAtTime(1174.66, now + 0.13);
    secondTone.connect(gain);
    secondTone.start(now + 0.13);
    secondTone.stop(now + 0.32);

    unreadAudioCloseTimer = window.setTimeout(() => {
      if (unreadAudioContext !== context) return;
      unreadAudioContext = null;
      unreadAudioCloseTimer = undefined;
      void context.close().catch(() => undefined);
    }, 1500);
  } catch (error) {
    console.warn("[wa_unread_sound]", error);
  }
}

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    const saved = raw ? (JSON.parse(raw) as Account[]) : [];
    const restored = saved
      .filter(
        (account) =>
          account.platform === "whatsapp" &&
          account.id.startsWith("wa_"),
      )
      .map((account) => ({
        ...account,
        status: "offline" as const,
        unreadCount: 0,
        lastSync: "等待恢复",
      }));
    return [...initialAccounts, ...restored];
  } catch {
    return initialAccounts;
  }
}

function loadAccountConfigs(): Record<string, AccountConfig> {
  try {
    const raw = localStorage.getItem(ACCOUNT_CONFIGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAccountConfigs(configs: Record<string, AccountConfig>) {
  localStorage.setItem(ACCOUNT_CONFIGS_KEY, JSON.stringify(configs));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeTranslationCacheSettings(
  value: Partial<TranslationCacheSettings> = {},
): TranslationCacheSettings {
  return {
    retentionDays: clampNumber(
      value.retentionDays,
      defaultTranslationCacheSettings.retentionDays,
      1,
      365,
    ),
    perAccountLimit: clampNumber(
      value.perAccountLimit,
      defaultTranslationCacheSettings.perAccountLimit,
      20,
      2000,
    ),
    autoTranslateHistory:
      typeof value.autoTranslateHistory === "boolean"
        ? value.autoTranslateHistory
        : defaultTranslationCacheSettings.autoTranslateHistory,
    clearAt:
      typeof value.clearAt === "number" && Number.isFinite(value.clearAt)
        ? value.clearAt
        : undefined,
  };
}

function loadTranslationCacheSettings(): TranslationCacheSettings {
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_SETTINGS_KEY);
    return normalizeTranslationCacheSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...defaultTranslationCacheSettings };
  }
}

function saveTranslationCacheSettings(settings: TranslationCacheSettings) {
  localStorage.setItem(
    TRANSLATION_CACHE_SETTINGS_KEY,
    JSON.stringify(normalizeTranslationCacheSettings(settings)),
  );
}

function withTranslationCacheSettings(
  config: AccountConfig | undefined,
  settings: TranslationCacheSettings,
): AccountConfig {
  return {
    ...defaultAccountConfig,
    ...(config ?? {}),
    translationCacheRetentionDays: settings.retentionDays,
    translationCachePerAccountLimit: settings.perAccountLimit,
    incomingAutoTranslate: settings.autoTranslateHistory,
    translationCacheClearAt: settings.clearAt,
  };
}

function panelConfigFingerprint(config: AccountConfig): string {
  return JSON.stringify({
    translationChannel: config.translationChannel,
    translationServer: config.translationServer,
    translationStyle: config.translationStyle,
    regionalTone: config.regionalTone,
    targetLanguage: config.targetLanguage,
    sourceLanguage: config.sourceLanguage,
    sendTranslation: config.sendTranslation,
    receiveTranslation: config.receiveTranslation,
    blockChinese: config.blockChinese,
    fontSize: config.fontSize,
    fontColor: config.fontColor,
    translationCacheRetentionDays: config.translationCacheRetentionDays,
    translationCachePerAccountLimit: config.translationCachePerAccountLimit,
    incomingAutoTranslate: config.incomingAutoTranslate,
    translationCacheClearAt: config.translationCacheClearAt,
  });
}

function nextWhatsAppAccountName(
  accounts: Account[],
  accountConfigs: Record<string, AccountConfig>,
): string {
  const usedNames = new Set(
    accounts
      .filter((account) => account.platform === "whatsapp")
      .map((account) => accountConfigs[account.id]?.name ?? account.name),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const name = `WhatsApp${index}`;
    if (!usedNames.has(name)) return name;
  }
  return `WhatsApp${accounts.length + 1}`;
}

const viewCopy: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "总览",
    subtitle: "查看渠道状态、消息与系统健康度",
  },
  accounts: {
    title: "账号管理",
    subtitle: "连接、恢复并管理各平台账号",
  },
  messages: {
    title: "统一收件箱",
    subtitle: "跨渠道查看和回复客户消息",
  },
  contacts: {
    title: "联系人",
    subtitle: "管理已授权联系人、标签与同意记录",
  },
  jobs: {
    title: "任务中心",
    subtitle: "创建受控通知任务并查看执行结果",
  },
  settings: {
    title: "设置",
    subtitle: "配置 Web 控制台连接、安全与翻译服务",
  },
};

function App() {
  const initialPanelSession = useMemo(loadPanelSession, []);
  const [view, setView] = useState<View>("overview");
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newAccountFormOpen, setNewAccountFormOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [remoteConfig, setRemoteConfig] = useState(loadRemoteConfig);
  const [connectionState, setConnectionState] =
    useState<RemoteConnectionState>("not_configured");

  const [openPanels, setOpenPanels] = useState<string[]>(
    initialPanelSession.openPanels,
  );
  const [activePanelId, setActivePanelId] = useState<string | null>(
    initialPanelSession.activePanelId,
  );
  const [accountManagerView, setAccountManagerView] = useState<
    "closed" | "quick" | "drawer"
  >("closed");
  const [accountOverlayOpen, setAccountOverlayOpen] = useState(false);
  const [newAccountCount, setNewAccountCount] = useState(0);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [pendingAccountAction, setPendingAccountAction] = useState<{
    type: "relogin" | "delete";
    accountId: string;
  } | null>(null);
  const [pendingBatchDeleteIds, setPendingBatchDeleteIds] = useState<string[]>([]);
  const [accountActionBusy, setAccountActionBusy] = useState(false);
  const [accountConfigs, setAccountConfigs] = useState<Record<string, AccountConfig>>(loadAccountConfigs);
  const [waPanelHealth, setWaPanelHealth] = useState<Record<string, WaPanelHealth>>({});
  const [translationCacheSettings, setTranslationCacheSettings] =
    useState<TranslationCacheSettings>(loadTranslationCacheSettings);
  const [translationLogs, setTranslationLogs] = useState<TranslationLogEntry[]>([]);
  const panelVisibilityEpoch = useRef(0);
  const panelConfigSyncRef = useRef<Record<string, string>>({});
  const panelHostRef = useRef<HTMLDivElement>(null);
  const unreadBaselineRef = useRef<Record<string, number>>({});
  const unreadNotificationAtRef = useRef<Record<string, number>>({});
  const accountsRef = useRef<Account[]>(accounts);
  const accountConfigsRef = useRef<Record<string, AccountConfig>>(accountConfigs);
  const activePanelIdRef = useRef<string | null>(activePanelId);
  const panelUiBlockedRef = useRef(false);
  const openAccountFromNotificationRef = useRef<(accountId: string) => void>(
    () => undefined,
  );
  const [unreadFocusRequest, setUnreadFocusRequest] = useState(0);

  const waSessions = useMemo(
    () =>
      accounts
        .filter((a) => a.platform === "whatsapp" && a.id.startsWith("wa_"))
        .map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          unreadCount: a.unreadCount ?? 0,
        })),
    [accounts],
  );
  const totalUnreadCount = useMemo(
    () =>
      waSessions.reduce(
        (sum, session) => sum + Math.max(0, session.unreadCount ?? 0),
        0,
      ),
    [waSessions],
  );

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    accountConfigsRef.current = accountConfigs;
  }, [accountConfigs]);

  useEffect(() => {
    activePanelIdRef.current = activePanelId;
  }, [activePanelId]);

  const unreadByAccount = useMemo(() => {
    const entries = accounts
      .filter((account) => account.platform === "whatsapp" && account.id.startsWith("wa_"))
      .map((account) => [account.id, account.unreadCount ?? 0] as const);
    return new Map(entries);
  }, [accounts]);

  const settingsAccountSummary = useMemo<ClientAccountDiagnostics>(() => {
    const whatsappAccounts = accounts.filter(
      (account) => account.platform === "whatsapp" && account.id.startsWith("wa_"),
    );

    return {
      total: accounts.length,
      whatsapp: whatsappAccounts.length,
      online: whatsappAccounts.filter((account) => account.status === "online").length,
      offline: whatsappAccounts.filter((account) => account.status === "offline").length,
      expired: whatsappAccounts.filter((account) => account.status === "expired").length,
      openPanels: openPanels.length,
      activePanelId,
    };
  }, [accounts, activePanelId, openPanels.length]);

  const remoteControlAccounts = useMemo<RemoteControlAccountSummary[]>(() => {
    const openPanelIds = new Set(openPanels);
    const now = new Date().toISOString();
    return accounts
      .filter((account) => account.id.length >= 16 && account.id.length <= 128)
      .map((account) => {
        const configuredName = accountConfigs[account.id]?.name;
        const health = waPanelHealth[account.id];
        const displayName = [configuredName || account.name, health?.summary]
          .filter(Boolean)
          .join(" · ");
        const status: RemoteControlAccountSummary["status"] =
          health?.state === "error"
            ? "error"
            : health?.state === "awaiting_qr"
              ? "awaiting_auth"
              : health?.state === "starting"
                ? "initializing"
                : account.status === "online" || health?.state === "authenticated"
                  ? "online"
                  : account.status === "expired"
                    ? "expired"
                    : openPanelIds.has(account.id)
                      ? "awaiting_auth"
                      : "offline";
        const unreadCount = Math.max(0, account.unreadCount ?? 0);
        return {
          accountId: account.id,
          platform: account.platform,
          status,
          occurredAt: health?.occurredAt ?? now,
          reasonCode: health?.reasonCode,
          summary: `${displayName}${unreadCount > 0 ? ` · 未读 ${unreadCount}` : ""}`,
        };
      });
  }, [accountConfigs, accounts, openPanels, waPanelHealth]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const timer = window.setTimeout(() => {
      void updateRemoteControlAccounts(remoteControlAccounts).catch((error) => {
        console.error("[remote_control_update_accounts]", error);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [remoteControlAccounts]);

  const panelTabs = useMemo(
    () =>
      openPanels.map((id, index) => {
        const cfg = accountConfigs[id];
        const account = accounts.find((a) => a.id === id);
        return {
          id,
          name: cfg?.name ?? account?.name ?? `WhatsApp ${index + 1}`,
          status: account?.status,
          unreadCount: unreadByAccount.get(id) ?? 0,
        };
      }),
    [openPanels, accounts, accountConfigs, unreadByAccount],
  );

  const activeConfig = activePanelId
    ? withTranslationCacheSettings(
        accountConfigs[activePanelId],
        translationCacheSettings,
      )
    : undefined;
  const editingAccount = editingAccountId
    ? accounts.find((account) => account.id === editingAccountId)
    : undefined;
  const editingAccountConfig = editingAccountId
    ? withTranslationCacheSettings(
        accountConfigs[editingAccountId] ?? {
          ...defaultAccountConfig,
          name: editingAccount?.name ?? defaultAccountConfig.name,
        },
        translationCacheSettings,
      )
    : undefined;
  const pendingActionAccount = pendingAccountAction
    ? accounts.find((account) => account.id === pendingAccountAction.accountId)
    : undefined;
  const pendingBatchDeleteAccounts = pendingBatchDeleteIds
    .map((accountId) => accounts.find((account) => account.id === accountId))
    .filter((account): account is Account => Boolean(account));
  const accountModalOpen =
    Boolean(editingAccountId)
    || Boolean(pendingAccountAction)
    || pendingBatchDeleteIds.length > 0;
  const panelUiBlocked =
    addModalOpen
    || newAccountFormOpen
    || accountModalOpen
    || accountManagerView !== "closed"
    || accountOverlayOpen;

  const currentView = useMemo(() => viewCopy[view], [view]);

  useEffect(() => {
    panelUiBlockedRef.current = panelUiBlocked;
  }, [panelUiBlocked]);

  const defaultNewAccountName = useMemo(
    () => nextWhatsAppAccountName(accounts, accountConfigs),
    [accounts, accountConfigs],
  );

  // Persist account configs
  useEffect(() => {
    saveAccountConfigs(accountConfigs);
  }, [accountConfigs]);

  useEffect(() => {
    saveTranslationCacheSettings(translationCacheSettings);
  }, [translationCacheSettings]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void onTranslationLogEntry((entry) => {
      setTranslationLogs((current) => [entry, ...current].slice(0, MAX_TRANSLATION_LOGS));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const openPanelIds = new Set(openPanels);
    for (const accountId of Object.keys(panelConfigSyncRef.current)) {
      if (!openPanelIds.has(accountId)) {
        delete panelConfigSyncRef.current[accountId];
      }
    }
    for (const accountId of openPanels) {
      const config = withTranslationCacheSettings(
        accountConfigs[accountId],
        translationCacheSettings,
      );
      const fingerprint = panelConfigFingerprint(config);
      if (panelConfigSyncRef.current[accountId] === fingerprint) continue;
      panelConfigSyncRef.current[accountId] = fingerprint;
      void setWaPanelTranslationConfig(accountId, config).catch((error) => {
        delete panelConfigSyncRef.current[accountId];
        console.error("[wa_panel_translation_config]", error);
      });
    }
  }, [accountConfigs, openPanels, translationCacheSettings]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.title =
      totalUnreadCount > 0
        ? `(${formatUnreadBadge(totalUnreadCount)}) MultiConnect`
        : "MultiConnect";
  }, [totalUnreadCount]);

  useEffect(() => {
    savePanelSession(openPanels, activePanelId);
  }, [openPanels, activePanelId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const nativePanelIds = await listWaPanels();
        const nativePanelSet = new Set(nativePanelIds);
        const saved = loadPanelSession();
        const orderedPanelIds = [
          ...saved.openPanels.filter((id) => nativePanelSet.has(id)),
          ...nativePanelIds.filter((id) => !saved.openPanels.includes(id)),
        ];
        const restoredActiveId =
          saved.activePanelId && nativePanelSet.has(saved.activePanelId)
            ? saved.activePanelId
            : null;

        await Promise.allSettled(
          nativePanelIds
            .filter((accountId) => accountId !== restoredActiveId)
            .map((accountId) => hideWaPanel(accountId)),
        );

        if (cancelled) return;
        setOpenPanels(orderedPanelIds);
        setActivePanelId(restoredActiveId);
      } catch (error) {
        console.error("[wa_panel_restore_after_reload]", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    const refresh = async () => {
      try {
        const status = await getRemoteControlStatus();
        if (active) setConnectionState(mapRemoteStatus(status));
      } catch {
        if (active) setConnectionState("error");
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const saved = accounts.filter(
      (a) => a.platform === "whatsapp" && a.id.startsWith("wa_"),
    );
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(saved));
  }, [accounts]);

  const showUnreadNotification = async (
    accountId: string,
    addedCount: number,
    unreadCount: number,
  ) => {
    const account = accountsRef.current.find((item) => item.id === accountId);
    const accountName =
      accountConfigsRef.current[accountId]?.name
      ?? account?.name
      ?? "WhatsApp 账号";
    const messageCountText = addedCount > 1 ? `${addedCount} 条新消息` : "1 条新消息";

    setToast(`${accountName} 收到 ${messageCountText}`);

    const now = Date.now();
    const lastNotifiedAt = unreadNotificationAtRef.current[accountId] ?? 0;
    if (now - lastNotifiedAt < UNREAD_NOTIFICATION_COOLDOWN_MS) return;
    unreadNotificationAtRef.current[accountId] = now;

    const alreadyViewing =
      activePanelIdRef.current === accountId
      && document.visibilityState === "visible"
      && document.hasFocus();
    if (alreadyViewing) return;

    playUnreadSound();
    if (!("Notification" in window)) return;

    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") return;

      const notification = new Notification(`WhatsApp · ${accountName}`, {
        body: `收到 ${messageCountText}，当前未读 ${unreadCount} 条`,
        tag: `multiconnect-wa-unread-${accountId}`,
      });
      notification.onclick = () => {
        window.focus();
        openAccountFromNotificationRef.current(accountId);
        notification.close();
      };
      window.setTimeout(() => notification.close(), 10000);
    } catch (error) {
      console.warn("[wa_unread_notification]", error);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void onWaPanelState(({ accountId, state, unreadCount, reasonCode, summary }) => {
      const nextUnreadCount = Math.max(0, Math.min(999, unreadCount ?? 0));
      setWaPanelHealth((current) => ({
        ...current,
        [accountId]: {
          state,
          occurredAt: new Date().toISOString(),
          reasonCode,
          summary,
        },
      }));
      const previousUnreadCount = unreadBaselineRef.current[accountId];
      const hasUnreadBaseline = Object.prototype.hasOwnProperty.call(
        unreadBaselineRef.current,
        accountId,
      );
      if (state === "authenticated") {
        if (hasUnreadBaseline && nextUnreadCount > previousUnreadCount) {
          void showUnreadNotification(
            accountId,
            nextUnreadCount - previousUnreadCount,
            nextUnreadCount,
          );
        }
        unreadBaselineRef.current[accountId] = nextUnreadCount;
        setAccounts((current) => {
          if (current.some((a) => a.id === accountId)) {
            return current.map((a) =>
              a.id === accountId
                ? {
                    ...a,
                    status: "online" as const,
                    lastSync: "刚刚",
                    unreadCount: nextUnreadCount,
                  }
                : a,
            );
          }
          const cfg = accountConfigs[accountId];
          return [
            ...current,
            {
              id: accountId,
              platform: "whatsapp" as const,
              name: cfg?.name ?? "WhatsApp 账号",
              handle: "内嵌 WebView Session",
              status: "online" as const,
              messagesToday: 0,
              unreadCount: nextUnreadCount,
              lastSync: "刚刚",
              translationEnabled: true,
              accent: "#23c483",
            },
          ];
        });
        if (!hasUnreadBaseline) {
          setToast("WhatsApp 登录成功，Session 保存在本机独立 Profile。");
        }
      } else if (state === "awaiting_qr" || state === "closed" || state === "error") {
        delete unreadBaselineRef.current[accountId];
        setAccounts((current) =>
          current.map((a) =>
            a.id === accountId
              ? {
                  ...a,
                  status: "expired" as const,
                  unreadCount: 0,
                  lastSync: "需要重新登录",
                }
              : a,
          ),
        );
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [accountConfigs]);

  useLayoutEffect(() => {
    if (
      !isTauriRuntime()
      || !activePanelId
      || panelUiBlocked
    ) {
      return;
    }

    let disposed = false;
    let frame = 0;
    let unlisten: (() => void) | undefined;

    const syncBounds = async () => {
      const host = panelHostRef.current;
      if (!host || disposed) return;
      const rect = host.getBoundingClientRect();
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const x = Math.max(0, Math.min(rect.left, viewportWidth));
      const y = Math.max(0, Math.min(rect.top, viewportHeight));
      const width = Math.max(1, Math.min(rect.width, viewportWidth - x));
      const height = Math.max(1, Math.min(rect.height, viewportHeight - y));
      if (width < 2 || height < 2) return;

      try {
        await setWaPanelBounds(activePanelId, {
          x,
          y,
          width,
          height,
        });
        if (!disposed && !panelUiBlockedRef.current) {
          await showWaPanel(activePanelId);
        }
      } catch (error) {
        console.error("[wa_panel_sync_bounds]", error);
      }
    };

    const scheduleSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        void syncBounds();
      });
    };

    const observer = new ResizeObserver(scheduleSync);
    if (panelHostRef.current) {
      observer.observe(panelHostRef.current);
    }
    observer.observe(document.body);
    window.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);
    document.fonts?.ready.then(scheduleSync).catch(() => undefined);
    void onWaPanelLayoutInvalidated(scheduleSync).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    scheduleSync();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
      unlisten?.();
    };
  }, [
    activePanelId,
    panelUiBlocked,
  ]);

  const hideOpenPanels = useCallback(async () => {
    if (!isTauriRuntime() || openPanels.length === 0) return true;
    ++panelVisibilityEpoch.current;
    const results = await Promise.allSettled(
      openPanels.map((accountId) => hideWaPanel(accountId)),
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      console.error("[wa_panel_hide_open_panels]", failed);
      setToast("无法暂时隐藏 WhatsApp 面板，请关闭标签后重试。");
      return false;
    }
    return true;
  }, [openPanels]);

  // When a modal or account manager opens, temporarily hide all native
  // child webviews so they don't overlap the React-rendered UI.
  useEffect(() => {
    if (!isTauriRuntime() || openPanels.length === 0) return;
    const shouldHidePanels = panelUiBlocked || !activePanelId;
    if (!shouldHidePanels) return;
    ++panelVisibilityEpoch.current;
    void (async () => {
      const results = await Promise.allSettled(
        openPanels.map((accountId) => hideWaPanel(accountId)),
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        console.error("[wa_panel_modal_visibility]", failed);
      }
    })();
  }, [
    panelUiBlocked,
    activePanelId,
    openPanels,
  ]);

  const hideActivePanelBeforeModal = useCallback(async () => {
    return hideOpenPanels();
  }, [hideOpenPanels]);

  const restoreActivePanelAfterModal = useCallback(
    async (accountId = activePanelId) => {
      if (!isTauriRuntime() || !accountId) return;
      const epoch = ++panelVisibilityEpoch.current;
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      if (epoch !== panelVisibilityEpoch.current) return;
      if (panelUiBlockedRef.current) return;
      try {
        const host = panelHostRef.current;
        if (host) {
          const rect = host.getBoundingClientRect();
          const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
          const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
          const x = Math.max(0, Math.min(rect.left, viewportWidth));
          const y = Math.max(0, Math.min(rect.top, viewportHeight));
          const width = Math.max(1, Math.min(rect.width, viewportWidth - x));
          const height = Math.max(1, Math.min(rect.height, viewportHeight - y));
          if (width >= 2 && height >= 2) {
            await setWaPanelBounds(accountId, { x, y, width, height });
          }
        }
        await showWaPanel(accountId);
      } catch (error) {
        console.error("[wa_panel_restore_after_modal]", error);
        setToast("WhatsApp 面板恢复失败，请从左侧账号列表重新打开。");
      }
    },
    [activePanelId],
  );

  const openPanel = useCallback(
    async (accountId: string, config?: AccountConfig) => {
      try {
        const effectiveConfig = withTranslationCacheSettings(
          config,
          translationCacheSettings,
        );
        await openWaPanel(accountId);
        try {
          await setWaPanelTranslationConfig(accountId, effectiveConfig);
          panelConfigSyncRef.current[accountId] = panelConfigFingerprint(effectiveConfig);
        } catch (error) {
          delete panelConfigSyncRef.current[accountId];
          console.error("[wa_panel_initial_translation_config]", error);
        }
        setOpenPanels((prev) =>
          prev.includes(accountId) ? prev : [...prev, accountId],
        );
        setActivePanelId(accountId);

        if (config) {
          setAccountConfigs((prev) => ({ ...prev, [accountId]: config }));
        }

        setAccounts((current) => {
          if (current.some((a) => a.id === accountId)) return current;
          return [
            ...current,
            {
              id: accountId,
              platform: "whatsapp" as const,
              name: effectiveConfig.name ?? "WhatsApp 账号",
              handle: "内嵌 WebView Session",
              status: "offline" as const,
              messagesToday: 0,
              lastSync: "连接中…",
              translationEnabled: true,
              accent: "#23c483",
            },
          ];
        });
      } catch (e) {
        const msg =
          e instanceof Object && "message" in e && typeof e.message === "string"
            ? e.message
            : JSON.stringify(e);
        const code =
          e instanceof Object && "code" in e && typeof e.code === "string"
            ? e.code
            : "WA_PANEL_FAILED";
        console.error("[wa_panel_open]", e);
        setToast(`无法打开面板 ${code}: ${msg}`);
      }
    },
    [translationCacheSettings],
  );

  const selectTab = useCallback(
    async (accountId: string) => {
      if (activePanelId === accountId) return;
      try {
        await showWaPanel(accountId);
        if (panelUiBlockedRef.current) {
          await hideWaPanel(accountId);
          return;
        }
        setActivePanelId(accountId);
      } catch {
        await openPanel(accountId);
      }
    },
    [activePanelId, openPanel],
  );

  const closeTab = useCallback(
    async (accountId: string) => {
      try {
        await closeWaPanel(accountId);
      } catch {
        // best-effort
      }
      setOpenPanels((prev) => prev.filter((id) => id !== accountId));
      setWaPanelHealth((current) => {
        const next = { ...current };
        delete next[accountId];
        return next;
      });
      if (activePanelId === accountId) {
        setActivePanelId(null);
      }
    },
    [activePanelId],
  );

  const closeOtherTabs = useCallback(
    async (accountId: string) => {
      const otherIds = openPanels.filter((id) => id !== accountId);
      await Promise.all(
        otherIds.map((id) => closeWaPanel(id).catch(() => undefined)),
      );
      setOpenPanels([accountId]);
      setWaPanelHealth((current) => {
        const next = { ...current };
        for (const id of otherIds) delete next[id];
        return next;
      });
      setActivePanelId(accountId);
      await showWaPanel(accountId).catch(() => undefined);
    },
    [openPanels],
  );

  const renamePanel = useCallback((accountId: string, name: string) => {
    setAccountConfigs((current) => ({
      ...current,
      [accountId]: {
        ...(current[accountId] ?? defaultAccountConfig),
        name,
      },
    }));
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId ? { ...account, name } : account,
      ),
    );
    setToast("账号备注已更新");
  }, []);

  const handleOpenAccountSettings = useCallback(
    async (accountId: string) => {
      if (!(await hideActivePanelBeforeModal())) return;
      setEditingAccountId(accountId);
    },
    [hideActivePanelBeforeModal],
  );

  const handleSaveAccountSettings = useCallback(
    async (config: AccountConfig) => {
      if (!editingAccountId) return;
      const accountId = editingAccountId;
      setAccountConfigs((current) => ({
        ...current,
        [accountId]: config,
      }));
      setAccounts((current) =>
        current.map((account) =>
          account.id === accountId
            ? { ...account, name: config.name }
            : account,
        ),
      );
      setEditingAccountId(null);
      setToast("账号设置已保存。");
      await restoreActivePanelAfterModal();
    },
    [editingAccountId, restoreActivePanelAfterModal],
  );

  const handleCloseAccountSettings = useCallback(async () => {
    setEditingAccountId(null);
    await restoreActivePanelAfterModal();
  }, [restoreActivePanelAfterModal]);

  const handleRequestAccountAction = useCallback(
    async (type: "relogin" | "delete", accountId: string) => {
      if (!(await hideActivePanelBeforeModal())) return;
      setPendingAccountAction({ type, accountId });
    },
    [hideActivePanelBeforeModal],
  );

  const handleCancelAccountAction = useCallback(async () => {
    if (accountActionBusy) return;
    setPendingAccountAction(null);
    await restoreActivePanelAfterModal();
  }, [accountActionBusy, restoreActivePanelAfterModal]);

  const handleConfirmAccountAction = useCallback(async () => {
    if (!pendingAccountAction || accountActionBusy) return;
    const { accountId, type } = pendingAccountAction;
    const config =
      accountConfigs[accountId] ?? {
        ...defaultAccountConfig,
        name:
          accounts.find((account) => account.id === accountId)?.name
          ?? defaultAccountConfig.name,
      };

    setAccountActionBusy(true);
    try {
      if (type === "relogin") {
        await resetWaPanelSession(accountId);
        setOpenPanels((current) => current.filter((id) => id !== accountId));
        setWaPanelHealth((current) => {
          const next = { ...current };
          delete next[accountId];
          return next;
        });
        if (activePanelId === accountId) setActivePanelId(null);
        setAccounts((current) =>
          current.map((account) =>
            account.id === accountId
              ? {
                  ...account,
                  status: "offline" as const,
                  lastSync: "等待重新登录",
                }
              : account,
          ),
        );
        setPendingAccountAction(null);
        await openPanel(accountId, config);
        setToast("登录状态已清除，请重新扫描二维码。");
      } else {
        await deleteWaAccount(accountId);
        setOpenPanels((current) => current.filter((id) => id !== accountId));
        setWaPanelHealth((current) => {
          const next = { ...current };
          delete next[accountId];
          return next;
        });
        setAccounts((current) =>
          current.filter((account) => account.id !== accountId),
        );
        setAccountConfigs((current) => {
          const next = { ...current };
          delete next[accountId];
          return next;
        });
        setNewAccountCount((count) => Math.max(0, count - 1));
        if (activePanelId === accountId) setActivePanelId(null);
        setPendingAccountAction(null);
        setToast("账号及本地登录数据已删除。");
        if (activePanelId !== accountId) {
          await restoreActivePanelAfterModal();
        }
      }
    } catch (error) {
      console.error("[wa_account_action]", error);
      setToast(
        type === "relogin"
          ? "重新登录失败，本地会话没有被更改。"
          : "删除账号失败，本地账号数据仍然保留。",
      );
    } finally {
      setAccountActionBusy(false);
    }
  }, [
    accountActionBusy,
    accountConfigs,
    accounts,
    activePanelId,
    openPanel,
    pendingAccountAction,
    restoreActivePanelAfterModal,
  ]);

  const handleRequestBatchDelete = useCallback(
    async (accountIds: string[]) => {
      const validIds = Array.from(new Set(accountIds)).filter((accountId) =>
        accounts.some(
          (account) =>
            account.id === accountId
            && account.platform === "whatsapp"
            && account.id.startsWith("wa_"),
        ),
      );
      if (validIds.length === 0) {
        setToast("请先选择要删除的账号。");
        return;
      }
      if (!(await hideActivePanelBeforeModal())) return;
      setPendingBatchDeleteIds(validIds);
    },
    [accounts, hideActivePanelBeforeModal],
  );

  const handleCancelBatchDelete = useCallback(async () => {
    if (accountActionBusy) return;
    setPendingBatchDeleteIds([]);
    await restoreActivePanelAfterModal();
  }, [accountActionBusy, restoreActivePanelAfterModal]);

  const handleConfirmBatchDelete = useCallback(async () => {
    if (pendingBatchDeleteIds.length === 0 || accountActionBusy) return;

    setAccountActionBusy(true);
    const failedIds: string[] = [];
    const deletedIds: string[] = [];

    try {
      for (const accountId of pendingBatchDeleteIds) {
        try {
          await deleteWaAccount(accountId);
          deletedIds.push(accountId);
        } catch (error) {
          failedIds.push(accountId);
          console.error("[wa_account_batch_delete]", accountId, error);
        }
      }

      const deleted = new Set(deletedIds);
      if (deleted.size > 0) {
        setOpenPanels((current) => current.filter((id) => !deleted.has(id)));
        setWaPanelHealth((current) => {
          const next = { ...current };
          for (const accountId of deleted) {
            delete next[accountId];
          }
          return next;
        });
        setAccounts((current) =>
          current.filter((account) => !deleted.has(account.id)),
        );
        setAccountConfigs((current) => {
          const next = { ...current };
          for (const accountId of deleted) {
            delete next[accountId];
          }
          return next;
        });
        setNewAccountCount((count) => Math.max(0, count - deleted.size));
        if (activePanelId && deleted.has(activePanelId)) {
          setActivePanelId(null);
        }
      }

      setPendingBatchDeleteIds([]);
      if (failedIds.length > 0) {
        setToast(`已删除 ${deletedIds.length} 个，${failedIds.length} 个删除失败。`);
      } else {
        setToast(`已删除 ${deletedIds.length} 个账号及本地登录数据。`);
      }

      if (!activePanelId || !deleted.has(activePanelId)) {
        await restoreActivePanelAfterModal();
      }
    } finally {
      setAccountActionBusy(false);
    }
  }, [
    accountActionBusy,
    activePanelId,
    pendingBatchDeleteIds,
    restoreActivePanelAfterModal,
  ]);

  const handleAccountManagerViewChange = useCallback(
    (view: "closed" | "quick" | "drawer") => {
      if (view !== "closed") void hideOpenPanels();
      setAccountManagerView(view);
      if (view === "drawer") setNewAccountCount(0);
    },
    [hideOpenPanels],
  );

  const handleOpenUnreadAccounts = useCallback(() => {
    setUnreadFocusRequest((value) => value + 1);
    handleAccountManagerViewChange("quick");
  }, [handleAccountManagerViewChange]);

  const handleToggleTranslation = (id: string) => {
    setAccounts((current) =>
      current.map((a) =>
        a.id === id ? { ...a, translationEnabled: !a.translationEnabled } : a,
      ),
    );
  };

  const handleReconnect = async (id: string) => {
    if (id.startsWith("wa_")) {
      await openPanel(id, accountConfigs[id]);
      return;
    }
    setAccounts((current) =>
      current.map((a) =>
        a.id === id ? { ...a, status: "online", lastSync: "刚刚" } : a,
      ),
    );
    setToast("已进入演示重连流程；真实平台适配器将在下一阶段接入。");
  };

  const handlePlatformSelect = async (platform: Platform) => {
    setAddModalOpen(false);
    if (platform === "whatsapp") {
      setNewAccountFormOpen(true);
      return;
    }
    setToast(`已选择 ${platform.toUpperCase()}；下一阶段将接入可见授权窗口。`);
  };

  // Called from NewAccountForm "保存"
  const handleNewAccountSave = async (config: AccountConfig) => {
    const previousPanelId = activePanelId;
    ++panelVisibilityEpoch.current;
    setActivePanelId(null);
    const accountId = createWhatsAppAccountId();
    setNewAccountFormOpen(false);
    try {
      await openPanel(accountId, config);
      setNewAccountCount((count) => count + 1);
    } catch {
      if (previousPanelId) {
        setActivePanelId(previousPanelId);
        await restoreActivePanelAfterModal(previousPanelId);
      }
    }
  };

  // Called from "+" button in tab bar — directly open config form
  const handleTabBarAdd = async () => {
    if (!(await hideActivePanelBeforeModal())) return;
    setNewAccountFormOpen(true);
  };

  const handleAddModalClose = async () => {
    setAddModalOpen(false);
    await restoreActivePanelAfterModal();
  };

  const handleNewAccountFormClose = async () => {
    setNewAccountFormOpen(false);
    await restoreActivePanelAfterModal();
  };

  // Update active panel's translation config
  const handleConfigChange = useCallback(
    (newConfig: AccountConfig) => {
      if (!activePanelId) return;
      const accountId = activePanelId;
      setAccountConfigs((prev) => ({ ...prev, [activePanelId]: newConfig }));
      const effectiveConfig = withTranslationCacheSettings(
        newConfig,
        translationCacheSettings,
      );
      const fingerprint = panelConfigFingerprint(effectiveConfig);
      panelConfigSyncRef.current[accountId] = fingerprint;
      void setWaPanelTranslationConfig(accountId, effectiveConfig).catch((error) => {
        delete panelConfigSyncRef.current[accountId];
        console.error("[wa_panel_translation_config_immediate]", error);
        setToast("翻译设置同步失败，请稍后重试。");
      });
    },
    [activePanelId],
  );

  const handleSaveConfig = () => {
    saveRemoteConfig(remoteConfig);
    setToast("Web 控制台连接配置已保存在本机。");
  };

  const handleConnectRemote = async () => {
    setConnectionState("registering");
    saveRemoteConfig(remoteConfig);
    try {
      await updateRemoteControlAccounts(remoteControlAccounts);
      const status = await connectRemoteControl(remoteConfig);
      const state = mapRemoteStatus(status);
      setConnectionState(state);
      setToast(
        state === "connected"
          ? "设备注册和 WSS v1 握手成功。"
          : "控制后端已响应，但常驻通道尚未连接。",
      );
    } catch {
      setConnectionState("error");
      setToast("连接失败，请确认控制后端正在运行并检查 API 地址。");
    }
  };

  const handleDisconnectRemote = async () => {
    try {
      const status = await disconnectRemoteControl();
      setConnectionState(mapRemoteStatus(status));
      setToast("远程控制通道已断开。");
    } catch {
      setConnectionState("error");
      setToast("断开远程控制时发生错误。");
    }
  };

  const handleViewChange = async (next: View) => {
    if (openPanels.length > 0) {
      await Promise.allSettled(
        openPanels.map((accountId) => hideWaPanel(accountId)),
      );
    }
    if (activePanelId) {
      setActivePanelId(null);
    }
    setView(next);
  };

  const handleViewPanel = useCallback(
    async (accountId: string) => {
      if (openPanels.includes(accountId)) {
        await selectTab(accountId);
      } else {
        await openPanel(accountId, accountConfigs[accountId]);
      }
    },
    [openPanels, selectTab, openPanel, accountConfigs],
  );

  useEffect(() => {
    openAccountFromNotificationRef.current = (accountId: string) => {
      void handleViewPanel(accountId);
    };
  }, [handleViewPanel]);

  const topbarTitle = activePanelId ? "WhatsApp Web" : currentView.title;
  const topbarSubtitle = activePanelId
    ? "内嵌会话 · 独立 Session"
    : currentView.subtitle;

  let content;
  if (view === "overview") {
    content = (
      <Overview
        accounts={accounts}
          messages={initialMessages}
          onAddAccount={() => {
            void (async () => {
              if (!(await hideActivePanelBeforeModal())) return;
              setAddModalOpen(true);
            })();
          }}
        onToggleTranslation={handleToggleTranslation}
        onReconnect={handleReconnect}
        onViewMessages={() => setView("messages")}
      />
    );
  } else if (view === "accounts") {
    content = (
      <AccountsView
          accounts={accounts}
          onAddAccount={() => {
            void (async () => {
              if (!(await hideActivePanelBeforeModal())) return;
              setAddModalOpen(true);
            })();
          }}
        onToggleTranslation={handleToggleTranslation}
        onReconnect={handleReconnect}
        onViewPanel={handleViewPanel}
      />
    );
  } else if (view === "messages") {
    content = <MessagesView messages={initialMessages} />;
  } else if (view === "contacts") {
    content = (
      <PlaceholderView
        icon={ContactRound}
        title="联系人模块正在排队"
        description="这里将管理联系人标签、授权来源、同意范围和退订状态。"
      />
    );
  } else if (view === "jobs") {
    content = (
      <PlaceholderView
        icon={SendHorizontal}
        title="任务中心尚未启用"
        description="这里将创建通知任务，并提供审批、限流、暂停和审计能力。"
      />
    );
  } else {
    content = (
      <SettingsView
        config={remoteConfig}
        connectionState={connectionState}
        accountSummary={settingsAccountSummary}
        translationCacheSettings={translationCacheSettings}
        translationLogs={translationLogs}
        onConfigChange={setRemoteConfig}
        onTranslationCacheSettingsChange={(settings) =>
          setTranslationCacheSettings(normalizeTranslationCacheSettings(settings))
        }
        onClearTranslationLogs={() => setTranslationLogs([])}
        onSave={handleSaveConfig}
        onConnect={handleConnectRemote}
        onDisconnect={handleDisconnectRemote}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onChange={handleViewChange}
        waSessions={waSessions}
        activePanelId={activePanelId}
        newAccountCount={newAccountCount}
        onOpenAccountManager={() => handleAccountManagerViewChange("drawer")}
        onOpenUnreadAccounts={handleOpenUnreadAccounts}
        onAddAccount={() => void handleTabBarAdd()}
        onOverlayOpenChange={setAccountOverlayOpen}
      />
      <main className={activePanelId ? "main-shell panel-active" : "main-shell"}>
        <Topbar title={topbarTitle} subtitle={topbarSubtitle} />

        <PanelTabBar
          tabs={panelTabs}
          accounts={waSessions}
          activeId={activePanelId}
          managerView={accountManagerView}
          unreadFocusRequest={unreadFocusRequest}
          onManagerViewChange={handleAccountManagerViewChange}
          onOverlayOpenChange={setAccountOverlayOpen}
          onSelect={selectTab}
          onRename={renamePanel}
          onEditSettings={(id) => void handleOpenAccountSettings(id)}
          onRelogin={(id) => void handleRequestAccountAction("relogin", id)}
          onDelete={(id) => void handleRequestAccountAction("delete", id)}
          onBatchDelete={(ids) => void handleRequestBatchDelete(ids)}
          onClose={closeTab}
          onCloseOthers={(id) => void closeOtherTabs(id)}
          onAdd={() => void handleTabBarAdd()}
        />

        {activePanelId && activeConfig && (
          <TranslationBar config={activeConfig} onChange={handleConfigChange} />
        )}

        {!activePanelId && (
          <div className="content-shell">{content}</div>
        )}

        {activePanelId && (
          <div className="panel-placeholder" ref={panelHostRef}>
            <div className="panel-placeholder-inner">
              WhatsApp Web 已在此区域加载
            </div>
          </div>
        )}
      </main>

      <AddAccountModal
        open={addModalOpen}
        onClose={() => void handleAddModalClose()}
        onSelect={(p) => void handlePlatformSelect(p)}
      />

      <NewAccountForm
        open={newAccountFormOpen}
        defaultName={defaultNewAccountName}
        onClose={() => void handleNewAccountFormClose()}
        onSave={(config) => void handleNewAccountSave(config)}
      />

      {editingAccountId && editingAccountConfig && (
        <AccountSettingsModal
          open
          accountId={editingAccountId}
          config={editingAccountConfig}
          onClose={() => void handleCloseAccountSettings()}
          onSave={(config) => void handleSaveAccountSettings(config)}
        />
      )}

      {pendingAccountAction && pendingActionAccount && (
        <AccountActionDialog
          open
          busy={accountActionBusy}
          tone={pendingAccountAction.type === "delete" ? "danger" : "warning"}
          title={
            pendingAccountAction.type === "delete"
              ? `删除“${pendingActionAccount.name}”？`
              : `重新登录“${pendingActionAccount.name}”？`
          }
          description={
            pendingAccountAction.type === "delete"
              ? "该账号的本地 Session、备注和翻译配置都会被永久删除，此操作无法撤销。"
              : "当前本地 Session 将被清除，随后需要使用手机重新扫描二维码。备注和翻译设置会保留。"
          }
          confirmLabel={
            pendingAccountAction.type === "delete"
              ? "确认删除"
              : "清除并重新登录"
          }
          onCancel={() => void handleCancelAccountAction()}
          onConfirm={() => void handleConfirmAccountAction()}
        />
      )}

      {pendingBatchDeleteAccounts.length > 0 && (
        <AccountActionDialog
          open
          busy={accountActionBusy}
          tone="danger"
          title={`删除 ${pendingBatchDeleteAccounts.length} 个账号？`}
          description={`将永久删除 ${pendingBatchDeleteAccounts
            .slice(0, 3)
            .map((account) => `“${account.name}”`)
            .join("、")}${
            pendingBatchDeleteAccounts.length > 3
              ? ` 等 ${pendingBatchDeleteAccounts.length} 个账号`
              : ""
          } 的本地 Session、备注和翻译配置，此操作无法撤销。`}
          confirmLabel="确认批量删除"
          onCancel={() => void handleCancelBatchDelete()}
          onConfirm={() => void handleConfirmBatchDelete()}
        />
      )}

      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </div>
  );
}

export default App;
