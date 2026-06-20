# MultiConnect Platform Sidecar

Node.js + Playwright 平台适配进程。当前仅实现 WhatsApp Web 的可见登录窗口、独立持久化 Profile 和登录状态检查。

## 安全边界

- 不提取、不打印、不上传 Cookie、Local Storage、IndexedDB 或二维码内容。
- 每个账号使用独立 `userDataDir`，不使用用户日常 Chrome Profile。
- 浏览器始终可见，由用户主动完成扫码。
- 只允许打开 `https://web.whatsapp.com/`；本地测试 URL 必须显式启用。
- 标准输出只写 JSONL 协议，普通错误写入标准错误。

## 命令

```powershell
npm install
npm run check
node dist/index.js
```

当前开发版本依赖本机安装的 Google Chrome 或 Microsoft Edge。正式发布前应将 Node Sidecar 和受支持浏览器运行时纳入安装包或明确列为系统依赖。
