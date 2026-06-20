# MultiConnect 客户端—Web 后端通信契约 v1

本目录是桌面客户端与 Web 后端之间的共享通信边界。线上数据以
[JSON Schema](./v1/multiconnect.v1.schema.json) 为准，TypeScript 使用
[类型定义](./v1/types.ts)。协议只描述我们自己的控制平面，不替代平台适配器协议。

## 文件

- `v1/multiconnect.v1.schema.json`：JSON Schema Draft 2020-12，校验单个 WSS 应用帧。
- `v1/types.ts`：与 Schema 对应的严格 TypeScript 判别联合。
- `v1/examples/valid/`：七种消息的合法示例。
- `v1/examples/invalid/schema/`：必须被 JSON Schema 拒绝的示例。
- `v1/examples/invalid/semantic/`：结构合法、但必须被业务语义校验拒绝的示例。
- `validate_examples.py`：Schema 与示例的可执行验证入口。
- `requirements.txt`：示例验证脚本的 Python 依赖。

## 传输与连接边界

桌面客户端主动建立 `wss://<host>/api/v1/devices/<deviceId>/channel` 长连接；其中
`deviceId` 只是公开设备标识，不是认证凭据。非 localhost 环境禁止明文 WS。认证仍依赖：

- `Authorization: Bearer <short-lived-device-token>`
- `Sec-WebSocket-Protocol: multiconnect.v1`

设备令牌只进入 TLS 保护的 HTTP Upgrade 请求头，不进入 URL 查询参数、应用消息、
错误详情或日志。桌面端应由 Rust 可信边界持有令牌，React UI 不得读取。

配对与 WSS 认证是两个阶段：

1. 用户先通过受认证的 Web/REST 流程完成设备配对，获得可撤销设备身份和短期凭据。
2. Web 后端在返回 `101 Switching Protocols` 前校验设备凭据、配对状态、撤销状态和租户归属。
3. 未认证返回 `401`，未配对、越权或已撤销返回 `403`；不得先接受连接再下发命令。
4. WSS 建立后，客户端第一帧必须是 `DeviceHello`，它只声明公开设备 ID、版本和能力，不携带配对密钥。
5. Web 用户发起命令时，后端还必须再次校验用户角色、设备范围、账号范围和命令权限。

配对码、一次性配对令牌和设备凭据的签发格式不属于本 v1 消息 Schema；它们应通过独立
REST 契约定义。

## Envelope

每条消息都必须包含：

| 字段 | 规则 |
|:--|:--|
| `protocolVersion` | v1 固定为整数 `1` |
| `messageId` | 当前帧唯一；重传时生成新值 |
| `type` | 七种消息之一 |
| `timestamp` | UTC RFC 3339，必须以 `Z` 结尾 |
| `sequence` | 每个发送方、每条 WSS 连接独立递增，从 `1` 开始 |
| `payload` | 由 `type` 决定的严格对象 |

消息类型为 `device.hello`、`device.status`、`command.request`、
`command.ack`、`command.result`、`heartbeat`、`error`。

初始帧大小上限建议为 1 MiB。超过上限时，接收方返回
`PROTOCOL_MESSAGE_TOO_LARGE`（若仍可安全回复）并关闭连接。大数据应使用受控文件或二进制
通道，不得塞入 JSON。

## 建连与消息顺序

客户端和服务端分别维护自己的 `sequence`，两边都从 `1` 开始，互不共用：

1. 客户端在 WSS 建立后 5 秒内发送 `DeviceHello`，客户端序列号为 `1`。
2. 客户端随后在 5 秒内发送初始 `DeviceStatus`，客户端序列号为 `2`。
3. 后端验证 Hello、能力和初始状态后，才可发送 `CommandRequest`。
4. 客户端先持久化命令和幂等映射，再发送 `CommandAck`，然后执行命令。
5. 每个已接受命令最终发送一个 `CommandResult`；重复投递可重放同一终态结果。
6. `Heartbeat` 可穿插在任意业务帧之间。

WSS 已保证单连接帧有序，`sequence` 用于检测实现错误、遗漏和重复。收到非预期序列号时，
发送 `PROTOCOL_INVALID_SEQUENCE`；无法安全恢复时关闭并重连。重连后序列号重新从 `1`
开始，未完成命令依靠 `commandId` 和 `idempotencyKey` 恢复，不能依靠旧连接序列号。

`sequence` 只表示交付顺序，不表示命令完成顺序。具有相同 `orderingKey` 的命令必须按请求
序列串行执行；不同 `orderingKey` 或没有该字段的命令可并发，结果可能乱序返回。

`DeviceStatus.statusRevision` 在同一已安装设备身份的生命周期内单调递增。后端应忽略小于等于
已保存 revision 的陈旧状态。

## 命令确认、超时与结果

`CommandRequest`、`CommandAck`、`CommandResult` 都回显同一组
`commandId`、`idempotencyKey`、`expiresAt`：

- `commandId`：一次命令调用的稳定关联 ID；传输重试时不变。
- `idempotencyKey`：同一逻辑副作用的稳定键；防止断线或重试造成重复执行。
- `expiresAt`：未接受命令的最后时刻。客户端不得接受 `expiresAt <= 当前协议时间` 的命令。
- `executionTimeoutMs`：从 `accepted` 开始计算的最大本地执行时间。

客户端应在收到请求后 5 秒内发送 Ack，或在更早的 `expiresAt` 前回复。Ack 状态：

| 状态 | 含义 |
|:--|:--|
| `accepted` | 已持久化并承诺执行 |
| `rejected` | 权限、参数、能力或本地前置条件不满足，必须带 `error` |
| `duplicate` | 已存在相同幂等命令，不再次执行 |
| `expired` | 收到时已过期，必须带 `COMMAND_EXPIRED` |

结果状态：

| 状态 | 含义 |
|:--|:--|
| `succeeded` | 已明确成功 |
| `failed` | 已明确失败，可依据错误的 `retryable` 决定是否重试 |
| `unknown` | 可能已经产生副作用但无法确认，禁止盲目重发 |
| `cancelled` | 在支持取消且结果明确时取消 |
| `expired` | 接受前或恢复执行时已失去有效性 |

`failed`、`unknown`、`cancelled`、`expired` 结果必须带稳定错误对象。执行超时时：

- 能确认没有产生副作用：返回 `failed` + `COMMAND_TIMEOUT`。
- 无法确认是否已产生副作用：返回 `unknown` + `COMMAND_TIMEOUT`，不得自动换新幂等键重发。

服务器时间为命令过期判断的基准。客户端通过心跳时间估算偏差；偏差超过 120 秒时应报告
`PROTOCOL_CLOCK_SKEW` 并暂停接受有副作用的命令，直到时间可信。

## 幂等规则

幂等作用域为 `(deviceId, commandName, idempotencyKey)`：

- 首次接受前，客户端必须原子保存命令摘要、状态和幂等键。
- 相同键且规范化命令内容相同：返回 `duplicate`；若已有终态，重放缓存的 `CommandResult`。
- 相同键但命令名、参数、目标、超时或排序键不同：拒绝并返回 `IDEMPOTENCY_CONFLICT`。
- 传输重试必须保留 `commandId`、`idempotencyKey`、`expiresAt` 和命令内容，只更新
  Envelope 的 `messageId`、`timestamp`、`sequence`。
- 幂等记录至少保留到 `expiresAt` 后 24 小时或 `completedAt` 后 24 小时，取更晚者。

服务端断线后可以重发未确认命令，但不得用新的幂等键“试一次”。对于 `unknown`，必须先查询
平台或本地事实状态，再由人工或明确的补偿流程处理。

## 心跳

任一方可发送 `ping`，对方使用相同 `nonce` 返回 `pong`，并在 `replyToMessageId` 中引用
ping 的消息 ID。`lastReceivedSequence` 是诊断信息，不是业务 Ack。

建议默认值：

- 空闲 30 秒发送 ping。
- 10 秒内未收到对应 pong，判定该次心跳失败。
- 90 秒没有任何有效帧，关闭连接并指数退避重连。

## 状态枚举

设备连接状态：`starting`、`ready`、`degraded`、`busy`、`shutting_down`。

账号状态与 PRD 保持一致：`initializing`、`awaiting_auth`、`online`、`degraded`、
`offline`、`expired`、`error`。

服务端通过 WSS 断开事实推导设备 `offline`，客户端不需要在已经断开的连接上发送
`offline`。

## 错误模型

错误对象包含稳定 `code`、`category`、脱敏 `message`、`retryable`，可选
`retryAfterMs` 和 `field`。`message` 面向诊断摘要，不得包含内部堆栈或敏感数据。
Schema 固定校验每个错误码所属类别，双方不得自行改类。

| 类别 | 错误码 |
|:--|:--|
| 协议 | `PROTOCOL_UNSUPPORTED_VERSION`、`PROTOCOL_INVALID_MESSAGE`、`PROTOCOL_INVALID_SEQUENCE`、`PROTOCOL_MESSAGE_TOO_LARGE`、`PROTOCOL_CLOCK_SKEW` |
| 设备认证/配对/授权 | `DEVICE_AUTH_REQUIRED`、`DEVICE_AUTH_INVALID`、`PAIRING_REQUIRED`、`PAIRING_REVOKED`、`PERMISSION_DENIED` |
| 命令 | `COMMAND_UNSUPPORTED`、`COMMAND_EXPIRED`、`COMMAND_TIMEOUT`、`COMMAND_CANCELLED`、`COMMAND_BUSY`、`IDEMPOTENCY_CONFLICT` |
| 账号 | `ACCOUNT_NOT_FOUND`、`ACCOUNT_NOT_READY` |
| 平台授权 | `AUTH_TIMEOUT`、`AUTH_EXPIRED` |
| 网络 | `NETWORK_TIMEOUT`、`DNS_FAILURE` |
| 平台 | `PLATFORM_RATE_LIMITED`、`PLATFORM_REJECTED` |
| 适配器 | `ADAPTER_UNAVAILABLE`、`ADAPTER_CRASHED`、`SELECTOR_MISMATCH` |
| 存储 | `DB_LOCKED`、`DISK_FULL` |
| 加密 | `KEYCHAIN_LOCKED`、`DECRYPT_FAILED` |
| 翻译 | `TRANSLATION_QUOTA`、`TRANSLATION_TIMEOUT` |
| 校验/内部 | `INVALID_ARGUMENT`、`INTERNAL_ERROR` |

错误码是否可重试由具体错误实例的 `retryable` 明确给出；调用方不能只按类别猜测。

建议的私有 WSS 关闭码：

| 关闭码 | 含义 |
|:--|:--|
| `4400` | 消息或协议无效 |
| `4401` | 设备未认证或凭据失效 |
| `4403` | 未配对、已撤销或越权 |
| `4408` | Hello、Ack 或心跳超时 |
| `4409` | 序列或幂等冲突 |
| `4413` | 消息过大 |

关闭前若连接仍可信，可先发送 `Error`；认证失败时不要在应用层泄露多余细节。

## 严禁传输平台 Session

WSS、REST、日志、审计事件和错误消息均不得传输或存储：

- WhatsApp、Telegram、RCS 或 Web 适配器的 Session。
- Cookie、Local Storage、IndexedDB、`storageState` 或浏览器 profile 内容。
- 平台访问令牌、刷新令牌、二维码内容、API Key、密码或验证码。
- 配对密钥、设备私钥、完整 Authorization 头。
- 上述数据的“加密后副本”；加密不改变禁止上传的边界。

平台 Session 只能留在桌面客户端可信边界内，由系统密钥链和认证加密保护。远程命令只能引用
本地 `accountId`，由客户端本地适配器执行。

Schema 会递归拒绝通用 `parameters` 和 `result` 中包含 `session`、`cookie`、`token`、
`secret`、`apiKey`、`authorization`、`credential`、`storageState`、
`localStorage` 等敏感属性名。这只是纵深防御，不能识别被伪装成普通字符串的秘密。每个
`commandName` 仍必须有独立白名单 Schema，客户端和服务端都要校验，并对日志再次脱敏。

## 示例

合法示例：

- [`DeviceHello`](./v1/examples/valid/device-hello.json)
- [`DeviceStatus`](./v1/examples/valid/device-status.json)
- [`CommandRequest`](./v1/examples/valid/command-request.json)
- [`CommandAck`](./v1/examples/valid/command-ack.json)
- [`CommandResult`](./v1/examples/valid/command-result.json)
- [`Heartbeat`](./v1/examples/valid/heartbeat.json)
- [`Error`](./v1/examples/valid/error.json)

非法示例：

- [`missing-message-id.json`](./v1/examples/invalid/schema/missing-message-id.json)：缺少 Envelope 必填字段。
- [`session-in-command.json`](./v1/examples/invalid/schema/session-in-command.json)：试图上传平台 Session。
- [`failed-result-without-error.json`](./v1/examples/invalid/schema/failed-result-without-error.json)：失败终态缺少错误对象。
- [`pong-without-reply.json`](./v1/examples/invalid/schema/pong-without-reply.json)：pong 未引用 ping。
- [`wrong-error-category.json`](./v1/examples/invalid/schema/wrong-error-category.json)：错误码与固定类别不匹配。
- [`expired-command.json`](./v1/examples/invalid/semantic/expired-command.json)：结构合法，但 `expiresAt` 不晚于消息时间。

## 验证

在仓库根目录运行：

```powershell
python -m pip install -r contracts/requirements.txt
python contracts/validate_examples.py
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler contracts/v1/types.ts
```

JSON Schema 负责结构、枚举、格式和敏感属性名拦截；实现还必须执行跨字段和跨消息语义校验，
包括时间关系、序列连续性、Hello 顺序、Ack 时限、命令权限、幂等内容一致性和状态转换。

## 集成约定

- Wire format 以 JSON Schema 为唯一事实源，TypeScript 类型用于编译期约束。
- 客户端和服务端都在反序列化后的第一边界校验 Schema，不信任对端。
- `commandName` 必须先出现在 `DeviceHello.capabilities.commandNames` 中，后端才能下发。
- 每个命令增加独立参数/结果 Schema，并在授权层绑定允许的角色、设备和账号范围。
- 服务端持久化 request/ack/result 审计记录，但错误摘要和结果必须脱敏。
- 客户端先持久化命令，再 Ack；后端先持久化命令，再通过 WSS 投递。
- 新增消息类型或改变必填字段属于破坏性变更，应发布新协议版本；v1 只允许新增可选字段，
  且双方必须先完成兼容性评估。
