export function renderConsoleHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MultiConnect Web Console</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #748094;
      --line: #dfe6f0;
      --brand: #18a058;
      --brand-soft: #e9f8f0;
      --danger: #d64550;
      --warning: #b56b12;
      --shadow: 0 18px 50px rgba(16, 24, 40, 0.08);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", "Microsoft YaHei", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 34rem),
        linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%);
    }

    button,
    input {
      font: inherit;
    }

    .shell {
      width: min(1180px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 32px 0 44px;
    }

    .hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 18px;
    }

    .hero h1 {
      margin: 0;
      font-size: 26px;
      letter-spacing: -0.04em;
    }

    .hero p {
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 13px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo {
      display: grid;
      width: 44px;
      height: 44px;
      border-radius: 15px;
      place-items: center;
      color: #ffffff;
      background: linear-gradient(135deg, #18a058, #4776f0);
      box-shadow: 0 12px 32px rgba(71, 118, 240, 0.24);
      font-weight: 900;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .key-status {
      width: 100%;
      min-height: 14px;
      color: var(--muted);
      font-size: 11px;
      text-align: right;
    }

    .key-input {
      width: 260px;
      border: 1px solid var(--line);
      border-radius: 13px;
      padding: 11px 13px;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.78);
      outline: none;
    }

    .key-input:focus {
      border-color: rgba(24, 160, 88, 0.55);
      box-shadow: 0 0 0 4px rgba(24, 160, 88, 0.12);
    }

    .button {
      border: 1px solid var(--line);
      border-radius: 13px;
      padding: 11px 15px;
      color: #253044;
      background: #ffffff;
      cursor: pointer;
      transition:
        transform 0.15s ease,
        border-color 0.15s ease,
        box-shadow 0.15s ease;
    }

    .button:hover {
      border-color: rgba(24, 160, 88, 0.45);
      box-shadow: 0 10px 24px rgba(16, 24, 40, 0.08);
      transform: translateY(-1px);
    }

    .button.primary {
      border-color: transparent;
      color: #ffffff;
      background: var(--brand);
    }

    .notice {
      margin: 0 0 18px;
      border: 1px solid #d8e4f3;
      border-radius: 18px;
      padding: 14px 16px;
      color: #58657a;
      background: rgba(255, 255, 255, 0.74);
      box-shadow: var(--shadow);
      font-size: 12px;
      line-height: 1.6;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }

    .metric,
    .panel {
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: var(--shadow);
    }

    .metric {
      padding: 17px;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .metric strong {
      display: block;
      margin-top: 8px;
      font-size: 26px;
      letter-spacing: -0.04em;
    }

    .metric small {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-size: 11px;
    }

    .panel {
      overflow: hidden;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
    }

    .panel-head h2 {
      margin: 0;
      font-size: 17px;
      letter-spacing: -0.03em;
    }

    .panel-head p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border-radius: 999px;
      padding: 7px 10px;
      color: #5d6678;
      background: #edf1f7;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .status-pill::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: currentColor;
    }

    .status-pill.ready,
    .status-pill.online {
      color: #138457;
      background: var(--brand-soft);
    }

    .status-pill.degraded,
    .status-pill.busy,
    .status-pill.starting {
      color: var(--warning);
      background: #fff4df;
    }

    .status-pill.offline,
    .status-pill.error {
      color: var(--danger);
      background: #fdebed;
    }

    .device-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      padding: 18px;
    }

    .device-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 15px;
      background: #ffffff;
    }

    .device-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .device-title {
      min-width: 0;
    }

    .device-title strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
    }

    .device-title code {
      display: block;
      overflow: hidden;
      margin-top: 5px;
      color: #8490a3;
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .device-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 13px;
    }

    .device-meta div {
      border-radius: 12px;
      padding: 9px 10px;
      background: #f6f8fb;
    }

    .device-meta span {
      display: block;
      color: var(--muted);
      font-size: 10px;
    }

    .device-meta strong {
      display: block;
      overflow: hidden;
      margin-top: 3px;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .device-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .device-actions .button {
      padding: 9px 11px;
      font-size: 12px;
    }

    .empty,
    .error-box {
      margin: 18px;
      border: 1px dashed #d6deea;
      border-radius: 16px;
      padding: 34px 20px;
      color: var(--muted);
      background: #fbfcfe;
      text-align: center;
      font-size: 13px;
    }

    .error-box {
      border-style: solid;
      color: var(--danger);
      background: #fff7f8;
      text-align: left;
      white-space: pre-wrap;
    }

    .footer {
      margin-top: 16px;
      color: var(--muted);
      font-size: 11px;
      text-align: center;
    }

    @media (max-width: 860px) {
      .hero {
        align-items: stretch;
        flex-direction: column;
      }

      .actions {
        justify-content: flex-start;
      }

      .key-input {
        width: 100%;
      }

      .summary,
      .device-list {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="brand">
        <div class="logo">MC</div>
        <div>
          <h1>MultiConnect Web Console</h1>
          <p>第一版控制台：设备在线状态、账号数量、远程状态刷新。</p>
        </div>
      </div>
      <div class="actions">
        <input id="control-key" class="key-input" type="password" autocomplete="off" placeholder="Control API Key（本机可留空）" />
        <button id="save-key" class="button">保存 Key</button>
        <button id="refresh" class="button primary">刷新</button>
        <span id="key-status" class="key-status" aria-live="polite"></span>
      </div>
    </section>

    <p class="notice">
      安全边界：控制台只读取设备注册、连接状态和账号摘要，不接收 WhatsApp/Telegram/RCS 的 Session、Cookie 或密钥。
      如果服务器配置了 CONTROL_API_KEY，请在右上角输入；本机 127.0.0.1 访问通常可以留空。
    </p>

    <section class="summary" aria-label="summary">
      <div class="metric">
        <span>Service</span>
        <strong id="service-status">--</strong>
        <small id="service-detail">等待刷新</small>
      </div>
      <div class="metric">
        <span>Devices</span>
        <strong id="device-count">0</strong>
        <small>已注册设备</small>
      </div>
      <div class="metric">
        <span>Online</span>
        <strong id="online-count">0</strong>
        <small>ready / busy / degraded</small>
      </div>
      <div class="metric">
        <span>Accounts</span>
        <strong id="account-count">0</strong>
        <small>设备上报账号摘要</small>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>设备列表</h2>
          <p id="last-refresh">尚未刷新</p>
        </div>
        <span id="overall-pill" class="status-pill">unknown</span>
      </div>
      <div id="message"></div>
      <div id="device-list" class="device-list"></div>
    </section>

    <div class="footer">MultiConnect Web Console v0.1 · 开发版内存存储，服务重启后设备注册状态会丢失。</div>
  </main>

  <script>
    (function () {
      var keyInput = document.getElementById("control-key");
      var keyStatus = document.getElementById("key-status");
      var saveKeyButton = document.getElementById("save-key");
      var refreshButton = document.getElementById("refresh");
      var serviceStatus = document.getElementById("service-status");
      var serviceDetail = document.getElementById("service-detail");
      var deviceCount = document.getElementById("device-count");
      var onlineCount = document.getElementById("online-count");
      var accountCount = document.getElementById("account-count");
      var lastRefresh = document.getElementById("last-refresh");
      var overallPill = document.getElementById("overall-pill");
      var message = document.getElementById("message");
      var deviceList = document.getElementById("device-list");

      keyInput.value = sessionStorage.getItem("mc-control-key") || "";

      function headers(json) {
        var result = {};
        var key = keyInput.value.trim();
        if (json) result["content-type"] = "application/json";
        if (key) result.authorization = "Bearer " + key;
        return result;
      }

      function setMessage(text, isError) {
        message.replaceChildren();
        if (!text) return;
        var box = document.createElement("div");
        box.className = isError ? "error-box" : "empty";
        box.textContent = text;
        message.appendChild(box);
      }

      function setKeyStatus(text) {
        keyStatus.textContent = text || "";
        if (!text) return;
        window.clearTimeout(setKeyStatus.timer);
        setKeyStatus.timer = window.setTimeout(function () {
          keyStatus.textContent = "";
        }, 2600);
      }

      function statusClass(status) {
        return String(status || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      }

      function formatTime(value) {
        if (!value) return "无";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
      }

      function onlineLike(device) {
        return ["ready", "busy", "degraded", "starting"].indexOf(device.status) !== -1;
      }

      async function parseResponse(response) {
        var payload = await response.json().catch(function () {
          return null;
        });
        if (!response.ok) {
          var messageText = payload && payload.error
            ? payload.error.code + ": " + payload.error.message
            : "HTTP " + response.status;
          throw new Error(messageText);
        }
        return payload;
      }

      async function apiGet(path) {
        return parseResponse(await fetch(path, { headers: headers(false) }));
      }

      async function apiPost(path, body) {
        return parseResponse(await fetch(path, {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify(body)
        }));
      }

      function renderDevice(device) {
        var card = document.createElement("article");
        card.className = "device-card";

        var top = document.createElement("div");
        top.className = "device-top";
        var title = document.createElement("div");
        title.className = "device-title";
        var name = document.createElement("strong");
        name.textContent = device.name || "未命名设备";
        var id = document.createElement("code");
        id.textContent = device.deviceId || "--";
        title.append(name, id);
        var pill = document.createElement("span");
        pill.className = "status-pill " + statusClass(device.status);
        pill.textContent = device.status || "unknown";
        top.append(title, pill);

        var meta = document.createElement("div");
        meta.className = "device-meta";
        var rows = [
          ["账号", String((device.accounts && device.accounts.length) || 0)],
          ["版本", device.clientVersion || "unknown"],
          ["最后在线", formatTime(device.lastSeenAt)],
          ["状态版本", device.statusRevision ? String(device.statusRevision) : "--"]
        ];
        rows.forEach(function (row) {
          var item = document.createElement("div");
          var label = document.createElement("span");
          label.textContent = row[0];
          var value = document.createElement("strong");
          value.textContent = row[1];
          item.append(label, value);
          meta.appendChild(item);
        });

        var actions = document.createElement("div");
        actions.className = "device-actions";
        var capability = document.createElement("span");
        capability.className = "status-pill";
        capability.textContent = ((device.capabilities || []).length || 0) + " capabilities";
        var button = document.createElement("button");
        button.className = "button";
        button.textContent = "刷新设备状态";
        button.disabled = !onlineLike(device);
        button.addEventListener("click", function () {
          requestDeviceStatus(device.deviceId, button);
        });
        actions.append(capability, button);

        card.append(top, meta, actions);
        return card;
      }

      function renderDevices(devices) {
        deviceList.replaceChildren();
        if (!devices.length) {
          setMessage("还没有设备注册。请打开桌面客户端 → 设置 → Web 控制台连接，API 地址填 http://127.0.0.1:8000，然后点击“连接控制后端”。", false);
          return;
        }
        setMessage("", false);
        devices.forEach(function (device) {
          deviceList.appendChild(renderDevice(device));
        });
      }

      async function refreshAll() {
        refreshButton.disabled = true;
        refreshButton.textContent = "刷新中...";
        try {
          var health = await apiGet("/health");
          serviceStatus.textContent = health.data && health.data.status ? health.data.status : "ok";
          serviceDetail.textContent = "uptime " + ((health.data && health.data.uptimeSeconds) || 0) + "s";

          var result = await apiGet("/api/v1/devices");
          var devices = result.data && Array.isArray(result.data.devices) ? result.data.devices : [];
          var onlineDevices = devices.filter(onlineLike);
          var accounts = devices.reduce(function (sum, device) {
            return sum + ((device.accounts && device.accounts.length) || 0);
          }, 0);
          deviceCount.textContent = String(devices.length);
          onlineCount.textContent = String(onlineDevices.length);
          accountCount.textContent = String(accounts);
          overallPill.textContent = onlineDevices.length > 0 ? "online" : "offline";
          overallPill.className = "status-pill " + (onlineDevices.length > 0 ? "online" : "offline");
          lastRefresh.textContent = "最后刷新：" + new Date().toLocaleString();
          renderDevices(devices);
        } catch (error) {
          serviceStatus.textContent = "error";
          serviceDetail.textContent = "请求失败";
          overallPill.textContent = "error";
          overallPill.className = "status-pill error";
          setMessage(error instanceof Error ? error.message : String(error), true);
        } finally {
          refreshButton.disabled = false;
          refreshButton.textContent = "刷新";
        }
      }

      async function requestDeviceStatus(deviceId, button) {
        var original = button.textContent;
        button.disabled = true;
        button.textContent = "请求中...";
        try {
          await apiPost("/api/v1/devices/" + encodeURIComponent(deviceId) + "/commands", {
            protocolVersion: 1,
            idempotencyKey: "console-" + Date.now() + "-" + Math.random().toString(16).slice(2),
            commandType: "device.status.request",
            timeoutMs: 5000
          });
          await refreshAll();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), true);
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      }

      saveKeyButton.addEventListener("click", function () {
        sessionStorage.setItem("mc-control-key", keyInput.value.trim());
        setKeyStatus("Key 已保存到当前浏览器会话");
        refreshAll();
      });
      refreshButton.addEventListener("click", refreshAll);
      keyInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          sessionStorage.setItem("mc-control-key", keyInput.value.trim());
          refreshAll();
        }
      });

      refreshAll();
      window.setInterval(refreshAll, 5000);
    })();
  </script>
</body>
</html>`;
}
