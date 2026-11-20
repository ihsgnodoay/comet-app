/**
 * IPC 中枢：把 renderer 的白名单调用映射到真实串口 / 会话 / 配置。
 * 这里是「UI 每个功能」的后端实现，所有事件都从主进程单向推送给渲染层。
 * 正式构建不含任何虚拟串口通道；MockSerial 仅作为 COMET_SMOKE 测试夹具在主进程内使用。
 */
import { clipboard, dialog, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FrameParser } from './FrameParser';
import { SerialService } from './SerialService';
import { MockSerial } from './MockSerial';
import { SessionStore } from './SessionStore';
import { SettingsStore } from './SettingsStore';
import type {
  ConnectionStatus,
  LogLine,
  PortInfo,
  SendPayload,
  SerialConfig
} from '../shared/types';

export interface Backend {
  serial: SerialService;
  mock: MockSerial;
  sessions: SessionStore;
  settings: SettingsStore;
  frames: FrameParser;
  win: BrowserWindow | null;
  activeSessionId: string;
  useMock: boolean;
  /** 是否允许运行时切换到虚拟串口（正式构建为 false，仅冒烟测试为 true） */
  allowMock: boolean;
}

function emit<T>(b: Backend, channel: string, payload: T): void {
  if (b.win && !b.win.isDestroyed()) b.win.webContents.send(channel, payload);
}

function emitLine(b: Backend, line: LogLine): void {
  emit(b, 'serial:line', line);
}

function driver(b: Backend): SerialService | MockSerial {
  return b.useMock ? b.mock : b.serial;
}

function combinedStatus(b: Backend): ConnectionStatus {
  const s = driver(b).status();
  return { ...s, mock: b.useMock };
}

function encodePayload(text: string, hex: boolean, crlf: boolean): Buffer {
  if (hex) {
    const cleaned = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    if (!cleaned) throw new Error('HEX 内容为空');
    if (cleaned.length % 2 !== 0) throw new Error('HEX 数据长度必须为偶数');
    const body = Buffer.from(cleaned, 'hex');
    return crlf ? Buffer.concat([body, Buffer.from([0x0d, 0x0a])]) : body;
  }
  return Buffer.from(text + (crlf ? '\r\n' : ''), 'utf8');
}

/** 把一段 RX 字节流分发到：文本日志 / HEX / 帧解析 / 统计 */
function handleData(b: Backend, chunk: Buffer): void {
  const id = b.activeSessionId;
  const lines = b.sessions.pushRx(id, chunk);
  for (const line of lines) emitLine(b, line);
  b.frames.push(chunk);
  // 节流推送 HEX，避免高频串口把 IPC 打满
  scheduleHex(b);
}

let hexTimer: NodeJS.Timeout | null = null;
function scheduleHex(b: Backend): void {
  if (hexTimer) return;
  hexTimer = setTimeout(() => {
    hexTimer = null;
    emit(b, 'serial:data', {
      sessionId: b.activeSessionId,
      rows: b.sessions.hexRows(b.activeSessionId, 64)
    });
  }, 120);
}

async function allPorts(b: Backend): Promise<PortInfo[]> {
  let real: PortInfo[] = [];
  try {
    real = await b.serial.listPorts();
  } catch {
    // 原生模块未就绪时返回空列表，不阻断 UI
  }
  // 正式应用只列真实端口，绝不混入虚拟 COM 口
  if (!b.allowMock) return real;
  const virtual = await b.mock.listPorts();
  const seen = new Set(real.map(p => p.path));
  return [...real, ...virtual.filter(p => !seen.has(p.path))];
}

export function pushPorts(b: Backend): void {
  allPorts(b).then(list => emit(b, 'serial:ports', list)).catch(() => undefined);
}

export function registerIpc(b: Backend): void {
  /* ---------- 串口 ---------- */

  ipcMain.handle('serial:list', (): Promise<PortInfo[]> => allPorts(b));

  ipcMain.handle('serial:connect', async (_e, config: SerialConfig): Promise<ConnectionStatus> => {
    const d = driver(b);
    try {
      await d.connect(config);
      b.settings.set({ serial: config });
      const line = b.sessions.addLine(
        b.activeSessionId,
        'sys',
        `已连接 ${config.path} · ${config.baudRate} ${config.dataBits}${config.parity[0].toUpperCase()}${config.stopBits} · DTR=${config.dtr ? 'ON' : 'OFF'} RTS=${config.rts ? 'ON' : 'OFF'}${b.useMock ? ' · 虚拟串口' : ''}`
      );
      emitLine(b, line);
      emit(b, 'serial:ports', await allPorts(b));
      emit(b, 'serial:status', combinedStatus(b));
      return combinedStatus(b);
    } catch (err) {
      const msg = (err as Error).message;
      emit(b, 'serial:error', msg);
      emitLine(b, b.sessions.addLine(b.activeSessionId, 'err', '连接失败：' + msg));
      return { ...combinedStatus(b), error: msg };
    }
  });

  ipcMain.handle('serial:disconnect', async (): Promise<ConnectionStatus> => {
    await driver(b).disconnect();
    emitLine(b, b.sessions.addLine(b.activeSessionId, 'sys', '已断开端口'));
    const s = combinedStatus(b);
    emit(b, 'serial:status', s);
    return s;
  });

  ipcMain.handle('serial:status', (): ConnectionStatus => combinedStatus(b));

  ipcMain.handle('serial:send', async (_e, payload: SendPayload) => {
    const d = driver(b);
    if (!d.isOpen) return { ok: false, bytes: 0, error: '端口未连接' };
    try {
      const buf = encodePayload(payload.text, payload.hex, payload.crlf);
      await d.write(buf);
      b.sessions.pushTx(payload.sessionId || b.activeSessionId, buf.length);
      const display = payload.hex
        ? buf.toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1 ')
        : payload.text + (payload.crlf ? '\\r\\n' : '');
      emitLine(b, b.sessions.addLine(payload.sessionId || b.activeSessionId, 'tx', display, buf.length));
      if (payload.echo) {
        emitLine(b, b.sessions.addLine(payload.sessionId || b.activeSessionId, 'rx', '[ECHO] ' + payload.text, 0));
      }
      return { ok: true, bytes: buf.length };
    } catch (err) {
      const msg = (err as Error).message;
      emit(b, 'serial:error', msg);
      return { ok: false, bytes: 0, error: msg };
    }
  });

  ipcMain.handle('serial:signals', async (_e, next: { dtr?: boolean; rts?: boolean }) => {
    const signals = await driver(b).setSignals(next);
    emit(b, 'serial:modem', signals);
    return signals;
  });

  /* ---------- 配置 ---------- */

  ipcMain.handle('settings:get', () => b.settings.get());
  ipcMain.handle('settings:set', (_e, patch) => b.settings.set(patch));
  ipcMain.handle('devices:list', () => b.settings.get().devices);
  ipcMain.handle('devices:save', (_e, devices) => {
    b.settings.set({ devices });
    return b.settings.get().devices;
  });

  /* ---------- 会话 ---------- */

  ipcMain.handle('session:new', (_e, name: string) => b.sessions.create(name));
  ipcMain.handle('session:close', (_e, id: string) => b.sessions.remove(id));
  ipcMain.handle('session:active', () => b.activeSessionId);
  ipcMain.handle('session:activate', (_e, id: string) => {
    b.activeSessionId = id;
    b.frames.reset();
    emit(b, 'serial:stats', b.sessions.stats(id));
    emit(b, 'serial:data', { sessionId: id, rows: b.sessions.hexRows(id, 64) });
  });
  ipcMain.handle('session:log', (_e, id: string) => b.sessions.lines(id));
  ipcMain.handle('session:clear', (_e, id: string) => {
    b.sessions.clear(id);
    b.frames.reset();
  });

  /* ---------- 文件 / 剪贴板 / 窗口 ---------- */

  ipcMain.handle('log:export', async (_e, arg: { text: string; suggestedName: string }) => {
    if (!b.win) return { ok: false, error: '窗口未就绪' };
    const result = await dialog.showSaveDialog(b.win, {
      title: '导出日志',
      defaultPath: path.join(os.homedir(), 'Downloads', arg.suggestedName || 'comet.log'),
      filters: [
        { name: '日志文件', extensions: ['log', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(result.filePath, arg.text, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('win:minimize', () => b.win?.minimize());
  ipcMain.handle('win:maximize', () => {
    if (!b.win) return;
    if (b.win.isMaximized()) b.win.unmaximize();
    else b.win.maximize();
  });
  ipcMain.handle('win:close', () => b.win?.close());

  /* ---------- 事件绑定 ---------- */

  const onData = (chunk: Buffer) => handleData(b, chunk);
  b.serial.on('data', onData);
  b.mock.on('data', onData);

  for (const d of [b.serial, b.mock]) {
    d.on('status', () => emit(b, 'serial:status', combinedStatus(b)));
    d.on('modem', signals => emit(b, 'serial:modem', signals));
    d.on('error', msg => {
      emit(b, 'serial:error', msg);
      emitLine(b, b.sessions.addLine(b.activeSessionId, 'err', '串口错误：' + msg));
    });
  }

  b.frames = new FrameParser(frame => {
    b.sessions.noteFrame(b.activeSessionId, frame.crcOk);
    emit(b, 'serial:frame', frame);
    const summary = `F200 ${frame.typeName} · CRC ${frame.crcOk ? 'OK' : 'FAIL'} · seq=${frame.seq} · len=${frame.length} · ${frame.raw}`;
    emitLine(b, b.sessions.addLine(b.activeSessionId, frame.crcOk ? 'sys' : 'warn', summary));
  });

  // 每秒推送统计（字节数、速率、吞吐、运行时长、帧计数）
  setInterval(() => {
    b.sessions.tick();
    emit(b, 'serial:stats', b.sessions.stats(b.activeSessionId));
  }, 1000);
}
