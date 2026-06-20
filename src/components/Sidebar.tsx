import {
  Activity,
  ContactRound,
  LayoutDashboard,
  MessageCircle,
  MessageSquareText,
  PanelLeftClose,
  SendHorizontal,
  Settings,
} from "lucide-react";

export type View =
  | "overview"
  | "accounts"
  | "messages"
  | "contacts"
  | "jobs"
  | "settings";

export interface WaSession {
  id: string;
  name: string;
  status: string;
}

interface SidebarProps {
  view: View;
  onChange: (view: View) => void;
  waSessions?: WaSession[];
  activePanelId?: string | null;
  onSelectPanel?: (id: string) => void;
}

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}> = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "accounts", label: "账号", icon: Activity },
  { id: "messages", label: "消息", icon: MessageSquareText, badge: "2" },
  { id: "contacts", label: "联系人", icon: ContactRound },
  { id: "jobs", label: "任务", icon: SendHorizontal },
];

export function Sidebar({
  view,
  onChange,
  waSessions = [],
  activePanelId,
  onSelectPanel,
}: SidebarProps) {
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
              {item.badge && <b>{item.badge}</b>}
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
          <>
            <span className="nav-caption nav-caption-spaced">已连接</span>
            {waSessions.map((session) => (
              <button
                key={session.id}
                className={
                  activePanelId === session.id
                    ? "nav-item active"
                    : "nav-item"
                }
                onClick={() => onSelectPanel?.(session.id)}
              >
                <span className="wa-nav-icon">
                  <MessageCircle size={13} />
                </span>
                <span>{session.name}</span>
                <b
                  className={
                    session.status === "online"
                      ? "wa-status-dot online"
                      : "wa-status-dot"
                  }
                />
              </button>
            ))}
          </>
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
