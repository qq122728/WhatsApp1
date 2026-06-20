# MultiConnect 代码审查记录（2026-06-20）

> 范围：本次只做问题记录和代码审查，不修复功能代码。  
> 背景：用户反馈真实 OpenAI 翻译变慢，WhatsApp 输入框“替换译文”时好时坏，需要把问题记录下来并全面审查。

## 0. 当前仓库状态

最近已提交基线：

- `68cc7b8 feat: refine translation preview and send flow`
- `b2499f8 feat: add account settings and session management`
- `e9a07b7 feat: improve multi-account navigation and management`
- `8157ed5 feat: establish scalable multi-account desktop baseline`

当前未提交改动集中在：

- `src-tauri/src/account_panel/mod.rs`
- `src-tauri/src/translation.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/panels.rs`
- `src-tauri/src/error.rs`
- `src-tauri/capabilities/default.json`
- `src/App.tsx`
- `src/lib/panels.ts`

这批未提交改动主要是：真实 OpenAI 翻译接入、远程 WhatsApp webview 事件桥、翻译配置同步。

## 1. 验证结果

已执行：

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

结果：通过，16 passed，1 ignored。

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run build
```

结果：通过。注意：普通 `npm run build` 在当前 PowerShell 下会被执行策略拦截，需要显式调用 `npm.cmd`。

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:translation
& 'C:\Program Files\nodejs\npm.cmd' run test:contracts
& 'C:\Program Files\nodejs\npm.cmd' --prefix server run check
& 'C:\Program Files\nodejs\npm.cmd' --prefix sidecar run check
```

结果：全部通过。

```powershell
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
```

结果：未通过，只发现 `src-tauri/src/account_panel/mod.rs` 中一处格式化差异，不是功能错误。

## 2. P0 问题：需要优先处理

### 2.1 WhatsApp 输入框替换不稳定

位置：

- `src-tauri/src/account_panel/mod.rs`：`setComposerText`
- `src-tauri/src/account_panel/mod.rs`：`handleSendClick`

问题：

- 当前替换逻辑依赖 `document.execCommand('insertText')`。
- 失败后 fallback 为 `input.textContent = value` + `InputEvent`。
- WhatsApp Web 的输入框是复杂 `contenteditable` + React 状态，DOM 看起来写入成功，不代表 WhatsApp 内部状态同步成功。
- 自动发送流程替换后只等待 80ms，然后点击原来的 `sendButton` 引用；如果 WhatsApp 重新渲染按钮、按钮尚未启用，或 React 状态未同步，就会出现“有时能发、有时不发”。
- 目前只拦截绿色发送按钮点击，没有处理 Enter/快捷键发送。
- “替换原文”按钮没有可靠验证替换是否成功。

建议：

1. 改成可靠写入流程：聚焦、全选、写入、触发 WhatsApp 可识别的输入事件，并轮询确认内部状态。
2. 替换后不要固定等 80ms，应等待发送按钮真正可用并重新获取当前按钮。
3. 替换失败时不要自动发送，提示用户“替换失败，请手动发送/重试”。
4. 后续补 Enter 发送拦截。

### 2.2 翻译慢：没有缓存、没有取消、没有后端限流

位置：

- `src-tauri/src/account_panel/mod.rs`：`updatePreview`
- `src-tauri/src/lib.rs`：`mc://translate-request` 监听
- `src-tauri/src/translation.rs`：`translate`

问题：

- 注入脚本每 250ms 轮询输入框。
- 文本稳定 400ms 后发起翻译请求。
- JS 只会丢弃过期回调，但 Rust/OpenAI 请求已经真实发出，无法取消。
- Rust 侧对每个 `mc://translate-request` 都 `spawn` 一个任务，没有账号级并发限制、in-flight 去重、速率限制。
- 没有缓存；相同文本、相同语言、相同模型会重复打 OpenAI。
- `reqwest` 总超时为 35 秒，用户体验上会觉得卡住。
- `max_output_tokens` 固定 2048，对短句偏大，会增加延迟和成本；对长文本又可能不够精确。

建议：

1. 增加缓存键：文本 hash + sourceLanguage + targetLanguage + model/provider + glossary/version。
2. 增加 in-flight 去重：同一账号同一文本正在翻译时复用同一个结果。
3. 增加后端账号级并发限制，避免快速输入时并发请求堆积。
4. JS 侧加超时兜底，超时后明确提示。
5. 根据输入长度动态设置 `max_output_tokens`，短句降低输出 token。

### 2.3 远程 WhatsApp webview 权限边界过宽

位置：

- `src-tauri/capabilities/default.json`
- `src-tauri/src/commands/panels.rs`
- `src-tauri/src/account_panel/mod.rs`
- `src-tauri/src/lib.rs`

问题：

- 当前 capability 允许远程 `https://*.whatsapp.com/*` 下的 `wa-*` webview 使用 `core:default`。
- `core:default` 包含事件 emit/listen 等核心能力。
- `wa_panel_set_translation_config` 已阻止 `wa-*` 调用，这是好的；但其他 panel 命令如 open/show/hide/set_bounds/close/reset/delete/list 没有同类 caller 检查。
- 事件桥 `mc://translate-request` 只校验 `requestId` 和 `accountId`，没有确认事件来源 webview 就是 `wa-{accountId}`。
- 理论上任一可 emit 的 webview 都可能构造翻译请求，消耗 OpenAI 额度，或把任意文本外发到翻译服务。
- `mc://panel-state` 没有 state 白名单，任意字符串可转发到主 UI。

建议：

1. 收紧 capability：远程 WhatsApp webview 只保留必要事件桥能力。
2. 所有敏感 Tauri command 增加 caller label 检查，禁止 `wa-*` 调用账号管理/删除/重置/窗口控制命令。
3. 给每个 panel 注入一次性 token，事件 payload 带 token，Rust 侧校验 token + accountId + webview 关系。
4. `panel-state` 只允许 `starting`、`awaiting_qr`、`authenticated`、`closed`、`error`。

## 3. P1 问题：影响稳定性和用户理解

### 3.1 翻译配置同步粗粒度，可能导致竞态

位置：

- `src/App.tsx`：同步 `accountConfigs` 到打开的 panel
- `src/lib/panels.ts`：`setWaPanelTranslationConfig`

问题：

- `accountConfigs` 任意变化时，前端会遍历所有 `openPanels` 并同步配置。
- 用户只改一个账号，所有已打开账号都会同步一次。
- 没有 debounce；快速点选语言/开关时会频繁 invoke。
- `openPanel` 先 `openWaPanel(accountId)`，再写 `accountConfigs`。刚打开时注入脚本默认 `sendTranslation: false`，如果用户立即输入，可能暂时没有预览。

建议：

1. 只同步变更账号，不广播全部账号。
2. 增加 debounce。
3. `openWaPanel` 支持初始 config，或打开前先写入 manager。
4. 同步失败给 toast/状态提示，不能只 `console.error`。

### 3.2 UI 暴露了未实现/未生效的选项

位置：

- `src/types.ts`
- `src/components/TranslationBar.tsx`
- `src/components/NewAccountForm.tsx`
- `src/components/AccountSettingsModal.tsx`
- `src/lib/panels.ts`
- `src-tauri/src/translation.rs`

问题：

- `receiveTranslation` UI 已存在，但当前真实 WhatsApp 注入脚本主要只做发送前翻译预览，没有接收消息翻译。
- `groupTranslation`、`blockChinese` UI 已存在，但没有同步到 Rust，也没有在注入脚本使用。
- `translationServer` UI 已存在，Rust `TranslationConfig` 也有字段，但实际请求固定走 `https://api.openai.com/v1/responses`。
- `TranslationBar` 硬编码显示 `261 ms`，不是实际延迟。
- UI 提供 `DeepL`、`Google`，但 Rust `model_id` 明确不支持，会返回 `TRANSLATION_NOT_CONFIGURED`。

建议：

1. 未实现的选项先隐藏或标注“占位/未接入”。
2. 如果保留 `translationServer`，需要说明它只是显示项；更好是移除或实现真实路由。
3. 延迟显示改为最近一次真实翻译耗时。
4. DeepL/Google 未接入前不要作为可选项，避免用户误解。

### 3.3 账号开关语义不统一

位置：

- `src/types.ts`：`Account.translationEnabled`
- `src/components/AccountCard.tsx`
- `src/App.tsx`：`handleToggleTranslation`
- `src/types.ts`：`AccountConfig.sendTranslation/receiveTranslation`

问题：

- 账号卡片上的 `translationEnabled` 只改 `Account` 展示字段。
- 真正 WhatsApp panel 使用的是 `AccountConfig.sendTranslation/receiveTranslation`。
- 用户可能以为关掉了自动翻译，但真实预览仍然开启。

建议：

1. 统一为 `AccountConfig` 作为真实配置源。
2. `Account.translationEnabled` 改为派生字段，或删除。
3. UI 上区分“发送翻译”和“接收翻译”。

### 3.4 localStorage 缺少 schema 校验和迁移

位置：

- `src/App.tsx`：`loadAccountConfigs` / `saveAccountConfigs`
- `src/lib/remote-api.ts`
- `src/components/PanelTabBar.tsx`

问题：

- `loadAccountConfigs` 直接 `JSON.parse`，没有 schema 校验、默认值合并、版本迁移。
- 旧 localStorage 缺字段时，可能把 `undefined` 传到 Rust。
- `localStorage.setItem` 没有异常保护，quota/隐私模式下可能影响 UI。

建议：

1. 增加配置版本号。
2. 读取时做默认值合并和字段校验。
3. 写入失败时降级为内存状态，并提示用户配置未持久化。

### 3.5 顶部账号管理、抽屉和原生 webview 存在覆盖/竞态

位置：

- `src/App.tsx`：`handleAccountManagerViewChange`
- `src/components/PanelTabBar.tsx`
- `src/components/Sidebar.tsx`

问题：

- 设置弹窗和新增账号表单会先隐藏 WhatsApp panel，这是正确的。
- 但账号管理抽屉/快速切换更多菜单主要依赖状态变化后 effect 异步隐藏 webview。
- 原生 child webview 不受 CSS z-index 控制，可能短暂盖住抽屉。
- 快速切换账号没有 busy/race 控制，快速点击可能导致 show/hide 顺序错乱。
- 关闭当前 tab 后不会自动切到相邻 tab，体验上会“空掉”。

建议：

1. 打开抽屉/菜单前也走 `hideActivePanelBeforeModal`。
2. 账号切换、关闭、删除、重登加 busy 状态。
3. 关闭当前 tab 时自动选择相邻 tab。

## 4. P1/P2：文档和实现不一致

### 4.1 HANDOFF/README 中 WhatsApp 面板描述已过期

位置：

- `HANDOFF.md`
- `README.md`
- `src-tauri/src/account_panel/mod.rs`

问题：

- 文档仍写“不是 add_child”“隐藏=移到屏幕外”“配置未联动”。
- 当前代码实际使用 `host_window.add_child(...)`、`hide()/show()`，并已通过 `wa_panel_set_translation_config` 同步翻译配置。

建议：

- 更新 HANDOFF，把当前真实实现写清楚：child webview、add_child、hide/show、配置同步、当前风险。

### 4.2 翻译文档滞后

位置：

- `README.md`
- `HANDOFF.md`
- `src-tauri/src/translation.rs`

问题：

- 文档仍写“真实 Provider 待实现 / P0 接入 OpenAI”。
- 当前已有 Rust OpenAI Responses API 调用，使用 `OPENAI_API_KEY`。
- 但仍是部分接入：只做发送前翻译，未实现接收侧翻译、缓存、密钥管理 UI。

建议：

- 文档改为“OpenAI 发送侧预览已部分接入，接收侧翻译/缓存/密钥链配置仍待完成”。

### 4.3 Control Server 文档和实现不一致

位置：

- `server/README.md`
- `server/src/schemas.ts`
- `server/src/security.ts`
- `server/src/device-channel.ts`
- `contracts/README.md`

问题：

- `server/README.md` 注册示例 `deviceId: "desktop-01"` 会被代码拒绝，因为实现要求 deviceId 至少 16 字符。
- 文档说注册用 `Authorization: Bearer <CONTROL_API_KEY>`，但桌面端远程配置没有 API Key 字段，注册请求也未带控制台认证头；当前主要适配“无 CONTROL_API_KEY + 回环地址”的开发模式。
- WSS 文档要求 `Sec-WebSocket-Protocol: multiconnect.v1`，但 server 似乎只在客户端提供了协议但不包含 `multiconnect.v1` 时拒绝；完全不带该头的路径需要进一步收紧。
- 心跳默认值不一致：合约建议 30s ping / 10s pong / 90s idle；server 默认 15s interval，约 45s idle 断开。

建议：

1. 修正文档示例。
2. 决定正式配对模型：CONTROL_API_KEY 输入，或设备配对码/审批流程。
3. 强制 WSS 子协议必须存在。
4. 统一心跳策略。

## 5. P2：架构债和后续风险

### 5.1 Control Server 是内存开发版，不是生产形态

位置：

- `server/src/store/device-store.ts`
- `server/src/device-channel.ts`

问题：

- 设备注册、凭据 hash、连接状态、pending/completed command 都存在内存里。
- 重启后全部丢失。
- 缺少正式设备撤销、租户、用户角色、权限范围、审计落库。

建议：

- 后续进入 Web 控制台阶段前，先做数据库持久化和审计表。

### 5.2 Rust WSS 客户端校验薄

位置：

- `src-tauri/src/remote_control/service.rs`
- `contracts/v1/multiconnect.v1.schema.json`

问题：

- server 侧有 schema 校验和顺序校验。
- Rust 客户端只做较薄的 envelope/sequence 检查，没有完整使用共享 JSON Schema。
- clock skew、orderingKey、断线恢复后的命令续处理仍未实现。

建议：

- Rust 端也使用共享 schema 或生成类型。
- 实现断线恢复、命令超时补偿和 unknown 状态策略。

### 5.3 OpenAI Key 依赖环境变量

位置：

- `src-tauri/src/translation.rs`

问题：

- 当前只读取 Rust 进程环境变量 `OPENAI_API_KEY`。
- 用户从普通方式启动客户端时，可能拿不到 PowerShell 用户环境。
- 没有 UI 配置入口，也没有系统密钥链存储。

建议：

1. 短期：在设置页显示“当前是否检测到 OpenAI Key”。
2. 中期：提供 Key 输入，保存到系统密钥链，不进 localStorage，不写日志。

## 6. 推荐修复顺序

### 第一批：稳定真实翻译和发送

1. 输入框可靠替换 + 自动发送确认。
2. 翻译请求缓存、in-flight 去重、后端限流。
3. 翻译错误/超时前端可见。
4. `cargo fmt` 格式化。

### 第二批：收紧安全边界

1. 收紧 `wa-*` capability。
2. 所有敏感 Tauri command 增加 caller 检查。
3. `mc://translate-request` 加来源校验/token。
4. `panel-state` 加白名单。

### 第三批：整理 UI 语义

1. 隐藏或标注未实现的 `receiveTranslation`、`groupTranslation`、`blockChinese`、`translationServer`。
2. DeepL/Google 未接入前不要展示。
3. 统一 `translationEnabled` 和 `AccountConfig`。
4. localStorage schema 校验和迁移。

### 第四批：更新文档和控制台基础设施

1. 更新 `HANDOFF.md` / `README.md` / `server/README.md`。
2. 明确 sidecar 是 legacy fallback 还是继续维护。
3. Control Server 持久化、正式配对、审计。
4. WSS 合约校验和心跳策略统一。

## 7. 当前结论

当前代码能编译、核心测试能过；用户遇到的“慢”和“替换时好时坏”不是单一 bug，而是运行时可靠性问题：

- OpenAI 请求链路缺缓存/取消/限流。
- WhatsApp contenteditable 写入方式不可靠。
- 远程 webview 与 Tauri 主进程之间的事件桥缺少来源绑定。
- UI 暴露了部分未实现配置，容易让用户误解。

建议下一步不要继续堆新功能，先按 P0 顺序把“翻译预览快、替换稳定、权限安全”这三件事收住。
