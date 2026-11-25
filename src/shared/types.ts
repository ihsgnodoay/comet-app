/**
 * IPC 契约：main / preload / renderer 三方共享的唯一真相来源。
 * 所有跨进程数据都在这里定义，禁止在 renderer 里直接 require('serialport')。
 */

export type LogDirection = 'rx' | 'tx' | 'sys' | 'warn' | 'err';

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
  locationId?: string;
  friendlyName?: string;
  isMock?: boolean;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: 'none' | 'odd' | 'even' | 'mark' | 'space';
  flowControl: 'none' | 'rtscts' | 'xonxoff';
  dtr: boolean;
  rts: boolean;
}

export interface ModemSignals {
  dtr: boolean;
  rts: boolean;
  dsr: boolean;
  cts: boolean;
  dcd: boolean;
}

export interface ConnectionStatus {
  connected: boolean;
  config: SerialConfig | null;
  mock: boolean;
  error?: string;
  openedAt?: number;
  path?: string;
}

export interface LogLine {
  id: number;
  ts: string;
  dir: LogDirection;
  text: string;
  sessionId: string;
  bytes: number;
}

export interface FrameResult {
  raw: string;
  type: number;
  typeName: string;
  seq: number;
  payload: number[];
  crcOk: boolean;
  length: number;
  ts: string;
  fields: Record<string, string | number>;
}

export interface SessionStats {
  sessionId: string;
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  uptimeMs: number;
  frameCount: number;
  frameErrors: number;
  lineCount: number;
  throughput: { rx: number[]; tx: number[] };
}

export interface DeviceRecord {
  id: string;
  name: string;
  port: string;
  baudRate: number;
  chip: string;
  tag: string;
  parity: string;
  online: boolean;
}

export interface QuickCommand {
  id: string;
  label: string;
  cmd: string;
}

export interface Settings {
  theme: string;
  font: string;
  fontSize: number;
  fontCollapsed: boolean;
  navHidden: boolean;
  inspHidden: boolean;
  sendHidden: boolean;
  showTs: boolean;
  autoScroll: boolean;
  filters: { rx: boolean; tx: boolean; sys: boolean };
  sendOpts: { hex: boolean; crlf: boolean; timer: boolean; echo: boolean };
  timerIntervalMs: number;
  serial: SerialConfig;
  devices: DeviceRecord[];
  quickCommands: QuickCommand[];
  mockEnabled: boolean;
  autoConnect: boolean;
  configVersion: number;
}

export interface SendPayload {
  sessionId: string;
  text: string;
  hex: boolean;
  crlf: boolean;
  echo: boolean;
}

export interface SendResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export type EventChannel =
  | 'serial:data'
  | 'serial:line'
  | 'serial:status'
  | 'serial:ports'
  | 'serial:frame'
  | 'serial:stats'
  | 'serial:modem'
  | 'serial:error';

/** contextBridge 暴露给 renderer 的白名单 API */
export interface CometAPI {
  listPorts(): Promise<PortInfo[]>;
  connect(config: SerialConfig): Promise<ConnectionStatus>;
  disconnect(): Promise<ConnectionStatus>;
  getStatus(): Promise<ConnectionStatus>;
  send(payload: SendPayload): Promise<SendResult>;
  setSignals(signals: { dtr?: boolean; rts?: boolean }): Promise<ModemSignals>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getDevices(): Promise<DeviceRecord[]>;
  saveDevices(devices: DeviceRecord[]): Promise<DeviceRecord[]>;
  exportLog(text: string, suggestedName: string): Promise<ExportResult>;
  copyText(text: string): Promise<boolean>;
  getSessionLog(sessionId: string): Promise<LogLine[]>;
  clearSession(sessionId: string): Promise<void>;
  newSession(name: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  getActiveSession(): Promise<string>;
  setActiveSession(sessionId: string): Promise<void>;
  win: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
  on(channel: EventChannel, callback: (payload: unknown) => void): () => void;
}

/* ---------------- 默认值 ---------------- */

export const DEFAULT_SERIAL: SerialConfig = {
  path: 'COM3',
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
  dtr: true,
  rts: false
};

export const DEFAULT_QUICK: QuickCommand[] = [
  { id: 'q1', label: '查询版本', cmd: 'AT+VER?' },
  { id: 'q2', label: 'flicker 检测', cmd: 'AT+FLCK?' },
  { id: 'q3', label: 'VCOM 校准', cmd: 'AT+VCAL=SET,0x1A4' },
  { id: 'q4', label: '内存 dump', cmd: 'AT+DUMP=0x20000000,64' },
  { id: 'q5', label: '复位', cmd: 'AT+RST' }
];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'comet-dark',
  font: 'jetbrains',
  fontSize: 12,
  fontCollapsed: false,
  navHidden: false,
  inspHidden: false,
  sendHidden: false,
  showTs: true,
  autoScroll: true,
  filters: { rx: true, tx: true, sys: true },
  sendOpts: { hex: false, crlf: true, timer: false, echo: false },
  timerIntervalMs: 1000,
  serial: DEFAULT_SERIAL,
  devices: [],
  quickCommands: DEFAULT_QUICK,
  mockEnabled: false,
  // 历史字段：现在启动恒为零会话、不自动连接，renderer 不再读取
  autoConnect: false,
  configVersion: 2
};
