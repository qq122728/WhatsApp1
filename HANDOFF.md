# MultiConnect 项目交接说明（WhatsApp 内嵌面板阶段）

> 截止 2026-06-19。当前分支为本地工程基线，未 git 化。

---

## 1. 已完成功能

### 1.1 桌面客户端壳（Tauri 2 + React 18 + Rust）
- 启动命令：`npm run tauri dev`（开发时需要 cargo 在 PATH，PowerShell 下用 `$env:PATH += ";$env:USERPROFILE\.cargo\bin"` 然后再运行）
- 主窗口布局常量（影响子 webview 定位）：
  - `SIDEBAR_W = 230` px
  - `TOPBAR_H = 86` px
  - `TAB_BAR_H = 40` px
  - `TRANSLATION_BAR_H = 62` px

### 1.2 WhatsApp 多账号面板（核心特性）
- **每个账号一个独立的 Tauri `WebviewWindow`**（无装饰、不在任务栏、`owner = main`）
- 不是 `add_child`：在 Tauri 2.11.3 + 默认 `tauri.conf.json` 创建的 main webview 下，`Window::add_child` 在 stable build 不可用，已尝试过 `unstable` feature 仍有兼容问题，所以采用「独立无边框窗口 + owner 锁定 z-order」实现"内嵌"观感
- **隐藏 = 移到屏幕外** `(30000, 30000)`，**显示 = 移回内容区**。`hide()/show()` 会改变 z-order 导致主窗口被遮挡，所以不用
- **Session 隔离**：每个账号有独立 `data_directory`：`{appDataDir}/panels/whatsapp/{accountId}`
- **DOM 注入脚本** 在 webview 启动时挂载：
  1. 轮询登录状态 → `wa_panel_report_state` IPC → 主窗口 `wa-panel-state` 事件
  2. mock 翻译：给 `.message-in` 加翻译徽章、给输入框附近显示翻译预览条

### 1.3 React UI
- **侧栏「已连接」** 区域显示所有 WhatsApp 账号（绿色圆形图标 + 在线状态点）
- **顶部标签栏**：所有打开的面板 + 关闭 × + 添加 + 按钮
- **翻译设置条**（深色，标签栏下方）：对方语言、自己语言、翻译通道、翻译服务器、字号、字体颜色、群组翻译、禁止中文 — 改动即时保存到当前账号配置
- **新增账号配置表单**（点 + 触发）：名称、翻译通道、翻译服务器、发送/接收翻译开关、对方/自己的语言、群组翻译、禁止中文、字号、字体颜色
- **模态框打开时自动让位** — 由于子 webview 是原生控件 z-index 不生效，App.tsx 检测到任何模态打开时调用 `hideWaPanel` 把面板移屏外，关闭后再 `showWaPanel`

### 1.4 配置持久化
- `multiconnect.saved-accounts` — 账号列表（只持久化曾登录过的）
- `multiconnect.account-configs` — 每账号翻译配置（`Record<accountId, AccountConfig>`）
- 关闭未登录的标签时会清理对应账号 + 配置

---

## 2. 未完成 / 待办

### 2.1 翻译功能（最重要）
- 目前是 **mock**：`mockTranslate()` 函数固定加 `[Mock EN]` / `[Mock 中文]` 前缀
- 待接入真实 API（用户倾向 OpenAI，需 key）
- **方案建议**：
  1. 在 Rust 端加 `translate` 命令，接收文本 + 配置（channel/source/target），后端调 OpenAI API（防止前端 key 泄露）
  2. 注入脚本通过 `__TAURI_INTERNALS__.invoke('translate', ...)` 调用
  3. 接收侧：MutationObserver 监听新 `.message-in`，调 API 后插入翻译
  4. 发送侧：拦截输入框 Enter / 发送按钮，把翻译后的文本替换原文再发送（contentEditable 写入参考 [WhatsApp 注入示例](https://stackoverflow.com/questions/61730321/) — 需要触发 React 内部 onChange）

### 2.2 配置 → 注入脚本联动
- 当前注入脚本是 webview 创建时一次性烧入 `account_id`，**不知道翻译开关 / 语言**
- 用户改翻译条 UI 时，子 webview 不会立即变化
- 需要做：Rust 加 `wa_panel_update_config` 命令，把 config 写到子 webview 的 window 全局（用 `webview.eval(...)`），脚本读 `window.__mc_config` 决定行为

### 2.3 已知小问题
- **DOM selector 脆弱** — WhatsApp Web 更新可能让 `.message-in` / `[contenteditable]` 失效，需要定期校验
- **主窗口移动时面板不跟随** — `owner` 关系只锁 z-order，没锁位置；需要监听主窗口 `move` 事件并调 `resize_all`（目前 React 只监听 `window resize`，不监听主窗口 move）
- **代理 IP 功能** 用户明确不要，所以 `AccountConfig` 里没有这一项；如果需要要重新加
- **多个 telegram / rcs** 的逻辑没做，新增账号选择对话框选 telegram / rcs 时只弹 toast 占位

### 2.4 其他模块
- 总览 / 消息 / 联系人 / 任务 / 设置 这些视图都还是初始 mock 数据
- 远程控制台 (Web 端) 没接入，`remote_control` 命令存在但前端只在设置页显示
- `platform_sidecar`（Playwright sidecar）保留了，但 WhatsApp 流程已转用内嵌 webview，sidecar 进入待命状态

---

## 3. 关键文件

### Rust（src-tauri/src/）
- `account_panel/mod.rs` — 面板生命周期 + 注入脚本（核心，~210 行）
- `commands/panels.rs` — `wa_panel_open/show/hide/close/resize/list/report_state` 7 个 Tauri 命令
- `lib.rs` — 注册 manager 和命令
- `error.rs` — `ErrorCode::WaPanelFailed` 已加
- `capabilities/default.json` — `"windows": ["main", "wa-*"]`（允许子 webview invoke）

### TypeScript / React（src/）
- `App.tsx` — 主组件，所有状态和事件协调
- `components/Sidebar.tsx` — 侧栏 + 「已连接」会话区
- `components/PanelTabBar.tsx` — 顶部标签栏
- `components/TranslationBar.tsx` — 翻译设置条（深色）
- `components/NewAccountForm.tsx` — 新增账号配置表单
- `components/Topbar.tsx` — 顶部栏（已简化）
- `lib/panels.ts` — Tauri 命令的 TS 封装
- `types.ts` — `AccountConfig`、`defaultAccountConfig`、语言/通道/服务器常量
- `styles.css` — 全部样式（无 CSS module / Tailwind），新增了 `.translation-bar`、`.panel-tab-bar`、`.wa-config-*`、`.wa-toggle`、`.wa-nav-icon` 等类

---

## 4. 已知坑（开发时容易踩）

1. **`cargo` 不在 PATH** — PowerShell 启动 `npm run tauri dev` 前要先 `$env:PATH += ";$env:USERPROFILE\.cargo\bin"`
2. **`multiconnect.exe` 残留进程锁文件** — Rust 重建时报 `failed to remove file ... 拒绝访问`，需要 `Get-Process multiconnect | Stop-Process -Force`
3. **修改 `init_script` 后旧 webview 拿不到新脚本** — 必须关闭标签 × 再重开
4. **窗口 z-order 问题** — 不要用 `WebviewWindow::hide()/show()`，会破坏 owner z-order；坚持「移屏外」方案
5. **DPI 缩放** — Builder 上的 `.position(x,y)` / `.inner_size(w,h)` 在不同 DPI 下行为不一致，目前 build 后立即用 `Position::Logical` / `Size::Logical` 显式重设，必须保留这两行
6. **modal 被 webview 遮挡** — 子 webview 是 native 控件，CSS z-index 无效；任何模态/弹窗都要在 useEffect 里调 `hideWaPanel`

---

## 5. 立刻可以测试的功能

启动后：
1. 左侧栏 → 账号 → 添加账号 → WhatsApp
2. 弹出配置表单 → 改名字 / 翻译通道 → 保存
3. 内容区出现 WhatsApp Web，扫码登录
4. 标签栏 + 号可以再开一个，每个都是独立 session
5. 接收消息会在气泡下出现紫色「译」徽章（mock）
6. 输入框有内容时底部浮出蓝色「Mock 翻译预览」气泡
7. 关闭标签 × 会清理；登录过的账号下次启动会保留在「已连接」侧栏

---

## 6. 下一阶段建议优先级

| 优先级 | 任务 | 估时 |
|---|---|---|
| P0 | 接入真实 OpenAI 翻译 API（Rust 端 + 前端 invoke + 替换 mock） | 0.5-1 天 |
| P0 | 翻译开关 / 语言切换 → 子 webview 实时联动 | 0.5 天 |
| P1 | 发送侧拦截：contentEditable 写入 + 触发 WhatsApp 内部 React onChange | 1-2 天（不稳定） |
| P1 | 主窗口 move 事件 → 面板跟随 | 0.5 天 |
| P2 | DOM selector 抽象成配置 + 选择器健康检查 | 1 天 |
| P3 | Telegram / RCS 多账号接入（同样的 webview 模式 + 各自登录页） | 各 1-2 天 |
