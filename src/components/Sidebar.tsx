import {
  Activity,
  LayoutDashboard,
  MessageCircle,
  PanelLeftClose,
  Plus,
  Settings,
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
  onOpenSession?: (id: string) => void;
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
  onOpenSession,
  onAddAccount,
}: SidebarProps) {
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

        <div className="account-rail">
          <div className="account-rail-head">
            <span className="nav-caption nav-caption-spaced">已连接</span>
            <div className="account-rail-tools">
              {unreadTotal > 0 && (
                <button
                  type="button"
                  className="account-rail-alert"
                  title="查看未读账号"
                  onClick={onOpenUnreadAccounts}
                >
                  {formatBadge(unreadTotal)}
                </button>
              )}
              <button
                type="button"
                aria-label="添加 WhatsApp 账号"
                title="添加 WhatsApp 账号"
                onClick={onAddAccount}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                aria-label="账号管理"
                title="账号管理"
                onClick={onOpenAccountsView ?? onOpenAccountManager}
              >
                <Settings size={13} />
              </button>
            </div>
          </div>

          {waSessions.length > 0 ? (
            <div className="account-rail-list">
              {waSessions.map((session) => {
                const unread = Math.max(0, session.unreadCount ?? 0);
                const active = activePanelId === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={[
                      "account-rail-item",
                      active ? "active" : "",
                      unread > 0 ? "unread" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => onOpenSession?.(session.id)}
                  >
                    <span className="account-rail-avatar">
                      <MessageCircle size={14} />
                    </span>
                    <span className="account-rail-copy">
                      <strong>{session.name}</strong>
                      <small>
                        <span className={`wa-status-dot ${session.status}`} />
                        {session.status === "online"
                          ? "在线"
                          : session.status === "expired"
                            ? "需扫码"
                            : "未打开"}
                      </small>
                    </span>
                    {unread > 0 && (
                      <span className="account-rail-unread">{formatBadge(unread)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <button
              type="button"
              className="account-rail-empty"
              onClick={onAddAccount}
            >
              <Plus size={14} />
              <span>添加 WhatsApp</span>
            </button>
          )}

          {waSessions.length > 0 && (
            <div className="account-rail-summary">
              在线 {onlineCount}
              {attentionCount > 0 ? ` · 待处理 ${attentionCount}` : ""}
              {newAccountCount > 0 ? ` · 新增 ${newAccountCount}` : ""}
              {unreadAccountCount > 0 ? ` · 未读 ${unreadAccountCount}号` : ""}
            </div>
          )}
        </div>
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
