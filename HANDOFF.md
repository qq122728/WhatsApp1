# MultiConnect 当前交接文档

更新时间：2026-06-21
当前阶段：桌面客户端核心功能已进入可测试阶段，Web 控制台第一版已打通设备注册、账号上报、账号状态查看和单账号检测。

## 一句话状态

当前项目已经可以本地运行客户端 + 控制服务 + Web 控制台。客户端可多开 WhatsApp 独立 Session，支持发送/接收翻译、翻译缓存、账号管理、未读提示；Web 控制台可以看到设备在线、账号总数、账号在线/离线/异常摘要，并可对单个账号触发状态检测。

## 最近提交

- `0adda76 feat: refresh account status from web console`
- `53b918c feat: report WhatsApp account health`
- `67894d5 feat: show account details in web console`
- `5b60bfb feat: add web console account reporting`
- `8dd5f68 feat: highlight slow translation logs`
- `2b717a2 feat: add translation diagnostics logs`
- `cd61104 feat: manage translation cache and tone`
- `d4f810b feat: persist incoming translation cache`

## 如何运行

### 1. 启动控制服务

```powershell
cd C:\Users\User\Desktop\whatsapp-tg-rcs-control-panel\server
npm start
```

看到类似下面日志表示服务已启动：

```text
server.started host=127.0.0.1 port=8000
```

### 2. 启动客户端开发版

```powershell
cd C:\Users\User\Desktop\whatsapp-tg-rcs-control-panel
npm run tauri dev
```

### 3. 打开 Web 控制台

浏览器访问：

```text
http://127.0.0.1:8000/console
```

如果控制服务重启过，客户端需要重新连接控制后端：客户端设置页里重新连接本机控制服务即可。

## 当前已完成能力

### 桌面客户端

- Tauri + React 桌面客户端主体。
- WhatsApp Web 内嵌为独立 Session，每个账号独立数据目录。
- 顶部账号标签、更多账号折叠、账号管理抽屉。
- 多账号备注编辑、置顶、关闭标签、批量管理基础能力。
- 发送侧翻译预览：
  - 第一次发送按钮/Enter 只把译文替换进输入框。
  - 第二次才真正发送。
  - 翻译失败时阻止中文原文误发。
- 接收侧消息翻译：
  - 新消息可自动翻译。
  - 未翻译消息有手动“翻译”按钮。
  - 翻译结果持久化缓存，下次打开可复用。
- 设置页：
  - OpenAI Key 使用本机环境变量，不打包进安装包。
  - 翻译缓存管理：占用查看、清理、保留天数、每账号缓存条数、自动翻译历史消息开关。
  - 翻译日志：记录最近翻译耗时、缓存命中、失败情况。
- 收到消息后账号标签出现未读数字，左侧账号汇总也能提示。

### 控制服务

- 本地 HTTP + WSS 控制服务。
- 设备注册和心跳。
- 设备状态请求命令：`device.status.request`。
- 单账号状态刷新命令：`account.status.refresh`。
- 当前存储为内存模式，服务重启后注册状态会丢失，需要客户端重新连接。

### Web 控制台

- 地址：`http://127.0.0.1:8000/console`
- 可查看：
  - 服务状态。
  - 已注册设备数量。
  - 在线设备数量。
  - 账号数量。
  - 设备最后在线时间、版本、状态版本。
  - 账号详情列表。
- 支持账号筛选：
  - 全部账号。
  - 在线。
  - 离线。
  - 待登录/异常等状态。
- 支持搜索账号备注、账号 ID、摘要。
- 单账号卡片支持“检测”，会让客户端打开/刷新对应 WhatsApp 面板并回报状态。

## 账号异常能否看到

可以看到“客户端识别到并上报”的异常。

目前客户端会把账号归类为：

- 在线：绿色。
- 离线/未打开/未检测：灰色。
- 待登录：需要扫码或重新登录。
- 异常/受限/疑似封号：红色或异常状态，来源于 WhatsApp 页面里的提示文本检测。

注意：封号/受限检测是基于 WhatsApp Web 页面文本和状态的被动识别，不等于官方 API。WhatsApp 文案、语言、页面版本变化时，检测规则可能需要补充。

## 重要限制和注意事项

- Web 控制台不会接收 WhatsApp Session、Cookie、密钥、聊天正文。
- 当前 Web 控制台只适合状态查看和安全检测，不做发消息动作。
- 服务端存储仍是内存模式，重启服务后设备注册会消失。
- 单账号“检测”会让客户端打开/切换对应账号 WebView，批量检测前需要加队列和并发限制。
- 修改 WebView 注入脚本后，旧的 WhatsApp 标签通常要关闭重开，或者重启客户端才能完全生效。
- Windows 任务管理器里 MultiConnect 主进程看起来内存很低时，仍要注意 WebView2/实用工具进程的实际占用。

## 已验证命令

最近阶段已跑过：

```powershell
npm --prefix server run check
cd C:\Users\User\Desktop\whatsapp-tg-rcs-control-panel\src-tauri
cargo check
cd C:\Users\User\Desktop\whatsapp-tg-rcs-control-panel
npm run build
```

## 建议下一步

1. 做 Web 控制台的批量安全检测：
   - 多选账号。
   - 队列执行。
   - 默认并发 1，最多 2。
   - 显示检测中、成功、失败、耗时。
2. 给控制服务加持久化：
   - 保存设备和账号最近状态。
   - 服务重启后控制台仍能看到上次快照。
3. 做 Web 控制台登录和权限：
   - 目前是本机控制台第一版。
   - 后续远程访问必须做鉴权、TLS、操作审计。
4. 优化异常检测规则：
   - 收集不同 WhatsApp 语言下的封号、受限、掉线、扫码文案。
   - 做可维护的规则表。

## 新会话启动建议

新会话可以直接从这句话开始：

> 请读取 `HANDOFF.md` 和 `PROJECT_PROGRESS.md`，继续 MultiConnect 项目。当前刚提交到 `0adda76 feat: refresh account status from web console`，下一步优先做 Web 控制台批量安全检测，注意不要改动 WhatsApp 发送逻辑。
