import {
  Ellipsis,
  ExternalLink,
  Languages,
  RefreshCw,
} from "lucide-react";
import type { Account } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";

interface AccountCardProps {
  account: Account;
  onToggleTranslation: (id: string) => void;
  onReconnect: (id: string) => void;
  onViewPanel?: (id: string) => void;
}

const statusLabel = {
  online: "在线",
  offline: "离线",
  expired: "需要重新登录",
};

export function AccountCard({
  account,
  onToggleTranslation,
  onReconnect,
  onViewPanel,
}: AccountCardProps) {
  const canOpenPanel =
    account.platform === "whatsapp" && account.id.startsWith("wa_");

  return (
    <article className="account-card">
      <div className="account-card-head">
        <div
          className="platform-tile"
          style={{
            color: account.accent,
            background: `${account.accent}16`,
          }}
        >
          <PlatformIcon platform={account.platform} size={22} />
        </div>
        <div className="account-name">
          <strong>{account.name}</strong>
          <span>{platformLabel[account.platform]}</span>
        </div>
        <button className="ghost-icon" aria-label="账号菜单">
          <Ellipsis size={18} />
        </button>
      </div>

      <div className="account-handle">{account.handle}</div>

      <div className={`status-line ${account.status}`}>
        <span />
        {statusLabel[account.status]}
      </div>

      <div className="account-metrics">
        <div>
          <span>今日消息</span>
          <strong>{account.messagesToday}</strong>
        </div>
        <div>
          <span>最近同步</span>
          <strong>{account.lastSync}</strong>
        </div>
      </div>

      <div className="account-card-footer">
        <button
          className={
            account.translationEnabled
              ? "translation-toggle enabled"
              : "translation-toggle"
          }
          onClick={() => onToggleTranslation(account.id)}
        >
          <Languages size={15} />
          自动翻译
          <span className="switch">
            <i />
          </span>
        </button>

        <div style={{ display: "flex", gap: 6 }}>
          {canOpenPanel && onViewPanel && (
            <button
              className="reconnect-button"
              onClick={() => onViewPanel(account.id)}
              style={{ borderColor: "#b8d0ef", color: "#2d6bbf", background: "#f2f7fe" }}
            >
              <ExternalLink size={14} />
              {account.status === "online" ? "查看会话" : "重新登录"}
            </button>
          )}
          {!canOpenPanel && account.status !== "online" && (
            <button
              className="reconnect-button"
              onClick={() => onReconnect(account.id)}
            >
              <RefreshCw size={14} />
              重连
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
