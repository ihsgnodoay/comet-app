/**
 * 生成一个「接入后端后」的静态预览页：注入 mock window.comet，
 * 让 renderer/app.js 在普通 Chrome 里也能跑完 boot 并渲染真实事件数据。
 * 仅用于视觉验证，不参与构建。
 */
const fs = require('node:fs');
// 预览专用：移除 CSP（内联 mock 脚本需要），产品构建里的 CSP 保持不变
const html = fs.readFileSync('D:/Agent/WorkBuddy/comet-app/out/renderer/index.html', 'utf8')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');

const mock = `<script>
(function () {
  const S = {
    theme:'comet-dark', font:'jetbrains', fontSize:12, fontCollapsed:false,
    navHidden:false, inspHidden:false, sendHidden:false, showTs:true, autoScroll:true,
    filters:{rx:true,tx:true,sys:true}, sendOpts:{hex:false,crlf:true,timer:false,echo:false},
    timerIntervalMs:1000, mockEnabled:true, autoConnect:true,
    serial:{path:'COM3',baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',dtr:true,rts:false},
    devices:[
      {id:'dev-1',name:'RT1052 调试板',port:'COM3',baudRate:115200,chip:'MIMXRT1052',tag:'UART6',parity:'None',online:true},
      {id:'dev-2',name:'F200 传感器',port:'COM7',baudRate:9600,chip:'F200-CTRL',tag:'RS485',parity:'None',online:true},
      {id:'dev-3',name:'VCOM 校准台',port:'COM12',baudRate:115200,chip:'VCOM-CAL',tag:'USB',parity:'Even',online:true},
      {id:'dev-4',name:'USB-UART 适配器',port:'COM5',baudRate:115200,chip:'CH340',tag:'离线',parity:'None',online:false}
    ],
    quickCommands:[
      {id:'q1',label:'查询版本',cmd:'AT+VER?'},
      {id:'q2',label:'flicker 检测',cmd:'AT+FLCK?'},
      {id:'q3',label:'VCOM 校准',cmd:'AT+VCAL=SET,0x1A4'},
      {id:'q4',label:'内存 dump',cmd:'AT+DUMP=0x20000000,64'},
      {id:'q5',label:'复位',cmd:'AT+RST'}
    ]
  };
  const cbs = {};
  const t = n => String(n).padStart(2,'0');
  const stamp = (ms) => { const d=new Date(Date.now()-(ms||0)); return t(d.getHours())+':'+t(d.getMinutes())+':'+t(d.getSeconds())+'.'+String(d.getMilliseconds()).padStart(3,'0'); };
  const line = (dir,text,ago) => ({id:Math.random(),ts:stamp(ago),dir,text,sessionId:'s1',bytes:text.length});
  const api = {
    on(ch,cb){ (cbs[ch]=cbs[ch]||[]).push(cb); return ()=>{}; },
    getSettings:async()=>S, setSettings:async(p)=>Object.assign(S,p),
    getDevices:async()=>S.devices, saveDevices:async(d)=>{S.devices=d;return d;},
    listPorts:async()=>[
      {path:'COM3',manufacturer:'NXP',vendorId:'1FC9',productId:'0130',friendlyName:'RT1052 调试板',isMock:false},
      {path:'COM7',manufacturer:'F200',vendorId:'0483',productId:'5740',isMock:true},
      {path:'COM12',manufacturer:'VCOM-CAL',isMock:true},
      {path:'COM5',manufacturer:'QinHeng',vendorId:'1A86',productId:'7523',isMock:true}
    ],
    connect:async()=>({connected:true,config:S.serial,mock:true,path:'COM3'}),
    disconnect:async()=>({connected:false,config:null,mock:true}),
    getStatus:async()=>({connected:true,config:S.serial,mock:true,path:'COM3'}),
    send:async()=>({ok:true,bytes:9}),
    setSignals:async(s)=>({dtr:s.dtr??true,rts:s.rts??false,dsr:true,cts:true,dcd:false}),
    setMock:async()=>({connected:true,config:S.serial,mock:true}),
    injectMock:async()=>{}, exportLog:async()=>({ok:true,path:'C:/temp/comet.log'}),
    copyText:async()=>true, getSessionLog:async()=>[], clearSession:async()=>{},
    newSession:async()=>'s2', closeSession:async()=>{}, getActiveSession:async()=>'s1',
    setActiveSession:async()=>{},
    win:{minimize:async()=>{},maximize:async()=>{},close:async()=>{}}
  };
  window.comet = api;
  const emit=(ch,p)=>(cbs[ch]||[]).forEach(f=>f(p));
  setTimeout(()=>{
    emit('serial:status',{connected:true,config:S.serial,mock:true,path:'COM3'});
    emit('serial:ports',[
      {path:'COM3',manufacturer:'NXP',vendorId:'1FC9',productId:'0130',isMock:false},
      {path:'COM7',manufacturer:'F200',vendorId:'0483',productId:'5740',isMock:true},
      {path:'COM12',manufacturer:'VCOM-CAL',isMock:true},
      {path:'COM5',manufacturer:'QinHeng',vendorId:'1A86',productId:'7523',isMock:true}
    ]);
    emit('serial:modem',{dtr:true,rts:false,dsr:true,cts:true,dcd:false});
    emit('serial:line',line('sys','已连接 COM3 · 115200 8N1 · DTR=ON RTS=OFF · 虚拟串口',9000));
    emit('serial:line',line('tx','AT+VER?\\\\r\\\\n',8600));
    emit('serial:line',line('rx','+VER: F200-CTRL v2.4.1 build 20261103',8400));
    emit('serial:line',line('rx','OK',8380));
    emit('serial:line',line('tx','AT+FLCK?\\\\r\\\\n',7000));
    emit('serial:line',line('rx','+FLCK: 0, 120Hz, duty=48.2%, ppm=+12',6800));
    emit('serial:line',line('sys','F200 状态帧 · CRC OK · seq=16 · len=9 · AA 55 03 10 2C 01 7F 3C FA',4000));
    emit('serial:line',line('rx','+VCAL: vcom=4.20V, offset=-3mV',2200));
    emit('serial:line',line('warn','UART6 RX idle > 500ms · buffer=0 · 检查线序',1200));
    emit('serial:frame',{raw:'AA 55 03 10 2C 01 7F 3C FA',type:3,typeName:'状态帧',seq:16,payload:[44,1,127,60],crcOk:true,length:9,ts:stamp(4000),fields:{}});
    emit('serial:stats',{sessionId:'s1',rxBytes:4286,txBytes:184,rxRate:2412,txRate:96,uptimeMs:154000,frameCount:7,frameErrors:0,lineCount:12,
      throughput:{rx:[10,14,22,18,26,30,24,34,28,40,36,44,38,48,42,52,46,56,50,60].concat(new Array(40).fill(0)),
                  tx:[4,6,4,8,6,10,8,12,10,14,12,16,14,18,16,20,18,22,20,24].concat(new Array(40).fill(0))}});
    emit('serial:data',{sessionId:'s1',rows:[
      {offset:'0000',bytes:'AA 55 03 10 2C 01 7F 3C FA 41 54 2B 56 45 52',ascii:'.....,....AT+VER'},
      {offset:'0010',bytes:'3F 0D 0A 2B 56 45 52 3A 20 46 32 30 30 2D 43',ascii:'?..+VER: F200-C'},
      {offset:'0020',bytes:'54 52 4C 20 76 32 2E 34 2E 31 20 62 75 69 6C',ascii:'TRL v2.4.1 buil'}
    ]});
  }, 1500);
})();
</script>`;

const noAnim = '<style>*{animation:none!important;transition:none!important}</style>';
const out = html.replace('</head>', noAnim + mock + '\n</head>');
const TMP = 'C:/Users/syd/AppData/Local/Temp/';
fs.writeFileSync(TMP + 'preview-backend.html', out, 'utf8');
// HTML 用相对路径 ./app.js 引用脚本，必须把 app.js 放到同一目录
fs.copyFileSync('D:/Agent/WorkBuddy/comet-app/out/renderer/app.js', TMP + 'app.js');
console.log('ok', out.length);
