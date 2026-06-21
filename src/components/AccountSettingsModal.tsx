import { Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  FONT_SIZES,
  REGIONAL_TONES,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  TRANSLATION_CHANNELS,
  TRANSLATION_SERVERS,
  TRANSLATION_STYLES,
  type AccountConfig,
} from "../types";

interface AccountSettingsModalProps {
  accountId: string;
  config: AccountConfig;
  open: boolean;
  onClose: () => void;
  onSave: (config: AccountConfig) => void;
}

export function AccountSettingsModal({
  accountId,
  config,
  open,
  onClose,
  onSave,
}: AccountSettingsModalProps) {
  const [draft, setDraft] = useState<AccountConfig>(config);

  useEffect(() => {
    if (open) setDraft({ ...config });
  }, [accountId, config, open]);

  if (!open) return null;

  const update = <K extends keyof AccountConfig>(
    key: K,
    value: AccountConfig[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal-card wa-config-card account-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div className="account-settings-heading">
            <span className="account-settings-heading-icon">
              <Settings size={18} />
            </span>
            <div>
              <h2 id="account-settings-title">账号设置</h2>
              <p>{accountId}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭账号设置">
            <X size={16} />
          </button>
        </div>

        <div className="wa-config-form">
          <label className="wa-config-full">
            <span>账号备注</span>
            <input
              type="text"
              maxLength={32}
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>

          <div className="wa-config-row">
            <label>
              <span>翻译通道</span>
              <select
                value={draft.translationChannel}
                onChange={(event) =>
                  update("translationChannel", event.target.value)
                }
              >
                {TRANSLATION_CHANNELS.map((channel) => (
                  <option key={channel}>{channel}</option>
                ))}
              </select>
            </label>
            <label>
              <span>翻译服务器</span>
              <select
                value={draft.translationServer}
                onChange={(event) =>
                  update("translationServer", event.target.value)
                }
              >
                {TRANSLATION_SERVERS.map((server) => (
                  <option key={server}>{server}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="wa-config-row">
            <label>
              <span>翻译风格</span>
              <select
                value={draft.translationStyle}
                onChange={(event) =>
                  update("translationStyle", event.target.value)
                }
              >
                {TRANSLATION_STYLES.map((style) => (
                  <option key={style}>{style}</option>
                ))}
              </select>
            </label>
            <label>
              <span>地区口吻</span>
              <select
                value={draft.regionalTone}
                onChange={(event) =>
                  update("regionalTone", event.target.value)
                }
              >
                {REGIONAL_TONES.map((tone) => (
                  <option key={tone}>{tone}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="wa-config-row">
            <label>
              <span>对方的语言</span>
              <select
                value={draft.targetLanguage}
                onChange={(event) =>
                  update("targetLanguage", event.target.value)
                }
              >
                {TARGET_LANGUAGES.map((language) => (
                  <option key={language}>{language}</option>
                ))}
              </select>
            </label>
            <label>
              <span>自己的语言</span>
              <select
                value={draft.sourceLanguage}
                onChange={(event) =>
                  update("sourceLanguage", event.target.value)
                }
              >
                {SOURCE_LANGUAGES.map((language) => (
                  <option key={language}>{language}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="account-settings-toggles">
            {(
              [
                ["sendTranslation", "发送翻译"],
                ["receiveTranslation", "接收翻译"],
                ["groupTranslation", "群组翻译"],
                ["blockChinese", "禁止中文"],
              ] as Array<
                [
                  | "sendTranslation"
                  | "receiveTranslation"
                  | "groupTranslation"
                  | "blockChinese",
                  string,
                ]
              >
            ).map(([key, label]) => (
              <label className="wa-toggle-label account-settings-toggle" key={key}>
                <span>{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft[key]}
                  className={draft[key] ? "wa-toggle on" : "wa-toggle"}
                  onClick={() => update(key, !draft[key])}
                >
                  <i />
                </button>
              </label>
            ))}
          </div>

          <div className="wa-config-row">
            <label>
              <span>字号大小</span>
              <select
                value={draft.fontSize}
                onChange={(event) =>
                  update("fontSize", Number(event.target.value))
                }
              >
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>字体颜色</span>
              <div className="wa-color-input">
                <input
                  type="color"
                  value={draft.fontColor}
                  onChange={(event) => update("fontColor", event.target.value)}
                />
                <span style={{ background: draft.fontColor }}>
                  {draft.fontColor.toUpperCase()}
                </span>
              </div>
            </label>
          </div>

          <div className="account-settings-footer">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={!draft.name.trim()}
              onClick={() => onSave({ ...draft, name: draft.name.trim() })}
            >
              保存设置
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
