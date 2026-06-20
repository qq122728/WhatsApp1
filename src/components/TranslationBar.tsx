import type { AccountConfig } from "../types";
import {
  TRANSLATION_CHANNELS,
  TRANSLATION_SERVERS,
  TARGET_LANGUAGES,
  SOURCE_LANGUAGES,
  FONT_SIZES,
} from "../types";

interface TranslationBarProps {
  config: AccountConfig;
  onChange: (config: AccountConfig) => void;
}

export function TranslationBar({ config, onChange }: TranslationBarProps) {
  const update = <K extends keyof AccountConfig>(key: K, value: AccountConfig[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <div className="translation-bar">
      <div className="translation-bar-row">
        <label className="tb-field">
          <input
            type="checkbox"
            checked={config.receiveTranslation}
            onChange={() => update("receiveTranslation", !config.receiveTranslation)}
          />
          <span className="tb-label">对方的语言</span>
          <select
            className="tb-select"
            value={config.targetLanguage}
            onChange={(e) => update("targetLanguage", e.target.value)}
          >
            {TARGET_LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>

        <label className="tb-field">
          <span className="tb-label">翻译通道</span>
          <select
            className="tb-select"
            value={config.translationChannel}
            onChange={(e) => update("translationChannel", e.target.value)}
          >
            {TRANSLATION_CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>

        <label className="tb-field">
          <span className="tb-label">字号大小</span>
          <select
            className="tb-select narrow"
            value={config.fontSize}
            onChange={(e) => update("fontSize", Number(e.target.value))}
          >
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}
          </select>
        </label>

        <label className="tb-field">
          <span className="tb-label">群组翻译</span>
          <button
            type="button"
            className={config.groupTranslation ? "wa-toggle on small" : "wa-toggle small"}
            onClick={() => update("groupTranslation", !config.groupTranslation)}
          >
            <i />
          </button>
        </label>
      </div>

      <div className="translation-bar-row">
        <label className="tb-field">
          <input
            type="checkbox"
            checked={config.sendTranslation}
            onChange={() => update("sendTranslation", !config.sendTranslation)}
          />
          <span className="tb-label">自己的语言</span>
          <select
            className="tb-select"
            value={config.sourceLanguage}
            onChange={(e) => update("sourceLanguage", e.target.value)}
          >
            {SOURCE_LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>

        <label className="tb-field">
          <span className="tb-label">翻译服务器</span>
          <select
            className="tb-select"
            value={config.translationServer}
            onChange={(e) => update("translationServer", e.target.value)}
          >
            {TRANSLATION_SERVERS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="tb-latency">261 ms</span>
        </label>

        <label className="tb-field">
          <span className="tb-label">字体颜色</span>
          <span className="tb-color" style={{ background: config.fontColor }}>
            {config.fontColor}
          </span>
        </label>

        <label className="tb-field">
          <span className="tb-label">禁止中文</span>
          <button
            type="button"
            className={config.blockChinese ? "wa-toggle on small" : "wa-toggle small"}
            onClick={() => update("blockChinese", !config.blockChinese)}
          >
            <i />
          </button>
        </label>
      </div>
    </div>
  );
}
