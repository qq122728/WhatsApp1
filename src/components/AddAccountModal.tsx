import { ArrowRight, ShieldCheck, X } from "lucide-react";
import type { Platform } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (platform: Platform) => void;
}

const descriptions: Record<Platform, string> = {
  whatsapp: "扫码连接 WhatsApp Web",
  telegram: "使用手机号和验证码登录",
  rcs: "与 Google Messages 配对",
};

export function AddAccountModal({
  open,
  onClose,
  onSelect,
}: AddAccountModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">连接新渠道</span>
            <h2 id="add-account-title">添加账号</h2>
            <p>选择需要连接的平台，授权过程会在可见窗口中完成。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>

        <div className="platform-options">
          {(["whatsapp", "telegram", "rcs"] as Platform[]).map(
            (platform) => (
              <button
                className="platform-option"
                key={platform}
                onClick={() => onSelect(platform)}
              >
                <span className={`option-icon ${platform}`}>
                  <PlatformIcon platform={platform} size={23} />
                </span>
                <span>
                  <strong>{platformLabel[platform]}</strong>
                  <small>{descriptions[platform]}</small>
                </span>
                <ArrowRight size={18} />
              </button>
            ),
          )}
        </div>

        <div className="security-note">
          <ShieldCheck size={18} />
          <span>
            登录凭据只保存在这台设备上，Web 控制台不会保存平台 Session。
          </span>
        </div>
      </section>
    </div>
  );
}
