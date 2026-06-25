# MultiConnect 项目当前进度总结

更新时间：2026-06-25

## 当前整体进度

项目已经从“能打开 WhatsApp Web”推进到“多账号驾驶舱 + 多家翻译商 + 批量预设管理 + 本地控制服务可用”的阶段。

当前最核心的主线有三条：

1. 桌面客户端：多 WhatsApp 账号独立 Session、四家翻译商、账号驾驶舱、批量管理。
2. 本地控制服务：HTTP + WSS，负责设备注册、状态命令、控制台 API。
3. Web 控制台：查看设备和账号状态，并触发账号检测。

## 项目全貌

### 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2（Rust + WebView） |
| 前端 | React 18 + TypeScript 5.7 + Vite 6 + lucide-react |
| Rust 后端 | tokio / reqwest（rustls） / tokio-tungstenite / serde / windows-sys（DPAPI） |
| 控制服务器 | Node 20 + Express 5 + ws + zod + ajv（独立 `server/`） |
| 平台 Sidecar | Node + playwright-core（独立 `sidecar/`，备用） |
| 质检 | tsc 项目引用、Vite、Python 契约脚本（`contracts/`） |

未引入：React Router、全局状态管理库、CSS 框架。状态用原生 React state + refs，样式手写 `styles.css`。

### 目录结构

```
src/                  React 前端
├── App.tsx           顶层状态：账号、面板、翻译缓存、远程同步
├── views/            Overview / AccountsView（驾驶舱） / SettingsView
├── components/       Sidebar、Topbar、PanelTabBar、各种对话框
├── features/
│   └── translation/  翻译纯逻辑 + 自检 CLI
├── lib/              IPC 封装、缓存、预设、远程 API
└── types.ts          全局类型与默认值

src-tauri/src/        Tauri Rust 后端
├── account_panel/    每个账号独立子 WebView（核心）
├── commands/         #[tauri::command] 入口：
│                     app / panels / whatsapp / openai_config /
│                     deepl_config / google_config /
│                     remote_config / remote_control
├── translation.rs    OpenAI/DeepL/Google/MyMemory + 文件缓存
├── *_config.rs       三家 API key 持久化（Windows DPAPI）
├── remote_control/   WSS 客户端
├── platform_sidecar/ Node sidecar 桥接（预留）
├── native_input.rs   Windows SendInput 注入
└── contracts/        JSON Schema 校验

server/               独立 Node 控制服务（HTTP + WSS + 控制台）
sidecar/              Playwright sidecar（备用）
contracts/            跨端共享 JSON Schema
```

### 存储方式

| 位置 | 内容 | 加密 |
|---|---|---|
| Windows DPAPI | OpenAI / DeepL / Google API key | ✅ 用户级 |
| macOS/Linux 文件 | 同上三家 key | ❌ 明文 hex（**M-1 待修**） |
| `app_config_dir/*.json` | 各服务商配置（model、base URL 等） | 明文 |
| `app_config_dir/translation-cache.json` | 翻译缓存（v3 namespace） | 明文 |
| `app_data_dir/<account_id>/` | 每个 WA 子 WebView 的 user-data（cookies、IndexedDB） | WebView 默认 |
| localStorage | `multiconnect.translation-presets`、`multiconnect.pinned-panel-tabs`、远程 API 配置等 UI 偏好 | 明文 |
| 内存 | `panelConfigSyncRef` 指纹、远程连接状态、Toast | — |

未使用：SQLite、IndexedDB（除 WhatsApp 自己的）、Tauri Store、系统 keychain。

## 已完成模块

### 1. 多账号 WhatsApp 客户端

- 每个 WhatsApp 账号使用独立 Session 和独立 user-data。
- 子 WebView 注入 init script，含 `navigator.webdriver` 反检测、`panel_token` 校验、Chrome User-Agent。
- 顶部“快速切换栏”：
  - 折叠态：每个已打开面板的 pill（状态点+名字+未读+×），点击直接切换。
  - 展开态：10 列网格，42px 图标，最多 40 个，超出内部滚动。
- 账号驾驶舱（AccountsView）：搜索 + 筛选 + 多选 + 批量打开/关闭/套预设/删除。
- 抽屉式账号管理：备注编辑、置顶、关闭标签、重新登录、删除。
- 当前已经测试过 10-20 个账号级别的界面表现。

### 2. 翻译功能

- 已接入四家：OpenAI（GPT-4O / GPT-4O-MINI / GPT-4.1）、DeepL、Google、MyMemory（免 Key 测试）。
- 默认 Google。
- 翻译风格、地区口吻、源/目标语言可独立配置。
- Google 支持源语言自动检测。
- 强制把外发中文文本转向英文，避免反向把英文译成中文。
- 发送前翻译预览：第一次回车生成译文，第二次回车才发送；翻译失败不会把中文原文发出去。
- 接收消息支持翻译按钮和自动翻译。
- 翻译缓存按 provider/model/source/target/style/tone/text 命名空间（v3 cache key），切换服务商不会串味。
- 翻译预览取消后会自动重试。
- 设置页有缓存管理和翻译日志。

### 3. 翻译预设

- 新增 `translation-presets.ts` 模块，捕获 12 个翻译相关字段为命名预设。
- 预设存在 localStorage，可在驾驶舱里对多个账号一次性套用。
- App.tsx 的同步 effect 会自动把变更推送到已打开的面板。

### 4. WhatsApp 兼容性修复

- 打开新面板报“WhatsApp Error”：通过设置 Chrome UA + 覆盖 `navigator.webdriver` 修复。
- 重登后翻译失效：通过 `panelConfigSyncRef` 缓存清理 + 重推配置修复（覆盖大约 2s 内的 reload 窗口）。
- 批量打开会话改为后台隐藏，不抢焦点，失败时提示具体数量。

### 5. 本地控制服务

- 服务目录：`server`
- 默认地址：`127.0.0.1:8000`
- 健康检查：`/health`
- Web 控制台：`/console`
- 当前是内存模式：开发简单；服务重启会丢失设备注册和命令状态。

### 6. Web 控制台

- 可以看到：服务在线状态、设备数、在线设备数、账号总数、设备状态、账号列表、账号在线/离线/待登录/异常。
- 支持账号搜索和筛选。
- 支持单账号“检测”，让客户端刷新该账号状态并回报。

### 7. 性能与窗口

- 翻译缓存本身占用很小（KB 级）。
- 真正吃资源的是多开 WebView，不是缓存；50 个账号同时活跃仍需后续的休眠/冻结策略。
- 应用窗口已适配任务栏可用区，不会被遮挡。

## 当前风险点与已知问题

### M-1：非 Windows 平台 API key 明文

- macOS / Linux 的 OpenAI / DeepL / Google key 是 hex 编码后写入 JSON，等同于明文。
- `status()` 还硬编码报告 `storage: "windows-dpapi"`，UI 显示会误导。
- 建议：非 Windows 走系统 keychain（macOS Keychain、Linux Secret Service），或至少接入 OS 级密钥管理。

### M-2：MyMemory 长度判断按字节

- `text.len() > 500` 用了字节数，中文一个字 3 字节，约 167 字就被拒。
- 应改为 `text.chars().count() > 500`。

### Web 控制台状态仍是本地快照

账号是否在线、是否异常，依赖客户端打开或检测过对应账号。没打开过的账号可能只显示离线或无补充摘要。

### 封号/异常检测需要继续积累规则

WhatsApp 没有官方封号状态 API，目前只能根据页面文本、扫码页、错误页、限制提示判断。

### 批量检测还没做队列

现在是单账号检测。批量检测必须限制并发，否则 50 个账号同时打开会吃资源、页面乱跳。

### 控制台还不是正式远程运维系统

适合本机或内网开发测试。要真正远程使用，还需要：登录鉴权、TLS、操作审计、持久化数据库、权限区分。

## 推荐下一步路线

### P0：修两个已知 bug

- **M-2**：MyMemory `chars().count()`（1 行）。
- **M-1**：非 Windows 平台接系统 keychain 或对 status() 至少做平台分支报告，避免误导。

### P1：UI Phase 2 — 驾驶舱常驻左侧 Rail

把 AccountsView 升级为常驻左侧栏，去掉 Sidebar 旧的“已连接”重复区。当前 Sidebar 列表、PanelTabBar 网格、AccountsView 驾驶舱三处展示同一批账号，状态容易不一致。

### P2：翻译重启 Method A

让 init-script 直接拉取最新翻译配置，比当前事件回调（`b636214`）的窗口更小，覆盖任意原因引发的 reload。

### P3：Web 控制台批量安全检测

可一次选多个账号检测、并发默认 1、可中断、显示队列进度。

### P4：控制服务持久化

本地 JSON 或 SQLite，重启后保留设备状态。

### P5：Web 控制台安全登录

管理员登录 + Control API Key 不再仅靠浏览器本地保存 + 操作日志。

### P6：账号异常规则中心

把检测规则集中到一个文件，支持多语言关键词，在控制台显示命中的规则和截图/摘要。

## 给下一位开发者的提醒

- 不要把 OpenAI / DeepL / Google Key 写进代码或安装包。
- 不要让 Web 控制台拿 WhatsApp Cookie、Session 或聊天正文。
- 不要批量同时打开几十个 WebView。
- 改 WebView 注入脚本后，记得提示用户关闭旧标签重开。
- `cargo fmt` 可能格式化不相关 Rust 文件，提交前检查 diff。
- 中文文档如果在 PowerShell 里显示乱码，优先确认编码，不要误以为内容坏了。
- 非 Windows 平台 API key 还没真正加密（M-1），先别假定它安全。
