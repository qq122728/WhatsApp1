import { MessageCircle, Radio, Send } from "lucide-react";
import type { Platform } from "../types";

interface PlatformIconProps {
  platform: Platform;
  size?: number;
}

export function PlatformIcon({
  platform,
  size = 18,
}: PlatformIconProps) {
  if (platform === "telegram") return <Send size={size} />;
  if (platform === "rcs") return <Radio size={size} />;
  return <MessageCircle size={size} />;
}

export const platformLabel: Record<Platform, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  rcs: "RCS",
};
