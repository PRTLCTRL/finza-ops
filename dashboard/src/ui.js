// Single-page dashboard UI — dark, minimal, mobile-first (Arsal checks from phone).
// Rendered by src/worker.js. No framework, no build step.
// The worker inlines the crash timeline via window.__BOOT (server-side KV read),
// so the Crashes tab + banner paint on first paint with zero extra round-trips.
export const HTML = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="referrer" content="no-referrer">
<title>finza ops dashboard</title>
<style>
:root{
  --bg:#0d1117;--panel:#161b22;--panel2:#1c2129;--line:#2a313c;--text:#e6edf3;--muted:#8b949e;
  --ok:#3fb950;--warn:#d29922;--bad:#f85149;--acc:#58a6ff;--spark:#2ea043;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:0 0 60px}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:14px}
header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between;padding:12px 14px;background:var(--panel);border-bottom:1px solid var(--line)}
header h1{font-size:17px;font-weight:650}
header .sub{color:var(--muted);font-size:12px}
.pill{display:inline-block;padding:2px 9px;border:1px solid var(--line);border-radius:999px;font-size:11px;color:var(--muted);background:var(--panel2)}
.pill:hover{color:var(--text)}
.tabs{display:flex;gap:2px;padding:8px 14px 0;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;overflow-x:auto}
.tab{padding:7px 12px;border-radius:8px 8px 0 0;font-size:13px;color:var(--muted);cursor:pointer;background:transparent;border:none;font-family:inherit;flex:none}
.tab.active{color:var(--text);background:var(--bg);border:1px solid var(--line);border-bottom-color:var(--bg)}
main{padding-top:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}
.card h2{font-size:13px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:8px}
.muted{color:var(--muted)}
.small{font-size:12px}
.banner{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;border:1px solid #67272c;background:#211318;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px}
.board-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:4px 0 10px}
.board-h h3{font-size:15px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.col{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px;min-height:40px}
.col-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.col-h .name{font-size:12px;font-weight:600}
.count{font-size:11px;color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:0 8px}
.tkt{background:var(--bg);border:1px solid #232a34;border-radius:6px;padding:6px 8px;margin-bottom:6px}
.tkt:last-child{margin-bottom:0}
.tkt .tt{font-size:13px;font-weight:500;display:block;color:var(--text)}
.tkt .meta{font-size:11px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
.tkt a{color:inherit}
.lbl{display:inline-block;padding:0 6px;border:1px solid var(--line);border-radius:999px;font-size:10px;color:var(--muted)}
.lbl.wayfinder\\:map{color:#a371f7;border-color:#a371f7}
.lbl.wayfinder\\:research{color:#dbb7ff;border-color:#8957e5}
.lbl.wayfinder\\:task{color:#58a6ff;border-color:#58a6ff}
.lbl.wayfinder\\:prototype{color:#39c5cf;border-color:#39c5cf}
.lbl.wayfinder\\:grilling{color:#f85149;border-color:#f85149}
.lbl.ready-for-agent{color:#3fb950;border-color:#3fb950}
.lbl.ready-for-human{color:#d29922;border-color:#d29922}
.lbl.needs-info{color:#d29922;border-color:#d29922}
.lbl.needs-triage{color:#d29922;border-color:#d29922}
.lbl.blocked{color:#f85149;border-color:#f85149}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}.dot.idle{background:#6e7681}
.svc{display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #21262d;font-size:13px}
.svc:last-child{border-bottom:none}
.svc .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.esc{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;text-align:left;padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:5px 8px;border-bottom:1px solid #21262d;vertical-align:top}
tr:last-child td{border-bottom:none}
.feed{list-style:none;max-height:420px;overflow-y:auto}
.feed li{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #21262d;font-size:13px;align-items:baseline;flex-wrap:wrap}
.feed li:last-child{border-bottom:none}
.feed .ts{color:var(--muted);font-size:11px;flex:none;min-width:52px}
.feed .agent{flex:none;font-weight:600;font-size:12px}
.feed .note{min-width:0;overflow-wrap:anywhere;flex:1}
.st-ok{color:var(--ok)}.st-error{color:var(--bad)}.st-started,.st-working{color:var(--acc)}.st-info{color:var(--muted)}
.k-crash{color:var(--bad)}.k-gateway{color:var(--warn)}.k-watchdog{color:var(--acc)}.k-sidecar{color:var(--bad)}
.spark{display:block;width:100%;height:44px}
.kv-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.kv-strip .stat{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px}
.stat .v{font-size:17px;font-weight:650}
.stat .k{font-size:11px;color:var(--muted)}
.err{color:var(--bad);font-size:12px}
#login{max-width:380px;margin:12vh auto;padding:18px}
#login input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px}
#login button{width:100%;padding:10px;margin-top:8px;border-radius:8px;border:1px solid var(--line);background:var(--acc);color:#0d1117;font-weight:600;font-size:15px}
.note{font-size:12px;color:var(--muted);margin-top:10px}
</style>
</head>
<body>
<div id="login" class="card" style="display:none">
  <h2 style="color:var(--text);text-transform:none;font-size:16px">finza ops dashboard</h2>
  <input id="tok" type="password" placeholder="dashboard token" autocomplete="current-password">
  <button onclick="login()">open</button>
  <p class="note">Token is stored in this browser only (localStorage) and sent as Basic auth.</p>
  <p class="note">Phone bookmark alternative: <code>?token=…</code> in the URL also works.</p>
  <p class="note" id="login-err" style="color:var(--bad)"></p>
</div>
<div id="app" style="display:none">
<header>
  <h1>finza ops</h1>
  <div>
    <span class="pill" id="p-updated">issues: —</span>
    <span class="pill" id="p-src">—</span>
    <span class="pill" style="cursor:pointer" id="p-refresh">refresh</span>
  </div>
  <div class="sub">backlog wayfinding + agent progress + machine health</div>
</header>
<div class="tabs">
  <button class="tab active" data-tab="wayfinding">Wayfinding</button>
  <button class="tab" data-tab="boards">Boards</button>
  <button class="tab" data-tab="feed">Agent feed</button>
  <button class="tab" data-tab="machine">Machine</button>
  <button class="tab" data-tab="crashes">Crashes</button>
  <button class="tab" data-tab="config">Config</button>
</div>
<main class="wrap">
  <div id="banner" class="banner" style="display:none"></div>
  <div id="tab-wayfinding">
    <p class="muted small" style="margin-bottom:10px">One row per feature (wayfinder map). Progress = closed children / total. "Next" = the frontier — first open, unblocked child. Blockers marked ⛔ usually need you.</p>
    <div id="featlist"></div>
    <div class="muted small" id="feat-empty" style="display:none">No wayfinder:map features found on either board yet.</div>
  </div>
  <div id="tab-boards" style="display:none">
    <div class="card">
      <h2>Board: finza-ops</h2>
      <div class="grid" id="b-finza-ops"></div>
      <div class="muted small" id="e-finza-ops" style="display:none"></div>
    </div>
    <div class="card">
      <h2>Board: pocket-lota-ad</h2>
      <div class="grid" id="b-pocket-lota-ad"></div>
      <div class="muted small" id="e-pocket-lota-ad" style="display:none"></div>
    </div>
  </div>
  <div id="tab-feed" style="display:none">
    <div class="card">
      <h2>Agent activity</h2>
      <ul class="feed" id="feed"></ul>
    </div>
  </div>
  <div id="tab-machine" style="display:none">
    <div class="card">
      <h2>VENGEANCE (i9-13900K, 64 GB)</h2>
      <div class="kv-strip" id="stats"></div>
      <div id="stopinfo" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <h2>24 h history</h2>
      <div id="sparks"></div>
    </div>
  </div>
  <div id="tab-crashes" style="display:none">
    <div class="card">
      <h2>Crash &amp; restart timeline</h2>
      <ul class="feed" id="crashlist"></ul>
      <p class="muted small" style="margin-top:8px">Sources: WER events (Application log, catches RADAR_PRE_LEAK_64-style leaks), gateway.log shutdown context (signal + parent_pid), watchdog.log pid changes, sidecar port 8789 death. Deduped on (kind, ts, title).</p>
    </div>
  </div>
  <div id="tab-config" style="display:none">
    <p class="muted small">Read-only connectivity status. No secrets, ever — only connected ✓ / missing ✗.</p>
    <div class="card">
      <h2>External services</h2>
      <div id="services"></div>
      <p class="muted small" style="margin-top:6px">Photon + xAI are inferred live: the dashboard being open proves the gateway path works; other services show <b>last-verified</b> once agents write progress lines.</p>
    </div>
    <div class="card">
      <h2>Pipeline</h2>
      <div class="esc"><table id="pipeline"></table></div>
      <p class="muted small" style="margin-top:6px">Raw pipeline rows — last progress line per agent/ticket.</p>
    </div>
  </div>
</main>
</div>
<script>
"use strict";
window.__BOOT=null; // replaced server-side with inline {crashes:[...]}
var TOKEN = localStorage.getItem("dash_token") || "";
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ var m={"&":"&amp;","<":"&lt;",">":"&gt;"}; var cc=c.charCodeAt(0); if(cc===34){return "&quot;"} if(cc===39){return "&#39;"} return m[c]; }); }
function authHeaders(){ return { "Authorization": "Basic " + btoa(TOKEN + ":") }; }
function api(path, opts){ opts = opts || {}; opts.headers = Object.assign({}, opts.headers || {}, authHeaders()); return fetch(path, opts); }

function login(){
  var t = $("tok").value.trim();
  if (!t) return;
  TOKEN = t;
  api("/issues").then(function(r){
    if (r.ok){ localStorage.setItem("dash_token", t); boot(); }
    else { $("login-err").textContent = "token rejected (" + r.status + ")"; }
  }).catch(function(e){ $("login-err").textContent = "network error"; });
}

function showLogin(){ $("login").style.display = "block"; }

function ago(iso){
  if (!iso) return "never";
  var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return Math.round(s) + "s ago";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 172800) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

var COL_ORDER = ["ready", "in-progress", "done", "blocked", "done-old"];
var COL_NAMES = { "ready": "ready", "in-progress": "in-progress", "done": "done this week", "blocked": "blocked / stalled", "done-old": "older done" };

function fmtRepo(r){ return r.split("/")[1] || r; }

function renderWayfinding(data){
  var el = $("featlist");
  var feats = data.features || [];
  $("feat-empty").style.display = feats.length ? "none" : "block";
  el.innerHTML = feats.map(function(f){
    var pct = f.pct || 0;
    var barColor = pct === 100 ? "var(--ok)" : pct > 0 ? "var(--acc)" : "var(--muted)";
    var bar = '<div style="background:var(--panel2);border:1px solid var(--line);border-radius:999px;height:10px;margin:6px 0 8px;overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:' + barColor + '"></div></div>';
    var next = f.frontier
      ? '<div class="small" style="margin-top:2px"><span class="lbl" style="color:var(--acc);border-color:var(--acc)">next</span> <a href="' + esc(f.frontier.url || "#") + '" target="_blank" rel="noopener">#' + f.frontier.n + " " + esc(f.frontier.title) + '</a></div>'
      : '<div class="small muted" style="margin-top:2px">no open unblocked children</div>';
    var blocked = (f.blockers || []).map(function(b){
      return '<div class="small" style="margin-top:2px"><span class="lbl" style="color:var(--bad);border-color:var(--bad)">⛔ ' + esc(b.n) + '</span> <a href="' + esc(b.url || "#") + '" target="_blank" rel="noopener">' + esc(b.title) + '</a></div>';
    }).join("");
    var stats = '<span class="count" style="font-size:12px">' + f.done + "/" + f.total + " done · " + pct + '%</span>';
    var badge = pct === 100 ? ' <span class="lbl" style="color:var(--ok);border-color:var(--ok)">complete 🎉</span>' : "";
    return '<div class="card" style="padding:12px 14px">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap">' +
        '<div><b style="font-size:14px">' + esc(f.title) + '</b>' + badge +
        ' <span class="muted small">' + esc(fmtRepo(f.repo)) + '#' + f.n + '</span></div>' + stats + '</div>' + bar +
      '<div class="small muted">children: ' + esc((f.total ? f.total : "none listed")) + '</div>' + next + blocked +
    '</div>';
  }).join("");
}

function renderBoards(data){
  var byBoard = {};
  (data.issues || []).forEach(function(i){
    var b = (i.url || "").indexOf("/PRTLCTRL/pocket-lota-ad/") >= 0 ? "PRTLCTRL/pocket-lota-ad" : "PRTLCTRL/finza-ops";
    (byBoard[b] = byBoard[b] || []).push(i);
  });
  ["PRTLCTRL/finza-ops", "PRTLCTRL/pocket-lota-ad"].forEach(function(board){
    var grid = $("b-" + fmtRepo(board));
    var errEl = $("e-" + fmtRepo(board));
    var issues = byBoard[board] || [];
    var cols = {};
    COL_ORDER.forEach(function(c){ cols[c] = []; });
    issues.forEach(function(i){ (cols[i.bucket] || (cols[i.bucket] = [])).push(i); });
    var html = COL_ORDER.map(function(cid){
      var list = cols[cid] || [];
      var cards = list.slice(0, 25).map(function(i){
        var lbls = (i.labels || []).filter(function(l){ return l.indexOf("wayfinder:") === 0 || l.indexOf("ready-for") === 0 || l.indexOf("needs-") === 0 || l === "blocked"; })
          .slice(0, 4).map(function(l){ return '<span class="lbl ' + esc(l).replace(/:/g, "\\\\:") + '">' + esc(l) + '</span>'; }).join(" ");
        return '<div class="tkt"><a href="' + esc(i.url) + '" target="_blank" rel="noopener"><span class="tt">' + esc("#" + i.n + " " + i.t) + '</span></a>' +
          '<div class="meta"><span>#' + i.n + '</span>' + (i.state === "closed" ? '<span class="muted">closed ' + esc(ago(i.closed)) + '</span>' : '<span class="muted">upd ' + esc(ago(i.updated)) + '</span>') + lbls + '</div></div>';
      }).join("");
      var more = list.length > 25 ? '<div class="muted small" style="padding:4px 2px">+' + (list.length - 25) + ' more…</div>' : "";
      return '<div class="col"><div class="col-h"><span class="name">' + COL_NAMES[cid] + '</span><span class="count">' + list.length + '</span></div>' + cards + more + '</div>';
    }).join("");
    grid.innerHTML = html;
    errEl.style.display = "none";
  });
  $("p-updated").textContent = "issues " + (data.fetched_at ? ago(data.fetched_at) : "never");
  $("p-src").textContent = "src: " + (data.source || "?");
}

function renderFeed(items){
  var ul = $("feed");
  if (!items || !items.length){ ul.innerHTML = '<li class="muted small">no entries yet — workers append {ts, agent, ticket, status, note} lines to KV</li>'; return; }
  ul.innerHTML = items.map(function(it){
    var st = esc(it.status || "info");
    return '<li><span class="ts">' + esc(ago(it.ts)) + '</span><span class="agent">' + esc(it.agent || "?") + '</span>' +
      (it.ticket ? '<span class="pill">' + esc(it.ticket) + '</span>' : '') +
      '<span class="st-' + esc(st) + '">' + esc(st) + '</span><span class="note">' + esc(it.note || "") + '</span></li>';
  }).join("");
}

// ---- crash & restart observability (section 7) ----

var KIND_NAMES = { "wer": "app crash (WER)", "gateway": "gateway stop", "watchdog": "watchdog restart", "sidecar": "sidecar down", "other": "event" };
var KIND_ICON = { "wer": "✖", "gateway": "■", "watchdog": "↻", "sidecar": "◌", "other": "•" };

function renderCrashes(events){
  var ul = $("crashlist");
  if (!events || !events.length){
    ul.innerHTML = '<li class="muted small">no crash events recorded — poster collects WER + gateway stop + watchdog + sidecar signals every 10 min</li>';
    return;
  }
  ul.innerHTML = events.slice(0, 40).map(function(c){
    var icon = KIND_ICON[c.kind] || "•";
    var kind = KIND_NAMES[c.kind] || c.kind || "event";
    return '<li><span class="ts">' + esc(ago(c.ts)) + '</span><span class="agent k-' + esc(c.kind || "other") + '">' + icon + ' ' + esc(kind) + '</span>' +
      '<span class="note"><b>' + esc(c.title) + '</b>' +
      (c.proc ? ' <span class="muted small">proc ' + esc(c.proc) + '</span>' : '') +
      (c.sig ? ' <span class="muted small">sig ' + esc(c.sig) + '</span>' : '') +
      (c.parent_pid ? ' <span class="muted small">parent pid ' + esc(c.parent_pid) + '</span>' : '') +
      (c.recovered_by ? ' <span class="lbl">recovered by ' + esc(c.recovered_by) + '</span>' : '') +
      '</span></li>';
  }).join("");
}

function renderBanner(events){
  var el = $("banner");
  var c = (events || []).find(function(x){ return x.kind !== "other"; });
  if (!c || (Date.now() - Date.parse(c.ts)) > 864e5){ el.style.display = "none"; return; }
  el.style.display = "flex";
  el.innerHTML = '<span class="dot bad"></span><span><b>last crash:</b> ' + esc(c.title) +
    ' <span class="muted">' + esc(ago(c.ts)) + ' · ' + esc(KIND_NAMES[c.kind] || c.kind) +
    (c.proc ? ' · ' + esc(c.proc) : '') + (c.recovered_by ? ' · recovered by ' + esc(c.recovered_by) : '') + '</span></span>';
}

// ---- machine health ---------------------------------------------------------

function spark(id, vals, color){
  var el = $(id);
  if (!el) return;
  var n = vals.length;
  if (!n){ el.innerHTML = '<p class="muted small">no samples yet</p>'; return; }
  var w = 600, h = 44, pad = 3;
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  if (max - min < 1e-9){ max = min + 1; }
  var pts = vals.map(function(v, i){
    var x = pad + (w - 2 * pad) * (n === 1 ? 1 : i / (n - 1));
    var y = h - pad - (h - 2 * pad) * ((v - min) / (max - min));
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  el.innerHTML = '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + pts.join(" ") + '"/></svg>';
}

function renderHealth(samples){
  var s0 = samples[0];
  var strip = $("stats");
  if (!s0){
    strip.innerHTML = '<div class="stat" style="grid-column:1/-1"><div class="v muted">—</div><div class="k">no health samples yet — poster posts every 10 min to /health</div></div>';
    $("sparks").innerHTML = "";
    $("stopinfo").innerHTML = "";
    return;
  }
  function cls(v, amber, red, invert){
    if (v == null) return "idle";
    var ok = invert ? (v >= amber) : (v <= amber);
    var bad = invert ? (v < red) : (v > red);
    return bad ? "bad" : ok ? "ok" : "warn";
  }
  var ramPct = (s0.ram != null && s0.ram_total) ? Math.round(100 * s0.ram / s0.ram_total) : null;
  strip.innerHTML =
    stat(s0.ram != null ? s0.ram.toFixed(1) + " GB" : "—", ramPct != null ? "ram used (" + ramPct + "%)" : "ram used", cls(ramPct != null ? ramPct : s0.ram, 80, 90, false)) +
    stat(s0.cpu != null ? Math.round(s0.cpu) + "%" : "—", "cpu", cls(s0.cpu, 60, 85, false)) +
    stat(s0.sidecar_alive === true ? "alive" : s0.sidecar_alive === false ? "down" : "—", "sidecar 8789", s0.sidecar_alive === true ? "ok" : s0.sidecar_alive === false ? "bad" : "idle") +
    stat(s0.disk != null ? Math.round(s0.disk) + " GB" : "—", "disk free", cls(s0.disk, 100, 50, true)) +
    stat(s0.gateway_state || "—", "gateway", s0.gateway_state === "running" ? "ok" : "bad") +
    stat(s0.watchdog ? s0.watchdog.restarts_24h + " restarts" : "—", "watchdog 24 h", s0.watchdog && s0.watchdog.restarts_24h > 0 ? "warn" : "ok") +
    stat(ago(s0.ts), "last seen", (Date.now() - Date.parse(s0.ts)) < 1300e3 ? "ok" : "warn");
  var extra = "";
  if (s0.last_stop){
    extra += '<div class="svc"><span class="dot warn"></span><span class="name">last gateway stop</span><span class="muted small">' +
      esc(s0.last_stop.signal || "?") + ' · parent ' + esc(s0.last_stop.parent_pid || "?") +
      (s0.last_stop.parent_name && s0.last_stop.parent_name !== "?" ? ' (' + esc(s0.last_stop.parent_name) + ')' : '') +
      ' · ' + esc(ago(s0.last_stop.ts)) +
      (s0.last_stop.recovered_by ? ' · recovered by ' + esc(s0.last_stop.recovered_by) : '') + '</span></div>';
  }
  if (s0.last_wer){
    extra += '<div class="svc"><span class="dot bad"></span><span class="name">last WER event</span><span class="muted small">' +
      esc(s0.last_wer.proc || "?") + ' · ' + esc(ago(s0.last_wer.ts)) + '</span></div>';
  }
  $("stopinfo").innerHTML = extra;
  $("sparks").innerHTML =
    sparkBlock("ram used %", "s-ram") +
    sparkBlock("cpu %", "s-cpu") +
    sparkBlock("disk free GB", "s-disk");
  var asc = samples.slice().reverse();
  spark("s-ram", asc.map(function(x){ return (x.ram != null && x.ram_total) ? Math.round(100 * x.ram / x.ram_total) : (x.ram != null && x.ram < 100 ? x.ram : null); }).filter(function(x){ return x != null; }), "#2ea043");
  spark("s-cpu", asc.map(function(x){ return x.cpu; }).filter(function(x){ return x != null; }), "#d29922");
  spark("s-disk", asc.map(function(x){ return x.disk; }).filter(function(x){ return x != null; }), "#58a6ff");
}
function stat(v, k, dotCls){
  return '<div class="stat"><div class="v"><span class="dot ' + dotCls + '"></span> ' + esc(String(v)) + '</div><div class="k">' + esc(k) + '</div></div>';
}
function sparkBlock(label, id){
  return '<div class="card" style="padding:8px;margin-bottom:8px"><h2 style="margin-bottom:4px">' + label + '</h2><div id="' + id + '"></div></div>';
}

var SERVICES = [
  { name: "put.io", key: "putio" },
  { name: "Google Workspace", key: "gws" },
  { name: "Photon (iMessage gateway)", key: "photon" },
  { name: "xAI", key: "xai" },
];

function renderConfig(data, samples){
  var s0 = samples[0];
  var last = {};
  (data.items || []).forEach(function(it){
    SERVICES.forEach(function(s){
      var re = new RegExp("\\\\b" + s.key + "\\\\b", "i");
      if (re.test((it.note || "") + " " + (it.agent || ""))) { last[s.key] = it.ts; }
    });
  });
  $("services").innerHTML = SERVICES.map(function(s){
    var cls, txt;
    if (s.key === "photon"){
      var gw = s0 ? s0.gateway_state : null;
      cls = gw === "running" ? "ok" : gw ? "warn" : "idle";
      txt = gw === "running" ? "connected ✓" : gw ? "gateway: " + gw : "unknown";
    } else {
      cls = last[s.key] ? "ok" : "idle";
      txt = last[s.key] ? "connected ✓ <span class='muted small'>(last-verified " + ago(last[s.key]) + ")</span>" : "missing ✗ <span class='muted small'>(no verification line yet)</span>";
    }
    return '<div class="svc"><span class="dot ' + cls + '"></span><span class="name">' + s.name + '</span><span>' + txt + '</span></div>';
  }).join("");
  var byKey = {};
  (data.items || []).forEach(function(it){
    var k = (it.agent || "?") + "|" + (it.ticket || "");
    if (!byKey[k]) byKey[k] = it;
  });
  $("pipeline").innerHTML = "<tr><th>agent</th><th>ticket</th><th>status</th><th>note</th><th>seen</th></tr>" +
    Object.keys(byKey).map(function(k){ var it = byKey[k];
      return "<tr><td>" + esc(it.agent) + "</td><td>" + esc(it.ticket || "—") + "</td><td>" + esc(it.status) + "</td><td>" + esc((it.note || "").slice(0, 60)) + "</td><td>" + esc(ago(it.ts)) + "</td></tr>";
    }).join("");
}

var state = { issues: null, feed: null, health: null, crash: null };
function renderAll(){
  if (state.issues) { renderBoards(state.issues); renderWayfinding(state.issues); }
  if (state.feed) { renderFeed(state.feed.items); renderConfig(state.feed, state.health || []); }
  if (state.health) renderHealth(state.health.samples);
  if (state.crash) { renderCrashes(state.crash.events); renderBanner(state.crash.events); }
}

function loadAll(){
  api("/issues").then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); }).then(function(d){ state.issues = d; }).catch(function(){});
  api("/feed").then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); }).then(function(d){ state.feed = d; }).catch(function(){});
  api("/health").then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); }).then(function(d){ state.health = d; }).catch(function(){});
  api("/crashes").then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); }).then(function(d){ state.crash = { events: d.events || [] }; }).catch(function(){});
  setTimeout(renderAll, 600);
}
function boot(){
  $("login").style.display = "none";
  $("app").style.display = "block";
  if (window.__BOOT && window.__BOOT.crashes){ state.crash = { events: window.__BOOT.crashes }; renderCrashes(state.crash.events); renderBanner(state.crash.events); }
  loadAll();
  setInterval(loadAll, 60000);
  if (location.search.indexOf("refresh=1") >= 0){
    api("/issues?refresh=1").then(function(){ location.replace("/"); });
  }
}
document.querySelectorAll(".tab").forEach(function(b){
  b.addEventListener("click", function(){
    document.querySelectorAll(".tab").forEach(function(x){ x.classList.remove("active"); });
    b.classList.add("active");
    ["wayfinding", "boards", "feed", "machine", "crashes", "config"].forEach(function(t){ $("tab-" + t).style.display = (t === b.dataset.tab ? "block" : "none"); });
    if (b.dataset.tab !== "wayfinding" && b.dataset.tab !== "boards") loadAll();
  });
});
$("p-refresh").addEventListener("click", function(){ api("/issues?refresh=1").then(function(){ loadAll(); }); });
if (TOKEN){
  api("/issues").then(function(r){ if (r.ok) boot(); else if (r.status === 401){ localStorage.removeItem("dash_token"); showLogin(); } else showLogin(); }).catch(showLogin);
} else {
  document.addEventListener("DOMContentLoaded", showLogin);
}
</script>
</body>
</html>`;