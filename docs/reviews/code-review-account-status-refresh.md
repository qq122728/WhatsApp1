# 代码审查报告：`account.status.refresh` 命令

- **审查范围**：工作区未提交改动(`git diff HEAD`)
- **涉及文件**：
  - `server/src/app.ts`
  - `server/src/console-page.ts`
  - `server/src/device-channel.ts`
  - `server/src/schemas.ts`
  - `server/test/server.test.ts`
  - `src-tauri/src/commands/remote_control.rs`
  - `src-tauri/src/remote_control/protocol.rs`
  - `src-tauri/src/remote_control/service.rs`
- **审查日期**：2026-06-21
- **标准**:生产标准(correctness / reuse / 简化 / 效率 / altitude / 约定)

---

## 概述

本次改动为远程控制通道新增 `account.status.refresh` 命令:Web 控制台为每个账号加了"检测"按钮,
点击后通过 REST 下发命令,Tauri 客户端打开对应账号的 WhatsApp 面板并回报刷新后的状态。

整体设计方向合理(复用 `dispatchSafeCommand`、使用 `discriminatedUnion`、客户端先 ack 再执行),
单元测试覆盖了 happy path。但从生产标准看,存在若干真实问题,按严重程度列出如下。

---

## 问题清单(按严重程度排序)

### 🔴 P1 — 慢速 refresh 会拖垮整条设备通道

**位置**：`src-tauri/src/remote_control/service.rs:526-546`、`server/src/device-channel.ts:730`、`server/src/console-page.ts:1052`

**描述**:新路径在回 `ack` 之后**同步阻塞**「打开 webview + 固定 `sleep(2500ms)`」,然后才发送 `command.result`。

- 控制台对该命令写死 `timeoutMs: 8000`。
- 服务端在收到 `ack` 之后的执行超时 = `executionTimeoutMs`(即 8000ms)。
- WhatsApp webview 冷启动(`add_child` 创建 webview + `std::fs::create_dir_all`)在 Windows 上很可能耗时数秒,
  **叠加 2.5s sleep 后整体可能超过 8s**。

**失败场景**:

1. 服务端在 8s 后先触发 `COMMAND_TIMEOUT`(HTTP 504)并 `removePending`。
2. 客户端随后才发来的 `command.result` 在 `matchPendingCommand` 找不到对应 pending。
3. 抛出 `IDEMPOTENCY_CONFLICT` → `failProtocol` 以 **close code 4409 关闭整条 WSS 连接**。

也就是说,**一次稍慢的"检测"会把该设备上所有账号的通道一起断掉**。
`device.status.request` 不暴露此问题,是因为它从不引入秒级延迟。

**建议**:将 panel open + 等待移出"阻塞结果返回"的同步路径;或让 `timeoutMs` 覆盖最坏情况,
并在客户端发送结果前用 `is_expired` 复检——若已过期则改发 `expired` ack,而不是发一个必然冲突的迟到 result。

---

### 🟠 P2 — accountId 字符集校验比账号本身的约束更严,部分账号"检测"必然 400

**位置**：`server/src/schemas.ts:16-20`、`src-tauri/src/remote_control/service.rs:641-648`、`server/src/wss-contract.ts:305`

**描述**:命令侧的 `accountIdSchema` 与 Rust 的 `account_id_from_refresh_command` 都要求
`^[A-Za-z0-9][A-Za-z0-9_-]*$`。但账号进入状态面板时**只校验长度**:

- `accountStatusSummarySchema` 为 `z.string().min(16).max(128)`(无字符集限制)。
- Rust `normalize_accounts` 同样只检查长度。

**失败场景**:任何含 `.` / `:` / `@` 等字符的账号 ID(状态 schema 明确允许)都会在控制台显示"检测"按钮,
点击后被服务端 `commandRequestSchema` 直接 400 拒绝(即便放行,客户端也会回 `INVALID_ARGUMENT`)。
该功能对这类账号永久不可用。现有测试用例的 accountId(`wa_<32hex>`)恰好落在合法字符集内,因此掩盖了该问题。

**建议**:两端校验应同源一致——要么在状态入口(`accountStatusSummarySchema` / `normalize_accounts`)也收紧字符集,
要么把 refresh 的 accountId 校验放宽到与状态 schema 相同。

---

### 🟠 P3 — 固定 2.5s sleep 是脆弱的启发式,可能返回过期数据却报告 "succeeded"

**位置**：`src-tauri/src/remote_control/service.rs:545-549`

**描述**:打开面板后 `sleep` 一个魔数 2500ms,然后把当前 `accounts` 快照原样作为"刷新结果"返回,
状态写成 `succeeded`。但面板加载 / 账号上线是异步且无界的——2.5s 并不保证 `accounts` 已被刷新。

**失败场景**:生产上容易出现"点了检测、返回成功、状态却没变"的误导性结果;
若实际刷新慢于 2.5s,则返回的是旧快照,用户得到错误的"已成功"反馈。

**建议**:等待真实的状态更新信号(已存在 `status_update` 通道)或设置明确的就绪条件,
而非依赖一个固定延时猜测。

---

### 🟡 P4 — 账号 ID 校验器三处重复且边界不一致(reuse / altitude)

**位置**：`src-tauri/src/remote_control/service.rs:641`、`src-tauri/src/commands/panels.rs:9-24`、`src-tauri/src/platform_sidecar/mod.rs:272`、`src-tauri/src/account_panel/mod.rs:1846`

**描述**:`account_id_from_refresh_command`(长度 16-128)实质重写了已有的两个校验器:

- `commands/panels.rs::validate_account_id`:长度 **8-64**,字符集相同。
- `platform_sidecar/mod.rs::validate_account_id`:长度 **8-64**,字符集相同。

三份逻辑相同但长度边界不一致;而 `AccountPanelManager::open` 自身**不做任何校验**(依赖调用方)。

**失败场景**:同一个账号 ID 在不同入口可能一处接受、一处拒绝;长度 65-128 的 ID 经新路径可绕过
正常命令路径的 8-64 上限去创建 profile 目录。

**建议**:抽出单一的 `validate_account_id` 复用,并统一长度边界与字符集。

---

### 🟡 P5 — 阻塞 `tokio::select!` 主循环,影响关停 / 心跳响应

**位置**：`src-tauri/src/remote_control/service.rs:526-546`

**描述**:在 panel open + 2.5s sleep 期间,`run_device_channel` 的 `select!` 循环停转,
无法处理 `shutdown`、`status_updates` 或心跳帧——用户断开会延迟最多约 2.5s+ 才生效。

**失败场景**:默认心跳间隔 15s 使单独的断连风险较低,但与 P1 叠加会放大超时窗口。属设计层面的连带问题。

**建议**:与 P1 一并处理,把耗时工作移出 `select!` 的同步分支。

---

## 做得好的地方

- `dispatchSafeCommand` 抽取共享逻辑、`discriminatedUnion` + `.strict()` 收紧入参,清晰。
- `expiresAt` 从写死的 `HELLO_TIMEOUT_MS` 改为 `executionTimeoutMs`(`device-channel.ts:262`),
  实际修掉了原有不一致,是正向改进。
- 控制台全部使用 `textContent` / `encodeURIComponent`,无 XSS / 注入面。
- 客户端先 `ack` 再执行、失败发 `command.result(failed)` 的协议序列正确。

---

## 优先级建议

| 优先级 | 问题 | 建议处理时机 |
| --- | --- | --- |
| P1 | 慢速 refresh 断开设备通道 | 合并前修复 |
| P2 | accountId 字符集不一致 | 合并前修复 |
| P3 | 固定 2.5s sleep 返回过期/虚假成功 | 紧随其后 |
| P4 | 校验器重复、边界不一致 | 紧随其后 |
| P5 | 阻塞 select 主循环 | 与 P1 一并处理 |
