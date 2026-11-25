/**
 * 生成「接入 mock 后端」的 Chrome 预览页，用来验证 renderer/app.js 的会话模型：
 *  - preview-empty.html   : 启动后的零会话空状态（截图用）
 *  - preview-session.html : 双击设备栏打开会话并连接后的界面（截图用）
 *  - preview-test.html    : 自动跑一遍交互断言，结果写进 <pre id="testOut">（--dump-dom 读取）
 * 仅用于视觉 / 逻辑验证，不参与构建。
 */
const fs = require('node:fs');
const TMP = 'C:/Users/syd/AppData/Local/Temp/';
const html = fs.readFileSync('D:/Agent/WorkBuddy/comet-app/out/renderer/index.html', 'utf8')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');

const mock = `<script>
(function () {
  const clone = o => JSON.parse(JSON.stringify(o));
  const S = {
    theme:'comet-dark', font:'jetbrains', fontSize:12, fontCollapsed:false,
    navHidden:false, inspHidden:false, sendHidden:false, showTs:true, autoScroll:true,
    filters:{rx:true,tx:true,sys:true}, sendOpts:{hex:false,crlf:true,timer:false,echo:false},
    timerIntervalMs:1000, mockEnabled:false, autoConnect:false,
    serial:{path:'COM3',baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',dtr:true,rts:false},
    devices: location.hash === '#noports' ? [] : [
      {id:'dev-1',name:'RT1052 调试板',port:'COM3',baudRate:115200,chip:'NXP',tag:'串口',parity:'None',online:true},
      {id:'dev-2',name:'F200 传感器',port:'COM7',baudRate:9600,chip:'F200',tag:'串口',parity:'Even',online:true}
    ],
    quickCommands:[
      {id:'q1',label:'查询版本',cmd:'AT+VER?'},
      {id:'q2',label:'flicker 检测',cmd:'AT+FLCK?'},
      {id:'q3',label:'VCOM 校准',cmd:'AT+VCAL=SET,0x1A4'},
      {id:'q4',label:'内存 dump',cmd:'AT+DUMP=0x20000000,64'},
      {id:'q5',label:'复位',cmd:'AT+RST'}
    ]
  };
  const cbs = {}; const logs = {}; let seq = 1; let active = null; let serial = null; let fail = false;
  const t = n => String(n).padStart(2,'0');
  const stamp = () => { const d=new Date(); return t(d.getHours())+':'+t(d.getMinutes())+':'+t(d.getSeconds())+'.'+t(d.getMilliseconds()); };
  const emit = (ch,p) => (cbs[ch]||[]).forEach(f => f(clone(p)));
  const line = (dir,text) => { const l={id:Math.random(),ts:stamp(),dir,text,sessionId:active,bytes:text.length}; (logs[active]=logs[active]||[]).push(l); emit('serial:line',l); return l; };
  const status = () => ({connected:!!serial,config:serial,mock:false,path:serial&&serial.path});
  const api = {
    on(ch,cb){ (cbs[ch]=cbs[ch]||[]).push(cb); return ()=>{}; },
    getSettings:async()=>clone(S), setSettings:async(p)=>{Object.assign(S,p);return clone(S);},
    getDevices:async()=>clone(S.devices), saveDevices:async(d)=>{S.devices=clone(d);return clone(d);},
    listPorts:async()=> location.hash === '#noports' ? [] : [
      {path:'COM3',manufacturer:'NXP',vendorId:'1FC9',productId:'0130'},
      {path:'COM7',manufacturer:'F200',vendorId:'0483',productId:'5740'},
      {path:'COM12',manufacturer:'VCOM-CAL'}
    ],
    connect:async cfg => {
      if (fail) { const s={connected:false,config:null,mock:false,error:'打开 '+cfg.path+' 超时（3s）'}; emit('serial:status',s); return s; }
      if (serial) line('sys','已断开端口');
      serial = cfg; S.serial = clone(cfg);
      emit('serial:status',status());
      line('sys','已连接 '+cfg.path+' · '+cfg.baudRate+' 8N1 · DTR=ON RTS=OFF');
      return status();
    },
    disconnect:async()=>{ if(serial) line('sys','已断开端口'); serial=null; const s=status(); emit('serial:status',s); return s; },
    getStatus:async()=>status(),
    send:async p => { if(!serial) return {ok:false,bytes:0,error:'端口未连接'}; line('tx',p.text+(p.crlf?'\\\\r\\\\n':'')); return {ok:true,bytes:p.text.length}; },
    setSignals:async(s)=>({dtr:s.dtr??true,rts:s.rts??false,dsr:true,cts:true,dcd:false}),
    exportLog:async()=>({ok:true,path:'C:/temp/comet.log'}), copyText:async()=>true,
    getSessionLog:async id => clone(logs[id]||[]), clearSession:async id => { logs[id]=[]; },
    newSession:async name => { const id='s'+(seq++); logs[id]=[]; return id; },
    closeSession:async id => { delete logs[id]; },
    getActiveSession:async()=>active, setActiveSession:async id => { active=id; },
    win:{minimize:async()=>{},maximize:async()=>{},close:async()=>{}}
  };
  window.comet = api;
  window.__pv = {
    rx(text){ if(serial) line('rx',text); },
    tx(text){ line('tx',text+'\\\\r\\\\n'); },
    set fail(v){ fail=v; }
  };
})();
</script>`;

const helpers = `
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {}; const log = (k, v) => { out[k] = v; };
const click = el => el.dispatchEvent(new MouseEvent('click', {bubbles:true}));
const dbl = el => { click(el); el.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); };
const flush = async () => { q('#testOut').textContent = JSON.stringify(out); };
`;

// 交互断言：零会话 → 连接建会话 → 关最后一个 → 双击直连 → 占用不抢线 → 新建设备 / 仅保存 / 命名 → 删除 → 多标签
const test = `<script>
${helpers}
(async () => {
  try {
    await sleep(700);
    log('bootDone', window.__cometBootDone === true); log('bootErr', String(window.__cometBootError || ''));
    log('t1_tabs', qa('#tabs .tab').length);
    log('t1_noSession', document.body.classList.contains('no-session'));
    log('t1_emptyDisplay', getComputedStyle(q('#emptyState')).display);
    log('t1_consoleDisplay', getComputedStyle(q('.console')).display);
    log('t1_sendDisplay', getComputedStyle(q('.sendbar')).display);
    log('t1_formInCenter', !!q('#emptySlot .settings-body'));
    log('t1_noFormLeft', !q('.view-settings .settings-body'));
    const m = q('.main').getBoundingClientRect(), c = q('.empty-card').getBoundingClientRect();
    log('t1_centerOffsetY', Math.round((c.top + c.height/2) - (m.top + m.height/2)));
    log('t1_centerOffsetX', Math.round((c.left + c.width/2) - (m.left + m.width/2)));
    log('t1_cardInsideMain', c.top >= m.top && c.bottom <= m.bottom && c.left >= m.left && c.right <= m.right);
    log('t1_devItems', qa('#devList .dev').length);
    log('t1_devX', qa('#devList .dev-x').length);
    log('t1_connOff', q('#quickConn').classList.contains('off'));
    log('t1_fPortRestored', q('#fPort').value + '/' + q('#fBaud').value);
    log('t1_nameField', !!q('#emptySlot #fName'));
    log('t1_saveBtn', !!q('#emptySlot #saveDevBtn') && /保存到设备栏/.test(q('#saveDevBtn').textContent));
    log('t1_greenDots', qa('#devList .dev-dot.ok').length);
    log('t1_addDevTip', q('#addDev').title);

    // 空状态下连接失败：原因显示在居中卡片里，且不留下半截会话
    window.__pv.fail = true;
    q('#fPort').value = 'COM12'; click(q('#connectBtn')); await sleep(200);
    log('t2_errShown', q('#emptyErr').classList.contains('on') ? q('#emptyErr').textContent : false);
    log('t2_tabsAfterFail', qa('#tabs .tab').length);
    log('t2_formInCenterAfterFail', !!q('#emptySlot .settings-body'));
    log('t2_noDeviceCreated', qa('#devList .dev').length);

    // 连接成功并命名：建标签（用填的名字）、保存到设备栏、表单回到左侧
    window.__pv.fail = false;
    q('#fName').value = '校准台';
    click(q('#quickConn')); await sleep(200);
    log('t3_tabs', qa('#tabs .tab').length);
    log('t3_tabName', q('#tabs .tab.active .tab-name').textContent);
    log('t3_noSession', document.body.classList.contains('no-session'));
    log('t3_formBackLeft', !!q('.view-settings .settings-body'));
    log('t3_devices', qa('#devList .dev').map(b => b.dataset.name).join(','));
    log('t3_devActive', qa('#devList .dev.active').map(b => b.dataset.port).join(','));
    log('t3_connOn', q('#quickConn').classList.contains('on'));
    log('t3_greenDots', qa('#devList .dev-dot.ok').length);

    // 关闭最后一个标签：允许关闭，回到空状态，串口一并断开，设备栏会话保留
    click(q('#tabs .tab.active .x')); await sleep(250);
    log('t4_tabs', qa('#tabs .tab').length);
    log('t4_noSession', document.body.classList.contains('no-session'));
    log('t4_connOff', q('#quickConn').classList.contains('off'));
    log('t4_formInCenter', !!q('#emptySlot .settings-body'));
    log('t4_devicesKept', qa('#devList .dev').length);
    log('t4_greenDots', qa('#devList .dev-dot.ok').length);
    log('t4_errCleared', !q('#emptyErr').classList.contains('on'));

    // 双击设备栏会话：Termius 式直连（标签 + 连接 + 参数回填 + 左侧串口配置）
    dbl(qa('#devList .dev')[1]); await sleep(300);
    log('t5_tabs', qa('#tabs .tab').length);
    log('t5_tabName', q('#tabs .tab.active .tab-name').textContent);
    log('t5_tabDeviceId', q('#tabs .tab.active').dataset.deviceId);
    log('t5_connected', q('#quickConn').classList.contains('on'));
    log('t5_fPort', q('#fPort').value + '/' + q('#fBaud').value);
    log('t5_settingsMode', q('#sidebar').classList.contains('settings-mode'));
    log('t5_sysLine', qa('#log .ln').length);
    // 串口正连着 COM7 时双击另一台（COM3）：只打开会话，不抢线
    dbl(qa('#devList .dev')[0]); await sleep(300);
    log('t6_tabs', qa('#tabs .tab').length);
    log('t6_activeTab', q('#tabs .tab.active .tab-name').textContent);
    log('t6_stillOn', q('#quickConn').querySelector('.conn-port').textContent);
    log('t6_formPort', q('#fPort').value);
    // 已连接的那台再双击：复用标签，不会重复开
    dbl(qa('#devList .dev')[1]); await sleep(300);
    log('t6_tabsSame', qa('#tabs .tab').length);
    log('t6_activeTab2', q('#tabs .tab.active .tab-name').textContent);
    // 切回设备视图，关掉两个标签
    click(qa('.rail-btn[data-panel="devices"]')[0]); await sleep(100);
    log('t6_devicesViewShown', getComputedStyle(q('.view-devices')).display !== 'none');
    click(q('#tabs .tab.active .x')); await sleep(250);
    log('t7_afterCloseOne', qa('#tabs .tab').length + ' tabs, active=' + q('#tabs .tab.active .tab-name').textContent + ', connected=' + q('#quickConn').classList.contains('on'));
    click(q('#tabs .tab.active .x')); await sleep(250);
    log('t7_noSessionAgain', document.body.classList.contains('no-session'));

    // 设备栏的 +：新建设备，不建标签；「保存到设备栏」不连接
    click(q('#addDev')); await sleep(150);
    log('t8_noTabAfterPlus', qa('#tabs .tab').length);
    log('t8_nameCleared', q('#fName').value);
    log('t8_focused', document.activeElement && document.activeElement.id);
    q('#fName').value = '我的板子'; q('#fPort').value = 'COM12'; q('#fBaud').value = '230400';
    click(q('#saveDevBtn')); await sleep(200);
    log('t8_devices', qa('#devList .dev').map(b => b.dataset.name).join(','));
    log('t8_sub', (qa('#devList .dev').find(b => b.dataset.name === '我的板子') || {dataset:{}}).dataset.port);
    log('t8_subText', (qa('#devList .dev').find(b => b.dataset.name === '我的板子') || {querySelector:()=>({textContent:''})}).querySelector('.dev-sub').textContent);
    log('t8_stillNoTab', qa('#tabs .tab').length + ' tabs, connected=' + q('#quickConn').classList.contains('on'));
    log('t8_noSession', document.body.classList.contains('no-session'));
    // 双击刚保存的设备：直连，标签用它保存的名字和参数
    dbl(qa('#devList .dev').find(b => b.dataset.name === '我的板子')); await sleep(300);
    log('t8_tabs', qa('#tabs .tab').length);
    log('t8_tabName', q('#tabs .tab.active .tab-name').textContent);
    log('t8_connected', q('#quickConn').classList.contains('on'));
    log('t8_formPort', q('#fPort').value + '/' + q('#fBaud').value);

    // 删除正在连接的会话：需二次确认
    const live = qa('#devList .dev').find(b => b.dataset.name === '我的板子');
    click(live.querySelector('.dev-x')); await sleep(150);
    log('t9_firstClickKeeps', qa('#devList .dev').length + ' devices/' + qa('#tabs .tab').length + ' tabs');
    click(live.querySelector('.dev-x')); await sleep(250);
    log('t9_afterConfirm', qa('#devList .dev').length + ' devices/' + qa('#tabs .tab').length + ' tabs');
    log('t9_noSession', document.body.classList.contains('no-session'));

    // 空白会话标签里连接并命名：标签随名字改，设备保存进设备栏
    click(q('#tabAdd')); await sleep(200);
    log('t10_blankName', q('#tabs .tab.active .tab-name').textContent);
    q('#fName').value = '临时抓包'; q('#fPort').value = 'COM12';
    click(q('#connectBtn')); await sleep(250);
    log('t10_tabRenamed', q('#tabs .tab.active .tab-name').textContent);
    log('t10_devices', qa('#devList .dev').map(b => b.dataset.name).join(','));
    // 已连接时点「连接」按钮 = 断开（按钮此时就是「断开连接」）
    click(q('#connectBtn')); await sleep(250);
    log('t11_clickWhileConnected', 'connected=' + q('#quickConn').classList.contains('on') + ', btn=' + q('#connectBtn').textContent.trim());
    log('t11_greenDots', qa('#devList .dev-dot.ok').length);
    click(q('#tabs .tab.active .x')); await sleep(250);
    // 删掉 COM12 的设备，让 COM12 变成「没有设备记录的端口」
    click(qa('#devList .dev').find(b => b.dataset.name === '临时抓包').querySelector('.dev-x')); await sleep(200);
    log('t11_devices', qa('#devList .dev').map(b => b.dataset.name).join(','));
    // 没填名字直接连一个没有设备记录的端口：设备名退回端口名
    click(q('#tabAdd')); await sleep(200);
    q('#fName').value = ''; q('#fPort').value = 'COM12';
    click(q('#connectBtn')); await sleep(250);
    log('t11_fallbackName', q('#tabs .tab.active .tab-name').textContent);
    log('t11_devices2', qa('#devList .dev').map(b => b.dataset.name).join(','));
    // 单串口连接：换端口前先断开。再开空白标签连「已有设备的端口」COM3：标签改成已有设备名，不重复建设备
    click(q('#connectBtn')); await sleep(250);
    log('t11_disconnectedByBtn', 'connected=' + q('#quickConn').classList.contains('on') + ', dots=' + qa('#devList .dev-dot.ok').length);
    click(q('#tabAdd')); await sleep(200);
    q('#fName').value = ''; q('#fPort').value = 'COM3';
    click(q('#connectBtn')); await sleep(250);
    log('t11_knownName', q('#tabs .tab.active .tab-name').textContent);
    log('t11_devices3', qa('#devList .dev').length + ' devices');
    click(qa('#tabs .tab')[0].querySelector('.x')); await sleep(250);
    log('t11_afterCloseFirst', qa('#tabs .tab').length + ' tabs, active=' + q('#tabs .tab.active .tab-name').textContent);
    click(q('#tabs .tab.active .x')); await sleep(250);
    log('t11_final', qa('#tabs .tab').length + ' tabs, noSession=' + document.body.classList.contains('no-session'));
  } catch (e) { log('EXCEPTION', String(e && e.stack || e)); }
  await flush();
})();
</script>`;

// 截图：双击设备栏会话直连，收几行数据
const session = `<script>
${helpers}
(async () => {
  await sleep(600);
  dbl(qa('#devList .dev')[0]); await sleep(300);   // 双击即直连
  window.__pv.rx('+VER: F200-CTRL v2.4.1 build 20261103');
  window.__pv.tx('AT+FLCK?');
  window.__pv.rx('+FLCK: 0, 120Hz, duty=48.2%, ppm=+12');
  window.__pv.rx('OK');
  await flush();
})();
</script>`;

const noAnim = '<style>*{animation:none!important;transition:none!important}#testOut{display:none}</style>';
const outPre = '<pre id="testOut"></pre>';
const build = (extra) => html
  .replace('</head>', noAnim + mock + '\n</head>')
  .replace('</body>', extra + outPre + '\n</body>');

fs.writeFileSync(TMP + 'preview-empty.html', build(''), 'utf8');
fs.writeFileSync(TMP + 'preview-session.html', build(session), 'utf8');
fs.writeFileSync(TMP + 'preview-test.html', build(test), 'utf8');
// HTML 用相对路径 ./app.js 引用脚本，必须把 app.js 放到同一目录
fs.copyFileSync('D:/Agent/WorkBuddy/comet-app/out/renderer/app.js', TMP + 'app.js');
console.log('ok', html.length);
