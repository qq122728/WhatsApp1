import { ArrowRight, ShieldCheck, X } from "lucide-react";
import type { Platform } from "../types";
import { PlatformIcon, platformLabel } from "./PlatformIcon";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (platform: Platform) => void;
}

const whatsappDescription = "扫码连接 WhatsApp Web";

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
            <span className="eyebrow">连接 WhatsApp</span>
            <h2 id="add-account-title">添加账号</h2>
            <p>创建独立的本机 WhatsApp Web Session，扫码后即可开始收发和翻译。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>

        <div className="platform-options">
          <button
            className="platform-option"
            onClick={() => onSelect("whatsapp" as Platform)}
          >
            <span className="option-icon whatsapp">
              <PlatformIcon platform="whatsapp" size={23} />
            </span>
            <span>
              <strong>{platformLabel.whatsapp}</strong>
              <small>{whatsappDescription}</small>
            </span>
            <ArrowRight size={18} />
          </button>
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
