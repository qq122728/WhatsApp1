import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  ExternalLink,
  Languages,
  Monitor,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Square,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import type { Account, AccountConfig } from "../types";
import { PlatformIcon } from "../components/PlatformIcon";
import {
  createPreset,
  extractPresetConfig,
  loadPresets,
  savePresets,
  type TranslationPreset,
} from "../lib/translation-presets";

type AccountFilter = "all" | "online" | "attention" | "unread" | "open";

interface AccountsViewProps {
  accounts: Account[];
  accountConfigs: Record<string, AccountConfig>;
  openPanels: string[];
  onAddAccount: () => void;
  onToggleTranslation: (id: string) => void;
  onViewPanel: (id: string) => void;
  onRelogin: (id: string) => void;
  onDelete: (id: string) => void;
  onEditSettings: (id: string) => void;
  onBatchOpen: (ids: string[]) => void;
  onBatchClose: (ids: string[]) => void;
  onBatchDelete: (ids: string[]) => void;
  onBatchApplyPreset: (ids: string[], preset: TranslationPreset) => void;
}

const statusLabel: Record<Account["status"], string> = {
  online: "在线",
  offline: "未打开",
  expired: "需扫码",
};

export function AccountsView({
  accounts,
  accountConfigs,
  openPanels,
  onAddAccount,
  onToggleTranslation,
  onViewPanel,
  onRelogin,
  onDelete,
  onEditSettings,
  onBatchOpen,
  onBatchClose,
  onBatchDelete,
  onBatchApplyPreset,
}: AccountsViewProps) {
  const waAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.platform === "whatsapp" && account.id.startsWith("wa_"),
      ),
    [accounts],
  );

  const openSet = useMemo(() => new Set(openPanels), [openPanels]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [presets, setPresets] = useState<TranslationPreset[]>(loadPresets);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);

  const onlineCount = waAccounts.filter((a) => a.status === "online").length;
  const attentionCount = waAccounts.filter((a) => a.status !== "online").length;
  const unreadAccountCount = waAccounts.filter(
    (a) => (a.unreadCount ?? 0) > 0,
  ).length;
  const openCount = waAccounts.filter((a) => openSet.has(a.id)).length;

  // Drop selections / presets that point at accounts which no longer exist.
  useEffect(() => {
    const valid = new Set(waAccounts.map((a) => a.id));
    setSelectedIds((current) => current.filter((id) => valid.has(id)));
  }, [waAccounts]);

  useEffect(() => {
    if (!presetMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!presetMenuRef.current?.contains(event.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [presetMenuOpen]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matching = waAccounts.filter((account) => {
    const name = (accountConfigs[account.id]?.name ?? account.name).toLocaleLowerCase();
    const matchesQuery =
      !normalizedQuery ||
      name.includes(normalizedQuery) ||
      account.id.toLocaleLowerCase().includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (filter === "online") return account.status === "online";
    if (filter === "attention") return account.status !== "online";
    if (filter === "unread") return (account.unreadCount ?? 0) > 0;
    if (filter === "open") return openSet.has(account.id);
    return true;
  });

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const matchingIds = matching.map((a) => a.id);
  const selectedMatchingCount = matchingIds.filter((id) =>
    selectedSet.has(id),
  ).length;
  const selectedOpenCount = selectedIds.filter((id) => openSet.has(id)).length;
  const selectedClosedCount = selectedIds.length - selectedOpenCount;

  const formatUnread = (value?: number) => {
    const count = Math.max(0, value ?? 0);
    if (!count) return "";
    return count > 99 ? "99+" : String(count);
  };

  const toggleSelectionMode = () => {
    setSelectionMode((current) => {
      if (current) setSelectedIds([]);
      return !current;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const selectAllMatching = () =>
    setSelectedIds((current) =>
      Array.from(new Set([...current, ...matchingIds])),
    );
  const clearSelection = () => setSelectedIds([]);

  const updatePresets = (next: TranslationPreset[]) => {
    setPresets(next);
    savePresets(next);
  };

  const handleSavePresetFromSelection = () => {
    if (selectedIds.length !== 1) return;
    const source = accountConfigs[selectedIds[0]];
    if (!source) return;
    const name = window.prompt(
      "为这套翻译配置起个名字（之后可批量套用）：",
      `${source.name} 配置`,
    );
    if (name === null) return;
    updatePresets([
      ...presets,
      createPreset(name, extractPresetConfig(source)),
    ]);
  };

  const handleApplyPreset = (preset: TranslationPreset) => {
    if (selectedIds.length === 0) return;
    onBatchApplyPreset(selectedIds, preset);
    setPresetMenuOpen(false);
  };

  const filters: Array<[AccountFilter, string]> = [
    ["all", `全部 ${waAccounts.length}`],
    ["online", `在线 ${onlineCount}`],
    ["attention", `待处理 ${attentionCount}`],
    ["unread", `有未读 ${unreadAccountCount}`],
    ["open", `已打开 ${openCount}`],
  ];

  return (
    <div className="view accounts-cockpit">
      <div className="cockpit-toolbar">
        <label className="cockpit-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索备注或账号 ID"
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <div className="cockpit-toolbar-actions">
          <button
            type="button"
            className={selectionMode ? "ghost-button active" : "ghost-button"}
            onClick={toggleSelectionMode}
          >
            <CheckSquare size={15} />
            {selectionMode ? "退出多选" : "多选"}
          </button>
          <button className="primary-button small" onClick={onAddAccount}>
            <Plus size={16} /> 添加账号
          </button>
        </div>
      </div>

      <div className="cockpit-filters">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {selectionMode && (
        <div className="cockpit-bulk-bar">
          <div className="cockpit-bulk-summary">
            <strong>已选 {selectedIds.length} 个</strong>
            <span>当前筛选 {selectedMatchingCount}/{matching.length}</span>
          </div>
          <div className="cockpit-bulk-actions">
            <button
              type="button"
              disabled={matching.length === 0}
              onClick={selectAllMatching}
            >
              全选当前
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={clearSelection}
            >
              清空
            </button>
            <button
              type="button"
              disabled={selectedClosedCount === 0}
              onClick={() => onBatchOpen(selectedIds)}
            >
              <ExternalLink size={14} />
              打开 {selectedClosedCount > 0 ? selectedClosedCount : ""}
            </button>
            <button
              type="button"
              disabled={selectedOpenCount === 0}
              onClick={() => onBatchClose(selectedIds)}
            >
              <Monitor size={14} />
              关闭 {selectedOpenCount > 0 ? selectedOpenCount : ""}
            </button>
            <div className="cockpit-preset-wrap" ref={presetMenuRef}>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => setPresetMenuOpen((open) => !open)}
              >
                <WandSparkles size={14} />
                套用预设
              </button>
              {presetMenuOpen && (
                <div className="cockpit-preset-menu" role="menu">
                  {presets.length === 0 ? (
                    <div className="cockpit-preset-empty">
                      还没有预设。选中一个账号后点“存为预设”。
                    </div>
                  ) : (
                    presets.map((preset) => (
                      <div key={preset.id} className="cockpit-preset-item">
                        <button
                          type="button"
                          className="cockpit-preset-apply"
                          onClick={() => handleApplyPreset(preset)}
                        >
                          <Languages size={14} />
                          <span>
                            <strong>{preset.name}</strong>
                            <small>
                              {preset.config.sourceLanguage} →{" "}
                              {preset.config.targetLanguage} ·{" "}
                              {preset.config.translationChannel}
                            </small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="cockpit-preset-delete"
                          aria-label={`删除预设 ${preset.name}`}
                          onClick={() =>
                            updatePresets(
                              presets.filter((item) => item.id !== preset.id),
                            )
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={selectedIds.length !== 1}
              title={
                selectedIds.length === 1
                  ? "把所选账号的翻译配置存为预设"
                  : "选中且仅选中一个账号才能存为预设"
              }
              onClick={handleSavePresetFromSelection}
            >
              <Save size={14} />
              存为预设
            </button>
            <button
              type="button"
              className="danger"
              disabled={selectedIds.length === 0}
              onClick={() => onBatchDelete(selectedIds)}
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
        </div>
      )}

      {matching.length > 0 ? (
        <div className="cockpit-list">
          {matching.map((account) => {
            const config = accountConfigs[account.id];
            const name = config?.name ?? account.name;
            const isOpen = openSet.has(account.id);
            const selected = selectedSet.has(account.id);
            return (
              <article
                key={account.id}
                className={`cockpit-row${selected ? " selected" : ""}`}
              >
                {selectionMode && (
                  <button
                    type="button"
                    className="cockpit-row-check"
                    aria-pressed={selected}
                    onClick={() => toggleSelected(account.id)}
                  >
                    {selected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                )}
                <button
                  type="button"
                  className="cockpit-row-main"
                  onClick={() =>
                    selectionMode
                      ? toggleSelected(account.id)
                      : onViewPanel(account.id)
                  }
                >
                  <span
                    className="cockpit-row-icon"
                    style={{ color: account.accent, background: `${account.accent}16` }}
                  >
                    <PlatformIcon platform="whatsapp" size={18} />
                  </span>
                  <span className="cockpit-row-copy">
                    <strong>{name}</strong>
                    <small>{account.id}</small>
                  </span>
                  {formatUnread(account.unreadCount) && (
                    <span className="cockpit-row-unread">
                      {formatUnread(account.unreadCount)}
                    </span>
                  )}
                  <span className={`cockpit-row-status ${account.status}`}>
                    {statusLabel[account.status]}
                  </span>
                  {isOpen && <span className="cockpit-row-openflag">会话中</span>}
                </button>
                {!selectionMode && (
                  <div className="cockpit-row-actions">
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title={isOpen ? "查看会话" : "打开会话"}
                      onClick={() => onViewPanel(account.id)}
                    >
                      <ExternalLink size={15} />
                    </button>
                    <button
                      type="button"
                      className={
                        account.translationEnabled
                          ? "cockpit-icon-btn on"
                          : "cockpit-icon-btn"
                      }
                      title="自动翻译开关"
                      onClick={() => onToggleTranslation(account.id)}
                    >
                      <Languages size={15} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title="翻译与账号设置"
                      onClick={() => onEditSettings(account.id)}
                    >
                      <Settings size={15} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn"
                      title="重新登录"
                      onClick={() => onRelogin(account.id)}
                    >
                      <RotateCcw size={15} />
                    </button>
                    <button
                      type="button"
                      className="cockpit-icon-btn danger"
                      title="删除账号"
                      onClick={() => onDelete(account.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="account-empty">
          <strong>
            {waAccounts.length === 0 ? "还没有 WhatsApp 账号" : "没有匹配的账号"}
          </strong>
          <span>
            {waAccounts.length === 0
              ? "添加账号后会创建独立的本机 Session；已有 Profile 会自动恢复。"
              : "试试调整搜索或筛选条件。"}
          </span>
          {waAccounts.length === 0 && (
            <button className="primary-button small" onClick={onAddAccount}>
              <Plus size={16} /> 添加 WhatsApp
            </button>
          )}
        </div>
      )}
    </div>
  );
}
