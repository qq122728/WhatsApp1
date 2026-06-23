import {
  AlertCircle,
  ArrowUpRight,
  CircleCheck,
  MessageCircle,
  Monitor,
  Plus,
  Radio,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import type { Account } from "../types";
import { AccountCard } from "../components/AccountCard";
import { PlatformIcon } from "../components/PlatformIcon";

interface OverviewProps {
  accounts: Account[];
  openPanelCount: number;
  onAddAccount: () => void;
  onToggleTranslation: (id: string) => void;
  onReconnect: (id: string) => void;
  onViewPanel?: (id: string) => void;
  onViewAccounts: () => void;
}

export function Overview({
  accounts,
  openPanelCount,
  onAddAccount,
  onToggleTranslation,
  onReconnect,
  onViewPanel,
  onViewAccounts,
}: OverviewProps) {
  const waAccounts = accounts.filter(
    (a) => a.platform === "whatsapp" && a.id.startsWith("wa_"),
  );
  const online = waAccounts.filter((a) => a.status === "online").length;
  const needsLogin = waAccounts.filter((a) => a.status === "expired").length;
  const unreadTotal = waAccounts.reduce((sum, a) => sum + (a.unreadCount ?? 0), 0);
  const healthScore =
    waAccounts.length === 0
      ? 100
      : Math.round(100 * (1 - needsLogin / waAccounts.length));

  return (
    <div className="view overview-view">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">工作台状态 · MultiConnect</span>
          <h2>
            多账号 WhatsApp
            <br />
            <em>本机独立管理。</em>
          </h2>
          <p>
            每个账号独立 Session，嵌入式 WebView 保持连接，翻译引擎实时处理收发消息。
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onAddAccount}>
              <Plus size={17} />
              添加账号
            </button>
            <button className="secondary-button" onClick={onViewAccounts}>
              管理账号
              <ArrowUpRight size={16} />
            </button>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hub">
            <div className="hub-mark">
              <span />
              <span />
              <span />
            </div>
          </div>
          <span className="channel-node node-wa">
            <PlatformIcon platform="whatsapp" size={22} />
          </span>
          <span className="channel-node node-tg">
            <PlatformIcon platform="telegram" size={22} />
          </span>
          <span className="channel-node node-rcs">
            <PlatformIcon platform="rcs" size={22} />
          </span>
          <div className="connection-card">
            <Wifi size={15} />
            <span>
              客户端引擎
              <b>连接稳定</b>
            </span>
          </div>
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card">
          <div className="stat-icon green">
            <Radio size={19} />
          </div>
          <span>在线账号</span>
          <strong>{online}</strong>
          <small>共 {waAccounts.length} 个 WhatsApp</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue">
            <MessageCircle size={19} />
          </div>
          <span>未读消息</span>
          <strong>{unreadTotal}</strong>
          <small>{unreadTotal > 0 ? "点击面板查看" : "当前无未读"}</small>
        </article>
        <article className="stat-card">
          <div className={needsLogin > 0 ? "stat-icon amber" : "stat-icon green"}>
            <AlertCircle size={19} />
          </div>
          <span>待登录</span>
          <strong>{needsLogin}</strong>
          <small>{needsLogin > 0 ? "需要重新扫码" : "所有账号正常"}</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon violet">
            <Monitor size={19} />
          </div>
          <span>开放面板</span>
          <strong>{openPanelCount}</strong>
          <small>{openPanelCount > 0 ? "Session 保持中" : "暂无面板运行"}</small>
        </article>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CHANNELS</span>
            <h3>已连接账号</h3>
          </div>
          <button className="text-button" onClick={onAddAccount}>
            <Plus size={15} />
            添加账号
          </button>
        </div>
        {waAccounts.length > 0 ? (
          <div className="account-grid">
            {waAccounts.map((account) => (
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
            <span>点击"添加账号"创建独立 Session，已有 Profile 会自动恢复。</span>
            <button className="primary-button small" onClick={onAddAccount}>
              <Plus size={16} /> 添加 WhatsApp
            </button>
          </div>
        )}
      </section>

      <section className="section-block compact health-card" style={{ maxWidth: 520 }}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">SYSTEM</span>
              <h3>系统健康</h3>
            </div>
            {needsLogin === 0 ? (
              <CircleCheck size={22} className="health-check" />
            ) : (
              <AlertCircle size={22} style={{ color: "var(--warning)" }} />
            )}
          </div>
          <div className="health-score">
            <div className="score-ring">
              <strong>{healthScore}</strong>
              <span>健康分</span>
            </div>
            <p>
              {waAccounts.length === 0
                ? "尚未添加账号。"
                : needsLogin > 0
                  ? `${needsLogin} 个账号需要重新扫码登录。`
                  : "所有账号运行正常，Session 完好。"}
            </p>
          </div>
          <div className="health-items">
            <div>
              <ShieldCheck size={17} />
              <span>
                Session 存储
                <small>本机独立 Profile</small>
              </span>
              <b>正常</b>
            </div>
            <div>
              <Wifi size={17} />
              <span>
                连接引擎
                <small>内嵌 WebView · 本地运行</small>
              </span>
              <b>正常</b>
            </div>
          </div>
      </section>
    </div>
  );
}
