import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./remote-api";

export interface AppInfo {
  name: string;
  version: string;
  description: string;
  runtime: string;
}

export interface DiagnosticsSystem {
  os: string;
  arch: string;
  family: string;
  buildProfile: string;
  processId: number;
}

export interface DiagnosticsEnvironment {
  hasOpenaiApiKey: boolean;
  hasDeeplApiKey: boolean;
  hasBrowserOverride: boolean;
  hasSidecarOverride: boolean;
}

export interface DiagnosticsOpenAi {
  configured: boolean;
  source: string;
  storage: string;
  maskedKey?: string;
  updatedAt?: string;
  error?: string;
}

export interface DiagnosticsDeepL {
  configured: boolean;
  source: string;
  storage: string;
  maskedKey?: string;
  updatedAt?: string;
  error?: string;
}

export interface DiagnosticsPaths {
  appConfigDir?: string;
  appDataDir?: string;
  appCacheDir?: string;
  appLogDir?: string;
  desktopDir?: string;
  currentExe?: string;
}

export interface AppDiagnostics {
  generatedAt: string;
  app: AppInfo;
  system: DiagnosticsSystem;
  environment: DiagnosticsEnvironment;
  openAi: DiagnosticsOpenAi;
  deepL: DiagnosticsDeepL;
  paths: DiagnosticsPaths;
  clientContext?: unknown;
}

export interface DiagnosticsExportResult {
  path: string;
  fileName: string;
  diagnostics: AppDiagnostics;
}

export function emptyAppDiagnostics(): AppDiagnostics {
  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: "multiconnect",
      version: "0.1.0",
      description: "Multi-channel messaging control client",
      runtime: "browser",
    },
    system: {
      os: "browser",
      arch: "unknown",
      family: "unknown",
      buildProfile: "dev",
      processId: 0,
    },
    environment: {
      hasOpenaiApiKey: false,
      hasDeeplApiKey: false,
      hasBrowserOverride: false,
      hasSidecarOverride: false,
    },
    openAi: {
      configured: false,
      source: "none",
      storage: "not-configured",
    },
    deepL: {
      configured: false,
      source: "none",
      storage: "not-configured",
    },
    paths: {},
  };
}

export async function loadAppDiagnostics(
  clientContext?: unknown,
): Promise<AppDiagnostics> {
  if (!isTauriRuntime()) return emptyAppDiagnostics();
  return invoke<AppDiagnostics>("app_diagnostics_snapshot", { clientContext });
}

export async function exportAppDiagnostics(
  clientContext?: unknown,
): Promise<DiagnosticsExportResult> {
  if (!isTauriRuntime()) {
    return {
      path: "",
      fileName: "browser-diagnostics.json",
      diagnostics: emptyAppDiagnostics(),
    };
  }
  return invoke<DiagnosticsExportResult>("app_diagnostics_export", {
    clientContext,
  });
}
