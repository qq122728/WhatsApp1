import { useEffect, useRef, useState } from "react";
import {
  Activity,
  LayoutDashboard,
  MessageCircle,
  PanelLeftClose,
  Plus,
  Settings,
  Users,
} from "lucide-react";

export type View = "overview" | "accounts" | "settings";

export interface WaSession {
  id: string;
  name: string;
  status: "online" | "offline" | "expired";
  unreadCount?: number;
}

interface SidebarProps {
  view: View;
  onChange: (view: View) => void;
  waSessions?: WaSession[];
  activePanelId?: string | null;
  newAccountCount?: number;
  onOpenAccountManager?: () => void;
  onOpenAccountsView?: () => void;
  onOpenUnreadAccounts?: () => void;
  onAddAccount?: () => void;
  onOverlayOpenChange?: (open: boolean) => void;
}

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "accounts", label: "账号", icon: Activity },
];

export function Sidebar({
  view,
  onChange,
  waSessions = [],
  activePanelId,
  newAccountCount = 0,
  onOpenAccountManager,
  onOpenAccountsView,
  onOpenUnreadAccounts,
  onAddAccount,
  onOverlayOpenChange,
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const onlineCount = waSessions.filter((session) => session.status === "online").length;
  const attentionCount = waSessions.filter((session) => session.status !== "online").length;
  const unreadTotal = waSessions.reduce(
    (sum, session) => sum + Math.max(0, session.unreadCount ?? 0),
    0,
  );
  const unreadAccountCount = waSessions.filter(
    (session) => (session.unreadCount ?? 0) > 0,
  ).length;
  const formatBadge = (value: number) => (value > 99 ? "99+" : String(value));

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        onOverlayOpenChange?.(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        onOverlayOpenChange?.(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen, onOverlayOpenChange]);

  const closeMenu = () => {
    setMenuOpen(false);
    onOverlayOpenChange?.(false);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>MultiConnect</strong>
          <small>消息控制中心</small>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主导航">
        <span className="nav-caption">工作台</span>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = !activePanelId && view === item.id;
          return (
            <button
              className={isActive ? "nav-item active" : "nav-item"}
              key={item.id}
              onClick={() => onChange(item.id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}

        <span className="nav-caption nav-caption-spaced">系统</span>
        <button
          className={
            !activePanelId && view === "settings"
              ? "nav-item active"
              : "nav-item"
          }
          onClick={() => onChange("settings")}
        >
          <Settings size={19} strokeWidth={1.8} />
          <span>设置</span>
        </button>

        {waSessions.length > 0 && (
          <div className="account-hub-wrap" ref={menuRef}>
            <span className="nav-caption nav-caption-spaced">已连接</span>
            <div
              className={[
                "account-hub",
                activePanelId ? "active" : "",
                unreadTotal > 0 ? "unread" : "",
              ].filter(Boolean).join(" ")}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuOpen(true);
                onOverlayOpenChange?.(true);
              }}
            >
              <button
                type="button"
                className="account-hub-main"
                onClick={onOpenAccountsView ?? onOpenAccountManager}
              >
              <span className="account-hub-icon">
                <MessageCircle size={15} />
              </span>
              <span className="account-hub-copy">
                <strong>WhatsApp 账号</strong>
                <small>
                  在线 {onlineCount}
                  {attentionCount > 0 ? ` · 待处理 ${attentionCount}` : ""}
                  {unreadTotal > 0 ? ` · 未读 ${unreadTotal}/${unreadAccountCount}号` : ""}
                </small>
              </span>
              <span className={unreadTotal > 0 ? "account-hub-count unread" : "account-hub-count"}>
                {unreadTotal > 0
                  ? formatBadge(unreadTotal)
                  : newAccountCount > 0
                    ? `+${newAccountCount}`
                    : waSessions.length}
              </span>
              </button>
              <button
                type="button"
                className="account-hub-settings"
                aria-label="管理 WhatsApp 账号"
                title="管理 WhatsApp 账号"
                onClick={onOpenAccountManager}
              >
                <Settings size={14} />
              </button>
            </div>

            {menuOpen && (
              <div className="sidebar-context-menu" role="menu">
                {unreadTotal > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      onOpenUnreadAccounts?.();
                    }}
                  >
                    <MessageCircle size={14} />
                    查看未读账号
                    <span>{formatBadge(unreadTotal)}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onOpenAccountManager?.();
                  }}
                >
                  <Users size={14} />
                  账号管理
                  <span>
                    {unreadTotal > 0
                      ? `未读 ${formatBadge(unreadTotal)}`
                      : waSessions.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onAddAccount?.();
                  }}
                >
                  <Plus size={14} />
                  添加 WhatsApp 账号
                </button>
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="local-engine">
          <span className="engine-pulse" />
          <div>
            <strong>本地引擎</strong>
            <small>运行正常</small>
          </div>
          <PanelLeftClose size={17} />
        </div>
        <span className="version">MultiConnect v0.1.0</span>
      </div>
    </aside>
  );
}
