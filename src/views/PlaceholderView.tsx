import type { LucideIcon } from "lucide-react";

interface PlaceholderViewProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function PlaceholderView({
  icon: Icon,
  title,
  description,
}: PlaceholderViewProps) {
  return (
    <div className="view placeholder-view">
      <div className="placeholder-icon">
        <Icon size={28} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <span>该模块将在账号与消息闭环稳定后接入。</span>
    </div>
  );
}
