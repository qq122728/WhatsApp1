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

    .status-pill.offline {
      color: #64748b;
      background: #eef2f7;
    }

    .status-pill.expired,
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

    .device-card.has-accounts {
      grid-column: 1 / -1;
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

    .account-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px 0;
      flex-wrap: wrap;
    }

    .batch-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      border-top: 1px solid var(--line);
      padding: 12px 18px 0;
      flex-wrap: wrap;
    }

    .batch-tools label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .batch-tools select {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 7px 9px;
      color: var(--ink);
      background: #ffffff;
      font-size: 12px;
      outline: none;
    }

    .batch-detail {
      color: var(--muted);
      font-size: 11px;
    }

    .batch-tools .button {
      padding: 8px 11px;
      font-size: 12px;
    }

    .account-search,
    .account-filter {
      border: 1px solid var(--line);
      border-radius: 13px;
      padding: 10px 12px;
      color: var(--ink);
      background: #ffffff;
      outline: none;
      font-size: 12px;
    }

    .account-search {
      min-width: min(360px, 100%);
      flex: 1 1 260px;
    }

    .account-filter {
      flex: 0 0 auto;
    }

    .account-search:focus,
    .account-filter:focus {
      border-color: rgba(24, 160, 88, 0.55);
      box-shadow: 0 0 0 4px rgba(24, 160, 88, 0.1);
    }

    .account-filter-detail {
      color: var(--muted);
      font-size: 11px;
    }

    .account-section {
      margin-top: 14px;
      border-top: 1px solid var(--line);
      padding-top: 13px;
    }

    .account-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: #4b5565;
      font-size: 12px;
      font-weight: 800;
    }

    .account-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px;
      max-height: 360px;
      overflow: auto;
      padding-right: 4px;
    }

    .account-card {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 11px;
      background: #fbfcfe;
      min-width: 0;
    }

    .account-card.running {
      border-color: rgba(71, 118, 240, 0.4);
      background: #f7faff;
    }

    .account-card.online {
      border-color: rgba(24, 160, 88, 0.26);
      background: #f4fcf7;
    }

    .account-card.offline {
      border-color: rgba(100, 116, 139, 0.22);
      background: #fbfcfe;
    }

    .account-card.error,
    .account-card.expired {
      border-color: rgba(214, 69, 80, 0.28);
      background: #fff8f8;
    }

    .account-card.awaiting_auth,
    .account-card.degraded,
    .account-card.initializing {
      border-color: rgba(181, 107, 18, 0.28);
      background: #fffaf0;
    }

    .account-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .account-select {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1 1 auto;
    }

    .account-select input {
      width: 16px;
      height: 16px;
      accent-color: var(--brand);
      flex: 0 0 auto;
    }

    .account-name {
      overflow: hidden;
      min-width: 0;
      color: #253044;
      font-size: 13px;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .account-id,
    .account-summary,
    .account-time {
      overflow: hidden;
      color: var(--muted);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .account-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .account-status-row {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-wrap: wrap;
    }

    .account-action {
      margin-left: auto;
      border: 1px solid rgba(24, 160, 88, 0.28);
      border-radius: 999px;
      padding: 5px 8px;
      color: #147a53;
      background: #ffffff;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }

    .account-action:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    .queue-state {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }

    .queue-state.running {
      color: #4776f0;
    }

    .queue-state.succeeded {
      color: #138457;
    }

    .queue-state.failed,
    .queue-state.stopped {
      color: var(--danger);
    }

    .account-empty {
      border: 1px dashed #d6deea;
      border-radius: 14px;
      padding: 14px;
      color: var(--muted);
      background: #fbfcfe;
      font-size: 12px;
      text-align: center;
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
      <div class="account-tools">
        <input id="account-search" class="account-search" type="search" placeholder="搜索账号备注、账号 ID、摘要" />
        <select id="account-filter" class="account-filter" aria-label="账号状态筛选">
          <option value="all">全部账号</option>
          <option value="online">在线</option>
          <option value="attention">待处理 / 异常</option>
          <option value="awaiting_auth">待登录</option>
          <option value="expired">过期</option>
          <option value="error">异常 / 疑似封号</option>
          <option value="offline">离线</option>
        </select>
        <span id="account-filter-detail" class="account-filter-detail"></span>
      </div>
      <div class="batch-tools" aria-label="批量账号检测">
        <button id="select-visible-accounts" class="button" type="button">选择当前匹配</button>
        <button id="clear-selected-accounts" class="button" type="button">清空选择</button>
        <label>
          并发
          <select id="batch-concurrency" aria-label="批量检测并发数">
            <option value="1" selected>1</option>
            <option value="2">2</option>
          </select>
        </label>
        <button id="batch-refresh-accounts" class="button primary" type="button" disabled>检测选中账号</button>
        <button id="stop-batch-refresh" class="button" type="button" disabled>停止剩余队列</button>
        <span id="batch-detail" class="batch-detail">未选择账号</span>
      </div>
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
      var accountSearch = document.getElementById("account-search");
      var accountFilter = document.getElementById("account-filter");
      var accountFilterDetail = document.getElementById("account-filter-detail");
      var selectVisibleAccountsButton = document.getElementById("select-visible-accounts");
      var clearSelectedAccountsButton = document.getElementById("clear-selected-accounts");
      var batchConcurrency = document.getElementById("batch-concurrency");
      var batchRefreshAccountsButton = document.getElementById("batch-refresh-accounts");
      var stopBatchRefreshButton = document.getElementById("stop-batch-refresh");
      var batchDetail = document.getElementById("batch-detail");
      var deviceList = document.getElementById("device-list");
      var latestDevices = [];
      var selectedAccountKeys = new Set();
      var accountQueueState = new Map();
      var batchRunning = false;
      var stopRequested = false;
      var refreshInFlight = null;
      var refreshAgain = false;
      var renderFrame = 0;

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

      function statusLabel(status) {
        var labels = {
          initializing: "初始化",
          awaiting_auth: "待登录",
          online: "在线",
          degraded: "降级",
          offline: "离线",
          expired: "过期",
          error: "异常",
          ready: "ready",
          busy: "busy",
          starting: "starting",
          shutting_down: "shutting down"
        };
        return labels[status] || status || "unknown";
      }

      function platformLabel(platform) {
        var labels = {
          whatsapp: "WhatsApp",
          telegram: "Telegram",
          rcs: "RCS"
        };
        return labels[platform] || platform || "unknown";
      }

      function accountDisplayName(account) {
        if (account.summary) {
          return String(account.summary).split(" · ")[0] || "未命名账号";
        }
        return platformLabel(account.platform) + " 账号";
      }

      function accountSearchText(account) {
        return [
          account.accountId,
          account.platform,
          account.status,
          statusLabel(account.status),
          account.reasonCode,
          account.summary,
          accountDisplayName(account)
        ].filter(Boolean).join(" ").toLowerCase();
      }

      function accountKey(deviceId, accountId) {
        return String(deviceId || "") + "::" + String(accountId || "");
      }

      function accountEntryKey(entry) {
        return accountKey(entry.device.deviceId, entry.account.accountId);
      }

      function isAttentionAccount(account) {
        return ["awaiting_auth", "expired", "error", "degraded", "initializing"].indexOf(account.status) !== -1;
      }

      function accountMatchesFilter(account) {
        var filter = accountFilter.value;
        var query = accountSearch.value.trim().toLowerCase();
        if (filter === "attention" && !isAttentionAccount(account)) return false;
        if (filter !== "all" && filter !== "attention" && account.status !== filter) return false;
        if (query && accountSearchText(account).indexOf(query) === -1) return false;
        return true;
      }

      function flattenAccounts(devices) {
        return flattenAccountEntries(devices).map(function (entry) {
          return entry.account;
        });
      }

      function flattenAccountEntries(devices) {
        var accounts = [];
        devices.forEach(function (device) {
          (device.accounts || []).forEach(function (account) {
            accounts.push({ device: device, account: account });
          });
        });
        return accounts;
      }

      function selectableAccountEntries(devices) {
        return flattenAccountEntries(devices).filter(function (entry) {
          return onlineLike(entry.device) && accountMatchesFilter(entry.account);
        });
      }

      function selectedAccountEntries(devices) {
        return flattenAccountEntries(devices).filter(function (entry) {
          return selectedAccountKeys.has(accountEntryKey(entry)) && onlineLike(entry.device);
        });
      }

      function updateBatchTools() {
        var selected = selectedAccountEntries(latestDevices);
        var selectedTotal = selectedAccountKeys.size;
        var unavailable = Math.max(0, selectedTotal - selected.length);
        batchRefreshAccountsButton.disabled = batchRunning || selected.length === 0;
        stopBatchRefreshButton.disabled = !batchRunning;
        selectVisibleAccountsButton.disabled = batchRunning;
        clearSelectedAccountsButton.disabled = batchRunning || selectedTotal === 0;
        batchConcurrency.disabled = batchRunning;
        if (batchRunning) {
          var running = 0;
          var succeeded = 0;
          var failed = 0;
          var queued = 0;
          accountQueueState.forEach(function (state) {
            if (state.status === "running") running += 1;
            if (state.status === "succeeded") succeeded += 1;
            if (state.status === "failed") failed += 1;
            if (state.status === "queued") queued += 1;
          });
          batchDetail.textContent = "检测中：" + running + " 个执行，" + queued + " 个等待，" + succeeded + " 个成功，" + failed + " 个失败";
          return;
        }
        if (!selectedTotal) {
          batchDetail.textContent = "未选择账号";
        } else if (unavailable) {
          batchDetail.textContent = "已选 " + selectedTotal + " 个，其中 " + unavailable + " 个设备离线，当前可检测 " + selected.length + " 个";
        } else {
          batchDetail.textContent = "已选 " + selected.length + " 个账号";
        }
      }

      function renderAccountTools(devices) {
        var accounts = flattenAccounts(devices);
        var matched = accounts.filter(accountMatchesFilter);
        if (!accounts.length) {
          accountFilterDetail.textContent = "暂无账号详情";
          return;
        }
        accountFilterDetail.textContent = matched.length + " / " + accounts.length + " 个账号匹配";
        updateBatchTools();
      }

      function shortAccountId(value) {
        var text = String(value || "--");
        if (text.length <= 26) return text;
        return text.slice(0, 12) + "..." + text.slice(-8);
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

      function renderAccount(device, account) {
        var key = accountKey(device.deviceId, account.accountId);
        var queueState = accountQueueState.get(key);
        var card = document.createElement("div");
        card.className = "account-card " + statusClass(account.status) + (queueState ? " " + queueState.status : "");

        var main = document.createElement("div");
        main.className = "account-main";
        var selectLabel = document.createElement("label");
        selectLabel.className = "account-select";
        var select = document.createElement("input");
        select.type = "checkbox";
        select.checked = selectedAccountKeys.has(key);
        select.disabled = batchRunning || !onlineLike(device);
        select.title = onlineLike(device) ? "选择此账号加入批量检测" : "设备离线，不能检测账号";
        select.addEventListener("change", function () {
          if (select.checked) {
            selectedAccountKeys.add(key);
          } else {
            selectedAccountKeys.delete(key);
          }
          updateBatchTools();
        });
        var name = document.createElement("div");
        name.className = "account-name";
        name.textContent = accountDisplayName(account);
        selectLabel.append(select, name);
        var pill = document.createElement("span");
        pill.className = "status-pill " + statusClass(account.status);
        pill.textContent = statusLabel(account.status);
        main.append(selectLabel, pill);

        var id = document.createElement("div");
        id.className = "account-id";
        id.title = account.accountId || "";
        id.textContent = shortAccountId(account.accountId);

        var row = document.createElement("div");
        row.className = "account-status-row";
        var platform = document.createElement("span");
        platform.className = "status-pill";
        platform.textContent = platformLabel(account.platform);
        row.appendChild(platform);
        if (account.reasonCode) {
          var reason = document.createElement("span");
          reason.className = "status-pill error";
          reason.textContent = account.reasonCode;
          row.appendChild(reason);
        }
        var refresh = document.createElement("button");
        refresh.className = "account-action";
        refresh.type = "button";
        refresh.textContent = "检测";
        refresh.disabled = batchRunning || !onlineLike(device);
        refresh.title = onlineLike(device)
          ? "打开/检测此账号状态"
          : "设备离线，不能检测账号";
        refresh.addEventListener("click", function () {
          requestAccountStatus(device.deviceId, account.accountId, refresh);
        });
        row.appendChild(refresh);

        var summary = document.createElement("div");
        summary.className = "account-summary";
        if (account.summary && account.summary !== accountDisplayName(account)) {
          summary.textContent = account.summary;
        } else if (account.status === "error") {
          summary.textContent = "异常账号：如果客户端识别到封号/受限，会在这里显示原因";
        } else if (account.status === "awaiting_auth") {
          summary.textContent = "需要登录或扫码确认";
        } else if (account.status === "expired") {
          summary.textContent = "登录状态过期，需要重新登录";
        } else {
          summary.textContent = "无补充摘要";
        }

        var time = document.createElement("div");
        time.className = "account-time";
        time.textContent = "更新时间：" + formatTime(account.occurredAt);

        card.append(main, id, row, summary, time);
        if (queueState) {
          var state = document.createElement("div");
          state.className = "queue-state " + queueState.status;
          state.textContent = queueState.label;
          if (queueState.error) state.title = queueState.error;
          card.appendChild(state);
        }
        return card;
      }

      function renderAccountSection(device) {
        var section = document.createElement("div");
        section.className = "account-section";
        var accounts = device.accounts || [];
        var matched = accounts.filter(accountMatchesFilter);

        var head = document.createElement("div");
        head.className = "account-section-head";
        var title = document.createElement("span");
        title.textContent = "账号详情";
        var count = document.createElement("span");
        count.textContent = matched.length + " / " + accounts.length;
        head.append(title, count);
        section.appendChild(head);

        if (!accounts.length) {
          var empty = document.createElement("div");
          empty.className = "account-empty";
          empty.textContent = "客户端还没有上报账号详情。请确认桌面客户端已连接控制后端。";
          section.appendChild(empty);
          return section;
        }

        if (!matched.length) {
          var noMatch = document.createElement("div");
          noMatch.className = "account-empty";
          noMatch.textContent = "当前筛选条件下没有匹配账号。";
          section.appendChild(noMatch);
          return section;
        }

        var grid = document.createElement("div");
        grid.className = "account-grid";
        matched.forEach(function (account) {
          grid.appendChild(renderAccount(device, account));
        });
        section.appendChild(grid);
        return section;
      }

      function renderDevice(device) {
        var card = document.createElement("article");
        card.className = "device-card" + ((device.accounts || []).length ? " has-accounts" : "");

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

        card.append(top, meta, actions, renderAccountSection(device));
        return card;
      }

      function renderDevices(devices) {
        if (renderFrame) {
          window.cancelAnimationFrame(renderFrame);
          renderFrame = 0;
        }
        deviceList.replaceChildren();
        renderAccountTools(devices);
        if (!devices.length) {
          setMessage("还没有设备注册。请打开桌面客户端 → 设置 → Web 控制台连接，API 地址填 http://127.0.0.1:8000，然后点击“连接控制后端”。", false);
          return;
        }
        setMessage("", false);
        devices.forEach(function (device) {
          deviceList.appendChild(renderDevice(device));
        });
        updateBatchTools();
      }

      function scheduleRenderDevices() {
        if (renderFrame) return;
        renderFrame = window.requestAnimationFrame(function () {
          renderFrame = 0;
          renderDevices(latestDevices);
        });
      }

      async function refreshOnce() {
        refreshButton.disabled = true;
        refreshButton.textContent = "刷新中...";
        try {
          var health = await apiGet("/health");
          serviceStatus.textContent = health.data && health.data.status ? health.data.status : "ok";
          serviceDetail.textContent = "uptime " + ((health.data && health.data.uptimeSeconds) || 0) + "s";

          var result = await apiGet("/api/v1/devices");
          var devices = result.data && Array.isArray(result.data.devices) ? result.data.devices : [];
          latestDevices = devices;
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

      async function refreshAll() {
        if (refreshInFlight) {
          refreshAgain = true;
          return refreshInFlight;
        }
        refreshInFlight = (async function () {
          do {
            refreshAgain = false;
            await refreshOnce();
          } while (refreshAgain);
        })();
        try {
          await refreshInFlight;
        } finally {
          refreshInFlight = null;
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

      async function requestAccountStatus(deviceId, accountId, button) {
        var original = button.textContent;
        button.disabled = true;
        button.textContent = "Checking";
        try {
          await apiPost("/api/v1/devices/" + encodeURIComponent(deviceId) + "/commands", {
            protocolVersion: 1,
            idempotencyKey: "console-account-" + Date.now() + "-" + Math.random().toString(16).slice(2),
            commandType: "account.status.refresh",
            accountId: accountId,
            timeoutMs: 8000
          });
          await refreshAll();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), true);
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      }

      async function requestAccountStatusForQueue(entry) {
        await apiPost("/api/v1/devices/" + encodeURIComponent(entry.device.deviceId) + "/commands", {
          protocolVersion: 1,
          idempotencyKey: "console-account-" + Date.now() + "-" + Math.random().toString(16).slice(2),
          commandType: "account.status.refresh",
          accountId: entry.account.accountId,
          timeoutMs: 8000
        });
      }

      function setQueueState(entry, status, label, error) {
        accountQueueState.set(accountEntryKey(entry), {
          status: status,
          label: label,
          error: error || "",
          updatedAt: Date.now()
        });
        scheduleRenderDevices();
      }

      async function runBatchRefresh() {
        if (batchRunning) return;
        var entries = selectedAccountEntries(latestDevices);
        if (!entries.length) {
          updateBatchTools();
          return;
        }
        batchRunning = true;
        stopRequested = false;
        accountQueueState.clear();
        entries.forEach(function (entry) {
          setQueueState(entry, "queued", "等待检测");
        });
        updateBatchTools();

        var queue = entries.slice();
        var workers = Math.max(1, Math.min(2, Number(batchConcurrency.value) || 1));
        async function worker() {
          while (queue.length) {
            var entry = queue.shift();
            if (!entry) return;
            if (stopRequested) {
              setQueueState(entry, "stopped", "已停止，未检测");
              continue;
            }
            var startedAt = Date.now();
            setQueueState(entry, "running", "检测中...");
            try {
              await requestAccountStatusForQueue(entry);
              var elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
              setQueueState(entry, "succeeded", "检测成功 · " + elapsed + "s");
            } catch (error) {
              var messageText = error instanceof Error ? error.message : String(error);
              setQueueState(entry, "failed", "检测失败", messageText);
              setMessage(messageText, true);
            }
          }
        }

        try {
          await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, worker));
        } finally {
          batchRunning = false;
          stopRequested = false;
          selectedAccountKeys.clear();
          updateBatchTools();
          renderDevices(latestDevices);
          await refreshAll();
        }
      }

      saveKeyButton.addEventListener("click", function () {
        sessionStorage.setItem("mc-control-key", keyInput.value.trim());
        setKeyStatus("Key 已保存到当前浏览器会话");
        refreshAll();
      });
      refreshButton.addEventListener("click", refreshAll);
      selectVisibleAccountsButton.addEventListener("click", function () {
        selectableAccountEntries(latestDevices).forEach(function (entry) {
          selectedAccountKeys.add(accountEntryKey(entry));
        });
        renderDevices(latestDevices);
      });
      clearSelectedAccountsButton.addEventListener("click", function () {
        selectedAccountKeys.clear();
        renderDevices(latestDevices);
      });
      batchRefreshAccountsButton.addEventListener("click", function () {
        runBatchRefresh();
      });
      stopBatchRefreshButton.addEventListener("click", function () {
        stopRequested = true;
        updateBatchTools();
      });
      accountSearch.addEventListener("input", function () {
        renderDevices(latestDevices);
      });
      accountFilter.addEventListener("change", function () {
        renderDevices(latestDevices);
      });
      keyInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          sessionStorage.setItem("mc-control-key", keyInput.value.trim());
          refreshAll();
        }
      });

      refreshAll();
      window.setInterval(function () {
        if (!batchRunning) refreshAll();
      }, 5000);
    })();
  </script>
</body>
</html>`;
}
