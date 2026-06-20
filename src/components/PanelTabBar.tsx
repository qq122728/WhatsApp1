import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pin, Plus, Search, X } from "lucide-react";
import { PlatformIcon } from "./PlatformIcon";

const MAX_VISIBLE_TABS = 7;
const PINNED_TABS_KEY = "multiconnect.pinned-panel-tabs";

interface PanelTab {
  id: string;
  name: string;
  status?: "online" | "offline" | "expired";
}

interface PanelTabBarProps {
  tabs: PanelTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onManagerOpenChange?: (open: boolean) => void;
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
  activeId,
  onSelect,
  onRename,
  onClose,
  onAdd,
  onManagerOpenChange,
}: PanelTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinnedTabs);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(MAX_VISIBLE_TABS);
  const editorRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!editingId) return;
    editorRef.current?.focus();
    editorRef.current?.select();
  }, [editingId]);

  useEffect(() => {
    const bar = managerRef.current;
    if (!bar) return;
    const updateLimit = () => {
      const availableForTabs = Math.max(0, bar.getBoundingClientRect().width - 155);
      setVisibleLimit(
        Math.max(3, Math.min(MAX_VISIBLE_TABS, Math.floor(availableForTabs / 145))),
      );
    };
    const observer = new ResizeObserver(updateLimit);
    observer.observe(bar);
    updateLimit();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setRecentIds((current) => [
      activeId,
      ...current.filter((id) => id !== activeId),
    ].slice(0, 30));
  }, [activeId]);

  useEffect(() => {
    const validIds = new Set(tabs.map((tab) => tab.id));
    setPinnedIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(next));
      return next;
    });
    setRecentIds((current) => current.filter((id) => validIds.has(id)));
  }, [tabs]);

  useEffect(() => {
    if (!managerOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!managerRef.current?.contains(event.target as Node)) {
        setManagerOpen(false);
        setQuery("");
        onManagerOpenChange?.(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setManagerOpen(false);
        setQuery("");
        onManagerOpenChange?.(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [managerOpen, onManagerOpenChange]);

  const orderedTabs = useMemo(() => {
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const orderedIds = [
      activeId,
      ...pinnedIds,
      ...recentIds,
      ...tabs.map((tab) => tab.id),
    ].filter((id): id is string => Boolean(id));
    const seen = new Set<string>();
    return orderedIds.flatMap((id) => {
      if (seen.has(id)) return [];
      seen.add(id);
      const tab = byId.get(id);
      return tab ? [tab] : [];
    });
  }, [tabs, activeId, pinnedIds, recentIds]);

  const visibleTabs = orderedTabs.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, tabs.length - visibleTabs.length);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredTabs = useMemo(
    () =>
      orderedTabs.filter(
        (tab) =>
          !normalizedQuery
          || tab.name.toLocaleLowerCase().includes(normalizedQuery)
          || tab.id.toLocaleLowerCase().includes(normalizedQuery),
      ),
    [orderedTabs, normalizedQuery],
  );

  if (tabs.length === 0) return null;

  const setManagerVisibility = (open: boolean) => {
    setManagerOpen(open);
    if (!open) setQuery("");
    onManagerOpenChange?.(open);
  };

  const beginEditing = (tab: PanelTab) => {
    cancelBlurRef.current = false;
    setEditingId(tab.id);
    setDraftName(tab.name);
  };

  const saveEditing = (tab: PanelTab) => {
    const nextName = draftName.trim();
    setEditingId(null);
    if (nextName && nextName !== tab.name) {
      onRename(tab.id, nextName);
    }
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

  const renderTab = (tab: PanelTab) => {
    const active = tab.id === activeId;
    const editing = tab.id === editingId;
    return (
      <div
        key={tab.id}
        className={`panel-tab${active ? " active" : ""}${editing ? " editing" : ""}`}
        role="tab"
        aria-selected={active}
        tabIndex={0}
        title={active ? "再次点击编辑备注" : tab.name}
        onClick={() => {
          if (editing) return;
          if (active) {
            beginEditing(tab);
          } else {
            onSelect(tab.id);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (active) {
            beginEditing(tab);
          } else {
            onSelect(tab.id);
          }
        }}
        onKeyDown={(event) => {
          if (editing || !["Enter", " "].includes(event.key)) return;
          event.preventDefault();
          if (active) {
            beginEditing(tab);
          } else {
            onSelect(tab.id);
          }
        }}
      >
        <span className="panel-tab-icon">
          <PlatformIcon platform="whatsapp" size={13} />
        </span>
        {editing ? (
          <input
            ref={editorRef}
            className="panel-tab-name-input"
            aria-label="编辑账号备注"
            maxLength={32}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => {
              if (cancelBlurRef.current) {
                cancelBlurRef.current = false;
                return;
              }
              saveEditing(tab);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                saveEditing(tab);
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelBlurRef.current = true;
                setEditingId(null);
              }
            }}
          />
        ) : (
          <span className="panel-tab-label">{tab.name}</span>
        )}
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
  };

  return (
    <div className="panel-tab-bar" ref={managerRef}>
      <div className="panel-tabs-visible" role="tablist">
        {visibleTabs.map(renderTab)}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          className={managerOpen ? "panel-tab-more active" : "panel-tab-more"}
          aria-expanded={managerOpen}
          onClick={() => setManagerVisibility(!managerOpen)}
        >
          更多 {hiddenCount}
          <ChevronDown size={13} />
        </button>
      )}

      <button className="panel-tab-add" onClick={onAdd} aria-label="添加账号">
        <Plus size={14} />
      </button>

      {managerOpen && (
        <section className="account-switcher" aria-label="全部 WhatsApp 账号">
          <div className="account-switcher-header">
            <div>
              <strong>全部账号</strong>
              <span>{tabs.length} 个已打开账号</span>
            </div>
            <label className="account-switcher-search">
              <Search size={15} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索备注或账号 ID"
              />
            </label>
          </div>

          <div className="account-switcher-grid">
            {filteredTabs.map((tab) => {
              const active = tab.id === activeId;
              const pinned = pinnedIds.includes(tab.id);
              return (
                <div
                  key={tab.id}
                  className={`account-switcher-item${active ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="account-switcher-select"
                    onClick={() => {
                      setManagerVisibility(false);
                      onSelect(tab.id);
                    }}
                  >
                    <span className="panel-tab-icon">
                      <PlatformIcon platform="whatsapp" size={13} />
                    </span>
                    <span className="account-switcher-copy">
                      <strong title={tab.name}>{tab.name}</strong>
                      <small>{active ? "当前账号" : tab.id}</small>
                    </span>
                    <i className={`account-status ${tab.status ?? "offline"}`} />
                  </button>
                  <button
                    type="button"
                    className={pinned ? "account-pin active" : "account-pin"}
                    aria-label={pinned ? `取消置顶 ${tab.name}` : `置顶 ${tab.name}`}
                    title={pinned ? "取消置顶" : "置顶"}
                    onClick={() => togglePinned(tab.id)}
                  >
                    <Pin size={13} />
                  </button>
                </div>
              );
            })}
            {filteredTabs.length === 0 && (
              <div className="account-switcher-empty">没有找到匹配的账号</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
