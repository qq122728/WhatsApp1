import {
  Bell,
  ChevronDown,
  Command,
  Search,
} from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle: string;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="page-title">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="topbar-actions">
        <label className="search-box">
          <Search size={17} />
          <input placeholder="搜索消息、联系人..." />
          <span>
            <Command size={12} /> K
          </span>
        </label>
        <button className="icon-button" aria-label="通知">
          <Bell size={19} />
          <i />
        </button>
        <button className="profile-button">
          <span className="avatar">MC</span>
          <span className="profile-copy">
            <strong>管理员</strong>
            <small>本地设备</small>
          </span>
          <ChevronDown size={15} />
        </button>
      </div>
    </header>
  );
}
