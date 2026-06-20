import { AlertTriangle, X } from "lucide-react";

interface AccountActionDialogProps {
  busy?: boolean;
  confirmLabel: string;
  description: string;
  open: boolean;
  title: string;
  tone?: "warning" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}

export function AccountActionDialog({
  busy = false,
  confirmLabel,
  description,
  open,
  title,
  tone = "warning",
  onCancel,
  onConfirm,
}: AccountActionDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <section
        className={`modal-card account-action-dialog ${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        aria-describedby="account-action-description"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="account-action-icon">
          <AlertTriangle size={22} />
        </div>
        <button
          type="button"
          className="modal-close account-action-close"
          aria-label="关闭确认窗口"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={16} />
        </button>
        <h2 id="account-action-title">{title}</h2>
        <p id="account-action-description">{description}</p>
        <div className="account-action-buttons">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={tone === "danger" ? "danger" : "warning"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
