import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Pin,
  Plus,
  Search,
  Settings,
  X,
  XCircle,
} from "lucide-react";
import { PlatformIcon } from "./PlatformIcon";

const MAX_VISIBLE_TABS = 7;
const PINNED_TABS_KEY = "multiconnect.pinned-panel-tabs";

type ManagerView = "closed" | "quick" | "drawer";
type AccountFilter = "all" | "online" | "attention" | "pinned";

interface PanelAccount {
  id: string;
  name: string;
  status?: "online" | "offline" | "expired";
}

interface PanelTabBarProps {
  tabs: PanelAccount[];
  accounts: PanelAccount[];
  activeId: string | null;
  managerView: ManagerView;
  onManagerViewChange: (view: ManagerView) => void;
  onOverlayOpenChange?: (open: boolean) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onAdd: () => void;
}

function loadPinnedTabs(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PINNED_TABS_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function PanelTabBar({
  tabs,
  accounts,
  activeId,
  managerView,
  onManagerViewChange,
  onOverlayOpenChange,
  onSelect,
  onRename,
  onClose,
  onCloseOthers,
  onAdd,
}: PanelTabBarProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinnedTabs);
  const [visibleLimit, setVisibleLimit] = useState(MAX_VISIBLE_TABS);
  const [contextId, setContextId] = useState<string | null>(null);
  const [contextPoint, setContextPoint] = useState({ x: 0, y: 0 });
  const [renameId, setRenameId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bar = rootRef.current;
    if (!bar || tabs.length === 0) return;
    const updateLimit = () => {
      const available = Math.max(0, bar.getBoundingClientRect().width - 155);
      setVisibleLimit(
        Math.max(3, Math.min(MAX_VISIBLE_TABS, Math.floor(available / 145))),
      );
    };
    const observer = new ResizeObserver(updateLimit);
    observer.observe(bar);
    updateLimit();
    return () => observer.disconnect();
  }, [tabs.length]);

  useEffect(() => {
    const validIds = new Set(accounts.map((account) => account.id));
    setPinnedIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(next));
      return next;
    });
  }, [accounts]);

  useEffect(() => {
    if (!renameId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renameId]);

  useEffect(() => {
    if (managerView === "closed") {
      setQuery("");
      setFilter("all");
    }
  }, [managerView]);

  const overlayOpen =
    managerView !== "closed" || Boolean(contextId) || Boolean(renameId);

  useEffect(() => {
    onOverlayOpenChange?.(overlayOpen);
  }, [overlayOpen, onOverlayOpenChange]);

  useEffect(() => {
    if (!overlayOpen) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onManagerViewChange("closed");
        setContextId(null);
        setRenameId(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onManagerViewChange("closed");
        setContextId(null);
        setRenameId(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [overlayOpen, onManagerViewChange]);

  const orderItems = (items: PanelAccount[]) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const orderedIds = [...pinnedIds, ...items.map((item) => item.id)];
    const seen = new Set<string>();
    return orderedIds.flatMap((id) => {
      if (seen.has(id)) return [];
      seen.add(id);
      const item = byId.get(id);
      return item ? [item] : [];
    });
  };

  const orderedTabs = useMemo(
    () => orderItems(tabs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, pinnedIds],
  );
  const orderedAccounts = useMemo(
    () => orderItems(accounts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, pinnedIds],
  );
  const visibleTabs = orderedTabs.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, tabs.length - visibleTabs.length);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingAccounts = orderedAccounts.filter((account) => {
    const matchesQuery =
      !normalizedQuery
      || account.name.toLocaleLowerCase().includes(normalizedQuery)
      || account.id.toLocaleLowerCase().includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (filter === "online") return account.status === "online";
    if (filter === "attention") return account.status !== "online";
    if (filter === "pinned") return pinnedIds.includes(account.id);
    return true;
  });
  const quickAccounts = matchingAccounts.slice(0, 8);
  const contextAccount = accounts.find((account) => account.id === contextId);
  const renameAccount = accounts.find((account) => account.id === renameId);
  const onlineCount = accounts.filter((account) => account.status === "online").length;
  const attentionCount = accounts.length - onlineCount;

  if (
    tabs.length === 0
    && managerView === "closed"
    && !contextId
    && !renameId
  ) {
    return null;
  }

  const closeOverlays = () => {
    onManagerViewChange("closed");
    setContextId(null);
    setRenameId(null);
  };

  const togglePinned = (id: string) => {
    setPinnedIds((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [id, ...current];
      localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const openContextMenu = (
    event: React.MouseEvent,
    id: string,
    keepManager = false,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!keepManager) onManagerViewChange("closed");
    setRenameId(null);
    setContextPoint({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 190),
    });
    setContextId(id);
  };

  const openGearMenu = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setRenameId(null);
    setContextPoint({
      x: Math.max(12, Math.min(rect.left - 170, window.innerWidth - 180)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 190),
    });
    setContextId(id);
  };

  const openRename = (account: PanelAccount) => {
    setContextId(null);
    setRenameId(account.id);
    setDraftName(account.name);
  };

  const saveRename = () => {
    if (!renameAccount) return;
    const name = draftName.trim();
    if (name && name !== renameAccount.name) {
      onRename(renameAccount.id, name);
    }
    setRenameId(null);
  };

  const selectAccount = (id: string) => {
    closeOverlays();
    onSelect(id);
  };

  return (
    <div
      className={tabs.length > 0 ? "panel-tab-bar" : "panel-tab-manager-host"}
      ref={rootRef}
    >
      {tabs.length > 0 && (
        <>
          <div className="panel-tabs-visible" role="tablist">
            {visibleTabs.map((tab) => {
              const active = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  className={`panel-tab${active ? " active" : ""}`}
                  role="tab"
                  aria-selected={active}
                  tabIndex={0}
                  title={`${tab.name} · 右键管理`}
                  onClick={() => onSelect(tab.id)}
                  onContextMenu={(event) => openContextMenu(event, tab.id)}
                  onKeyDown={(event) => {
                    if (!["Enter", " "].includes(event.key)) return;
                    event.preventDefault();
                    onSelect(tab.id);
                  }}
                >
                  <span className="panel-tab-icon">
                    <PlatformIcon platform="whatsapp" size={13} />
                  </span>
                  <span className="panel-tab-label">{tab.name}</span>
                  <button
                    type="button"
                    className="panel-tab-close"
                    aria-label={`关闭 ${tab.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              className={managerView === "quick" ? "panel-tab-more active" : "panel-tab-more"}
              aria-expanded={managerView === "quick"}
              onClick={() =>
                onManagerViewChange(managerView === "quick" ? "closed" : "quick")
              }
            >
              更多 {hiddenCount}
              <ChevronDown size={13} />
            </button>
          )}

          <button
            className="panel-tab-add"
            onClick={() => {
              closeOverlays();
              onAdd();
            }}
            aria-label="添加账号"
          >
            <Plus size={14} />
          </button>
        </>
      )}

      {managerView === "quick" && (
        <section className="account-quick-switcher" aria-label="快速切换账号">
          <div className="account-quick-header">
            <strong>快速切换</strong>
            <span>{accounts.length} 个账号</span>
          </div>
          <label className="account-switcher-search">
            <Search size={15} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索账号"
            />
          </label>
          <div className="account-quick-list">
            {quickAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={account.id === activeId ? "active" : ""}
                onClick={() => selectAccount(account.id)}
              >
                <span className="panel-tab-icon">
                  <PlatformIcon platform="whatsapp" size={13} />
                </span>
                <span>{account.name}</span>
                <i className={`account-status ${account.status ?? "offline"}`} />
              </button>
            ))}
            {quickAccounts.length === 0 && (
              <div className="account-switcher-empty">没有找到匹配的账号</div>
            )}
          </div>
          <button
            type="button"
            className="account-quick-more"
            onClick={() => onManagerViewChange("drawer")}
          >
            查看全部账号
            <ChevronRight size={14} />
          </button>
        </section>
      )}

      {managerView === "drawer" && (
        <>
          <button
            type="button"
            className="account-drawer-backdrop"
            aria-label="关闭账号管理"
            onClick={() => onManagerViewChange("closed")}
          />
          <aside className="account-drawer" aria-label="账号管理">
            <header className="account-drawer-header">
              <div>
                <strong>账号管理</strong>
                <span>
                  共 {accounts.length} 个 · 在线 {onlineCount}
                  {attentionCount > 0 ? ` · 待处理 ${attentionCount}` : ""}
                </span>
              </div>
              <div className="account-drawer-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    closeOverlays();
                    onAdd();
                  }}
                >
                  <Plus size={14} />
                  添加账号
                </button>
                <button
                  type="button"
                  aria-label="关闭账号管理"
                  onClick={() => onManagerViewChange("closed")}
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            <label className="account-drawer-search">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索备注或账号 ID"
              />
            </label>

            <div className="account-drawer-filters">
              {(
                [
                  ["all", `全部 ${accounts.length}`],
                  ["online", `在线 ${onlineCount}`],
                  ["attention", `待处理 ${attentionCount}`],
                  ["pinned", `置顶 ${pinnedIds.length}`],
                ] as Array<[AccountFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="account-drawer-list">
              {matchingAccounts.map((account) => {
                const active = account.id === activeId;
                const pinned = pinnedIds.includes(account.id);
                return (
                  <article
                    key={account.id}
                    className={`account-drawer-card${active ? " active" : ""}`}
                  >
                    <button
                      type="button"
                      className="account-drawer-select"
                      onClick={() => selectAccount(account.id)}
                    >
                      <span className="account-drawer-icon">
                        <PlatformIcon platform="whatsapp" size={17} />
                      </span>
                      <span className="account-drawer-copy">
                        <strong>{account.name}</strong>
                        <small>
                          {active ? "当前账号" : account.id}
                          {pinned ? " · 已置顶" : ""}
                        </small>
                      </span>
                      <span className={`account-state-label ${account.status ?? "offline"}`}>
                        {account.status === "online"
                          ? "在线"
                          : account.status === "expired"
                            ? "需登录"
                            : "离线"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="account-card-settings"
                      aria-label={`管理 ${account.name}`}
                      title="管理账号"
                      onClick={(event) => openGearMenu(event, account.id)}
                    >
                      <Settings size={15} />
                    </button>
                  </article>
                );
              })}
              {matchingAccounts.length === 0 && (
                <div className="account-switcher-empty">没有找到匹配的账号</div>
              )}
            </div>
          </aside>
        </>
      )}

      {contextAccount && (
        <div
          className="tab-context-menu"
          role="menu"
          style={{ left: contextPoint.x, top: contextPoint.y }}
        >
          <button type="button" role="menuitem" onClick={() => openRename(contextAccount)}>
            <Edit3 size={14} />
            编辑备注
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              togglePinned(contextAccount.id);
              setContextId(null);
            }}
          >
            <Pin size={14} />
            {pinnedIds.includes(contextAccount.id) ? "取消置顶" : "置顶账号"}
          </button>
          {!tabs.some((tab) => tab.id === contextAccount.id) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => selectAccount(contextAccount.id)}
            >
              <ChevronRight size={14} />
              打开账号
            </button>
          )}
          {tabs.some((tab) => tab.id === contextAccount.id) && (
            <>
              <div className="context-menu-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose(contextAccount.id);
                  setContextId(null);
                }}
              >
                <X size={14} />
                关闭标签
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseOthers(contextAccount.id);
                    setContextId(null);
                  }}
                >
                  <XCircle size={14} />
                  关闭其他标签
                </button>
              )}
            </>
          )}
        </div>
      )}

      {renameAccount && (
        <form
          className="tab-rename-popover"
          style={{ left: contextPoint.x, top: contextPoint.y }}
          onSubmit={(event) => {
            event.preventDefault();
            saveRename();
          }}
        >
          <strong>编辑账号备注</strong>
          <input
            ref={renameInputRef}
            maxLength={32}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
          />
          <div>
            <button type="button" onClick={() => setRenameId(null)}>取消</button>
            <button type="submit" className="primary">保存</button>
          </div>
        </form>
      )}
    </div>
  );
}
