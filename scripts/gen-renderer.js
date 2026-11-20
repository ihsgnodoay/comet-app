/**
 * 一次性生成 renderer/index.html：
 *  - 完整保留原型的 <style> 与 DOM（视觉定稿，一个字节都不改）
 *  - 把内联 <script> 抽成外部 app.js
 *  - 追加 -webkit-app-region 规则，让无边框窗口的标题栏可拖动
 *  - 注入正式版专属 UI：顶部常驻「连接 / 断开」按钮、可用的连接设置入口
 *    （原型保持纯视觉基准稿，功能 UI 一律由本脚本注入，保证可重现）
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = 'D:/Agent/WorkBuddy/serial demo/ui-prototype/index.html';
const DST = 'D:/Agent/WorkBuddy/comet-app/src/renderer/index.html';

let h = fs.readFileSync(SRC, 'utf8');

const appRegion = `<style id="comet-app-region">
.titlebar{-webkit-app-region:drag}
.titlebar .brand,.titlebar .tabs-top,.titlebar .tb-actions,.titlebar .win-ctl,
.titlebar .icon-btn,.titlebar .tab,.titlebar .tab-add{-webkit-app-region:no-drag}
</style>`;
h = h.replace('</head>', appRegion + '\n</head>');

// 正式版专属：顶部常驻连接控制 + 状态栏可点击。
// 视觉守住 Termius 总纲：深蓝相位底 + 半透明白层 + 1px 细线，扁平无阴影；
// 绿色只用于「已连接」状态，hover 变红提示「断开」。
const connCss = `<style id="comet-conn-ui">
.conn-btn{height:30px;display:flex;align-items:center;gap:7px;padding:0 11px;border-radius:7px;border:1px solid rgba(150,170,220,.16);background:rgba(255,255,255,.055);color:var(--t2);font-family:var(--mono);font-size:11.5px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,color .15s;margin-right:2px}
.conn-btn:hover{background:rgba(255,255,255,.09);border-color:rgba(150,170,220,.28);color:var(--t1)}
.conn-btn .cdot{width:7px;height:7px;border-radius:50%;background:var(--t3);flex:none}
.conn-btn.on{color:var(--ok);border-color:rgba(33,181,104,.34);background:rgba(33,181,104,.10)}
.conn-btn.on .cdot{background:var(--ok)}
.conn-btn.on:hover{background:rgba(242,94,97,.12);border-color:rgba(242,94,97,.36);color:var(--err)}
.conn-btn.on:hover .cdot{background:var(--err)}
.conn-sep{width:1px;height:18px;background:var(--line);margin:0 3px;flex:none}
#sbState{cursor:pointer}
#sbState:hover{color:var(--t1)}
</style>`;
h = h.replace('</head>', connCss + '\n</head>');

// CSP：renderer 无远程资源；img 允许 data:（主题缩略图是内联 SVG）、
// style 允许 inline（原型的内联 <style> 与 CSS 变量注入）。
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'">`;
h = h.replace(/(<head[^>]*>)/, '$1\n' + csp);

const before = (h.match(/<script>[\s\S]*?<\/script>/g) || []).length;
h = h.replace(/<script>[\s\S]*?<\/script>/, '<script src="./app.js"></script>');
const after = (h.match(/<script>[\s\S]*?<\/script>/g) || []).length;

// 状态栏：原型标注改为真实运行状态
h = h.replace('UI 原型 · 未连接真实串口', '串口服务运行中');
h = h.replace('v0.1.0-design', 'v0.3.0');
// 「注入模拟数据」在正式版改为向真实串口发送一帧测试帧
h = h.replace('title="注入模拟接收数据"', 'title="发送 F200 测试帧"');

// 把最高频的「连接 / 断开」从隐藏的设置面板提到顶部常驻位置
const quickConn = `\t\t\t\t<button class="conn-btn off" id="quickConn" title="连接 / 断开当前端口"><span class="cdot"></span><span class="conn-port">COM3</span><span class="conn-act">连接</span></button>
\t\t\t\t<div class="conn-sep"></div>`;
h = h.replace('<div class="tb-actions">', '<div class="tb-actions">\n' + quickConn);
// 原型里这个「设置」齿轮原本是死按钮，改成真正打开连接设置面板
h = h.replace('<button class="icon-btn" title="设置">', '<button class="icon-btn" id="openSettings" title="连接设置">');

if (before !== 1 || after !== 0 || !h.includes('src="./app.js"') ||
    !h.includes('id="quickConn"') || !h.includes('id="openSettings"')) {
  console.error('[gen-renderer] 生成校验失败 before=' + before + ' after=' + after);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, h, 'utf8');
console.log('[gen-renderer] OK  ' + h.length + ' bytes  内联脚本 ' + before + ' -> ' + after);
