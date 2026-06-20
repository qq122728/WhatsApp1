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
} from "./lib/remote-api";
import {
  closeWaPanel,
  hideWaPanel,
  onWaPanelLayoutInvalidated,
  onWaPanelState,
  openWaPanel,
  setWaPanelBounds,
  showWaPanel,
} from "./lib/panels";
import { createWhatsAppAccountId } from "./lib/whatsapp";
import type {
  Account,
  AccountConfig,
  Platform,
  RemoteConnectionState,
} from "./types";
import { defaultAccountConfig } from "./types";
import { AccountsView } from "./views/AccountsView";
import { MessagesView } from "./views/MessagesView";
import { Overview } from "./views/Overview";
import { PlaceholderView } from "./views/PlaceholderView";
import { SettingsView } from "./views/SettingsView";

const SAVED_ACCOUNTS_KEY = "multiconnect.saved-accounts";
const ACCOUNT_CONFIGS_KEY = "multiconnect.account-configs";

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    const saved = raw ? (JSON.parse(raw) as Account[]) : [];
    const restored = saved
      .filter(
        (account) =>
          account.platform === "whatsapp" &&
          account.id.startsWith("wa_") &&
          // Only restore accounts that were online at some point (real sessions)
          account.status === "online",
      )
      .map((account) => ({
        ...account,
        status: "offline" as const,
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
  const [view, setView] = useState<View>("overview");
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newAccountFormOpen, setNewAccountFormOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [remoteConfig, setRemoteConfig] = useState(loadRemoteConfig);
  const [connectionState, setConnectionState] =
    useState<RemoteConnectionState>("not_configured");

  const [openPanels, setOpenPanels] = useState<string[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [accountManagerView, setAccountManagerView] = useState<
    "closed" | "quick" | "drawer"
  >("closed");
  const [accountOverlayOpen, setAccountOverlayOpen] = useState(false);
  const [newAccountCount, setNewAccountCount] = useState(0);
  const [accountConfigs, setAccountConfigs] = useState<Record<string, AccountConfig>>(loadAccountConfigs);
  const panelVisibilityEpoch = useRef(0);
  const panelHostRef = useRef<HTMLDivElement>(null);

  const waSessions = useMemo(
    () =>
      accounts
        .filter((a) => a.platform === "whatsapp" && a.id.startsWith("wa_"))
        .map((a) => ({ id: a.id, name: a.name, status: a.status })),
    [accounts],
  );

  const panelTabs = useMemo(
    () =>
      openPanels.map((id, index) => {
        const cfg = accountConfigs[id];
        const account = accounts.find((a) => a.id === id);
        return {
          id,
          name: cfg?.name ?? account?.name ?? `WhatsApp ${index + 1}`,
          status: account?.status,
        };
      }),
    [openPanels, accounts, accountConfigs],
  );

  const activeConfig = activePanelId
    ? accountConfigs[activePanelId] ?? defaultAccountConfig
    : undefined;

  const currentView = useMemo(() => viewCopy[view], [view]);

  // Persist account configs
  useEffect(() => {
    saveAccountConfigs(accountConfigs);
  }, [accountConfigs]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void onWaPanelState(({ accountId, state }) => {
      if (state === "authenticated") {
        setAccounts((current) => {
          if (current.some((a) => a.id === accountId)) {
            return current.map((a) =>
              a.id === accountId
                ? { ...a, status: "online" as const, lastSync: "刚刚" }
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
              lastSync: "刚刚",
              translationEnabled: true,
              accent: "#23c483",
            },
          ];
        });
        setToast("WhatsApp 登录成功，Session 保存在本机独立 Profile。");
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
      || addModalOpen
      || newAccountFormOpen
      || accountManagerView !== "closed"
      || accountOverlayOpen
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
      if (rect.width < 1 || rect.height < 1) return;

      try {
        await setWaPanelBounds(activePanelId, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
        if (!disposed) {
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
    window.addEventListener("resize", scheduleSync);
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
      unlisten?.();
    };
  }, [
    activePanelId,
    addModalOpen,
    newAccountFormOpen,
    accountManagerView,
    accountOverlayOpen,
  ]);

  // When a modal opens, temporarily hide the active panel so the native
  // child webview doesn't overlap the React-rendered modal.
  useEffect(() => {
    if (!isTauriRuntime() || !activePanelId) return;
    ++panelVisibilityEpoch.current;
    const anyModalOpen =
      addModalOpen
      || newAccountFormOpen
      || accountManagerView !== "closed"
      || accountOverlayOpen;
    void (async () => {
      try {
        if (anyModalOpen) {
          await hideWaPanel(activePanelId);
        }
      } catch (error) {
        console.error("[wa_panel_modal_visibility]", error);
      }
    })();
  }, [
    addModalOpen,
    newAccountFormOpen,
    accountManagerView,
    accountOverlayOpen,
    activePanelId,
  ]);

  const hideActivePanelBeforeModal = useCallback(async () => {
    if (!isTauriRuntime() || !activePanelId) return true;
    ++panelVisibilityEpoch.current;
    try {
      await hideWaPanel(activePanelId);
      return true;
    } catch (error) {
      console.error("[wa_panel_hide_before_modal]", error);
      setToast("无法暂时隐藏 WhatsApp 面板，请关闭标签后重试。");
      return false;
    }
  }, [activePanelId]);

  const restoreActivePanelAfterModal = useCallback(
    async (accountId = activePanelId) => {
      if (!isTauriRuntime() || !accountId) return;
      const epoch = ++panelVisibilityEpoch.current;
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      if (epoch !== panelVisibilityEpoch.current) return;
      try {
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
        await openWaPanel(accountId);
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
              name: config?.name ?? "WhatsApp 账号",
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
    [],
  );

  const selectTab = useCallback(
    async (accountId: string) => {
      if (activePanelId === accountId) return;
      try {
        await showWaPanel(accountId);
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

  const handleAccountManagerViewChange = useCallback(
    (view: "closed" | "quick" | "drawer") => {
      setAccountManagerView(view);
      if (view === "drawer") setNewAccountCount(0);
    },
    [],
  );

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
      setAccountConfigs((prev) => ({ ...prev, [activePanelId]: newConfig }));
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
    if (activePanelId) {
      try {
        await hideWaPanel(activePanelId);
      } catch {
        // best-effort
      }
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
        onConfigChange={setRemoteConfig}
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
          onManagerViewChange={handleAccountManagerViewChange}
          onOverlayOpenChange={setAccountOverlayOpen}
          onSelect={selectTab}
          onRename={renamePanel}
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
        onClose={() => void handleNewAccountFormClose()}
        onSave={(config) => void handleNewAccountSave(config)}
      />

      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </div>
  );
}

export default App;
