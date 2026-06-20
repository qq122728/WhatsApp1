import { X } from "lucide-react";
import { useState } from "react";
import type { AccountConfig } from "../types";
import {
  defaultAccountConfig,
  TRANSLATION_CHANNELS,
  TRANSLATION_SERVERS,
  TARGET_LANGUAGES,
  SOURCE_LANGUAGES,
  FONT_SIZES,
} from "../types";

interface NewAccountFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: AccountConfig) => void;
}

export function NewAccountForm({ open, onClose, onSave }: NewAccountFormProps) {
  const [config, setConfig] = useState<AccountConfig>({ ...defaultAccountConfig });

  if (!open) return null;

  const update = <K extends keyof AccountConfig>(key: K, value: AccountConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    onSave(config);
    setConfig({ ...defaultAccountConfig });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card wa-config-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>新增 {config.name}</h2>
            <p>只有翻译和智能回复功能，应用更稳定，无其他自定义功能</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="wa-config-form">
          {/* 名称 */}
          <label className="wa-config-full">
            <span>名称</span>
            <input
              type="text"
              value={config.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>

          {/* Row: 翻译通道 + 翻译服务器 */}
          <div className="wa-config-row">
            <label>
              <span>翻译通道</span>
              <select
                value={config.translationChannel}
                onChange={(e) => update("translationChannel", e.target.value)}
              >
                {TRANSLATION_CHANNELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <span>翻译服务器</span>
              <select
                value={config.translationServer}
                onChange={(e) => update("translationServer", e.target.value)}
              >
                {TRANSLATION_SERVERS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Row: 发送翻译 + 接收翻译 */}
          <div className="wa-config-row">
            <label className="wa-toggle-label">
              <span>发送翻译</span>
              <button
                type="button"
                className={config.sendTranslation ? "wa-toggle on" : "wa-toggle"}
                onClick={() => update("sendTranslation", !config.sendTranslation)}
              >
                <i />
              </button>
            </label>
            <label className="wa-toggle-label">
              <span>接收翻译</span>
              <button
                type="button"
                className={config.receiveTranslation ? "wa-toggle on" : "wa-toggle"}
                onClick={() => update("receiveTranslation", !config.receiveTranslation)}
              >
                <i />
              </button>
            </label>
          </div>

          {/* Row: 对方的语言 + 自己的语言 */}
          <div className="wa-config-row">
            <label>
              <span>对方的语言</span>
              <select
                value={config.targetLanguage}
                onChange={(e) => update("targetLanguage", e.target.value)}
              >
                {TARGET_LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              <span>自己的语言</span>
              <select
                value={config.sourceLanguage}
                onChange={(e) => update("sourceLanguage", e.target.value)}
              >
                {SOURCE_LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>

          <hr className="wa-config-divider" />

          {/* Row: 群组翻译 + 禁止中文 */}
          <div className="wa-config-row">
            <label className="wa-toggle-label">
              <span>群组翻译</span>
              <button
                type="button"
                className={config.groupTranslation ? "wa-toggle on" : "wa-toggle"}
                onClick={() => update("groupTranslation", !config.groupTranslation)}
              >
                <i />
              </button>
            </label>
            <label className="wa-toggle-label">
              <span>禁止中文</span>
              <button
                type="button"
                className={config.blockChinese ? "wa-toggle on" : "wa-toggle"}
                onClick={() => update("blockChinese", !config.blockChinese)}
              >
                <i />
              </button>
            </label>
          </div>

          {/* Row: 字号大小 + 字体颜色 */}
          <div className="wa-config-row">
            <label>
              <span>字号大小</span>
              <select
                value={config.fontSize}
                onChange={(e) => update("fontSize", Number(e.target.value))}
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>{s} px</option>
                ))}
              </select>
            </label>
            <label>
              <span>字体颜色</span>
              <div className="wa-color-input">
                <input
                  type="color"
                  value={config.fontColor}
                  onChange={(e) => update("fontColor", e.target.value)}
                />
                <span style={{ background: config.fontColor }}>{config.fontColor}</span>
              </div>
            </label>
          </div>

          <button className="wa-config-save" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
