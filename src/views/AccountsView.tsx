import { Plus } from "lucide-react";
import type { Account } from "../types";
import { AccountCard } from "../components/AccountCard";

interface AccountsViewProps {
  accounts: Account[];
  onAddAccount: () => void;
  onToggleTranslation: (id: string) => void;
  onReconnect: (id: string) => void;
  onViewPanel?: (id: string) => void;
}

export function AccountsView({
  accounts,
  onAddAccount,
  onToggleTranslation,
  onReconnect,
  onViewPanel,
}: AccountsViewProps) {
  const whatsappAccounts = accounts.filter(
    (account) => account.platform === "whatsapp" && account.id.startsWith("wa_"),
  );
  const onlineCount = whatsappAccounts.filter((account) => account.status === "online").length;
  const needsLoginCount = whatsappAccounts.filter((account) => account.status === "expired").length;

  return (
    <div className="view">
      <div className="view-toolbar">
        <div className="filter-tabs">
          <button className="active">WhatsApp {whatsappAccounts.length}</button>
          <button>在线 {onlineCount}</button>
          <button>待登录 {needsLoginCount}</button>
        </div>
        <button className="primary-button small" onClick={onAddAccount}>
          <Plus size={16} /> 添加 WhatsApp
        </button>
      </div>

      {whatsappAccounts.length > 0 ? (
        <div className="account-grid large">
          {whatsappAccounts.map((account) => (
            <AccountCard
              account={account}
              key={account.id}
              onToggleTranslation={onToggleTranslation}
              onReconnect={onReconnect}
              onViewPanel={onViewPanel}
            />
          ))}
        </div>
      ) : (
        <div className="account-empty">
          <strong>还没有 WhatsApp 账号</strong>
          <span>添加账号后会创建独立的本机 Session；已有 Profile 会自动恢复到这里。</span>
          <button className="primary-button small" onClick={onAddAccount}>
            <Plus size={16} /> 添加 WhatsApp
          </button>
        </div>
      )}
    </div>
  );
}
