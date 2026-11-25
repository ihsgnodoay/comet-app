/**
 * 一次性生成 renderer/index.html：
 *  - 完整保留原型的 <style> 与 DOM（视觉定稿，一个字节都不改）
 *  - 把内联 <script> 抽成外部 app.js
 *  - 追加 -webkit-app-region 规则，让无边框窗口的标题栏可拖动
 *  - 注入正式版专属 UI：顶部常驻「连接 / 断开」按钮、可用的连接设置入口、
 *    零会话空状态（主窗口垂直居中的连接设置）、设备栏删除按钮样式；并删除原型焊死的演示标签
 *    （原型保持纯视觉基准稿，功能 UI 一律由本脚本注入，保证可重现）
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = 'D:/Agent/WorkBuddy/serial demo/ui-prototype/index.html';
const DST = 'D:/Agent/WorkBuddy/comet-app/src/renderer/index.html';

let h = fs.readFileSync(SRC, 'utf8');

// 注入点全部带断言：原型结构一旦变动就立即失败，而不是静默生成一份缺功能的 HTML
const must = (cond, msg) => { if (!cond) throw new Error('[gen-renderer] ' + msg); };

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

// 会话模型：启动零会话，主窗口 = 垂直居中的连接设置；会话保存在左侧设备栏，可删、可双击打开。
// 配色守住总纲：--bg-2 卡片底 + 1px 细线，扁平无阴影；红色只用于删除 / 断开这类破坏性 hover。
const sessionCss = `<style id="comet-session-ui">
.empty-state{display:none;flex:1;min-height:0;align-items:center;justify-content:center;padding:24px;background:var(--bg-1)}
body.no-session .empty-state{display:flex}
body.no-session .console,body.no-session .sendbar{display:none}
.settings-body .f-name{width:100%;height:32px;box-sizing:border-box;padding:0 10px;background:var(--bg-1);border:1px solid var(--line-2);border-radius:6px;outline:none;font-size:12px;color:var(--t1);transition:border-color .15s}
.settings-body .f-name::placeholder{color:var(--t3)}
.settings-body .f-name:focus{border-color:rgba(59,140,255,.55)}
.settings-body .ghost-btn{width:100%;flex:none;margin-top:-4px}
.empty-ports{display:none;margin:0;padding:10px 12px;border:1px solid rgba(255,209,102,.28);border-radius:8px;background:rgba(255,209,102,.07);font-size:11.5px;line-height:1.7;color:var(--t2)}
.empty-ports.on{display:block}

.empty-card{width:380px;max-width:100%;max-height:100%;overflow:auto;box-sizing:border-box;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:20px 20px 18px;display:flex;flex-direction:column;gap:14px}
.empty-title{font-size:15px;font-weight:600;color:var(--t1)}
.empty-sub{margin:-6px 0 0;font-size:11.5px;line-height:1.6;color:var(--t3)}
.empty-card .settings-body{flex:none;overflow:visible;padding:0;gap:11px}
.empty-err{margin:0;font-family:var(--mono);font-size:11.5px;line-height:1.5;color:var(--err);display:none}
.empty-err.on{display:block}
.settings-away{display:none;margin:0;padding:14px 16px;font-size:11.5px;line-height:1.6;color:var(--t3)}
body.no-session .settings-away{display:block}
.dev-x{flex:none;width:20px;height:20px;display:grid;place-items:center;border-radius:5px;color:var(--t3);cursor:pointer;margin:-2px -4px -2px 0;transition:background .15s,color .15s}
.dev-x:hover{background:rgba(242,94,97,.12);color:var(--err)}
.dev-x.arm{background:rgba(242,94,97,.16);color:var(--err)}
.dev-x svg{width:12px;height:12px}
.dev-empty{margin:10px 8px;padding:14px 12px;border:1px dashed var(--line-2);border-radius:8px;font-size:11.5px;line-height:1.7;color:var(--t3)}
</style>`;
h = h.replace('</head>', sessionCss + '\n</head>');

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

// 空状态：无会话时主窗口中央显示连接设置（表单节点由 app.js 搬运，全局只有一份）
const emptyState = `\t\t\t<div class="empty-state" id="emptyState">
\t\t\t\t<div class="empty-card">
\t\t\t\t\t<div class="empty-title">新建串口会话</div>
\t\t\t\t\t<p class="empty-sub">填好参数点「连接」，或双击左侧已保存的会话直接连接。</p>
\t\t\t\t\t<p class="empty-ports" id="emptyPorts"></p>
\t\t\t\t\t<div class="empty-slot" id="emptySlot"></div>
\t\t\t\t\t<p class="empty-err" id="emptyErr"></p>
\t\t\t\t</div>
\t\t\t</div>
\t\t\t`;
h = h.replace('<main class="main">', '<main class="main">\n' + emptyState);

// 表单加「名称」输入与「保存到设备栏」：新设备可以起名，也可以不连接先存起来
const nameFieldRe = /(<div class="field"><label>端口<\/label>)/;
must(nameFieldRe.test(h), 'port field anchor');
h = h.replace(nameFieldRe, '<div class="field"><label>名称</label><input class="f-name" id="fName" placeholder="给这个设备起个名字，留空则用端口名" autocomplete="off" maxlength="40"></div>\n\t\t\t\t\t\t\t' + '$1');
const hintA = '<p class="set-hint">修改参数后需重新连接生效</p>';
must(h.includes(hintA), 'set-hint anchor');
h = h.replace(hintA, hintA + '\n\t\t\t\t\t\t\t<button class="ghost-btn" id="saveDevBtn" title="不连接，只把当前参数存进左侧设备栏">' + '<svg class="i"><use href="#i-plus"/></svg>保存到设备栏</button>');

// 左侧「连接设置」视图在空状态下不持有表单，留一句去向说明
const away = h.match(/<span class="count" id="setPortTag">COM3<\/span>\s*<\/div>/);
if (!away) throw new Error('setPortTag anchor missing');
h = h.replace(away[0], away[0] + '\n\t\t\t\t\t\t<p class="settings-away">连接设置显示在主窗口中央。<br>连接成功后，该会话会保存到「设备」栏。</p>');

// 原型里焊死的两个演示标签删掉：正式版启动零会话，标签一律由运行时创建
const demoTabs = (h.match(/<button class="tab[ "][\s\S]*?<\/button>/g) || []).length;
h = h.replace(/\s*<button class="tab[ "][\s\S]*?<\/button>/g, '');

if (before !== 1 || after !== 0 || !h.includes('src="./app.js"') ||
    !h.includes('id="quickConn"') || !h.includes('id="openSettings"') ||
    demoTabs !== 2 || h.includes('data-tab=') || !h.includes('id="emptyState"') ||
    !h.includes('id="emptySlot"') || !h.includes('class="settings-away"') ||
    !h.includes('id="fName"') || !h.includes('id="saveDevBtn"')) {
  console.error('[gen-renderer] 生成校验失败 before=' + before + ' after=' + after);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, h, 'utf8');
console.log('[gen-renderer] OK  ' + h.length + ' bytes  内联脚本 ' + before + ' -> ' + after);
