import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  CloudCog,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import type {
  ClientAccountDiagnostics,
  RemoteConfig,
  RemoteConnectionState,
  TranslationCacheSettings,
} from "../types";
import {
  exportAppDiagnostics,
  loadAppDiagnostics,
  type AppDiagnostics,
} from "../lib/app-diagnostics";
import {
  clearOpenAiApiKey,
  emptyOpenAiConfigStatus,
  loadOpenAiConfigStatus,
  openAiErrorMessage,
  saveOpenAiApiKey,
  testOpenAiApiKey,
  type OpenAiConfigStatus,
} from "../lib/openai-config";
import {
  clearTranslationCache,
  emptyTranslationCacheStats,
  loadTranslationCacheStats,
  type TranslationCacheStats,
} from "../lib/translation-cache";
import type { TranslationLogEntry } from "../lib/translation-logs";

interface SettingsViewProps {
  config: RemoteConfig;
  connectionState: RemoteConnectionState;
  accountSummary: ClientAccountDiagnostics;
  translationCacheSettings: TranslationCacheSettings;
  translationLogs: TranslationLogEntry[];
  onConfigChange: (config: RemoteConfig) => void;
  onTranslationCacheSettingsChange: (settings: TranslationCacheSettings) => void;
  onClearTranslationLogs: () => void;
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

const openAiModels = ["gpt-4o-mini", "gpt-4o", "gpt-4.1"];

const openAiSourceCopy: Record<
  OpenAiConfigStatus["source"],
  { title: string; description: string }
> = {
  local: {
    title: "已保存到本机",
    description: "Key 已用 Windows DPAPI 加密保存，翻译会优先使用它。",
  },
  environment: {
    title: "使用系统环境变量",
    description: "检测到 OPENAI_API_KEY；也可以在这里保存一个本机 Key 覆盖它。",
  },
  none: {
    title: "尚未配置",
    description: "保存 OpenAI API Key 后，WhatsApp 翻译会直接使用本机配置。",
  },
};

const cacheStatusCopy: Record<string, string> = {
  memory: "内存命中",
  disk: "硬盘命中",
  shared: "等待复用",
  miss: "新请求",
};

function formatDuration(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.max(0, Math.round(ms))}ms`;
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SettingsView({
  config,
  connectionState,
  accountSummary,
  translationCacheSettings,
  translationLogs,
  onConfigChange,
  onTranslationCacheSettingsChange,
  onClearTranslationLogs,
  onSave,
  onConnect,
  onDisconnect,
}: SettingsViewProps) {
  const state = connectionCopy[connectionState];
  const busy =
    connectionState === "checking" ||
    connectionState === "registering" ||
    connectionState === "connecting";
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiConfigStatus>(
    emptyOpenAiConfigStatus,
  );
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiModel, setOpenAiModel] = useState(openAiModels[0]);
  const [openAiBusy, setOpenAiBusy] = useState<
    "loading" | "saving" | "testing" | "clearing" | null
  >(null);
  const [openAiMessage, setOpenAiMessage] = useState("");
  const openAiCopy = openAiSourceCopy[openAiStatus.source];
  const openAiMaskedKey = useMemo(
    () => openAiStatus.maskedKey || "未保存",
    [openAiStatus.maskedKey],
  );
  const openAiBusyNow = openAiBusy !== null;
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<
    "loading" | "exporting" | null
  >(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats>(
    emptyTranslationCacheStats,
  );
  const [cacheBusy, setCacheBusy] = useState<"loading" | "clearing" | null>(null);
  const [cacheMessage, setCacheMessage] = useState("");
  const recentTranslationLogs = useMemo(
    () => translationLogs.slice(0, 20),
    [translationLogs],
  );
  const translationLogSummary = useMemo(() => {
    const total = translationLogs.length;
    const failed = translationLogs.filter((log) => !log.success).length;
    const cacheHits = translationLogs.filter((log) =>
      ["memory", "disk", "shared"].includes(String(log.cacheStatus || "")),
    ).length;
    const averageDuration =
      total === 0
        ? 0
        : Math.round(
            translationLogs.reduce((sum, log) => sum + Math.max(0, log.durationMs || 0), 0)
              / total,
          );
    return { total, failed, cacheHits, averageDuration };
  }, [translationLogs]);

  const updateCacheSetting = useCallback(
    <K extends keyof TranslationCacheSettings,>(
      key: K,
      value: TranslationCacheSettings[K],
    ) => {
      onTranslationCacheSettingsChange({
        ...translationCacheSettings,
        [key]: value,
      });
    },
    [onTranslationCacheSettingsChange, translationCacheSettings],
  );

  const diagnosticsContext = useMemo(
    () => ({
      generatedBy: "settings-view",
      remote: {
        state: connectionState,
        apiConfigured: Boolean(config.apiBaseUrl.trim()),
        deviceIdSuffix: config.deviceId ? config.deviceId.slice(-8) : null,
      },
      accounts: accountSummary,
      openAi: {
        configured: openAiStatus.configured,
        source: openAiStatus.source,
        storage: openAiStatus.storage,
      },
      userAgent:
        typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    }),
    [accountSummary, config.apiBaseUrl, config.deviceId, connectionState, openAiStatus],
  );

  const diagnosticsSummary = useMemo(() => {
    const snapshot = diagnostics;
    const lines = [
      `MultiConnect ${snapshot?.app.version ?? "0.1.0"}`,
      `Build: ${snapshot?.system.buildProfile ?? "unknown"} / ${
        snapshot?.system.os ?? "unknown"
      }-${snapshot?.system.arch ?? "unknown"}`,
      `OpenAI: ${
        openAiStatus.configured
          ? `${openAiStatus.source} (${openAiStatus.storage})`
          : "not configured"
      }`,
      `Remote: ${connectionState}`,
      `Accounts: ${accountSummary.whatsapp} WhatsApp / ${accountSummary.online} online / ${accountSummary.openPanels} open panels`,
      `Generated: ${snapshot?.generatedAt ?? new Date().toISOString()}`,
    ];
    return lines.join("\n");
  }, [accountSummary, connectionState, diagnostics, openAiStatus]);

  const refreshOpenAiStatus = useCallback(async () => {
    setOpenAiBusy("loading");
    try {
      const status = await loadOpenAiConfigStatus();
      setOpenAiStatus(status);
      setOpenAiMessage("");
    } catch (error) {
      setOpenAiMessage(openAiErrorMessage(error));
    } finally {
      setOpenAiBusy(null);
    }
  }, []);

  useEffect(() => {
    void refreshOpenAiStatus();
  }, [refreshOpenAiStatus]);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticsBusy("loading");
    try {
      const snapshot = await loadAppDiagnostics(diagnosticsContext);
      setDiagnostics(snapshot);
      setDiagnosticsMessage("诊断信息已刷新。");
    } catch (error) {
      setDiagnosticsMessage(openAiErrorMessage(error));
    } finally {
      setDiagnosticsBusy(null);
    }
  }, [diagnosticsContext]);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const refreshCacheStats = useCallback(async () => {
    setCacheBusy("loading");
    try {
      const stats = await loadTranslationCacheStats();
      setCacheStats(stats);
      setCacheMessage("翻译缓存统计已刷新。");
    } catch (error) {
      setCacheMessage(openAiErrorMessage(error));
    } finally {
      setCacheBusy(null);
    }
  }, []);

  useEffect(() => {
    void refreshCacheStats();
  }, [refreshCacheStats]);

  const handleClearTranslationCache = useCallback(async () => {
    setCacheBusy("clearing");
    try {
      const result = await clearTranslationCache();
      const clearAt = Date.now();
      onTranslationCacheSettingsChange({
        ...translationCacheSettings,
        clearAt,
      });
      setCacheStats({
        entries: 0,
        bytes: 0,
        formattedSize: "0 B",
        directory: result.directory,
        updatedAt: result.clearedAt,
      });
      setCacheMessage(
        `已清理 ${result.removedEntries} 条缓存，释放约 ${result.formattedSize}。`,
      );
    } catch (error) {
      setCacheMessage(openAiErrorMessage(error));
    } finally {
      setCacheBusy(null);
    }
  }, [onTranslationCacheSettingsChange, translationCacheSettings]);

  const handleCopyDiagnostics = useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        setDiagnosticsMessage("当前环境不支持自动复制，请先导出诊断包。");
        return;
      }
      await navigator.clipboard.writeText(diagnosticsSummary);
      setDiagnosticsMessage("诊断摘要已复制，可以直接发给开发人员。");
    } catch (error) {
      setDiagnosticsMessage(openAiErrorMessage(error));
    }
  }, [diagnosticsSummary]);

  const handleExportDiagnostics = useCallback(async () => {
    setDiagnosticsBusy("exporting");
    try {
      const result = await exportAppDiagnostics(diagnosticsContext);
      setDiagnostics(result.diagnostics);
      setDiagnosticsMessage(`诊断包已导出：${result.path || result.fileName}`);
    } catch (error) {
      setDiagnosticsMessage(openAiErrorMessage(error));
    } finally {
      setDiagnosticsBusy(null);
    }
  }, [diagnosticsContext]);

  const handleSaveOpenAiKey = useCallback(async () => {
    const apiKey = openAiKey.trim();
    if (!apiKey) {
      setOpenAiMessage("请先输入 OpenAI API Key。");
      return;
    }
    setOpenAiBusy("saving");
    try {
      const status = await saveOpenAiApiKey(apiKey);
      setOpenAiStatus(status);
      setOpenAiKey("");
      setOpenAiMessage("OpenAI Key 已保存。");
    } catch (error) {
      setOpenAiMessage(openAiErrorMessage(error));
    } finally {
      setOpenAiBusy(null);
    }
  }, [openAiKey]);

  const handleTestOpenAiKey = useCallback(async () => {
    setOpenAiBusy("testing");
    try {
      const result = await testOpenAiApiKey(openAiKey, openAiModel);
      setOpenAiMessage(
        result.ok
          ? `连接成功：${result.model} 可用。`
          : result.message,
      );
      const status = await loadOpenAiConfigStatus();
      setOpenAiStatus(status);
    } catch (error) {
      setOpenAiMessage(openAiErrorMessage(error));
    } finally {
      setOpenAiBusy(null);
    }
  }, [openAiKey, openAiModel]);

  const handleClearOpenAiKey = useCallback(async () => {
    setOpenAiBusy("clearing");
    try {
      const status = await clearOpenAiApiKey();
      setOpenAiStatus(status);
      setOpenAiKey("");
      setOpenAiMessage(
        status.source === "environment"
          ? "已清除本机保存的 Key；当前仍会使用系统环境变量。"
          : "OpenAI Key 已清除。",
      );
    } catch (error) {
      setOpenAiMessage(openAiErrorMessage(error));
    } finally {
      setOpenAiBusy(null);
    }
  }, []);

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

      <section className="settings-card openai-config-card">
        <div className="settings-card-head">
          <div className="settings-icon violet">
            <KeyRound size={22} />
          </div>
          <div>
            <span className="eyebrow">OPENAI</span>
            <h3>OpenAI Key 管理</h3>
            <p>
              保存后 WhatsApp 翻译会优先使用本机加密 Key；环境变量
              OPENAI_API_KEY 仍作为兜底。
            </p>
          </div>
        </div>

        <div
          className={`openai-status ${openAiStatus.configured ? "configured" : "empty"}`}
        >
          <span className="connection-status-icon">
            {openAiBusy === "loading" ? (
              <LoaderCircle size={19} className="spin" />
            ) : openAiStatus.configured ? (
              <Check size={19} />
            ) : (
              <KeyRound size={19} />
            )}
          </span>
          <span>
            <strong>{openAiCopy.title}</strong>
            <small>{openAiCopy.description}</small>
          </span>
          <code>{openAiMaskedKey}</code>
        </div>

        <div className="settings-form">
          <label>
            <span>API Key</span>
            <div className="input-shell">
              <LockKeyhole size={16} />
              <input
                type="password"
                value={openAiKey}
                placeholder="sk-..."
                autoComplete="off"
                onChange={(event) => setOpenAiKey(event.target.value)}
              />
            </div>
            <small>
              不会写入代码或日志；Windows 下会使用当前用户的 DPAPI 加密保存。
            </small>
          </label>

          <div className="form-row">
            <label>
              <span>测试模型</span>
              <div className="input-shell">
                <Server size={16} />
                <select
                  value={openAiModel}
                  onChange={(event) => setOpenAiModel(event.target.value)}
                >
                  {openAiModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              <span>存储来源</span>
              <div className="input-shell readonly">
                <KeyRound size={16} />
                <input
                  value={`${openAiStatus.source} · ${openAiStatus.storage}`}
                  readOnly
                />
              </div>
            </label>
          </div>

          {openAiMessage ? (
            <div
              className={`openai-message ${
                openAiMessage.includes("成功") || openAiMessage.includes("已")
                  ? "success"
                  : "error"
              }`}
            >
              {openAiMessage}
            </div>
          ) : null}

          <div className="settings-actions">
            <button
              className="secondary-button"
              onClick={() => void handleTestOpenAiKey()}
              disabled={openAiBusyNow || (!openAiKey.trim() && !openAiStatus.configured)}
            >
              {openAiBusy === "testing" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              测试连接
            </button>
            <button
              className="secondary-button danger-soft"
              onClick={() => void handleClearOpenAiKey()}
              disabled={openAiBusyNow || openAiStatus.source === "none"}
            >
              清除 Key
            </button>
            <button
              className="primary-button"
              onClick={() => void handleSaveOpenAiKey()}
              disabled={openAiBusyNow || !openAiKey.trim()}
            >
              {openAiBusy === "saving" ? (
                <LoaderCircle size={16} className="spin" />
              ) : null}
              保存 Key
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card translation-cache-card">
        <div className="settings-card-head">
          <div className="settings-icon green">
            <Database size={22} />
          </div>
          <div>
            <span className="eyebrow">TRANSLATION CACHE</span>
            <h3>翻译缓存管理</h3>
            <p>
              管理接收消息翻译的本地缓存。缓存命中后会直接显示译文，减少重复请求和等待时间。
            </p>
          </div>
        </div>

        <div className="translation-cache-summary">
          <div>
            <span>缓存占用</span>
            <strong>{cacheStats.formattedSize}</strong>
            <small>{cacheStats.entries} 条后端缓存记录</small>
          </div>
          <div>
            <span>保留时间</span>
            <strong>{translationCacheSettings.retentionDays} 天</strong>
            <small>超过后自动清理 WebView 即时缓存</small>
          </div>
          <div>
            <span>单账号上限</span>
            <strong>{translationCacheSettings.perAccountLimit} 条</strong>
            <small>每个 WhatsApp 账号独立限制</small>
          </div>
        </div>

        <div className="settings-form translation-cache-form">
          <div className="form-row">
            <label>
              <span>缓存保留天数</span>
              <div className="input-shell">
                <Database size={16} />
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={translationCacheSettings.retentionDays}
                  onChange={(event) =>
                    updateCacheSetting("retentionDays", Number(event.target.value))
                  }
                />
              </div>
              <small>建议 30-90 天；太长会占更多硬盘空间。</small>
            </label>
            <label>
              <span>每账号缓存条数</span>
              <div className="input-shell">
                <Database size={16} />
                <input
                  type="number"
                  min={20}
                  max={2000}
                  value={translationCacheSettings.perAccountLimit}
                  onChange={(event) =>
                    updateCacheSetting("perAccountLimit", Number(event.target.value))
                  }
                />
              </div>
              <small>建议 200-500 条；账号很多时可以调低。</small>
            </label>
          </div>

          <label className="translation-cache-toggle">
            <span>
              <strong>自动翻译历史消息</strong>
              <small>
                打开后，往上翻到未翻译的英文消息会自动补翻译；关闭后只显示手动“翻译”按钮。
              </small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={translationCacheSettings.autoTranslateHistory}
              className={
                translationCacheSettings.autoTranslateHistory
                  ? "wa-toggle on"
                  : "wa-toggle"
              }
              onClick={() =>
                updateCacheSetting(
                  "autoTranslateHistory",
                  !translationCacheSettings.autoTranslateHistory,
                )
              }
            >
              <i />
            </button>
          </label>

          {cacheMessage ? (
            <div className="diagnostics-message">{cacheMessage}</div>
          ) : null}

          <div className="settings-actions">
            <button
              className="secondary-button"
              onClick={() => void refreshCacheStats()}
              disabled={cacheBusy !== null}
            >
              {cacheBusy === "loading" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              刷新占用
            </button>
            <button
              className="secondary-button danger-soft"
              onClick={() => void handleClearTranslationCache()}
              disabled={cacheBusy !== null}
            >
              {cacheBusy === "clearing" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              一键清理翻译缓存
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card translation-log-card">
        <div className="settings-card-head">
          <div className="settings-icon violet">
            <Activity size={22} />
          </div>
          <div>
            <span className="eyebrow">TRANSLATION LOGS</span>
            <h3>翻译日志</h3>
            <p>
              记录最近翻译请求的耗时、缓存命中和失败原因。不会保存完整消息正文，只记录文本长度。
            </p>
          </div>
        </div>

        <div className="translation-log-summary">
          <div>
            <span>最近记录</span>
            <strong>{translationLogSummary.total}</strong>
            <small>最多保留最近 160 条</small>
          </div>
          <div>
            <span>缓存命中</span>
            <strong>{translationLogSummary.cacheHits}</strong>
            <small>内存/硬盘/等待复用</small>
          </div>
          <div>
            <span>失败</span>
            <strong>{translationLogSummary.failed}</strong>
            <small>可用于定位 Key、额度、网络问题</small>
          </div>
          <div>
            <span>平均耗时</span>
            <strong>{formatDuration(translationLogSummary.averageDuration)}</strong>
            <small>包含缓存命中记录</small>
          </div>
        </div>

        <div className="translation-log-list">
          {recentTranslationLogs.map((log) => {
            const cacheLabel = log.cacheStatus
              ? cacheStatusCopy[String(log.cacheStatus)] ?? String(log.cacheStatus)
              : "无缓存";
            return (
              <article
                key={log.id}
                className={log.success ? "translation-log-item" : "translation-log-item failed"}
              >
                <div className="translation-log-main">
                  <strong>{log.purpose === "incoming" ? "接收翻译" : "发送翻译"}</strong>
                  <span>{formatLogTime(log.createdAt)} · {log.accountId.slice(0, 14)}…</span>
                </div>
                <div className="translation-log-meta">
                  <span className={log.success ? "ok" : "bad"}>
                    {log.success ? "成功" : log.errorCode ?? "失败"}
                  </span>
                  <span>{cacheLabel}</span>
                  <span>{formatDuration(log.durationMs)}</span>
                  <span>{log.textChars} 字符</span>
                  {log.model ? <span>{log.model}</span> : null}
                </div>
                {!log.success && log.message ? (
                  <p>{log.message}</p>
                ) : null}
              </article>
            );
          })}
          {recentTranslationLogs.length === 0 && (
            <div className="translation-log-empty">
              还没有翻译日志。发送或接收翻译一次后，这里会出现记录。
            </div>
          )}
        </div>

        <div className="settings-actions">
          <button
            className="secondary-button"
            onClick={onClearTranslationLogs}
            disabled={translationLogs.length === 0}
          >
            清空日志
          </button>
        </div>
      </section>

      <section className="settings-card diagnostics-card">
        <div className="settings-card-head">
          <div className="settings-icon">
            <Server size={22} />
          </div>
          <div>
            <span className="eyebrow">DIAGNOSTICS</span>
            <h3>测试诊断</h3>
            <p>
              发给别人测试时，如果出现界面、翻译、账号切换问题，可以先导出诊断包再截图反馈。
              诊断包不会包含真实 OpenAI Key。
            </p>
          </div>
        </div>

        <div className="diagnostics-grid">
          <div>
            <span>应用版本</span>
            <strong>v{diagnostics?.app.version ?? "0.1.0"}</strong>
            <small>{diagnostics?.system.buildProfile ?? "unknown"}</small>
          </div>
          <div>
            <span>运行系统</span>
            <strong>
              {diagnostics?.system.os ?? "unknown"} /{" "}
              {diagnostics?.system.arch ?? "unknown"}
            </strong>
            <small>PID {diagnostics?.system.processId ?? "-"}</small>
          </div>
          <div>
            <span>OpenAI</span>
            <strong>{openAiStatus.configured ? "已配置" : "未配置"}</strong>
            <small>{openAiStatus.source}</small>
          </div>
          <div>
            <span>WhatsApp 账号</span>
            <strong>{accountSummary.whatsapp} 个</strong>
            <small>
              在线 {accountSummary.online} · 已打开 {accountSummary.openPanels}
            </small>
          </div>
        </div>

        <div className="diagnostics-list">
          <div>
            <span>配置目录</span>
            <code>{diagnostics?.paths.appConfigDir ?? "待刷新"}</code>
          </div>
          <div>
            <span>日志目录</span>
            <code>{diagnostics?.paths.appLogDir ?? "待刷新"}</code>
          </div>
          <div>
            <span>环境变量 Key</span>
            <code>
              {diagnostics?.environment.hasOpenaiApiKey ? "OPENAI_API_KEY 已检测到" : "未检测到"}
            </code>
          </div>
        </div>

        {diagnosticsMessage ? (
          <div className="diagnostics-message">{diagnosticsMessage}</div>
        ) : null}

        <div className="settings-actions">
          <button
            className="secondary-button"
            onClick={() => void refreshDiagnostics()}
            disabled={diagnosticsBusy !== null}
          >
            {diagnosticsBusy === "loading" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            刷新诊断
          </button>
          <button
            className="secondary-button"
            onClick={() => void handleCopyDiagnostics()}
            disabled={diagnosticsBusy !== null}
          >
            复制摘要
          </button>
          <button
            className="primary-button"
            onClick={() => void handleExportDiagnostics()}
            disabled={diagnosticsBusy !== null}
          >
            {diagnosticsBusy === "exporting" ? (
              <LoaderCircle size={16} className="spin" />
            ) : null}
            导出诊断包
          </button>
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
