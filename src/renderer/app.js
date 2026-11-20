/* ============================================================
 * Comet 串口工作台 · renderer
 * 视觉完全沿用已定稿原型，这里只负责把每个 UI 功能接到主进程 API。
 * 全局只有一个 window.comet（preload 白名单），拿不到 Node / fs / serialport。
 * ============================================================ */
(function () {
  'use strict';

  const comet = window.comet;
  if (!comet) {
    document.body.insertAdjacentHTML('afterbegin', '<div style="padding:20px;color:#F25E61;font:14px monospace">preload 未加载，主进程 API 不可用</div>');
    return;
  }

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const icon = id => '<svg class="i"><use href="#' + id + '"/></svg>';
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3); };
  const fmt = n => n.toLocaleString('en-US').replace(/,/g, ' ');
  const noop = () => {};

  /* ---------------- 状态 ---------------- */
  let settings = null;
  let sessionId = 's1';
  let connected = false;
  let ports = [];
  let devices = [];
  let quickCmds = [];
  let simTimer = null;
  let filters = { rx: true, tx: true, sys: true, warn: true, err: true };
  let opts = { hex: false, crlf: true, timer: false, echo: false };
  let autoScroll = true, showTs = true;
  let rxBytes = 0, txBytes = 0;
  let lastStats = null;

  function persist(patch) {
    comet.setSettings(patch).then(s => { settings = s; }).catch(noop);
  }

  function toast(msg) {
    $('#toastText').textContent = msg;
    $('#toast').classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $('#toast').classList.remove('on'), 1800);
  }

  /* ---------------- 日志区 ---------------- */
  function addLine(dir, text, ts) {
    const line = document.createElement('div');
    line.className = 'ln';
    line.dataset.dir = dir;
    const label = { rx: 'RX', tx: 'TX', sys: 'SYS', warn: 'WARN', err: 'ERR' }[dir] || 'SYS';
    line.innerHTML = '<span class="ts">' + (ts || stamp()) + '</span><span class="dir ' + dir + '">' + label + '</span><span class="msg"></span>';
    line.querySelector('.msg').textContent = text;
    $('#log').insertBefore(line, $('#log .cursor-line'));
    applyFilters();
    if (autoScroll) $('#log').scrollTop = $('#log').scrollHeight;
  }

  function applyFilters() {
    $$('#log .ln').forEach(l => {
      const d = l.dataset.dir;
      const key = (d === 'warn' || d === 'err') ? 'sys' : d;
      l.classList.toggle('hide', !filters[key]);
    });
    $$('#log .ts').forEach(t => { t.style.display = showTs ? '' : 'none'; });
    $$('#log .ln').forEach(l => { l.style.gridTemplateColumns = showTs ? '' : '0em 4em 1fr'; });
  }

  function renderSessionLog(lines) {
    $$('#log .ln').forEach(l => l.remove());
    lines.forEach(l => addLine(l.dir, l.text, l.ts));
  }

  /* ---------------- 统计 / 面板数据 ---------------- */
  function seriesPoints(arr, h) {
    if (!arr || !arr.length) return '';
    const w = 220, max = Math.max(1, ...arr);
    return arr.map((v, i) => (i * w / Math.max(1, arr.length - 1)).toFixed(0) + ',' + (h - (v / max) * (h - 8)).toFixed(0)).join(' ');
  }

  function renderStats(s) {
    lastStats = s;
    rxBytes = s.rxBytes; txBytes = s.txBytes;
    $('#mRx').innerHTML = fmt(rxBytes) + '<small>B</small>';
    $('#mTx').innerHTML = fmt(txBytes) + '<small>B</small>';
    $('#sbRx').textContent = fmt(rxBytes);
    $('#sbTx').textContent = fmt(txBytes);
    const metricVals = $$('.metrics .v');
    if (metricVals[2]) metricVals[2].innerHTML = (s.rxRate / 1024).toFixed(1) + '<small>KB/s</small>';
    const secs = Math.floor(s.uptimeMs / 1000);
    $('#mTime').textContent = pad(Math.floor(secs / 60)) + ':' + pad(secs % 60);
    const spark = $$('.spark polyline');
    if (spark[0]) spark[0].setAttribute('points', seriesPoints(s.throughput.rx, 56));
    if (spark[1]) spark[1].setAttribute('points', seriesPoints(s.throughput.tx, 56));
    const portSec = $$('.insp-sec')[1];
    if (portSec) {
      const kvs = portSec.querySelectorAll('.kv .v');
      if (kvs[5]) { kvs[5].textContent = String(s.frameErrors); kvs[5].style.color = s.frameErrors ? 'var(--err)' : 'var(--ok)'; }
      if (kvs[4]) kvs[4].textContent = '4096 B';
    }
    const sRight = $$('.s-right span');
    if (sRight[1]) sRight[1].textContent = 'RX ' + s.rxRate + ' B/s';
  }

  function setLed(el, on) {
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.innerHTML = '<i></i>' + (on ? 'ON' : 'OFF');
  }

  function renderModem(m) {
    setLed($('#ledDTR'), m.dtr);
    setLed($('#ledRTS'), m.rts);
    const leds = $$('.sig .led');
    setLed(leds[2], m.dsr);
    setLed(leds[3], m.cts);
    $$('.tg').forEach(t => t.classList.toggle('on', t.dataset.tg === 'DTR' ? m.dtr : m.rts));
  }

  function renderFrame(f) {
    const card = $('.frame-card');
    if (!card) return;
    $('.fc-name').textContent = 'F200 · ' + f.typeName;
    const ok = $('.fc-ok');
    ok.textContent = f.crcOk ? 'CRC OK' : 'CRC FAIL';
    ok.style.color = f.crcOk ? 'var(--ok)' : 'var(--err)';
    $('.fc-hex').textContent = f.raw;
    $('.fc-foot').textContent = 'seq=' + f.seq + ' · len=' + f.length + ' · ' + f.ts;
  }

  function renderHex(rows) {
    const pane = $('#hexPane');
    if (!pane) return;
    const head = pane.querySelector('.hex-head');
    pane.innerHTML = '';
    if (head) pane.appendChild(head.cloneNode(true));
    (rows || []).forEach(r => {
      const div = document.createElement('div');
      div.className = 'hexrow';
      div.innerHTML = '<span class="off"></span><span class="bytes"></span><span class="ascii"></span>';
      div.querySelector('.off').textContent = r.offset;
      div.querySelector('.bytes').textContent = r.bytes;
      div.querySelector('.ascii').textContent = r.ascii;
      pane.appendChild(div);
    });
  }

  function renderPorts() {
    const sel = $('#fPort');
    const cur = sel.value;
    sel.innerHTML = '';
    ports.forEach(p => {
      const o = document.createElement('option');
      o.value = p.path;
      o.textContent = p.path + (p.isMock ? ' · 虚拟' : '');
      sel.appendChild(o);
    });
    if (cur && ports.some(p => p.path === cur)) sel.value = cur;
    else if (ports.length) sel.value = settings?.serial?.path || ports[0].path;
    updatePortInfo();
  }

  function updatePortInfo() {
    const p = ports.find(x => x.path === $('#fPort').value);
    const portSec = $$('.insp-sec')[1];
    if (!portSec) return;
    const kvs = portSec.querySelectorAll('.kv .v');
    if (kvs[2]) kvs[2].textContent = p && p.vendorId ? (p.vendorId + ' / ' + (p.productId || '—')) : '— / —';
    if (kvs[3]) kvs[3].textContent = p && p.manufacturer ? p.manufacturer : 'USB-SERIAL';
  }

  /* ---------------- 设备 / 快捷指令 ---------------- */
  function renderDevices() {
    const list = $('#devList');
    list.innerHTML = '';
    devices.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'dev' + (i === 0 ? ' active' : '');
      b.dataset.id = d.id;
      b.dataset.name = d.name;
      b.dataset.port = d.port;
      b.dataset.baud = String(d.baudRate);
      b.dataset.chip = d.chip;
      b.dataset.tag = d.tag;
      b.innerHTML = '<span class="dev-dot ' + (d.online ? 'ok' : 'warn') + '"></span>' +
        '<span class="dev-main"><span class="dev-name"></span><span class="dev-sub"></span></span>' +
        '<span class="dev-tag"></span>';
      const framing = d.parity === 'Even' ? '8E1' : d.parity === 'Odd' ? '8O1' : '8N1';
      b.querySelector('.dev-name').textContent = d.name;
      b.querySelector('.dev-sub').textContent = d.port + ' · ' + d.baudRate + ' ' + framing;
      b.querySelector('.dev-tag').textContent = d.tag;
      b.addEventListener('click', () => selectDevice(d, b));
      list.appendChild(b);
    });
    const count = $('.side-head .count');
    if (count) count.textContent = String(devices.length);
    const labels = $$('.sec-label');
    if (labels[0] && labels[0].lastElementChild) labels[0].lastElementChild.textContent = devices.length + ' 台';
  }

  function renderQuick() {
    const ql = $('#quickList');
    ql.innerHTML = '';
    quickCmds.forEach(q => {
      const b = document.createElement('button');
      b.className = 'quick';
      b.dataset.cmd = q.cmd;
      b.innerHTML = icon('i-bolt') + '<span></span>';
      b.querySelector('span').textContent = q.cmd;
      b.addEventListener('click', () => fillCmd(q.cmd));
      ql.appendChild(b);
    });
    const meta = $('.send-meta');
    meta.querySelectorAll('.qcmd').forEach(n => n.remove());
    quickCmds.slice(0, 3).forEach(q => {
      const b = document.createElement('button');
      b.className = 'qcmd';
      b.dataset.cmd = q.cmd;
      b.textContent = q.cmd;
      b.addEventListener('click', () => fillCmd(q.cmd));
      meta.appendChild(b);
    });
  }

  function fillCmd(cmd, focus) {
    $('#sendInput').value = cmd;
    if (focus !== false) $('#sendInput').focus();
  }

  function selectDevice(d, el) {
    $$('#devList .dev').forEach(x => x.classList.remove('active'));
    if (el) el.classList.add('active');
    const activeTab = $('#tabs .tab.active');
    if (activeTab) {
      activeTab.querySelector('.tab-name').textContent = d.name;
      activeTab.dataset.full = d.name;
      activeTab.dataset.port = d.port;
    }
    $('#fPort').value = d.port;
    $('#fBaud').value = String(d.baudRate);
    $('#setPortTag').textContent = d.port;
    $('#iChip').textContent = d.chip;
    $('#iPort').textContent = d.port;
    $('#sbPort').textContent = d.port + ' · ' + d.baudRate + ' 8N1';
    updatePortInfo();
    toast('已选择 ' + d.name);
  }

  /* ---------------- 连接 ---------------- */
  function readConfig() {
    const sels = $$('.settings-body .sel select');
    return {
      path: $('#fPort').value,
      baudRate: parseInt($('#fBaud').value, 10) || 115200,
      dataBits: parseInt(sels[2]?.value || '8', 10),
      stopBits: parseFloat(sels[3]?.value || '1'),
      parity: (sels[4]?.value || 'None').toLowerCase(),
      flowControl: (sels[5]?.value || 'None').toLowerCase() === 'rts/cts' ? 'rtscts'
        : (sels[5]?.value || 'None').toLowerCase() === 'xon/xoff' ? 'xonxoff' : 'none',
      dtr: $('.tg[data-tg="DTR"]')?.classList.contains('on') ?? true,
      rts: $('.tg[data-tg="RTS"]')?.classList.contains('on') ?? false
    };
  }

  function applyStatus(s) {
    connected = !!s.connected;
    $('#stateBadge').classList.toggle('off', !connected);
    $('#stateText').textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
    const btn = $('#connectBtn');
    btn.classList.toggle('connected', connected);
    btn.innerHTML = connected ? icon('i-unlink') + '<span>断开连接</span>' : icon('i-link') + '<span>连接端口</span>';
    $$('.sel').forEach(x => x.classList.toggle('disabled', connected));
    $('#sbState').textContent = connected ? '● 已连接' : '○ 未连接';
    $('#sbState').style.color = connected ? 'var(--ok)' : 'var(--t3)';
    $('#cursorHint').textContent = connected ? '等待数据…' : '端口未打开';
    $$('#tabs .tab .dot').forEach(d => d.classList.toggle('ok', connected));
    const sRight = $$('.s-right span');
    if (sRight[0]) sRight[0].innerHTML = '<svg class="i" style="width:11px;height:11px"><use href="#i-info"/></svg> ' + (s.mock ? '虚拟串口 · MockSerial' : '真实串口 · serialport');
    if (s.config) $('#sbPort').textContent = s.config.path + ' · ' + s.config.baudRate + ' 8N1';
  }

  async function toggleConnect() {
    if (connected) {
      applyStatus(await comet.disconnect());
    } else {
      if (opts.hex) {
        const t = $('#sendInput').value.trim();
        if (t && !/^[0-9a-fA-F\s,]+$/.test(t)) { toast('HEX 发送已开启，输入框内容不是十六进制'); }
      }
      const s = await comet.connect(readConfig());
      applyStatus(s);
      if (s.error) toast('连接失败：' + s.error);
    }
  }

  /* ---------------- 发送 ---------------- */
  async function send() {
    const input = $('#sendInput');
    const raw = input.value.trim();
    if (!raw) { toast('先写点东西再发送吧'); return; }
    if (!connected) { toast('端口未连接'); return; }
    if (opts.hex) {
      const cleaned = raw.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
      if (!cleaned || cleaned.length % 2 !== 0) { toast('HEX 模式需要偶数个十六进制字符'); return; }
    }
    const res = await comet.send({ sessionId, text: raw, hex: opts.hex, crlf: opts.crlf, echo: opts.echo });
    if (!res.ok) { toast('发送失败：' + res.error); return; }
    input.value = '';
  }

  /* ---------------- 主题 / 字体（保留原型 8 套） ---------------- */
  const THEMES = [
    { id: 'comet-dark', name: 'Comet Dark', sub: '深色 · 冷蓝', tone: 'dark', v: { '--bg-0': '#0B0E1A', '--bg-1': '#101322', '--bg-2': '#161B2E', '--bg-3': '#1C2238', '--line': 'rgba(150,170,220,.09)', '--line-2': 'rgba(150,170,220,.17)', '--t1': '#C9D1E3', '--t2': '#8A93A8', '--t3': '#5C657C', '--acc': '#3B8CFF', '--acc-2': '#6AA5FF', '--acc-soft': 'rgba(59,140,255,.13)', '--ok': '#21B568', '--warn': '#FFD166', '--err': '#F25E61', '--rx': '#6FD3E8', '--tx': '#AC9CFF', '--sys': '#7C879F' } },
    { id: 'midnight', name: 'Midnight', sub: '深色 · 靛蓝', tone: 'dark', v: { '--bg-0': '#060812', '--bg-1': '#0A0D1C', '--bg-2': '#111529', '--bg-3': '#181D35', '--line': 'rgba(140,160,255,.10)', '--line-2': 'rgba(140,160,255,.20)', '--t1': '#CBD2EC', '--t2': '#8B92B5', '--t3': '#5B6288', '--acc': '#6E8BFF', '--acc-2': '#93A8FF', '--acc-soft': 'rgba(110,139,255,.15)', '--ok': '#2FC98A', '--warn': '#FFCF6B', '--err': '#FF6B7A', '--rx': '#7DE0F0', '--tx': '#B9A6FF', '--sys': '#7C84A8' } },
    { id: 'graphite', name: 'Graphite', sub: '深色 · 石墨灰', tone: 'dark', v: { '--bg-0': '#0D0E11', '--bg-1': '#121316', '--bg-2': '#191B20', '--bg-3': '#21242B', '--line': 'rgba(180,185,195,.10)', '--line-2': 'rgba(180,185,195,.19)', '--t1': '#D2D4D9', '--t2': '#8E9299', '--t3': '#62666D', '--acc': '#4CC9C0', '--acc-2': '#6FE0D7', '--acc-soft': 'rgba(76,201,192,.14)', '--ok': '#3FC98A', '--warn': '#E8C15A', '--err': '#E8685E', '--rx': '#6FD8D0', '--tx': '#A9B4C4', '--sys': '#7A7F87' } },
    { id: 'forest', name: 'Forest', sub: '深色 · 松绿', tone: 'dark', v: { '--bg-0': '#080D0A', '--bg-1': '#0C120E', '--bg-2': '#121A15', '--bg-3': '#18231C', '--line': 'rgba(140,200,160,.10)', '--line-2': 'rgba(140,200,160,.19)', '--t1': '#C6D6CB', '--t2': '#86A090', '--t3': '#5A7264', '--acc': '#35C27A', '--acc-2': '#5ADB9B', '--acc-soft': 'rgba(53,194,122,.14)', '--ok': '#35C27A', '--warn': '#E5C263', '--err': '#E06A5E', '--rx': '#7FD9AE', '--tx': '#B7C98E', '--sys': '#6F8378' } },
    { id: 'amber', name: 'Amber', sub: '深色 · 暖褐', tone: 'dark', v: { '--bg-0': '#0F0C08', '--bg-1': '#14100A', '--bg-2': '#1B1610', '--bg-3': '#241D15', '--line': 'rgba(220,190,150,.10)', '--line-2': 'rgba(220,190,150,.19)', '--t1': '#DDD2C2', '--t2': '#A2978A', '--t3': '#736A5E', '--acc': '#F0A24B', '--acc-2': '#FFBD75', '--acc-soft': 'rgba(240,162,75,.14)', '--ok': '#4FC08A', '--warn': '#F0C24B', '--err': '#E8694F', '--rx': '#F0B27A', '--tx': '#C9A6E8', '--sys': '#8A8072' } },
    { id: 'comet-light', name: 'Comet Light', sub: '浅色 · 冷蓝', tone: 'light', v: { '--bg-0': '#F2F5FB', '--bg-1': '#FFFFFF', '--bg-2': '#F6F8FD', '--bg-3': '#EAEFF8', '--line': 'rgba(30,55,100,.10)', '--line-2': 'rgba(30,55,100,.19)', '--t1': '#1B2437', '--t2': '#5A6580', '--t3': '#8791A6', '--acc': '#2F7CF6', '--acc-2': '#1F65DE', '--acc-soft': 'rgba(47,124,246,.10)', '--ok': '#1A9E5C', '--warn': '#B8860B', '--err': '#D9453F', '--rx': '#0A7286', '--tx': '#6F5BD0', '--sys': '#78839A' } },
    { id: 'paper', name: 'Paper', sub: '浅色 · 米白', tone: 'light', v: { '--bg-0': '#F7F4EC', '--bg-1': '#FFFDF8', '--bg-2': '#F3EEE3', '--bg-3': '#E9E2D3', '--line': 'rgba(90,70,40,.12)', '--line-2': 'rgba(90,70,40,.22)', '--t1': '#2B2418', '--t2': '#6B5F4C', '--t3': '#A09580', '--acc': '#B4622A', '--acc-2': '#8F4A1D', '--acc-soft': 'rgba(180,98,42,.11)', '--ok': '#3E8E5A', '--warn': '#A9761B', '--err': '#C24B3E', '--rx': '#236970', '--tx': '#74519B', '--sys': '#8A7E6B' } },
    { id: 'neon', name: 'Neon', sub: '深色 · 霓虹', tone: 'dark', v: { '--bg-0': '#05060A', '--bg-1': '#090B12', '--bg-2': '#0F121C', '--bg-3': '#161A28', '--line': 'rgba(255,120,180,.10)', '--line-2': 'rgba(255,120,180,.20)', '--t1': '#D8DDF0', '--t2': '#8B93B0', '--t3': '#5B6280', '--acc': '#FF4D8D', '--acc-2': '#FF7AAB', '--acc-soft': 'rgba(255,77,141,.14)', '--ok': '#2EE6A8', '--warn': '#FFD166', '--err': '#FF5470', '--rx': '#56E8FF', '--tx': '#C08BFF', '--sys': '#7A82A0' } }
  ];
  const FONTS = [
    { id: 'jetbrains', name: 'JetBrains Mono', stack: "'JetBrains Mono','Cascadia Code',Consolas,monospace" },
    { id: 'cascadia', name: 'Cascadia Code', stack: "'Cascadia Code',Consolas,monospace" },
    { id: 'consolas', name: 'Consolas', stack: "Consolas,'Courier New',monospace" },
    { id: 'sourcecode', name: 'Source Code Pro', stack: "'Source Code Pro',Consolas,monospace" },
    { id: 'fira', name: 'Fira Code', stack: "'Fira Code',Consolas,monospace" }
  ];

  function applyTheme(id, save) {
    const t = THEMES.find(x => x.id === id) || THEMES[0];
    Object.keys(t.v).forEach(k => document.documentElement.style.setProperty(k, t.v[k]));
    document.body.dataset.theme = t.id;
    document.body.dataset.tone = t.tone;
    $$('.theme-item').forEach(el => el.classList.toggle('active', el.dataset.themeId === t.id));
    $('#themeBtn').innerHTML = icon(t.tone === 'light' ? 'i-moon' : 'i-sun');
    if (save) persist({ theme: t.id });
  }

  function thumbSVG(t) {
    const v = t.v;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 104" width="144" height="104">' +
      '<rect width="144" height="104" rx="10" fill="' + v['--bg-0'] + '"/>' +
      '<path d="M0 10a10 10 0 0110-10h124a10 10 0 0110 10v8H0z" fill="' + v['--bg-1'] + '"/>' +
      '<circle cx="10" cy="9" r="2" fill="' + v['--acc'] + '"/><circle cx="17" cy="9" r="2" fill="' + v['--t3'] + '" opacity=".7"/><circle cx="24" cy="9" r="2" fill="' + v['--t3'] + '" opacity=".7"/>' +
      '<rect x="0" y="18" width="26" height="78" fill="' + v['--bg-1'] + '"/>' +
      '<rect x="6" y="26" width="14" height="3" rx="1.5" fill="' + v['--acc'] + '" opacity=".85"/><rect x="6" y="34" width="10" height="3" rx="1.5" fill="' + v['--t3'] + '" opacity=".5"/><rect x="6" y="42" width="12" height="3" rx="1.5" fill="' + v['--t3'] + '" opacity=".5"/>' +
      '<rect x="34" y="26" width="60" height="4" rx="2" fill="' + v['--t2'] + '" opacity=".75"/><rect x="34" y="36" width="44" height="4" rx="2" fill="' + v['--rx'] + '" opacity=".9"/><rect x="34" y="46" width="72" height="4" rx="2" fill="' + v['--t3'] + '" opacity=".55"/><rect x="34" y="56" width="52" height="4" rx="2" fill="' + v['--tx'] + '" opacity=".85"/><rect x="34" y="66" width="66" height="4" rx="2" fill="' + v['--t3'] + '" opacity=".55"/><rect x="34" y="76" width="38" height="4" rx="2" fill="' + v['--ok'] + '" opacity=".85"/>' +
      '<rect x="0" y="96" width="144" height="8" fill="' + v['--bg-1'] + '"/></svg>';
  }

  function renderThemes() {
    const list = $('#themeList');
    list.innerHTML = '';
    THEMES.forEach(t => {
      const b = document.createElement('button');
      b.className = 'theme-item';
      b.dataset.themeId = t.id;
      b.title = t.name;
      b.innerHTML = '<img class="theme-thumb" src="data:image/svg+xml,' + encodeURIComponent(thumbSVG(t)) + '" alt="' + t.name + ' 主题预览" width="72" height="52">' +
        '<span class="theme-meta"><span class="theme-name">' + t.name + '</span><span class="theme-sub">' + t.sub + '</span></span>' +
        '<span class="theme-check">' + icon('i-check') + '</span>';
      b.addEventListener('click', () => { applyTheme(t.id, true); toast('主题：' + t.name); });
      list.appendChild(b);
    });
  }

  let curFont = 'jetbrains', curSize = 12;
  function applyFont(id, size, save) {
    const f = FONTS.find(x => x.id === id) || FONTS[0];
    curFont = f.id;
    curSize = Math.min(20, Math.max(10, parseInt(size, 10) || 12));
    document.documentElement.style.setProperty('--log-font', f.stack);
    document.documentElement.style.setProperty('--log-size', curSize + 'px');
    $('#fontSel').value = f.id;
    $('#sizeVal').textContent = curSize;
    if (save) persist({ font: curFont, fontSize: curSize });
  }

  function setFontFold(collapsed, save) {
    $('#fontSec').classList.toggle('collapsed', collapsed);
    $('#fontFold').setAttribute('aria-expanded', String(!collapsed));
    if (save) persist({ fontCollapsed: collapsed });
  }

  /* ---------------- 面板开合 ---------------- */
  function setNav(hidden, silent) {
    document.body.classList.toggle('nav-hidden', hidden);
    $('#navToggle').title = hidden ? '打开左侧栏' : '隐藏左侧栏';
    if (!silent) { toast(hidden ? '左侧栏已隐藏' : '左侧栏已打开'); persist({ navHidden: hidden }); }
  }
  function setInsp(hidden, silent) {
    $('.app').classList.toggle('insp-hidden', hidden);
    $('#inspBtn').classList.toggle('on', !hidden);
    $('#inspBtn').title = hidden ? '打开右侧边栏' : '隐藏右侧边栏';
    if (!silent) { toast(hidden ? '右侧边栏已隐藏' : '右侧边栏已打开'); persist({ inspHidden: hidden }); }
  }
  function setSend(hidden, silent) {
    $('.app').classList.toggle('send-hidden', hidden);
    $('#panelBtn').classList.toggle('on', !hidden);
    if (!silent) { toast(hidden ? '发送面板已收起' : '发送面板已展开'); persist({ sendHidden: hidden }); }
  }
  function showView(mode) {
    $('#sidebar').classList.toggle('settings-mode', mode === 'settings');
    $$('.rail-btn[data-panel]').forEach(b => b.classList.remove('active'));
    $('#railSettings').classList.remove('active');
    if (mode === 'settings') $('#railSettings').classList.add('active');
    else { const c = $('.rail-btn[data-panel="' + mode + '"]'); if (c) c.classList.add('active'); }
  }

  /* ---------------- 会话标签 ---------------- */
  const tabTip = document.createElement('div');
  tabTip.className = 'tab-tip';
  document.body.appendChild(tabTip);
  const HUES = [215, 170, 262, 28, 335, 95];
  let tabSeq = 2, hueSeq = 2;

  function showTabTip(el) {
    tabTip.textContent = el.dataset.full || el.querySelector('.tab-name')?.textContent || '';
    if (el.dataset.port) { const s = document.createElement('span'); s.className = 'tip-port'; s.textContent = el.dataset.port; tabTip.appendChild(s); }
    const r = el.getBoundingClientRect();
    tabTip.style.left = (r.left + r.width / 2) + 'px';
    tabTip.style.top = (r.bottom + 8) + 'px';
    tabTip.classList.add('on');
  }
  function hideTabTip() { tabTip.classList.remove('on'); }

  async function activateTab(tab) {
    $$('#tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    hideTabTip();
    sessionId = tab.dataset.session || sessionId;
    await comet.setActiveSession(sessionId);
    const lines = await comet.getSessionLog(sessionId);
    renderSessionLog(lines);
  }

  async function addTab(name) {
    const hue = HUES[hueSeq % HUES.length]; hueSeq++;
    const sid = await comet.newSession(name || ('新会话 ' + tabSeq));
    const t = document.createElement('button');
    t.className = 'tab';
    t.dataset.full = name || ('新会话 ' + tabSeq);
    t.dataset.session = sid;
    t.dataset.port = $('#fPort').value;
    t.style.setProperty('--h', hue);
    t.innerHTML = '<span class="tab-ico">' + icon('i-terminal') + '<span class="dot"></span></span><span class="tab-name"></span><span class="x">' + icon('i-x') + '</span>';
    t.querySelector('.tab-name').textContent = t.dataset.full;
    $('#tabs').insertBefore(t, $('#tabAdd'));
    tabSeq++;
    await activateTab(t);
    toast('已新建会话');
  }

  /* ---------------- 命令面板 ---------------- */
  const palItems = () => [
    ...devices.map(d => ({ group: '设备', icon: 'i-chip', name: d.name, sub: d.port, act: () => selectDevice(d, $$('#devList .dev').find(b => b.dataset.id === d.id)) })),
    ...quickCmds.map(q => ({ group: '指令', icon: 'i-bolt', name: q.cmd, sub: q.label, act: () => fillCmd(q.cmd) })),
    { group: '操作', icon: 'i-link', name: '连接 / 断开端口', sub: 'Ctrl D', act: () => toggleConnect() },
    { group: '操作', icon: 'i-refresh', name: '刷新端口', sub: '', act: () => $('#refreshBtn').click() },
    { group: '操作', icon: 'i-trash', name: '清空日志', sub: 'Ctrl L', act: () => $('#clearBtn').click() },
    { group: '操作', icon: 'i-download', name: '导出日志', sub: '.log', act: () => $('#exportBtn').click() },
    { group: '视图', icon: 'i-sun', name: '切换主题', sub: '深 / 浅', act: () => $('#themeBtn').click() },
    { group: '视图', icon: 'i-terminal', name: '切换到 HEX 视图', sub: '', act: () => $$('#viewSeg button')[1].click() }
  ];
  let palFiltered = [], palSel = 0;

  function renderPalette(q) {
    palFiltered = palItems().filter(i => (i.name + i.group + i.sub).toLowerCase().includes(q.toLowerCase()));
    palSel = 0;
    const list = $('#palList');
    list.innerHTML = '';
    if (!palFiltered.length) { list.innerHTML = '<div class="pal-group">没有匹配项</div>'; return; }
    let last = '';
    palFiltered.forEach((it, idx) => {
      if (it.group !== last) { last = it.group; const g = document.createElement('div'); g.className = 'pal-group'; g.textContent = it.group; list.appendChild(g); }
      const b = document.createElement('button');
      b.className = 'pal-item' + (idx === 0 ? ' sel' : '');
      b.innerHTML = icon(it.icon) + '<span></span><span class="sub"></span>';
      b.querySelector('span').textContent = it.name;
      b.querySelector('.sub').textContent = it.sub;
      b.addEventListener('click', () => { it.act(); closePalette(); });
      list.appendChild(b);
    });
  }
  function openPalette() { $('#overlay').classList.add('on'); $('#palInput').value = ''; renderPalette(''); setTimeout(() => $('#palInput').focus(), 20); }
  function closePalette() { $('#overlay').classList.remove('on'); }

  /* ---------------- UI 绑定 ---------------- */
  function bindUI() {
    // 左侧栏
    $('#navToggle').addEventListener('click', () => setNav(!document.body.classList.contains('nav-hidden')));
    $$('.rail-btn[data-panel]').forEach(b => b.addEventListener('click', () => { showView(b.dataset.panel); toast(b.dataset.panelName + ' 面板'); }));
    $('#railSettings').addEventListener('click', () => { showView('settings'); document.body.classList.remove('nav-hidden'); toast('连接设置'); });
    $('#devSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      $$('#devList .dev').forEach(d => { d.style.display = (d.dataset.name + d.dataset.port + d.dataset.tag).toLowerCase().includes(q) ? '' : 'none'; });
    });
    $('#addDev').addEventListener('click', async () => {
      const port = ports.find(p => !devices.some(d => d.port === p.path));
      const rec = { id: 'dev-' + Date.now(), name: '新设备 ' + (devices.length + 1), port: port ? port.path : 'COM1', baudRate: 115200, chip: 'UNKNOWN', tag: '手动添加', parity: 'None', online: false };
      devices = await comet.saveDevices([...devices, rec]);
      renderDevices();
      toast('已添加设备（可在配置中修改）');
    });
    $('#addBtn').addEventListener('click', () => addTab());
    $('#refreshBtn').addEventListener('click', async () => {
      ports = await comet.listPorts();
      renderPorts();
      toast('端口已刷新 · 发现 ' + ports.length + ' 个');
    });

    // 右侧栏 / 发送面板
    $('#inspBtn').addEventListener('click', () => setInsp(!$('.app').classList.contains('insp-hidden')));
    $('#panelBtn').addEventListener('click', () => setSend(!$('.app').classList.contains('send-hidden')));
    $$('#inspTabs button').forEach(b => b.addEventListener('click', () => {
      $$('#inspTabs button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      $('#inspector').classList.toggle('themes-mode', b.dataset.view === 'themes');
    }));

    // 连接
    $('#connectBtn').addEventListener('click', toggleConnect);
    $$('.tg').forEach(t => t.addEventListener('click', async () => {
      const on = !t.classList.contains('on');
      t.classList.toggle('on', on);
      renderModem(await comet.setSignals({ [t.dataset.tg]: on }));
    }));

    // 标签
    $('#tabs').addEventListener('click', async e => {
      const x = e.target.closest('.x');
      if (x) {
        const tab = x.closest('.tab');
        if ($$('#tabs .tab').length <= 1) { toast('至少保留一个会话'); return; }
        const wasActive = tab.classList.contains('active');
        await comet.closeSession(tab.dataset.session);
        tab.remove();
        if (wasActive) await activateTab($('#tabs .tab'));
        return;
      }
      const tab = e.target.closest('.tab');
      if (tab && !tab.classList.contains('active')) await activateTab(tab);
    });
    $('#tabs').addEventListener('mouseover', e => { const t = e.target.closest('.tab'); if (t && !e.target.closest('.x')) showTabTip(t); });
    $('#tabs').addEventListener('mouseout', e => { const t = e.target.closest('.tab'); if (t && !t.contains(e.relatedTarget)) hideTabTip(); });
    $('#tabAdd').addEventListener('click', () => addTab());

    // 视图 / 过滤 / 选项
    $$('#viewSeg button').forEach(b => b.addEventListener('click', () => {
      $$('#viewSeg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const hex = b.dataset.view === 'hex';
      $('#hexPane').classList.toggle('on', hex);
      $('#log').classList.toggle('off', hex);
      toast(hex ? 'HEX 视图' : '文本视图');
    }));
    $$('.chip[data-filter]').forEach(c => c.addEventListener('click', () => {
      c.classList.toggle('on');
      filters[c.dataset.filter] = c.classList.contains('on');
      applyFilters();
      persist({ filters: { ...filters } });
    }));
    $('#tsChip').addEventListener('click', e => { showTs = !showTs; e.currentTarget.classList.toggle('on', showTs); applyFilters(); persist({ showTs }); });
    $('#scrollChip').addEventListener('click', e => { autoScroll = !autoScroll; e.currentTarget.classList.toggle('on', autoScroll); persist({ autoScroll }); toast(autoScroll ? '自动滚动：开' : '自动滚动：关'); });
    $$('.opt').forEach(o => o.addEventListener('click', () => {
      o.classList.toggle('on');
      opts[o.dataset.opt] = o.classList.contains('on');
      if (o.dataset.opt === 'timer') {
        clearInterval(simTimer);
        if (opts.timer) simTimer = setInterval(() => send(), settings?.timerIntervalMs || 1000);
        toast(opts.timer ? '定时发送：开' : '定时发送：关');
      }
      persist({ sendOpts: { ...opts } });
    }));

    // 发送 / 日志工具
    $('#sendBtn').addEventListener('click', send);
    $('#sendInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    $('#simBtn').addEventListener('click', async () => {
      if (!connected) { toast('端口未连接'); return; }
      // 合法的 F200 状态帧：AA 55 | 03 | 10 | 2C 01 7F 3C | CRC(FA)
      const r = await comet.send({ sessionId, text: 'AA 55 03 10 2C 01 7F 3C FA', hex: true, crlf: false, echo: false });
      toast(r.ok ? '已发送 F200 测试帧 · ' + r.bytes + ' B' : '发送失败：' + r.error);
    });
    $('#clearBtn').addEventListener('click', async () => { await comet.clearSession(sessionId); $$('#log .ln').forEach(l => l.remove()); applyFilters(); toast('日志已清空'); });
    $('#copyBtn').addEventListener('click', async () => {
      const text = $$('#log .ln').map(l => l.innerText.replace(/\s+/g, ' ')).join('\n');
      await comet.copyText(text);
      toast('日志已复制');
    });
    $('#exportBtn').addEventListener('click', async () => {
      const text = $$('#log .ln').map(l => l.innerText.replace(/\s+/g, ' ')).join('\n');
      const name = 'comet-' + new Date().toISOString().slice(0, 10) + '.log';
      const r = await comet.exportLog(text, name);
      toast(r.ok ? '已导出 ' + r.path : (r.canceled ? '已取消导出' : '导出失败：' + r.error));
    });

    // 主题 / 字体
    $('#fontSel').addEventListener('change', e => applyFont(e.target.value, curSize, true));
    $('#sizeMinus').addEventListener('click', () => applyFont(curFont, curSize - 1, true));
    $('#sizePlus').addEventListener('click', () => applyFont(curFont, curSize + 1, true));
    $('#fontFold').addEventListener('click', () => setFontFold(!$('#fontSec').classList.contains('collapsed'), true));
    $('#themeBtn').addEventListener('click', () => {
      const isLight = document.body.dataset.tone === 'light';
      applyTheme(isLight ? 'comet-dark' : 'comet-light', true);
      toast(isLight ? '已切换到深色' : '已切换到浅色');
    });

    // 命令面板
    $('#palBtn').addEventListener('click', openPalette);
    $('#overlay').addEventListener('click', e => { if (e.target === $('#overlay')) closePalette(); });
    $('#palInput').addEventListener('input', e => renderPalette(e.target.value));
    $('#palInput').addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!palFiltered.length) return;
        palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palFiltered.length) % palFiltered.length;
        $$('#palList .pal-item').forEach((b, i) => b.classList.toggle('sel', i === palSel));
        $$('#palList .pal-item')[palSel]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); if (palFiltered[palSel]) { palFiltered[palSel].act(); closePalette(); } }
      else if (e.key === 'Escape') closePalette();
    });

    // 快捷键
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'k' || k === 'j')) { e.preventDefault(); openPalette(); }
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); toggleConnect(); }
      if ((e.ctrlKey || e.metaKey) && k === 'l') { e.preventDefault(); $('#clearBtn').click(); }
      if (e.key === 'Escape') closePalette();
    });

    // 窗口控制
    const winBtns = $$('.win-ctl button');
    if (winBtns[0]) winBtns[0].addEventListener('click', () => comet.win.minimize());
    if (winBtns[1]) winBtns[1].addEventListener('click', () => comet.win.maximize());
    if (winBtns[2]) winBtns[2].addEventListener('click', () => comet.win.close());

    // 时钟
    setInterval(() => { const d = new Date(); $('#clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }, 1000);
  }

  /* ---------------- 事件订阅 ---------------- */
  function subscribe() {
    comet.on('serial:line', line => addLine(line.dir, line.text, line.ts));
    comet.on('serial:stats', s => { renderStats(s); lastStats = { ...lastStats, ...s }; });
    comet.on('serial:frame', renderFrame);
    comet.on('serial:modem', renderModem);
    comet.on('serial:data', d => renderHex(d.rows));
    comet.on('serial:status', s => applyStatus(s));
    comet.on('serial:ports', list => { ports = list; renderPorts(); });
    comet.on('serial:error', msg => toast('串口错误：' + msg));
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    settings = await comet.getSettings();
    filters = { ...filters, ...(settings.filters || {}) };
    opts = { ...opts, ...(settings.sendOpts || {}) };
    autoScroll = settings.autoScroll;
    showTs = settings.showTs;
    devices = settings.devices || [];
    quickCmds = settings.quickCommands || [];

    // 从配置还原 UI 状态
    applyTheme(settings.theme, false);
    applyFont(settings.font, settings.fontSize, false);
    setFontFold(settings.fontCollapsed, false);
    setNav(settings.navHidden || window.innerWidth <= 1320, true);
    setInsp(settings.inspHidden || window.innerWidth <= 1320, true);
    setSend(settings.sendHidden, true);
    $('#tsChip').classList.toggle('on', showTs);
    $('#scrollChip').classList.toggle('on', autoScroll);
    $$('.chip[data-filter]').forEach(c => c.classList.toggle('on', !!filters[c.dataset.filter]));
    $$('.opt').forEach(o => o.classList.toggle('on', !!opts[o.dataset.opt]));
    const baudSel = $$('.settings-body .sel select')[1];
    if (baudSel) baudSel.value = String(settings.serial.baudRate);

    // 清掉原型里的静态演示数据，界面从真实后端的干净状态开始
    $$('#log .ln').forEach(l => l.remove());
    renderHex([]);
    $('#mRx').innerHTML = '0<small>B</small>';
    $('#mTx').innerHTML = '0<small>B</small>';
    $('#sbRx').textContent = '0';
    $('#sbTx').textContent = '0';
    $('#mTime').textContent = '00:00';
    const metricVals = $$('.metrics .v');
    if (metricVals[2]) metricVals[2].innerHTML = '0.0<small>KB/s</small>';
    if ($('.fc-hex')) $('.fc-hex').textContent = '等待数据帧…';
    if ($('.fc-name')) $('.fc-name').textContent = 'F200 · 等待帧';
    if ($('.fc-foot')) $('.fc-foot').textContent = '—';
    if ($('.fc-ok')) { $('.fc-ok').textContent = '—'; $('.fc-ok').style.color = 'var(--t3)'; }

    renderThemes();
    renderDevices();
    renderQuick();
    bindUI();
    subscribe();

    ports = await comet.listPorts();
    // 首次运行用真实枚举到的端口生成设备列表，不再内置虚构设备
    if (!devices.length && ports.length) {
      devices = ports.map((p, i) => ({
        id: 'dev-' + (i + 1),
        name: p.friendlyName || p.manufacturer || p.path,
        port: p.path,
        baudRate: settings.serial.baudRate,
        chip: p.manufacturer || 'UNKNOWN',
        tag: p.vendorId ? 'USB' : '串口',
        parity: 'None',
        online: true
      }));
      await comet.saveDevices(devices);
      renderDevices();
    }
    renderPorts();

    // 两个初始标签各绑定独立会话
    sessionId = await comet.getActiveSession();
    const tabs = $$('#tabs .tab');
    if (tabs[0]) tabs[0].dataset.session = sessionId;
    if (tabs[1]) {
      const sid2 = await comet.newSession('F200 传感器');
      tabs[1].dataset.session = sid2;
    }

    applyStatus(await comet.getStatus());
    const savedPath = $('#fPort').value;
    if (settings.autoConnect && ports.some(p => p.path === savedPath)) {
      const s = await comet.connect(readConfig());
      applyStatus(s);
      if (s.error) toast('连接失败：' + s.error + ' · 请在连接设置中选端口');
    } else if (settings.autoConnect) {
      toast('未发现端口 ' + savedPath + '，请选择串口后连接');
      addLine('sys', '等待端口：' + savedPath + ' 未在系统中发现，请在连接设置中选择可用端口');
    }
    window.__cometBootDone = true;
  }

  boot().catch(err => {
    window.__cometBootError = err.message;
    toast('初始化失败：' + err.message);
    console.error('[comet] boot error', err);
  });
})();
