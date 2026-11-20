/**
 * Electron 主进程入口
 * 串口数据流全部在此进程；renderer 只通过 preload 白名单 API 通信。
 */
import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'node:path';
import { FrameParser } from './FrameParser';
import { SerialService } from './SerialService';
import { MockSerial } from './MockSerial';
import { SessionStore } from './SessionStore';
import { SettingsStore } from './SettingsStore';
import { registerIpc, pushPorts, type Backend } from './ipc';
import { ALLOW_MOCK } from '../shared/config';

let win: BrowserWindow | null = null;
let backend: Backend | null = null;
const SMOKE = process.env.COMET_SMOKE === '1';
let smokeErrors = 0;

// 串口工具多开会抢同一个 COM 口，必须单实例
const singleInstance = app.requestSingleInstanceLock();
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
    if (backend) pushPorts(backend);
  });
  win.webContents.on('console-message', (_e, level, message) => {
    // Electron 开发期的 CSP 提示不属于运行时错误，打包后不会出现
    if (level >= 2 && !message.includes('Insecure Content-Security-Policy')) {
      smokeErrors++;
      console.error('[renderer console]', message);
    }
  });
  win.webContents.on('render-process-gone', () => {
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

  const settings = new SettingsStore();
  const sessions = new SessionStore();
  const serial = new SerialService();
  const mock = new MockSerial();
  const cfg = settings.get();
  // 正式构建永远走真实串口；Mock 只作为 COMET_SMOKE 测试夹具
  const allowMock = ALLOW_MOCK || SMOKE;

  backend = {
    serial,
    mock,
    sessions,
    settings,
    frames: new FrameParser(() => undefined), // registerIpc 里会替换成真正的回调
    win: null,
    activeSessionId: sessions.list()[0].id,
    useMock: allowMock && (SMOKE || cfg.mockEnabled),
    allowMock
  };

  registerIpc(backend);
  createWindow();
  if (backend) backend.win = win;

  if (SMOKE) {
    // 无窗口冒烟测试：等 renderer 跑完 boot 后检查状态并退出
    setTimeout(async () => {
      let bootDone = false;
      let bootError = '';
      try {
        const r = await win?.webContents.executeJavaScript(
          'JSON.stringify({done: window.__cometBootDone === true, err: window.__cometBootError || ""})'
        );
        const parsed = JSON.parse(r as string);
        bootDone = parsed.done;
        bootError = parsed.err;
      } catch (err) {
        bootError = (err as Error).message;
      }
      if (!bootDone) {
        smokeErrors++;
        console.error('[smoke] renderer boot 未完成: ' + bootError);
      }
      console.log('[smoke] bootDone=' + bootDone + ' consoleErrors=' + smokeErrors);
      app.exit(smokeErrors > 0 || !bootDone ? 1 : 0);
    }, 6000);
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
    await backend.mock.disconnect();
  } catch {
    // 退出时忽略
  }
});
