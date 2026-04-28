/** Telegram Mini App: login + Home / Admins / Users */
export function getMiniAppHtml() {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <title>E-Savdo</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--tg-theme-bg-color, #0f172a);
      color: var(--tg-theme-text-color, #f8fafc);
      min-height: 100vh;
      padding-bottom: 72px;
    }
    .err {
      background: #7f1d1d; color: #fecaca; padding: 10px 12px; border-radius: 10px;
      margin: 12px; font-size: 0.88rem;
    }
    /* Login */
    #screen-login { padding: 20px 16px 24px; max-width: 400px; margin: 0 auto; }
    #screen-login h1 { font-size: 1.25rem; margin: 0 0 8px; }
    #screen-login .lead { font-size: 0.88rem; opacity: 0.8; margin: 0 0 20px; line-height: 1.45; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 6px; opacity: 0.9; }
    .field input {
      width: 100%; padding: 14px; border-radius: 10px; font-size: 16px;
      border: 1px solid var(--tg-theme-hint-color, #475569);
      background: var(--tg-theme-secondary-bg-color, #1e293b);
      color: inherit;
    }
    .btn-go {
      width: 100%; padding: 14px; margin-top: 8px; border: none; border-radius: 10px;
      font-size: 1rem; font-weight: 700; cursor: pointer;
      background: #2563eb; color: #fff;
    }
    .btn-go:disabled { opacity: 0.6; }
    /* App shell */
    #screen-app { display: none; min-height: 100vh; padding-bottom: 8px; }
    #screen-app.visible { display: block; }
    .panel { display: none; padding: 12px 14px 8px; }
    .panel.active { display: block; }
    .panel h2 { font-size: 1.05rem; margin: 0 0 12px; }
    .hint { font-size: 0.78rem; opacity: 0.75; line-height: 1.4; margin: 0 0 12px; }
    /* Stats */
    .stats { display: grid; grid-template-columns: 1fr; gap: 10px; }
    @media (min-width: 360px) { .stats { grid-template-columns: repeat(3, 1fr); } }
    .stat {
      background: var(--tg-theme-secondary-bg-color, #1e293b);
      border-radius: 12px; padding: 14px; border: 1px solid rgba(148,163,184,0.2);
      text-align: center;
    }
    .stat .num { font-size: 1.5rem; font-weight: 800; color: var(--tg-theme-link-color, #60a5fa); }
    .stat .lbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; margin-top: 6px; line-height: 1.3; }
    .toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
    .btn-text {
      background: transparent; border: none; color: var(--tg-theme-link-color, #93c5fd);
      font-size: 0.88rem; cursor: pointer; padding: 8px;
    }
    /* Lists */
    .search {
      width: 100%; padding: 12px 14px; border-radius: 10px; margin-bottom: 10px;
      border: 1px solid var(--tg-theme-hint-color, #475569);
      background: var(--tg-theme-secondary-bg-color, #1e293b); color: inherit; font-size: 16px;
    }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .card {
      padding: 12px 14px; border-radius: 12px;
      background: var(--tg-theme-secondary-bg-color, #1e293b);
      border: 1px solid rgba(148,163,184,0.2);
      text-align: left; cursor: pointer; width: 100%; color: inherit; font: inherit;
    }
    .card .uname { font-size: 0.95rem; font-weight: 700; line-height: 1.25; margin: 0 0 6px; }
    .card .submeta { font-size: 0.8rem; opacity: 0.88; line-height: 1.35; }
    .card .submeta .plan { color: var(--tg-theme-link-color, #60a5fa); font-weight: 600; }
    .card .pill { display: inline-block; font-size: 0.68rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; margin-top: 6px; }
    .card .pill.ok { background: rgba(22,163,74,0.25); color: #4ade80; }
    .card .pill.bad { background: rgba(220,38,38,0.25); color: #f87171; }
    .empty { text-align: center; padding: 20px; opacity: 0.7; font-size: 0.9rem; }
    .admin-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      background: var(--tg-theme-secondary-bg-color, #1e293b);
      border-radius: 10px; border: 1px solid rgba(148,163,184,0.15);
    }
    .admin-row code { flex: 1; font-size: 0.82rem; word-break: break-all; }
    .admin-row .rm {
      flex-shrink: 0; padding: 8px 10px; border-radius: 8px; border: none;
      background: #991b1b; color: #fff; font-size: 0.8rem; cursor: pointer;
    }
    .admin-row .rm:disabled { opacity: 0.35; cursor: not-allowed; }
    .add-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .add-row input {
      flex: 1; min-width: 100px; padding: 12px; border-radius: 10px;
      border: 1px solid var(--tg-theme-hint-color, #475569);
      background: var(--tg-theme-bg-color, #0f172a); color: inherit; font-size: 16px;
    }
    .btn-sm { padding: 12px 14px; border-radius: 10px; border: none; font-weight: 600; cursor: pointer; background: #2563eb; color: #fff; }
    /* Tab bar */
    .tabbar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
      display: flex; justify-content: space-around; align-items: center;
      padding: 8px 4px calc(8px + env(safe-area-inset-bottom));
      background: var(--tg-theme-secondary-bg-color, #1e293b);
      border-top: 1px solid rgba(148,163,184,0.25);
    }
    .tab {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 6px 4px; border: none; background: transparent; color: inherit;
      font-size: 0.68rem; cursor: pointer; opacity: 0.55;
    }
    .tab svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .tab.active { opacity: 1; color: var(--tg-theme-link-color, #60a5fa); font-weight: 600; }
    /* Modal */
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100;
      display: flex; align-items: flex-end; justify-content: center;
    }
    .sheet {
      width: 100%; max-width: 480px; background: var(--tg-theme-bg-color, #0f172a);
      border-radius: 16px 16px 0 0; padding: 18px; border: 1px solid rgba(148,163,184,0.25);
      max-height: 88vh; overflow: auto;
    }
    .sheet h3 { margin: 0 0 10px; font-size: 1rem; }
    .sheet pre { white-space: pre-wrap; word-break: break-all; font-size: 0.78rem;
      background: var(--tg-theme-secondary-bg-color, #1e293b); padding: 10px; border-radius: 8px; margin: 0 0 14px; }
    .btn-row { display: flex; flex-direction: column; gap: 8px; }
    .btn-danger { padding: 14px; border-radius: 10px; border: none; font-weight: 600; background: #dc2626; color: #fff; cursor: pointer; }
    .btn-secondary { padding: 14px; border-radius: 10px; border: none; font-weight: 600;
      background: var(--tg-theme-secondary-bg-color, #334155); color: inherit; cursor: pointer; }
    .usr-card-wrap {
      display: flex; gap: 8px; align-items: stretch;
    }
    .usr-card-wrap .card-main-part {
      flex: 1; text-align: left; cursor: pointer; width: auto; border: none; font: inherit; color: inherit;
      padding: 12px 14px; border-radius: 12px;
      background: var(--tg-theme-secondary-bg-color, #1e293b);
      border: 1px solid rgba(148,163,184,0.2);
    }
    .usr-card-side {
      display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .support-badge {
      min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
      background: #dc2626; color: #fff; font-size: 0.7rem; font-weight: 800;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .support-badge.soft-hide { visibility: hidden; }
    .btn-chat-mini {
      padding: 10px 12px; border-radius: 10px; border: none;
      font-weight: 700; font-size: 0.82rem; cursor: pointer; background: #2563eb; color: #fff;
    }
    .support-chat-wrap {
      display: flex; flex-direction: column;
      height: min(68vh, 520px); max-height: 78vh;
    }
    .support-msg-scroll {
      flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 8px 2px 12px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .support-msg-row { display: flex; }
    .support-msg-row.row-user { justify-content: flex-end; }
    .support-msg-row.row-staff { justify-content: flex-start; }
    .support-bubble {
      max-width: 88%; padding: 10px 12px; border-radius: 14px;
      font-size: 0.9rem; line-height: 1.38; word-break: break-word; white-space: pre-wrap;
    }
    .support-bubble.b-user {
      background: #2563eb; color: #fff; border-radius: 14px 14px 4px 14px;
    }
    .support-bubble.b-staff {
      background: var(--tg-theme-secondary-bg-color, #334155); color: inherit;
      border-radius: 14px 14px 14px 4px;
    }
    .support-meta { font-size: 0.65rem; opacity: 0.7; margin-top: 4px; }
    .support-composer-row { display: flex; gap: 8px; margin-top: 10px; flex-shrink: 0; align-items: flex-end; }
    .support-composer-row textarea {
      flex: 1; min-height: 48px; max-height: 140px;
      resize: vertical; padding: 10px 12px; border-radius: 10px; font-size: 16px;
      border: 1px solid var(--tg-theme-hint-color, #475569);
      background: var(--tg-theme-bg-color, #0f172a); color: inherit; font-family: inherit;
    }
    .support-send-btn {
      flex-shrink: 0; padding: 12px 14px; border-radius: 10px; border: none;
      font-weight: 700; font-size: 0.88rem; cursor: pointer; background: #16a34a; color: #fff;
    }
  </style>
</head>
<body>
  <div id="msg-err" class="err" style="display:none"></div>

  <div id="screen-login">
    <h1>E-Savdo</h1>
    <p class="lead">Davom etish uchun kiriting. Faqat Telegram admin akkaunti va to'g'ri login/parol.</p>
    <div class="field">
      <label for="inp-login">Login</label>
      <input id="inp-login" type="text" autocomplete="username" />
    </div>
    <div class="field">
      <label for="inp-pass">Parol</label>
      <input id="inp-pass" type="password" autocomplete="current-password" />
    </div>
    <button type="button" class="btn-go" id="btn-login">Kirish</button>
  </div>

  <div id="screen-app">
    <div class="toolbar">
      <button type="button" class="btn-text" id="btn-logout">Chiqish</button>
    </div>

    <div id="panel-home" class="panel active">
      <h2>Bosh sahifa</h2>
      <p class="hint">Litsenziya yozuvlari bo'yicha qisqa statistika.</p>
      <div class="stats">
        <div class="stat"><div class="num" id="st-total">—</div><div class="lbl">Jami foydalanuvchilar</div></div>
        <div class="stat"><div class="num" id="st-active">—</div><div class="lbl">Aktiv obunalar</div></div>
        <div class="stat"><div class="num" id="st-expired">—</div><div class="lbl">Tugagan / noaktiv</div></div>
      </div>
    </div>

    <div id="panel-admins" class="panel">
      <h2>Adminlar</h2>
      <p class="hint">Telegram user ID qo'shing (boshqa foydalanuvchi botga yozganda ID chiqadi).</p>
      <div id="admins-list" class="list"></div>
      <div class="add-row">
        <input type="text" id="new-admin-id" inputmode="numeric" placeholder="Telegram ID" autocomplete="off" />
        <button type="button" class="btn-sm" id="btn-add-admin">Qo'shish</button>
      </div>
    </div>

    <div id="panel-users" class="panel">
      <h2>Foydalanuvchilar</h2>
      <p class="hint">Ism va obuna. Batafsil (Device ID) uchun chap qismga bosing — o‘ngda yangi xabar soni va Chat.</p>
      <input type="search" id="q-users" class="search" placeholder="Ism, kontakt, obuna bo'yicha qidirish..." autocomplete="off" />
      <div id="users-list" class="list"></div>
      <div id="users-empty" class="empty" style="display:none">Litsenziyalar yo'q</div>
    </div>

    <nav class="tabbar" id="tabbar">
      <button type="button" class="tab active" data-tab="home">
        <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Home
      </button>
      <button type="button" class="tab" data-tab="admins">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Admins
      </button>
      <button type="button" class="tab" data-tab="users">
        <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="3" ry="3"/><path d="M4 20v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1"/><circle cx="18" cy="8" r="2.5"/><circle cx="6" cy="8" r="2.5"/></svg>
        Users
      </button>
    </nav>
  </div>
  <div id="modal" style="display:none"></div>

  <script>
(function () {
  var API = "";
  var TOKEN_KEY = "esavdo_mini_token";
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  function showErr(msg) {
    var el = document.getElementById("msg-err");
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(t) {
    try { sessionStorage.setItem(TOKEN_KEY, t || ""); } catch (e) { /* */ }
  }
  function clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ }
  }

  function authBearer() {
    var t = getToken();
    if (!t) throw new Error("Sessiya yo'q");
    return { "Authorization": "Bearer " + t, "Content-Type": "application/json" };
  }

  var items = [];
  var admins = [];
  var stats = { total: 0, active: 0, expired: 0 };
  var supportPoll = null;

  function escapeHtml(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function formatDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 10);
      return d.toLocaleString("uz-UZ", { dateStyle: "medium", timeStyle: "short" });
    } catch (e) { return iso; }
  }

  function userListTitle(x) {
    var n = (x.fullName && String(x.fullName).trim()) || "";
    return n || "Ism kiritilmagan";
  }

  function licenseActiveNow(x) {
    if (String(x.status || "") !== "active") return false;
    var t = Date.parse(x.expiresAt || "");
    return !isNaN(t) && t > Date.now();
  }

  function showApp(on) {
    document.getElementById("screen-login").style.display = on ? "none" : "block";
    var app = document.getElementById("screen-app");
    if (on) app.classList.add("visible");
    else app.classList.remove("visible");
    app.style.display = on ? "block" : "none";
  }

  function showTab(name) {
    document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    var panel = document.getElementById("panel-" + name);
    if (panel) panel.classList.add("active");
    var tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.classList.add("active");
    if (name === "home") refreshStats();
  }

  function refreshStats() {
    fetch(API + "/admin/stats", { headers: authBearer() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return;
        stats = { total: j.total, active: j.active, expired: j.expired };
        document.getElementById("st-total").textContent = stats.total;
        document.getElementById("st-active").textContent = stats.active;
        document.getElementById("st-expired").textContent = stats.expired;
      })
      .catch(function () { /* */ });
  }

  function applyBootstrap(j) {
    items = j.licenses || [];
    admins = j.admins || [];
    if (j.stats) {
      stats = j.stats;
      document.getElementById("st-total").textContent = stats.total;
      document.getElementById("st-active").textContent = stats.active;
      document.getElementById("st-expired").textContent = stats.expired;
    }
    renderAdmins();
    renderUsers(document.getElementById("q-users").value);
  }

  function renderAdmins() {
    var wrap = document.getElementById("admins-list");
    wrap.innerHTML = "";
    if (!admins.length) {
      wrap.innerHTML = "<div class='empty'>Adminlar yo'q</div>";
      return;
    }
    admins.forEach(function (id) {
      var row = document.createElement("div");
      row.className = "admin-row";
      var lastOne = admins.length <= 1;
      row.innerHTML = "<code>" + escapeHtml(id) + "</code>" +
        "<button type='button' class='rm' " + (lastOne ? "disabled" : "") + ">O'chirish</button>";
      if (!lastOne) {
        row.querySelector(".rm").onclick = function () {
          function go() {
            fetch(API + "/admin/admins/remove", { method: "POST", headers: authBearer(), body: JSON.stringify({ telegramUserId: id }) })
              .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
              .then(function (x) {
                if (!x.ok || !x.j.ok) { showErr(x.j.error || "Xato"); return; }
                admins = x.j.admins || [];
                renderAdmins();
                if (tg && tg.showAlert) tg.showAlert("Admin olib tashlandi.");
              })
              .catch(function (e) { showErr(e.message); });
          }
          if (tg && tg.showConfirm) tg.showConfirm("Olib tashlaysizmi?", function (ok) { if (ok) go(); });
          else if (confirm("Olib tashlaysizmi?")) go();
        };
      }
      wrap.appendChild(row);
    });
  }

  function updateUserSupportUnread(mid, unread) {
    items = items.map(function (i) {
      if (i.machineId !== mid) return i;
      var next = Object.assign({}, i);
      next.supportUnread = unread;
      return next;
    });
    renderUsers(document.getElementById("q-users").value);
  }

  function renderUsers(filter) {
    var q = (filter || "").trim().toLowerCase();
    var list = document.getElementById("users-list");
    var empty = document.getElementById("users-empty");
    list.innerHTML = "";
    var rows = items.filter(function (x) {
      if (!q) return true;
      var hay = (
        (x.fullName || "") + " " + (x.contact || "") + " " + x.machineId + " " +
        (x.planLabel || x.plan || "") + " " + (x.expiresAt || "")
      ).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    if (!rows.length) {
      empty.style.display = "block";
      empty.textContent = items.length ? "Topilmadi" : "Litsenziyalar yo'q";
      return;
    }
    empty.style.display = "none";
    rows.forEach(function (x) {
      var act = licenseActiveNow(x);
      var wrap = document.createElement("div");
      wrap.className = "usr-card-wrap";
      var su = Number(x.supportUnread || 0) || 0;
      var mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "card-main-part";
      var pill = "<span class='pill " + (act ? "ok" : "bad") + "'>" + (act ? "Aktiv" : "Tugagan") + "</span>";
      mainBtn.innerHTML =
        "<div class='uname'>" + escapeHtml(userListTitle(x)) + "</div>" +
        "<div class='submeta'><span class='plan'>" + escapeHtml(x.planLabel || x.plan || "—") + "</span> · " +
        formatDate(x.expiresAt) + "</div>" + pill;
      mainBtn.onclick = function () { openUserModal(x); };
      var side = document.createElement("div");
      side.className = "usr-card-side";
      var bd = document.createElement("span");
      bd.className = "support-badge" + (su > 0 ? "" : " soft-hide");
      bd.textContent = su > 0 ? String(su) : "0";
      var chatBtn = document.createElement("button");
      chatBtn.type = "button";
      chatBtn.className = "btn-chat-mini";
      chatBtn.textContent = "Chat";
      chatBtn.onclick = function (ev) {
        ev.stopPropagation();
        openSupportChat(x, bd);
      };
      side.appendChild(bd);
      side.appendChild(chatBtn);
      wrap.appendChild(mainBtn);
      wrap.appendChild(side);
      list.appendChild(wrap);
    });
  }

  function closeSupportChatModal() {
    closeModal();
  }

  function formatMsgTime(ts) {
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" });
    } catch (e) {
      return "";
    }
  }

  function openSupportChat(x, badgeEl) {
    if (!x || !x.machineId) return;
    closeSupportChatModal();
    var machineId = x.machineId;
    showErr("");
    var m = document.getElementById("modal");

    function renderIntoScroll(box, msgs) {
      box.innerHTML = "";
      (msgs || []).forEach(function (msg) {
        var row = document.createElement("div");
        row.className = "support-msg-row row-" + (msg.role === "staff" ? "staff" : "user");
        var b = document.createElement("div");
        b.className = "support-bubble b-" + (msg.role === "staff" ? "staff" : "user");
        b.innerHTML =
          escapeHtml(msg.body || "") +
          '<div class="support-meta">' + escapeHtml(formatMsgTime(msg.ts)) + "</div>";
        row.appendChild(b);
        box.appendChild(row);
      });
      box.scrollTop = box.scrollHeight;
    }

    function loadMsgs(silent) {
      fetch(
        API + "/admin/support/messages?machineId=" + encodeURIComponent(machineId),
        { headers: authBearer() }
      )
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (xr) {
          if (!xr.ok || !xr.j.ok) {
            if (!silent) showErr(xr.j.error || "Xabarlar yuklanmadi");
            return;
          }
          var box = document.getElementById("support-msg-inner");
          if (box) renderIntoScroll(box, xr.j.messages || []);
          if (!silent && badgeEl) updateUserSupportUnread(machineId, 0);
        })
        .catch(function (e) { if (!silent) showErr(e.message); });
    }

    m.style.display = "block";
    m.innerHTML =
      "<div class='backdrop' id='bd'>" +
      "<div class='sheet support-chat-sheet' onclick='event.stopPropagation()'>" +
      "<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px'>" +
      "<h3 style='margin:0'>" + escapeHtml(userListTitle(x)) + "</h3>" +
      "</div>" +
      "<p style='font-size:0.78rem;opacity:0.8;margin:0 0 10px 0;word-break:break-all'>ID: " +
      escapeHtml(machineId) + "</p>" +
      "<div class='support-chat-wrap'>" +
      "<div class='support-msg-scroll' id='support-msg-inner'></div>" +
      "<div class='support-composer-row'>" +
      "<textarea id='support-input' rows='2' placeholder='Javob yozing…'></textarea>" +
      "<button type='button' class='support-send-btn' id='support-send'>Yuborish</button>" +
      "</div></div>" +
      "<div class='btn-row' style='margin-top:14px'><button type='button' class='btn-secondary' id='support-close'>Yopish</button></div>" +
      "</div></div>";

    document.getElementById("bd").onclick = closeSupportChatModal;
    document.getElementById("support-close").onclick = closeSupportChatModal;
    document.getElementById("support-send").onclick = function () {
      var ta = document.getElementById("support-input");
      var txt = ta && ta.value ? ta.value.trim() : "";
      if (!txt) return;
      fetch(API + "/admin/support/reply", {
        method: "POST",
        headers: authBearer(),
        body: JSON.stringify({ machineId: machineId, text: txt }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (xr) {
          if (!xr.ok || !xr.j.ok) {
            showErr(xr.j.error || "Yuborilmadi");
            return;
          }
          if (ta) ta.value = "";
          loadMsgs(true);
          if (tg && tg.showAlert) tg.showAlert("Yuborildi.");
        })
        .catch(function (e) { showErr(e.message); });
    };

    loadMsgs(false);
    if (supportPoll) clearInterval(supportPoll);
    supportPoll = setInterval(function () { loadMsgs(true); }, 4000);
  }

  function closeModal() {
    if (supportPoll) {
      clearInterval(supportPoll);
      supportPoll = null;
    }
    document.getElementById("modal").style.display = "none";
    document.getElementById("modal").innerHTML = "";
  }

  function openUserModal(x) {
    var m = document.getElementById("modal");
    m.style.display = "block";
    var act = licenseActiveNow(x);
    var lines =
      "Ism: " + (x.fullName && String(x.fullName).trim() ? escapeHtml(x.fullName) : "—") + "\\n" +
      "Kontakt: " + escapeHtml((x.contact && String(x.contact).trim()) || "—") + "\\n" +
      "Obuna: " + escapeHtml(x.planLabel || x.plan || "—") + "\\n" +
      "Muddati: " + escapeHtml(x.expiresAt || "—") + " (" + formatDate(x.expiresAt) + ")\\n" +
      "Holat: " + (act ? "Aktiv" : "Tugagan / noaktiv") + " (status: " + escapeHtml(String(x.status || "—")) + ")\\n" +
      "Device ID: " + escapeHtml(x.machineId || "—") + "\\n" +
      (x.requestId ? "So'rov ID: " + escapeHtml(x.requestId) + "\\n" : "") +
      (x.approvedAt ? "Tasdiqlangan: " + escapeHtml(x.approvedAt) + " (" + formatDate(x.approvedAt) + ")" : "");
    m.innerHTML =
      "<div class='backdrop' id='bd'>" +
        "<div class='sheet' onclick='event.stopPropagation()'>" +
          "<h3>Foydalanuvchi</h3>" +
          "<pre style='white-space:pre-wrap;word-break:break-word'>" + lines + "</pre>" +
          "<div class='btn-row'>" +
            "<button type='button' class='btn-danger' id='revoke'>Obunani bekor qilish</button>" +
            "<button type='button' class='btn-secondary' id='closem'>Yopish</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    document.getElementById("bd").onclick = closeModal;
    document.getElementById("closem").onclick = closeModal;
    document.getElementById("revoke").onclick = function () {
      function go() {
        fetch(API + "/admin/revoke", { method: "POST", headers: authBearer(), body: JSON.stringify({ machineId: x.machineId }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (r) {
            if (!r.ok || !r.j.ok) { showErr(r.j.error || "Xato"); return; }
            items = items.filter(function (i) { return i.machineId !== x.machineId; });
            closeModal();
            renderUsers(document.getElementById("q-users").value);
            refreshStats();
            if (tg && tg.showAlert) tg.showAlert("Bekor qilindi.");
          })
          .catch(function (e) { showErr(e.message); });
      }
      if (tg && tg.showConfirm) tg.showConfirm("Bekor qilasizmi?", function (ok) { if (ok) go(); });
      else if (confirm("Bekor qilasizmi?")) go();
    };
  }

  function loadBootstrap() {
    showErr("");
    fetch(API + "/admin/bootstrap", { headers: authBearer() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (x) {
        if (x.status === 401 || x.j.error === "unauthorized") {
          clearToken();
          showApp(false);
          showErr("Qayta kiring.");
          return;
        }
        if (!x.j.ok) {
          showErr(x.j.error === "forbidden" ? "Admin emassiz." : (x.j.error || "Xato"));
          clearToken();
          showApp(false);
          return;
        }
        applyBootstrap(x.j);
        showApp(true);
        showTab("home");
      })
      .catch(function (e) { showErr(e.message); clearToken(); showApp(false); });
  }

  document.getElementById("btn-login").onclick = function () {
    showErr("");
    var login = document.getElementById("inp-login").value.trim();
    var password = document.getElementById("inp-pass").value;
    if (!tg || !tg.initData) {
      showErr("Telegram ichida oching.");
      return;
    }
    var btn = document.getElementById("btn-login");
    btn.disabled = true;
    fetch(API + "/admin/miniapp-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData, login: login, password: password })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        btn.disabled = false;
        if (!x.j.ok) {
          if (x.j.error === "bad_credentials") showErr("Login yoki parol noto'g'ri.");
          else if (x.j.error === "forbidden") showErr("Siz Telegram admin ro'yxatida emassiz.");
          else if (x.j.error === "miniapp_login_not_configured") showErr("Serverda login sozlanmagan (MINIAPP_LOGIN / MINIAPP_PASSWORD).");
          else showErr(x.j.error || "Kirish xatosi");
          return;
        }
        setToken(x.j.token);
        document.getElementById("inp-pass").value = "";
        loadBootstrap();
      })
      .catch(function (e) { btn.disabled = false; showErr(e.message); });
  };

  document.getElementById("btn-logout").onclick = function () {
    var h = {};
    try { h = authBearer(); } catch (e) { h = {}; }
    fetch(API + "/admin/logout", { method: "POST", headers: h }).finally(function () {
      clearToken();
      showApp(false);
      showErr("");
    });
  };

  document.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () { showTab(this.getAttribute("data-tab")); };
  });

  document.getElementById("btn-add-admin").onclick = function () {
    var v = document.getElementById("new-admin-id").value.trim();
    if (!/^-?\\d{1,20}$/.test(v)) { showErr("ID raqam bo'lishi kerak."); return; }
    showErr("");
    fetch(API + "/admin/admins/add", { method: "POST", headers: authBearer(), body: JSON.stringify({ telegramUserId: v }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j.ok) { showErr(x.j.error || "Xato"); return; }
        admins = x.j.admins || [];
        document.getElementById("new-admin-id").value = "";
        renderAdmins();
        if (tg && tg.showAlert) tg.showAlert("Qo'shildi.");
      })
      .catch(function (e) { showErr(e.message); });
  };

  document.getElementById("q-users").addEventListener("input", function () { renderUsers(this.value); });

  if (getToken()) loadBootstrap();
  else showApp(false);
})();
  </script>
</body>
</html>`;
}
