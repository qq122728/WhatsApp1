import {
  Check,
  CloudCog,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Server,
} from "lucide-react";
import type {
  RemoteConfig,
  RemoteConnectionState,
} from "../types";

interface SettingsViewProps {
  config: RemoteConfig;
  connectionState: RemoteConnectionState;
  onConfigChange: (config: RemoteConfig) => void;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

const connectionCopy: Record<
  RemoteConnectionState,
  { title: string; description: string }
> = {
  not_configured: {
    title: "尚未配置",
    description: "填写我们自己的 API 地址后进行连接测试。",
  },
  checking: {
    title: "正在检查连接",
    description: "正在请求后端 /health 接口。",
  },
  registering: {
    title: "正在注册设备",
    description: "客户端正在向控制后端申请短期设备凭据。",
  },
  connecting: {
    title: "正在建立安全通道",
    description: "正在进行 WSS 鉴权和 v1 协议握手。",
  },
  connected: {
    title: "已连接",
    description: "设备已注册，WSS 常驻通道正在运行。",
  },
  disconnected: {
    title: "已断开",
    description: "本机已停止远程控制通道。",
  },
  error: {
    title: "连接出现错误",
    description: "设备注册、鉴权或协议握手没有完成。",
  },
  unreachable: {
    title: "暂时无法连接",
    description: "后端可能尚未启动，配置已经保留。",
  },
};

export function SettingsView({
  config,
  connectionState,
  onConfigChange,
  onSave,
  onConnect,
  onDisconnect,
}: SettingsViewProps) {
  const state = connectionCopy[connectionState];
  const busy =
    connectionState === "checking" ||
    connectionState === "registering" ||
    connectionState === "connecting";

  return (
    <div className="view settings-view">
      <section className="settings-card">
        <div className="settings-card-head">
          <div className="settings-icon">
            <CloudCog size={22} />
          </div>
          <div>
            <span className="eyebrow">REMOTE CONTROL</span>
            <h3>Web 控制台连接</h3>
            <p>
              客户端主动连接我们自己的后端 API，平台 Session
              始终保留在本机。
            </p>
          </div>
        </div>

        <div className={`connection-status ${connectionState}`}>
          <span className="connection-status-icon">
            {busy ? (
              <LoaderCircle size={19} className="spin" />
            ) : connectionState === "connected" ? (
              <Check size={19} />
            ) : (
              <Server size={19} />
            )}
          </span>
          <span>
            <strong>{state.title}</strong>
            <small>{state.description}</small>
          </span>
        </div>

        <div className="settings-form">
          <label>
            <span>API 地址</span>
            <div className="input-shell">
              <Server size={16} />
              <input
                value={config.apiBaseUrl}
                placeholder="https://api.example.com"
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    apiBaseUrl: event.target.value,
                  })
                }
              />
            </div>
            <small>
              桌面客户端会完成设备注册，并主动建立经过鉴权的 WSS 通道。
            </small>
          </label>

          <div className="form-row">
            <label>
              <span>设备名称</span>
              <div className="input-shell">
                <CloudCog size={16} />
                <input
                  value={config.deviceName}
                  onChange={(event) =>
                    onConfigChange({
                      ...config,
                      deviceName: event.target.value,
                    })
                  }
                />
              </div>
            </label>
            <label>
              <span>设备 ID</span>
              <div className="input-shell readonly">
                <KeyRound size={16} />
                <input value={config.deviceId} readOnly />
              </div>
            </label>
          </div>

          <div className="settings-actions">
            {connectionState === "connected" ? (
              <button className="secondary-button" onClick={onDisconnect}>
                断开远程控制
              </button>
            ) : (
              <button
                className="secondary-button"
                onClick={onConnect}
                disabled={busy}
              >
                <RefreshCw size={16} className={busy ? "spin" : undefined} />
                {busy ? "正在连接" : "连接控制后端"}
              </button>
            )}
            <button className="primary-button" onClick={onSave}>
              保存配置
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card security-card">
        <div className="settings-card-head">
          <div className="settings-icon green">
            <LockKeyhole size={22} />
          </div>
          <div>
            <span className="eyebrow">SECURITY</span>
            <h3>安全边界</h3>
            <p>第一版已经按本地优先原则划分客户端与 Web 后端职责。</p>
          </div>
        </div>
        <div className="security-grid">
          <div>
            <Check size={16} />
            <span>
              Session 留在本地
              <small>Web 后端不保存平台登录凭据</small>
            </span>
          </div>
          <div>
            <Check size={16} />
            <span>
              客户端主动连接
              <small>无需暴露本机端口或公网 IP</small>
            </span>
          </div>
          <div>
            <Check size={16} />
            <span>
              设备独立标识
              <small>后续用于配对和短期令牌</small>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
