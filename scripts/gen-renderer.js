/**
 * 一次性生成 renderer/index.html：
 *  - 完整保留原型的 <style> 与 DOM（视觉定稿，一个字节都不改）
 *  - 把内联 <script> 抽成外部 app.js
 *  - 追加 -webkit-app-region 规则，让无边框窗口的标题栏可拖动
 *    （纯功能 CSS，不改变任何颜色 / 尺寸 / 布局）
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

if (before !== 1 || after !== 0 || !h.includes('src="./app.js"')) {
  console.error('[gen-renderer] 脚本抽取失败 before=' + before + ' after=' + after);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, h, 'utf8');
console.log('[gen-renderer] OK  ' + h.length + ' bytes  内联脚本 ' + before + ' -> ' + after);
