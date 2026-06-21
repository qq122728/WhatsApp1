# MultiConnect

MultiConnect 是一个面向合规客服与客户运营场景的多渠道消息管理项目，计划统一管理 WhatsApp、Telegram 和 RCS 会话，并提供账号状态、消息收发、翻译、联系人及任务调度能力。

> 当前仓库状态：**工程基线开发中。客户端界面、翻译核心、自有控制后端、WSS 契约和 Tauri 后端骨架已经建立；真实平台接入尚未实现。**
>
> 项目版本：v0.1.0  
> 更新日期：2026-06-19

## 文档导航

| 文档 | 内容 |
|:--|:--|
| [HANDOFF.md](./HANDOFF.md) | 当前阶段交接说明，新会话继续工作优先阅读 |
| [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md) | 当前项目进度、已完成功能、风险点与下一步路线 |
| [CODING_GUIDELINES.md](./CODING_GUIDELINES.md) | 主代理与并行开发代理共同遵守的编码准则 |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | 测试版安装、运行与反馈说明 |
| [contracts/README.md](./contracts/README.md) | 客户端与 Web 后端的 WSS v1 通信契约 |
| [server/README.md](./server/README.md) | 自有 Web 控制后端的运行与 API 说明 |
| [docs/archive/PRD.md](./docs/archive/PRD.md) | 旧版产品需求基线，归档留痕 |
| [docs/archive/技术设计文档.md](./docs/archive/技术设计文档.md) | 旧版技术设计基线，归档留痕 |
| [docs/archive/代码结构说明.md](./docs/archive/代码结构说明.md) | 旧版代码结构说明，归档留痕 |

## 当前可运行内容

- React/Vite 客户端：总览、账号、统一收件箱、双语消息、发送前翻译预览、设置页。
- 翻译核心：中英文检测、Mock Provider、内存缓存、超时及稳定错误映射。
- Tauri/Rust：应用命令、Remote API 配置校验、设备注册、WSS v1 常驻连接、心跳、状态命令处理，以及 SessionVault/正式配对预留契约。
- WhatsApp 登录适配器：可见 Chrome 扫码、每账号独立持久 Profile、登录状态检查和手动恢复。
- Control Server：设备注册、状态查询、WSS 设备通道、命令 ACK/结果和幂等缓存。
- 通信契约：JSON Schema、TypeScript 类型以及合法/非法协议示例。

界面默认展示的账号和消息仍是演示数据；通过“添加账号”完成扫码后新增的 WhatsApp 账号使用真实本地登录状态，但消息同步尚未接入。

## 开发运行

要求 Node.js 20 或更高版本。

```powershell
npm install
npm --prefix sidecar install
npm run dev
```

客户端开发页面默认位于 `http://127.0.0.1:1420`。

启动我们自己的控制后端：

```powershell
cd server
npm install
npm run dev
```

随后打开桌面客户端的“设置”：

1. API 地址填写 `http://127.0.0.1:8000`。
2. 点击“保存配置”。
3. 点击“连接控制后端”。
4. 出现“已连接”后，说明设备注册、短期令牌鉴权和 WSS v1 握手已经完成。

设备令牌仅保存在 Rust 进程内存中，React 页面不会读取或保存令牌。

连接 WhatsApp：

1. 进入“账号”或“总览”，点击“添加账号”。
2. 选择 WhatsApp。
3. 客户端会打开独立的可见 Chrome 窗口。
4. 使用手机 WhatsApp 的“关联设备”扫描二维码。
5. 客户端显示登录成功后，账号会保存到本地账号索引。

当前开发版本要求本机已安装 Google Chrome，并要求 Node.js 可从 `PATH` 启动。WhatsApp Profile 保存在 Tauri 应用数据目录，不使用用户日常 Chrome Profile，也不会上传控制后端。

执行当前全部 Node/Python 检查：

```powershell
npm run check
```

Tauri 桌面运行还需要 Rust/Cargo 和 Windows WebView2 开发环境：

```powershell
npm run tauri dev
```

## 产品边界

项目优先支持已获得用户授权的客服、通知和客户关系维护场景，不以规避平台风控、批量骚扰或未经同意的营销触达为目标。

- 优先采用平台官方 API。
- Web 自动化仅作为受限适配方案，并需单独评估平台条款、账号风险和维护成本。
- 所有批量任务必须具备联系人同意记录、频率限制、退订机制、审计日志和紧急停止能力。
- Session、令牌和翻译服务密钥不得以明文保存或写入日志。

## 建议实施顺序

1. 创建 Tauri + React 工程和基础 CI。
2. 完成账号、会话、消息的本地数据模型。
3. 先接入一个合规且可测试的平台通道。
4. 实现单聊收发、状态恢复和错误处理。
5. 在后端实现翻译适配层，不在前端暴露 API Key。
6. 完成端到端测试后，再扩展联系人、任务调度和远程控制台。

## 当前里程碑

| 里程碑 | 状态 |
|:--|:--|
| 产品需求基线 | 已形成文档 |
| 技术设计基线 | 已形成文档 |
| React/Vite 客户端 | 已建立骨架 |
| Tauri/Rust 后端 | 设备注册与 WSS 客户端已完成 |
| 客户端翻译核心 | Mock 闭环已完成 |
| 自有 Control Server | 内存版闭环已完成 |
| WSS v1 通信契约 | 已完成 |
| Telegram 接入 | 待实现 |
| RCS 接入 | 待实现 |
| WhatsApp 可见扫码与 Profile 恢复 | 已完成第一阶段 |
| WhatsApp 消息同步与发送 | 待实现 |
| 真实翻译 Provider | 待实现 |
| 自动重连、持久数据库与正式设备配对 | 待实现 |
| 群发与完整 Web 控制台 | 待实现 |

状态以仓库中可运行代码、自动化测试和验收记录为准，不以文档中的设计描述代替实现证明。
