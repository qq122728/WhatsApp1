# MultiConnect Control Server

MultiConnect 自有 Web 控制台后端 API 的第一版。它提供设备注册、设备状态查询、受认证的 WebSocket 设备通道，以及一个仅用于验证命令闭环的 `device.status.request` 命令。

## 重要安全边界

- **禁止平台 Session 上云。** REST 和 WebSocket 输入会递归拒绝常见的 Session、Cookie、Storage State、平台 Token 和 API Key 字段。
- 服务只保存设备注册信息、设备凭据的 SHA-256 哈希和连接状态，不接收 WhatsApp、Telegram 或 RCS Session。
- 当前 `InMemoryDeviceStore` 是明确的开发实现：进程重启后设备、凭据、状态和命令幂等缓存全部丢失，不可用于生产。
- 默认只监听 `127.0.0.1:8000`。非回环监听必须启用 `REQUIRE_TLS=true`，通常应放在 TLS 反向代理后。
- 未配置 `CONTROL_API_KEY` 时，注册、状态和命令接口只允许回环调用。
- 日志只记录请求/连接元数据；敏感字段会被删除或脱敏，设备标识会哈希。不要在反向代理访问日志中记录 `Authorization`。

## 快速开始

要求 Node.js 20 或更高版本。

```powershell
cd C:\Users\User\Desktop\whatsapp-tg-rcs-control-panel\server
npm install
Copy-Item .env.example .env
npm run dev
```

完整验证：

```powershell
npm run check
```

生产式启动：

```powershell
npm run build
npm start
```

## REST 协议

所有成功响应都包含：

```json
{
  "protocolVersion": 1,
  "messageId": "server-generated-id",
  "type": "health.status",
  "timestamp": "2026-06-19T12:00:00.000Z",
  "data": {}
}
```

稳定错误结构：

```json
{
  "protocolVersion": 1,
  "messageId": "server-generated-id",
  "type": "error",
  "timestamp": "2026-06-19T12:00:00.000Z",
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Request validation failed",
    "retryable": false,
    "requestId": "request-correlation-id"
  }
}
```

### `GET /health`

无需认证。返回服务状态，并明确报告 `storage.kind=memory`、`durable=false`。

### `POST /api/v1/devices/register`

本地开发从回环地址调用；远程部署使用：

```text
Authorization: Bearer <CONTROL_API_KEY>
```

请求：

```json
{
  "protocolVersion": 1,
  "deviceId": "desktop-01",
  "name": "Support workstation",
  "clientVersion": "0.1.0",
  "capabilities": ["device.status"]
}
```

响应只在注册时返回一次 `deviceToken`。重新注册同一 `deviceId` 会轮换凭据并断开旧通道。

### `GET /api/v1/devices`

返回当前内存仓库中的设备列表。

### `GET /api/v1/devices/:deviceId/status`

返回注册信息、最后活动时间、连接状态和 `channelConnected`。

### `POST /api/v1/devices/:deviceId/commands`

第一版只允许无平台数据的状态查询命令：

```json
{
  "protocolVersion": 1,
  "idempotencyKey": "request-20260619-001",
  "commandType": "device.status.request",
  "timeoutMs": 5000
}
```

命令包含幂等键、接受期限和执行超时；设备需先发送 `command.ack`，再发送
`command.result`。服务不会自动重发超时或结果未知的命令。内存实现按契约将幂等终态保留到
`expiresAt` 或完成时间之后至少 24 小时，但进程重启仍会丢失。

WSS `command.request.payload` 使用契约字段 `commandName`、`parameters`、
`expiresAt` 和 `executionTimeoutMs`。成功的
`device.status.request` 结果必须是严格的 `DeviceStatusPayload`，不接受任意平台载荷。

## WebSocket 设备通道

地址：

```text
ws://127.0.0.1:8000/api/v1/devices/<deviceId>/channel
```

握手必须携带设备认证头，并建议协商共享子协议：

```text
Authorization: Bearer <deviceToken>
Sec-WebSocket-Protocol: multiconnect.v1
```

设备令牌不放在 URL 查询参数中，避免被代理或访问日志记录。线上 WSS 帧直接使用仓库
`contracts/v1/multiconnect.v1.schema.json` 做 Draft 2020-12 校验；运行构建产物时必须同时
部署根目录的 `contracts/v1`。

每个发送方在每条连接上独立维护从 `1` 开始的连续 `sequence`。客户端第一帧必须是
`DeviceHello`，第二帧必须是初始 `DeviceStatus`；握手完成前服务端不会下发命令。

七种线上消息为 `device.hello`、`device.status`、`command.request`、
`command.ack`、`command.result`、`heartbeat` 和 `error`。每条消息必须包含
`protocolVersion`、`messageId`、`type`、UTC `timestamp`、`sequence` 和 `payload`：

```json
{
  "protocolVersion": 1,
  "messageId": "5ce61aba-6f14-4386-b242-cbc120de57a7",
  "type": "device.status",
  "timestamp": "2026-06-19T12:00:00.000Z",
  "sequence": 2,
  "payload": {
    "statusRevision": 1,
    "status": "ready",
    "activeCommandCount": 0,
    "queuedCommandCount": 0,
    "accounts": []
  }
}
```

心跳使用契约统一的 `heartbeat` 类型及 `ping`/`pong` payload。序列跳号、首帧顺序错误、
敏感字段或命令关联字段不一致时，服务发送契约 `Error` 后使用 `44xx` 私有关闭码断开。

## CORS

开发/测试模式默认允许 `http://localhost:*`、`https://localhost:*`、`127.0.0.1` 和 `[::1]`。`CORS_ORIGINS` 可添加精确来源；生产模式只接受显式列表。

## 当前未实现

- 持久数据库、迁移和多实例共享状态。
- 用户登录、角色/设备范围权限和正式设备配对审批。
- 凭据吊销列表、令牌续期与密钥轮换管理界面。
- 审计日志持久化和外部可观测性后端。
- 实际平台消息或 Session 处理；本版本刻意不包含这些能力。
