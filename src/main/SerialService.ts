/**
 * 真实串口服务（主进程，直连 OS）
 *
 * 设计要点：
 *  - serialport 是原生模块，这里**延迟 require**，即使 .node 未 rebuild 成功，
 *    Electron 也能正常启动并降级到 Mock 模式，而不是整个进程崩掉。
 *  - 所有 OS 侧操作都在此文件，renderer 完全拿不到 Node 权限。
 */
import { EventEmitter } from 'node:events';
import type * as SP from 'serialport';
import type {
  ConnectionStatus,
  ModemSignals,
  PortInfo,
  SerialConfig
} from '../shared/types';

let cached: typeof SP | null = null;
function sp(): typeof SP {
  if (!cached) cached = require('serialport') as typeof SP;
  return cached;
}

const INITIAL_SIGNALS: ModemSignals = { dtr: false, rts: false, dsr: false, cts: false, dcd: false };

export class SerialService extends EventEmitter {
  private port: SP.SerialPort | null = null;
  private cfg: SerialConfig | null = null;
  private openedAt = 0;
  private signals: ModemSignals = { ...INITIAL_SIGNALS };
  private lastError = '';

  /** 枚举系统串口 */
  async listPorts(): Promise<PortInfo[]> {
    try {
      const list = await sp().SerialPort.list();
      return list.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        vendorId: p.vendorId,
        productId: p.productId,
        pnpId: p.pnpId,
        locationId: p.locationId,
        friendlyName: (p as { friendlyName?: string }).friendlyName || p.manufacturer || p.path
      }));
    } catch (err) {
      this.lastError = (err as Error).message;
      this.emit('error', this.lastError);
      return [];
    }
  }

  /** 打开端口（带 3s 超时，避免驱动无响应时界面卡死） */
  async connect(cfg: SerialConfig): Promise<ConnectionStatus> {
    await this.disconnect();
    const S = sp();
    const flow = cfg.flowControl;
    const options = {
      path: cfg.path,
      baudRate: cfg.baudRate,
      dataBits: cfg.dataBits,
      stopBits: cfg.stopBits,
      parity: cfg.parity,
      rtscts: flow === 'rtscts',
      xon: flow === 'xonxoff',
      xoff: flow === 'xonxoff',
      autoOpen: false
    };

    return new Promise<ConnectionStatus>((resolve, reject) => {
      let port: SP.SerialPort;
      try {
        // SerialPortOpenOptions 泛型较严，用 as 断言交给底层校验
        port = new S.SerialPort(options as ConstructorParameters<typeof S.SerialPort>[0]);
      } catch (err) {
        this.lastError = (err as Error).message;
        reject(err);
        return;
      }
      this.port = port;

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastError = `打开 ${cfg.path} 超时（3s）`;
        if (this.port === port) this.port = null;
        try { port.close(() => undefined); } catch { /* ignore */ }
        reject(new Error(this.lastError));
      }, 3000);

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      port.on('data', (chunk: Buffer) => this.emit('data', chunk));
      port.on('error', err => {
        this.lastError = err.message;
        this.emit('error', err.message);
      });
      port.on('close', () => {
        if (this.port === port) this.port = null;
        this.cfg = null;
        this.emit('status', this.status());
      });

      port.open(err => {
        if (err) {
          this.lastError = err.message;
          if (this.port === port) this.port = null;
          finish(() => reject(err));
          return;
        }
        this.cfg = cfg;
        this.openedAt = Date.now();
        this.signals = { ...INITIAL_SIGNALS, dtr: cfg.dtr, rts: cfg.rts };
        port.set({ dtr: cfg.dtr, rts: cfg.rts }, () => {
          this.emit('modem', this.signals);
        });
        this.emit('status', this.status());
        finish(() => resolve(this.status()));
      });
    });
  }

  /** 关闭端口 */
  async disconnect(): Promise<ConnectionStatus> {
    const port = this.port;
    this.port = null;
    this.cfg = null;
    if (port && port.isOpen) {
      await new Promise<void>(resolve => {
        port.close(() => resolve());
      });
    }
    this.openedAt = 0;
    const s = this.status();
    this.emit('status', s);
    return s;
  }

  /** 写数据，返回实际写入字节数 */
  async write(data: Buffer): Promise<number> {
    const port = this.port;
    if (!port || !port.isOpen) throw new Error('端口未打开');
    return new Promise<number>((resolve, reject) => {
      port.write(data, err => (err ? reject(err) : resolve(data.length)));
    });
  }

  /** 设置 DTR / RTS，并读回 modem 状态 */
  async setSignals(next: { dtr?: boolean; rts?: boolean }): Promise<ModemSignals> {
    if (next.dtr !== undefined) this.signals.dtr = next.dtr;
    if (next.rts !== undefined) this.signals.rts = next.rts;
    const port = this.port;
    if (port && port.isOpen) {
      await new Promise<void>((resolve, reject) => {
        port.set({ dtr: this.signals.dtr, rts: this.signals.rts }, err => (err ? reject(err) : resolve()));
      });
      await this.readModem();
    }
    this.emit('modem', this.signals);
    return { ...this.signals };
  }

  /** 读取 DSR / CTS / DCD */
  async readModem(): Promise<ModemSignals> {
    const port = this.port;
    if (port && port.isOpen) {
      await new Promise<void>(resolve => {
        port.get((err, status) => {
          if (!err && status) {
            this.signals.cts = !!status.cts;
            this.signals.dsr = !!status.dsr;
            this.signals.dcd = !!status.dcd;
          }
          resolve();
        });
      });
    }
    this.emit('modem', this.signals);
    return { ...this.signals };
  }

  status(error?: string): ConnectionStatus {
    const connected = !!this.port && this.port.isOpen;
    return {
      connected,
      config: connected ? this.cfg : null,
      mock: false,
      openedAt: this.openedAt || undefined,
      path: this.cfg?.path,
      error: error || (connected ? undefined : this.lastError || undefined)
    };
  }

  get isOpen(): boolean {
    return !!this.port && this.port.isOpen;
  }
}
