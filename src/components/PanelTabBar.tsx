import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { PlatformIcon } from "./PlatformIcon";

const PINNED_TABS_KEY = "multiconnect.pinned-panel-tabs";

type ManagerView = "closed" | "quick" | "drawer";
type AccountFilter = "all" | "online" | "attention" | "pinned" | "unread";

interface PanelAccount {
  id: string;
  name: string;
  status?: "online" | "offline" | "expired";
  unreadCount?: number;
}

interface PanelTabBarProps {
  tabs: PanelAccount[];
  accounts: PanelAccount[];
  activeId: string | null;
  managerView: ManagerView;
  unreadFocusRequest?: number;
  onManagerViewChange: (view: ManagerView) => void;
  onOverlayOpenChange?: (open: boolean) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onEditSettings: (id: string) => void;
  onRelogin: (id: string) => void;
  onDelete: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
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
  unreadFocusRequest = 0,
  onManagerViewChange,
  onOverlayOpenChange,
  onSelect,
  onRename,
  onEditSettings,
  onRelogin,
  onDelete,
  onBatchDelete,
  onClose,
  onCloseOthers,
  onAdd,
}: PanelTabBarProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinnedTabs);
  const [contextId, setContextId] = useState<string | null>(null);
  const [contextPoint, setContextPoint] = useState({ x: 0, y: 0 });
  const [renameId, setRenameId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const validIds = new Set(accounts.map((account) => account.id));
    setPinnedIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedIds((current) => current.filter((id) => validIds.has(id)));
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
    if (managerView !== "drawer") {
      setSelectionMode(false);
      setSelectedIds([]);
    }
  }, [managerView]);

  useEffect(() => {
    if (!unreadFocusRequest || managerView === "closed") return;
    setQuery("");
    setFilter("unread");
  }, [managerView, unreadFocusRequest]);

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

  const orderAccountItems = (items: PanelAccount[]) =>
    orderItems(items)
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const unreadA = a.item.unreadCount ?? 0;
        const unreadB = b.item.unreadCount ?? 0;
        if (unreadA > 0 || unreadB > 0) {
          if (unreadA !== unreadB) return unreadB - unreadA;
          return a.index - b.index;
        }
        return a.index - b.index;
      })
      .map(({ item }) => item);

  const orderedAccounts = useMemo(
    () => orderAccountItems(accounts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, pinnedIds],
  );
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
    if (filter === "unread") return (account.unreadCount ?? 0) > 0;
    return true;
  });
  const quickAccounts = matchingAccounts.slice(0, 40);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const matchingIds = matchingAccounts.map((account) => account.id);
  const selectedMatchingCount = matchingIds.filter((id) =>
    selectedSet.has(id),
  ).length;
  const selectedOpenIds = selectedIds.filter((id) =>
    tabs.some((tab) => tab.id === id),
  );
  const contextAccount = accounts.find((account) => account.id === contextId);
  const renameAccount = accounts.find((account) => account.id === renameId);
  const activeAccount = accounts.find((account) => account.id === activeId);
  const onlineCount = accounts.filter((account) => account.status === "online").length;
  const attentionCount = accounts.length - onlineCount;
  const unreadAccountCount = accounts.filter((account) => (account.unreadCount ?? 0) > 0).length;
  const totalUnreadCount = accounts.reduce(
    (sum, account) => sum + Math.max(0, account.unreadCount ?? 0),
    0,
  );
  const quickFilterOptions: Array<[AccountFilter, string]> = [
    ["all", `全部 ${accounts.length}`],
    ["online", `在线 ${onlineCount}`],
    ...(attentionCount > 0
      ? ([["attention", `待处理 ${attentionCount}`]] as Array<[AccountFilter, string]>)
      : []),
    ...(pinnedIds.length > 0
      ? ([["pinned", `置顶 ${pinnedIds.length}`]] as Array<[AccountFilter, string]>)
      : []),
    ...(unreadAccountCount > 0
      ? ([["unread", `有未读 ${unreadAccountCount}`]] as Array<[AccountFilter, string]>)
      : []),
  ];
  const formatUnread = (value?: number) => {
    const count = Math.max(0, value ?? 0);
    if (!count) return "";
    return count > 99 ? "99+" : String(count);
  };

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

  const openGearMenu = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setRenameId(null);
    setContextPoint({
      x: Math.max(12, Math.min(rect.left - 170, window.innerWidth - 180)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 330),
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

  const toggleSelectionMode = () => {
    setContextId(null);
    setRenameId(null);
    setSelectionMode((current) => {
      const next = !current;
      if (!next) setSelectedIds([]);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const selectAllMatching = () => {
    setSelectedIds((current) =>
      Array.from(new Set([...current, ...matchingIds])),
    );
  };

  const clearSelection = () => setSelectedIds([]);

  const setSelectedPinned = (pinned: boolean) => {
    if (selectedIds.length === 0) return;
    setPinnedIds((current) => {
      const selected = new Set(selectedIds);
      const next = pinned
        ? Array.from(new Set([...selectedIds, ...current]))
        : current.filter((id) => !selected.has(id));
      localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const closeSelectedTabs = () => {
    if (selectedOpenIds.length === 0) return;
    selectedOpenIds.forEach((id) => onClose(id));
    const closed = new Set(selectedOpenIds);
    setSelectedIds((current) => current.filter((id) => !closed.has(id)));
  };

  const deleteSelectedAccounts = () => {
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds];
    closeOverlays();
    setSelectionMode(false);
    setSelectedIds([]);
    onBatchDelete(ids);
  };

  return (
    <div
      className={
        tabs.length > 0
          ? `panel-tab-bar panel-account-switcher${managerView === "quick" ? " expanded" : ""}`
          : "panel-tab-manager-host"
      }
      ref={rootRef}
    >
      {tabs.length > 0 && managerView === "closed" && (
        <section className="account-quick-collapsed" aria-label="账号快速切换">
          <button
            type="button"
            className="account-quick-collapsed-main"
            onClick={() => onManagerViewChange("quick")}
          >
            <span className="account-quick-collapsed-icon">
              <PlatformIcon platform="whatsapp" size={17} />
            </span>
            <span>
              <strong>快速切换</strong>
              <small>
                {activeAccount ? `当前 ${activeAccount.name} · ` : ""}
                {accounts.length} 个账号 · 在线 {onlineCount}
                {totalUnreadCount > 0 ? ` · 未读 ${totalUnreadCount}` : ""}
              </small>
            </span>
          </button>
          <div className="account-quick-collapsed-actions">
            <button
              type="button"
              className="account-quick-expand"
              onClick={() => onManagerViewChange("quick")}
            >
              展开
              <ChevronDown size={13} />
            </button>
            <button
              className="account-quick-add"
              onClick={() => {
                closeOverlays();
                onAdd();
              }}
              aria-label="添加账号"
            >
              <Plus size={14} />
            </button>
          </div>
        </section>
      )}

      {managerView === "quick" && (
        <section className="account-quick-switcher account-quick-switcher-inline" aria-label="快速切换账号">
          <div className="account-quick-header">
            <div className="account-quick-title">
              <strong>快速切换</strong>
              <span>
                {accounts.length} 个账号 · 显示 {matchingAccounts.length} 个匹配
                {totalUnreadCount > 0 ? ` · 未读 ${totalUnreadCount}` : ""}
              </span>
            </div>
            <label className="account-switcher-search account-quick-search">
              <Search size={15} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索账号"
              />
            </label>
            <div className="account-quick-filters" aria-label="账号筛选">
              {quickFilterOptions.map(([value, label]) => (
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
            <button
              type="button"
              className="account-quick-more"
              onClick={() => onManagerViewChange("drawer")}
            >
              查看全部
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              className="account-quick-collapse"
              onClick={() => onManagerViewChange("closed")}
            >
              收起
              <ChevronDown size={13} />
            </button>
          </div>
          <div className="account-quick-list">
            {quickAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={account.id === activeId ? "active" : ""}
                onClick={() => selectAccount(account.id)}
              >
                <span className="account-quick-icon">
                  <PlatformIcon platform="whatsapp" size={26} />
                  <i className={`account-status ${account.status ?? "offline"}`} />
                </span>
                <span>{account.name}</span>
                {formatUnread(account.unreadCount) && (
                  <b className="account-inline-unread">
                    {formatUnread(account.unreadCount)}
                  </b>
                )}
              </button>
            ))}
            {quickAccounts.length === 0 && (
              <div className="account-switcher-empty">没有找到匹配的账号</div>
            )}
          </div>
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
                  {totalUnreadCount > 0 ? ` · 未读 ${totalUnreadCount}` : ""}
                </span>
              </div>
              <div className="account-drawer-actions">
                <button
                  type="button"
                  className={selectionMode ? "active" : ""}
                  onClick={toggleSelectionMode}
                >
                  {selectionMode ? "退出多选" : "多选管理"}
                </button>
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
                  ["unread", `有未读 ${unreadAccountCount}`],
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

            {selectionMode && (
              <div className="account-bulk-bar">
                <div className="account-bulk-summary">
                  <strong>已选 {selectedIds.length} 个</strong>
                  <span>
                    当前筛选已选 {selectedMatchingCount}/{matchingAccounts.length}
                  </span>
                </div>
                <div className="account-bulk-actions">
                  <button
                    type="button"
                    disabled={matchingAccounts.length === 0}
                    onClick={selectAllMatching}
                  >
                    全选当前
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={clearSelection}
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    disabled={selectedOpenIds.length === 0}
                    onClick={closeSelectedTabs}
                  >
                    关闭标签 {selectedOpenIds.length}
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setSelectedPinned(true)}
                  >
                    置顶
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setSelectedPinned(false)}
                  >
                    取消置顶
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={selectedIds.length === 0}
                    onClick={deleteSelectedAccounts}
                  >
                    删除账号
                  </button>
                </div>
              </div>
            )}

            <div className="account-drawer-list">
              {matchingAccounts.map((account) => {
                const active = account.id === activeId;
                const pinned = pinnedIds.includes(account.id);
                const selected = selectedSet.has(account.id);
                return (
                  <article
                    key={account.id}
                    className={`account-drawer-card${active ? " active" : ""}${
                      selectionMode ? " selecting" : ""
                    }${selected ? " selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="account-drawer-select"
                      aria-pressed={selectionMode ? selected : undefined}
                      onClick={() =>
                        selectionMode
                          ? toggleSelected(account.id)
                          : selectAccount(account.id)
                      }
                    >
                      {selectionMode && (
                        <span
                          className={`account-select-checkbox${
                            selected ? " checked" : ""
                          }`}
                          aria-hidden="true"
                        >
                          {selected ? "✓" : ""}
                        </span>
                      )}
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
                      {formatUnread(account.unreadCount) && (
                        <span className="account-drawer-unread">
                          {formatUnread(account.unreadCount)}
                        </span>
                      )}
                      <span className={`account-state-label ${account.status ?? "offline"}`}>
                        {account.status === "online"
                          ? "在线"
                          : account.status === "expired"
                            ? "需登录"
                            : "离线"}
                      </span>
                    </button>
                    {!selectionMode && (
                      <button
                        type="button"
                        className="account-card-settings"
                        aria-label={`管理 ${account.name}`}
                        title="管理账号"
                        onClick={(event) => openGearMenu(event, account.id)}
                      >
                        <Settings size={15} />
                      </button>
                    )}
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
              closeOverlays();
              onEditSettings(contextAccount.id);
            }}
          >
            <SlidersHorizontal size={14} />
            翻译与账号设置
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
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeOverlays();
              onRelogin(contextAccount.id);
            }}
          >
            <RotateCcw size={14} />
            重新登录
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
          <div className="context-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              closeOverlays();
              onDelete(contextAccount.id);
            }}
          >
            <Trash2 size={14} />
            删除账号
          </button>
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
