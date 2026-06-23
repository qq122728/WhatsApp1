export type Platform = "whatsapp" | "telegram" | "rcs";
export type AccountStatus = "online" | "offline" | "expired";

export interface Account {
  id: string;
  platform: Platform;
  name: string;
  handle: string;
  status: AccountStatus;
  messagesToday: number;
  unreadCount?: number;
  lastSync: string;
  translationEnabled: boolean;
  accent: string;
}

export interface Message {
  id: string;
  platform: Platform;
  accountName: string;
  contact: string;
  original: string;
  translation?: string;
  time: string;
  direction: "inbound" | "outbound";
  unread?: boolean;
}

export interface RemoteConfig {
  apiBaseUrl: string;
  deviceName: string;
  deviceId: string;
}

export interface AccountConfig {
  name: string;
  translationChannel: string;
  translationServer: string;
  translationStyle: string;
  regionalTone: string;
  targetLanguage: string;
  sourceLanguage: string;
  sendTranslation: boolean;
  receiveTranslation: boolean;
  fontSize: number;
  fontColor: string;
  groupTranslation: boolean;
  blockChinese: boolean;
  translationCacheRetentionDays: number;
  translationCachePerAccountLimit: number;
  incomingAutoTranslate: boolean;
  translationCacheClearAt?: number;
}

export interface TranslationCacheSettings {
  retentionDays: number;
  perAccountLimit: number;
  autoTranslateHistory: boolean;
  clearAt?: number;
}

export const defaultTranslationCacheSettings: TranslationCacheSettings = {
  retentionDays: 45,
  perAccountLimit: 260,
  autoTranslateHistory: true,
};

export const defaultAccountConfig: AccountConfig = {
  name: "WhatsApp纯净版",
  translationChannel: "GPT-4O-MINI",
  translationServer: "亚洲服务器",
  translationStyle: "自然口语",
  regionalTone: "通用自然",
  targetLanguage: "英语（美国）",
  sourceLanguage: "中文（简体）",
  sendTranslation: true,
  receiveTranslation: true,
  fontSize: 16,
  fontColor: "#18A058",
  groupTranslation: false,
  blockChinese: true,
  translationCacheRetentionDays: defaultTranslationCacheSettings.retentionDays,
  translationCachePerAccountLimit: defaultTranslationCacheSettings.perAccountLimit,
  incomingAutoTranslate: defaultTranslationCacheSettings.autoTranslateHistory,
};

export const TRANSLATION_CHANNELS = [
  "GPT-4O-MINI",
  "GPT-4O",
  "GPT-4.1",
  "DeepL",
  "MyMemory(免Key测试)",
  "Google",
];
export const TRANSLATION_SERVERS = ["亚洲服务器", "美国服务器", "欧洲服务器"];
export const TRANSLATION_STYLES = ["自然口语", "准确直译", "客服友好"];
export const REGIONAL_TONES = ["通用自然", "亚洲友好", "欧洲简洁", "美国随意"];
export const TARGET_LANGUAGES = ["英语（美国）", "中文（简体）"];
export const SOURCE_LANGUAGES = ["中文（简体）", "英语（美国）"];
export const FONT_SIZES = [12, 14, 16, 18, 20, 24];

export type RemoteConnectionState =
  | "not_configured"
  | "checking"
  | "registering"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "unreachable";

export interface RemoteControlStatus {
  state:
    | "idle"
    | "registering"
    | "connecting"
    | "connected"
    | "disconnected"
    | "error";
  apiBaseUrl?: string;
  deviceId?: string;
  connectedAt?: string;
  credentialExpiresAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export interface RemoteControlAccountSummary {
  accountId: string;
  platform: Platform;
  status:
    | "initializing"
    | "awaiting_auth"
    | "online"
    | "degraded"
    | "offline"
    | "expired"
    | "error";
  occurredAt: string;
  reasonCode?: string;
  summary?: string;
}

export interface ClientAccountDiagnostics {
  total: number;
  whatsapp: number;
  online: number;
  offline: number;
  expired: number;
  openPanels: number;
  activePanelId?: string | null;
}
