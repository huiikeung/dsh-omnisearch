/**
 * dsh-omnisearch — the remote-screen page for visible platform login.
 *
 * Served at GET /omnisearch/api/vnc/page?platform=<p>&token=<t>. Pure static
 * HTML+JS: it polls `vnc/frame` for JPEG frames, maps taps/clicks into
 * `vnc/input` events, and shows the login state once the cookie jar is
 * satisfied. No framework, no build step — the string is returned as-is.
 *
 * The token is minted by `vnc/start` and only exists in the URL the operator
 * opens, so the stream is not world-readable even though the fenced route
 * plane itself is loopback-trusted.
 *
 * @module
 */

/** Build the remote-screen page HTML. */
export function renderVncPage(platform: string, token: string, title: string): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${title} · 登录</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; background: #0b0d12; color: #e6e8ee; font: 14px/1.5 system-ui, sans-serif; display: flex; flex-direction: column; height: 100dvh; }
  header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #141821; border-bottom: 1px solid #232a38; }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; }
  header .dot.ok { background: #22c55e; }
  header .url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #9aa4b8; }
  header button { background: #1d2432; color: #cbd3e1; border: 1px solid #2a3244; border-radius: 6px; padding: 4px 10px; font-size: 12px; }
  #screen { flex: 1; display: block; margin: 0 auto; background: #000; touch-action: none; object-fit: contain; }
  #bar { display: flex; gap: 6px; padding: 8px; background: #141821; border-top: 1px solid #232a38; align-items: center; }
  #bar input[type=text] { flex: 1; background: #0f131c; border: 1px solid #2a3244; color: #e6e8ee; border-radius: 6px; padding: 8px 10px; font-size: 14px; }
  #bar button { background: #2563eb; border: 0; color: #fff; border-radius: 6px; padding: 8px 12px; font-size: 14px; }
  #bar button.ghost { background: #1d2432; color: #cbd3e1; border: 1px solid #2a3244; }
  #hint { padding: 6px 12px; font-size: 12px; color: #9aa4b8; background: #10141d; }
  #done { display: none; padding: 10px 12px; background: #052e16; color: #bbf7d0; font-size: 13px; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <span class="url" id="url">连接中…</span>
  <button id="reload">刷新页面</button>
  <button id="close">关闭</button>
</header>
<div id="done">✅ 检测到登录成功，Cookie 已自动保存。可以关闭本窗口，回到设置页。</div>
<img id="screen" alt="远程登录页面">
<div id="hint">在画面上点击即可操作；文字用下方输入框发送（按 Enter 也可以）。登录成功后会自动保存。</div>
<div id="bar">
  <input type="text" id="text" placeholder="输入文字后发送" autocomplete="off">
  <button id="send">发送</button>
  <button class="ghost" id="enter">↵</button>
  <button class="ghost" id="back">⌫</button>
  <button class="ghost" id="up">↑</button>
  <button class="ghost" id="down">↓</button>
</div>
<script>
var PLATFORM = ${JSON.stringify(platform)}, TOKEN = ${JSON.stringify(token)};
var API = "/omnisearch/api";
var img = document.getElementById("screen");
var urlEl = document.getElementById("url");
var dot = document.getElementById("dot");
var doneEl = document.getElementById("done");
var W = 420, H = 860, busy = false, authenticated = false;

function post(method, body) {
  return fetch(API + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  }).then(function (r) { return r.json(); });
}

function poll() {
  if (busy || authenticated) return;
  busy = true;
  post("vnc/frame", { platform: PLATFORM, token: TOKEN }).then(function (d) {
    busy = false;
    var v = d.value || d;
    if (!v.active) { urlEl.textContent = "登录窗口已关闭"; dot.style.background = "#ef4444"; return; }
    if (v.frame) img.src = "data:image/jpeg;base64," + v.frame;
    if (v.url) urlEl.textContent = v.url;
    if (v.authenticated) {
      authenticated = true;
      dot.className = "dot ok";
      doneEl.style.display = "block";
    }
  }).catch(function () { busy = false; });
}
setInterval(poll, 700);
poll();

// 画面坐标 → CDP 坐标（画布内等比缩放）
function toCdp(evt) {
  var r = img.getBoundingClientRect();
  var cx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
  var cy = (evt.touches ? evt.touches[0].clientY : evt.clientY) - r.top;
  var scale = Math.min(r.width / img.naturalWidth || 1, r.height / img.naturalHeight || 1);
  var offX = (r.width - img.naturalWidth * scale) / 2, offY = (r.height - img.naturalHeight * scale) / 2;
  return { x: Math.round((cx - offX) / scale), y: Math.round((cy - offY) / scale) };
}
function tap(evt) { evt.preventDefault(); var p = toCdp(evt); post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "click", x: p.x, y: p.y } }); }
img.addEventListener("click", tap);
img.addEventListener("touchend", tap, { passive: false });

function sendText() {
  var el = document.getElementById("text");
  var v = el.value; if (!v) return;
  post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "text", text: v } });
  el.value = "";
}
document.getElementById("send").onclick = sendText;
document.getElementById("text").addEventListener("keydown", function (e) { if (e.key === "Enter") sendText(); });
document.getElementById("enter").onclick = function () { post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "key", key: "Enter" } }); };
document.getElementById("back").onclick = function () { post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "key", key: "Backspace" } }); };
document.getElementById("up").onclick = function () { post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "scroll", deltaY: -400 } }); };
document.getElementById("down").onclick = function () { post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "scroll", deltaY: 400 } }); };
document.getElementById("reload").onclick = function () { post("vnc/input", { platform: PLATFORM, token: TOKEN, input: { type: "key", key: "F5" } }); poll(); };
document.getElementById("close").onclick = function () { post("vnc/stop", { platform: PLATFORM, token: TOKEN }); window.close(); };
</script>
</body>
</html>`;
}
