import {
  ArrowUpRight,
  CircleCheck,
  Clock3,
  MessageSquareText,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import type { Account, Message } from "../types";
import { AccountCard } from "../components/AccountCard";
import { PlatformIcon } from "../components/PlatformIcon";

interface OverviewProps {
  accounts: Account[];
  messages: Message[];
  onAddAccount: () => void;
  onToggleTranslation: (id: string) => void;
  onReconnect: (id: string) => void;
  onViewMessages: () => void;
}

export function Overview({
  accounts,
  messages,
  onAddAccount,
  onToggleTranslation,
  onReconnect,
  onViewMessages,
}: OverviewProps) {
  const online = accounts.filter((account) => account.status === "online").length;
  const messagesToday = accounts.reduce(
    (sum, account) => sum + account.messagesToday,
    0,
  );

  return (
    <div className="view overview-view">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">工作台状态 · 2026年6月19日</span>
          <h2>
            上午好，所有渠道
            <br />
            <em>尽在掌握。</em>
          </h2>
          <p>
            客户端负责保持平台连接，Web 控制台通过我们自己的 API
            安全下发指令。
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onAddAccount}>
              <Plus size={17} />
              添加账号
            </button>
            <button className="secondary-button" onClick={onViewMessages}>
              查看消息
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
          <small>共 {accounts.length} 个账号</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue">
            <MessageSquareText size={19} />
          </div>
          <span>今日消息</span>
          <strong>{messagesToday}</strong>
          <small className="positive">较昨日 +12.4%</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon violet">
            <Sparkles size={19} />
          </div>
          <span>已翻译</span>
          <strong>38</strong>
          <small>节省约 24 分钟</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon amber">
            <Clock3 size={19} />
          </div>
          <span>待处理</span>
          <strong>2</strong>
          <small>最早等待 8 分钟</small>
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
        <div className="account-grid">
          {accounts.map((account) => (
            <AccountCard
              account={account}
              key={account.id}
              onToggleTranslation={onToggleTranslation}
              onReconnect={onReconnect}
            />
          ))}
        </div>
      </section>

      <section className="dashboard-columns">
        <div className="section-block compact">
          <div className="section-heading">
            <div>
              <span className="eyebrow">INBOX</span>
              <h3>最近消息</h3>
            </div>
            <button className="text-button" onClick={onViewMessages}>
              全部消息 <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="message-list">
            {messages.slice(0, 3).map((message) => (
              <button className="message-row" key={message.id}>
                <span className={`message-platform ${message.platform}`}>
                  <PlatformIcon platform={message.platform} size={17} />
                </span>
                <span className="message-main">
                  <span className="message-meta">
                    <strong>{message.contact}</strong>
                    <small>{message.time}</small>
                  </span>
                  <span className="message-preview">{message.original}</span>
                  {message.translation && (
                    <span className="translated-preview">
                      <Sparkles size={12} /> {message.translation}
                    </span>
                  )}
                </span>
                {message.unread && <i className="unread-dot" />}
              </button>
            ))}
          </div>
        </div>

        <div className="section-block compact health-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SYSTEM</span>
              <h3>系统健康</h3>
            </div>
            <CircleCheck size={22} className="health-check" />
          </div>
          <div className="health-score">
            <div className="score-ring">
              <strong>96</strong>
              <span>健康分</span>
            </div>
            <p>核心服务运行稳定，1 个账号需要重新授权。</p>
          </div>
          <div className="health-items">
            <div>
              <ShieldCheck size={17} />
              <span>
                Session 加密
                <small>本地安全存储</small>
              </span>
              <b>正常</b>
            </div>
            <div>
              <Wifi size={17} />
              <span>
                连接引擎
                <small>最近心跳：刚刚</small>
              </span>
              <b>正常</b>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
