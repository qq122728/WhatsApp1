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
  return (
    <div className="view">
      <div className="view-toolbar">
        <div className="filter-tabs">
          <button className="active">全部账号</button>
          <button>在线</button>
          <button>需要处理</button>
        </div>
        <button className="primary-button small" onClick={onAddAccount}>
          <Plus size={16} /> 添加账号
        </button>
      </div>
      <div className="account-grid large">
        {accounts.map((account) => (
          <AccountCard
            account={account}
            key={account.id}
            onToggleTranslation={onToggleTranslation}
            onReconnect={onReconnect}
            onViewPanel={onViewPanel}
          />
        ))}
      </div>
    </div>
  );
}
