/**
 * Electron 主进程入口
 * 串口数据流全部在此进程；renderer 只通过 preload 白名单 API 通信。
 * 正式桌面应用只使用真实串口；测试夹具不参与运行时。
 */
import { app, BrowserWindow, Menu } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FrameParser } from './FrameParser';
import { SerialService } from './SerialService';
import { SessionStore } from './SessionStore';
import { SettingsStore } from './SettingsStore';
import { registerIpc, pushPorts, type Backend } from './ipc';

let win: BrowserWindow | null = null;
let backend: Backend | null = null;
const SMOKE = process.env.COMET_SMOKE === '1';
let smokeErrors = 0;

// 仅冒烟模式：把 renderer 控制台与 boot 状态写到临时文件，便于无窗口排查
const DIAG = SMOKE ? path.join(os.tmpdir(), 'comet-smoke-diag.txt') : '';
function diag(line: string): void {
  if (!DIAG) return;
  try { fs.appendFileSync(DIAG, line + '\n'); } catch { /* ignore */ }
}
if (DIAG) {
  try { fs.writeFileSync(DIAG, ''); } catch { /* ignore */ }
}

// 串口工具多开会抢同一个 COM 口，必须单实例。
// 但冒烟测试需与用户已打开的实例并存，故 SMOKE 模式跳过锁申请。
const singleInstance = SMOKE || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function createWindow(): void {
  win = new BrowserWindow({
    width: 1460,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0B0E1A',
    title: 'Comet 串口工作台',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (!SMOKE) win.once('ready-to-show', () => win?.show());
  win.webContents.on('did-finish-load', () => {
    diag('[did-finish-load]');
    if (backend) pushPorts(backend);
  });
  win.webContents.on('console-message', (_e, level, message) => {
    diag('[console L' + level + '] ' + message);
    // Electron 开发期的 CSP 提示不属于运行时错误，打包后不会出现
    if (level >= 2 && !message.includes('Insecure Content-Security-Policy')) {
      smokeErrors++;
      console.error('[renderer console]', message);
    }
  });
  win.webContents.on('render-process-gone', () => {
    diag('[render-process-gone]');
    smokeErrors++;
    console.error('[smoke] 渲染进程异常退出');
  });
  if (process.env.COMET_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => {
    win = null;
    if (backend) backend.win = null;
  });
}

app.whenReady().then(() => {
  if (!singleInstance) return;
  Menu.setApplicationMenu(null); // 无边框窗口不挂原生菜单
  diag('[app-ready]');

  const settings = new SettingsStore();
  const sessions = new SessionStore();
  const serial = new SerialService();

  backend = {
    serial,
    sessions,
    settings,
    frames: new FrameParser(() => undefined), // registerIpc 里会替换成真正的回调
    win: null,
    activeSessionId: sessions.list()[0].id
  };

  registerIpc(backend);
  createWindow();
  if (backend) backend.win = win;
  diag('[ipc-registered]');

  if (SMOKE) {
    // 无窗口冒烟测试：等 renderer 跑完 boot 后检查状态并退出
    setTimeout(async () => {
      let bootDone = false;
      let bootError = '';
      let step = '';
      try {
        const r = await win?.webContents.executeJavaScript(
          'JSON.stringify({done: window.__cometBootDone === true, err: String(window.__cometBootError || ""), comet: typeof window.comet, lines: document.querySelectorAll("#log .ln").length, conn: (function(){var b=document.getElementById("quickConn"); return b ? b.className + "|" + b.textContent.trim() : "missing";})(), settingsBtn: !!document.getElementById("openSettings"), hint: String((document.getElementById("cursorHint")||{}).textContent || "")})'
        );
        diag('[executeJavaScript] ' + r);
        const parsed = JSON.parse(r as string);
        bootDone = parsed.done;
        bootError = parsed.err;
        step = parsed.step;
      } catch (err) {
        bootError = (err as Error).message;
        diag('[executeJavaScript-error] ' + bootError);
      }
      if (!bootDone) {
        smokeErrors++;
        console.error('[smoke] renderer boot 未完成: ' + bootError + ' step=' + step);
      }
      diag('[result] bootDone=' + bootDone + ' consoleErrors=' + smokeErrors + ' step=' + step);
      console.log('[smoke] bootDone=' + bootDone + ' consoleErrors=' + smokeErrors);
      app.exit(smokeErrors > 0 || !bootDone ? 1 : 0);
    }, 12000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (!backend) return;
  try {
    await backend.serial.disconnect();
  } catch {
    // 退出时忽略
  }
});
