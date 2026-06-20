import { useEffect, useMemo, useState } from "react";
import { Languages, LoaderCircle, Search, Send, Sparkles } from "lucide-react";
import type { Message } from "../types";
import { PlatformIcon } from "../components/PlatformIcon";
import {
  MockTranslationProvider,
  TranslationService,
} from "../features/translation";

interface MessagesViewProps {
  messages: Message[];
}

export function MessagesView({ messages }: MessagesViewProps) {
  const active = messages[0];
  const translationService = useMemo(
    () => new TranslationService(new MockTranslationProvider({ latencyMs: 180 })),
    [],
  );
  const [draft, setDraft] = useState("");
  const [translatedDraft, setTranslatedDraft] = useState("");
  const [translationState, setTranslationState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [queueNotice, setQueueNotice] = useState("");

  useEffect(() => {
    const normalized = draft.trim();
    if (!normalized) {
      setTranslatedDraft("");
      setTranslationState("idle");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setTranslationState("loading");
      try {
        const result = await translationService.translate(
          {
            text: normalized,
            targetLanguage: "en",
            glossaryVersion: "support-v1",
          },
          { signal: controller.signal },
        );
        setTranslatedDraft(result.translatedText);
        setTranslationState("ready");
      } catch {
        if (!controller.signal.aborted) {
          setTranslatedDraft("");
          setTranslationState("error");
        }
      }
    }, 280);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [draft, translationService]);

  const handleDemoSend = () => {
    if (!draft.trim() || translationState !== "ready") return;
    setQueueNotice("译文已确认并进入本地演示队列；尚未连接真实平台。");
    setDraft("");
    setTranslatedDraft("");
    setTranslationState("idle");
  };

  return (
    <div className="view messages-layout">
      <section className="conversation-panel">
        <label className="conversation-search">
          <Search size={16} />
          <input placeholder="搜索会话" />
        </label>
        <div className="conversation-filters">
          <button className="active">全部</button>
          <button>未读 2</button>
        </div>
        <div className="conversation-list">
          {messages.map((message, index) => (
            <button
              key={message.id}
              className={index === 0 ? "conversation active" : "conversation"}
            >
              <span className={`message-platform ${message.platform}`}>
                <PlatformIcon platform={message.platform} size={18} />
              </span>
              <span>
                <strong>{message.contact}</strong>
                <small>{message.original}</small>
              </span>
              <time>{message.time}</time>
            </button>
          ))}
        </div>
      </section>

      <section className="chat-panel">
        <header className="chat-head">
          <div className="contact-avatar">OM</div>
          <div>
            <strong>{active.contact}</strong>
            <span>
              <i /> WhatsApp · 北美客服
            </span>
          </div>
          <button className="secondary-button compact-button">
            查看联系人
          </button>
        </header>

        <div className="chat-body">
          <span className="date-divider">今天</span>
          <div className="chat-bubble incoming">
            <p>{active.original}</p>
            <div className="bubble-translation">
              <Sparkles size={13} />
              <span>{active.translation}</span>
            </div>
            <time>{active.time}</time>
          </div>
          <div className="chat-bubble outgoing">
            <p>
              Of course. Your order is scheduled to arrive this Friday.
            </p>
            <div className="bubble-translation">
              <Languages size={13} />
              <span>当然，您的订单预计本周五送达。</span>
            </div>
            <time>10:45 · 已发送</time>
          </div>
        </div>

        <footer className="composer">
          <div className={`translation-preview ${translationState}`}>
            {translationState === "loading" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Sparkles size={14} />
            )}
            <span>
              {translationState === "idle" &&
                "自动翻译已开启 · 输入中文后生成英文预览"}
              {translationState === "loading" && "正在生成英文翻译预览..."}
              {translationState === "ready" && (
                <>
                  译文预览：<strong>{translatedDraft}</strong>
                </>
              )}
              {translationState === "error" &&
                "翻译暂时失败，原文仍会保留，请稍后重试。"}
            </span>
          </div>
          {queueNotice && <div className="queue-notice">{queueNotice}</div>}
          <div className="composer-row">
            <textarea
              value={draft}
              placeholder="输入中文，发送前会显示英文翻译预览..."
              onChange={(event) => {
                setDraft(event.target.value);
                setQueueNotice("");
              }}
            />
            <button
              aria-label="确认译文并发送"
              disabled={!draft.trim() || translationState !== "ready"}
              onClick={handleDemoSend}
            >
              <Send size={18} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
