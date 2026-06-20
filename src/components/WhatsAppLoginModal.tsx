import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  QrCode,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  beginWhatsAppLogin,
  closeWhatsAppLogin,
  getWhatsAppLoginStatus,
  type WhatsAppLoginState,
} from "../lib/whatsapp";

interface WhatsAppLoginModalProps {
  accountId: string | null;
  onClose: () => void;
  onAuthenticated: (accountId: string) => void;
}

const stateCopy: Record<
  WhatsAppLoginState,
  { title: string; description: string }
> = {
  starting: {
    title: "正在打开 WhatsApp Web",
    description: "首次启动 Chrome 可能需要几秒钟。",
  },
  awaiting_qr: {
    title: "请使用手机扫码",
    description: "在手机 WhatsApp 的“关联设备”中扫描浏览器二维码。",
  },
  authenticated: {
    title: "登录成功",
    description: "本地 Profile 已保留，下次可以恢复登录状态。",
  },
  closed: {
    title: "登录窗口已关闭",
    description: "重新打开此流程即可继续扫码。",
  },
  error: {
    title: "登录流程出现错误",
    description: "请检查 Chrome 和网络连接后重试。",
  },
};

export function WhatsAppLoginModal({
  accountId,
  onClose,
  onAuthenticated,
}: WhatsAppLoginModalProps) {
  const [state, setState] = useState<WhatsAppLoginState>("starting");
  const [errorCode, setErrorCode] = useState("");
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!accountId || startedRef.current) return;
    startedRef.current = true;
    let active = true;
    let interval: number | undefined;

    const update = async () => {
      try {
        const status = await getWhatsAppLoginStatus(accountId);
        if (!active) return;
        setState(status.state);
        setErrorCode(status.errorCode ?? "");
        if (status.state === "authenticated" && !completedRef.current) {
          completedRef.current = true;
          window.setTimeout(() => onAuthenticated(accountId), 650);
        }
      } catch {
        if (active) {
          setState("error");
          setErrorCode("LOGIN_STATUS_UNAVAILABLE");
        }
      }
    };

    void (async () => {
      try {
        const status = await beginWhatsAppLogin(accountId);
        if (!active) return;
        setState(status.state);
        setErrorCode(status.errorCode ?? "");
        if (status.state === "authenticated" && !completedRef.current) {
          completedRef.current = true;
          window.setTimeout(() => onAuthenticated(accountId), 650);
          return;
        }
        interval = window.setInterval(update, 1800);
      } catch (error) {
        if (active) {
          setState("error");
          setErrorCode(
            typeof error === "object" &&
              error !== null &&
              "code" in error &&
              typeof error.code === "string"
              ? error.code
              : "WHATSAPP_LOGIN_FAILED",
          );
        }
      }
    })();

    return () => {
      active = false;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [accountId, onAuthenticated]);

  if (!accountId) return null;
  const copy = stateCopy[state];
  const waiting = state === "starting" || state === "awaiting_qr";

  const handleClose = async () => {
    await closeWhatsAppLogin(accountId).catch(() => undefined);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal-card whatsapp-login-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-login-title"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">WHATSAPP WEB</span>
            <h2 id="whatsapp-login-title">连接 WhatsApp</h2>
            <p>授权在可见 Chrome 窗口完成，凭据不会上传控制后端。</p>
          </div>
          <button className="modal-close" onClick={handleClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>

        <div className={`login-state-panel ${state}`}>
          <div className="login-state-icon">
            {state === "authenticated" ? (
              <CheckCircle2 size={31} />
            ) : state === "awaiting_qr" ? (
              <QrCode size={31} />
            ) : (
              <LoaderCircle
                size={31}
                className={waiting ? "spin" : undefined}
              />
            )}
          </div>
          <strong>{copy.title}</strong>
          <p>{copy.description}</p>
          {errorCode && <code>{errorCode}</code>}
        </div>

        <div className="login-steps">
          <div className={state !== "starting" ? "done" : "active"}>
            <span>1</span>
            <p>
              打开浏览器
              <small>使用独立的本地 Profile</small>
            </p>
          </div>
          <div
            className={
              state === "awaiting_qr"
                ? "active"
                : state === "authenticated"
                  ? "done"
                  : ""
            }
          >
            <span>2</span>
            <p>
              手机扫码
              <small>WhatsApp → 设置 → 关联设备</small>
            </p>
          </div>
          <div className={state === "authenticated" ? "done active" : ""}>
            <span>3</span>
            <p>
              保存登录状态
              <small>仅保存在当前电脑</small>
            </p>
          </div>
        </div>

        <div className="security-note">
          <ShieldCheck size={18} />
          <span>
            请保持 Chrome 窗口打开直到客户端显示登录成功。关闭此弹窗会同时关闭登录窗口。
          </span>
        </div>

        {state === "closed" || state === "error" ? (
          <button className="primary-button login-retry" onClick={onClose}>
            返回账号选择
            <ExternalLink size={15} />
          </button>
        ) : null}
      </section>
    </div>
  );
}
