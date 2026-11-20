/**
 * 虚拟串口（无硬件回环）
 *
 * 与 SerialService 对外行为一致：字节流从 'data' 事件出来，
 * 因此帧解析、统计、HEX、日志等下游逻辑完全不需要区分真假串口。
 * 用于：没有板子时验证全链路、演示、以及 CI 冒烟测试。
 */
import { EventEmitter } from 'node:events';
import { buildFrame } from './FrameParser';
import type {
  ConnectionStatus,
  ModemSignals,
  PortInfo,
  SerialConfig
} from '../shared/types';

const MOCK_PORTS: PortInfo[] = [
  { path: 'COM3', manufacturer: 'NXP', vendorId: '1FC9', productId: '0130', friendlyName: 'RT1052 调试板 (虚拟)', isMock: true },
  { path: 'COM7', manufacturer: 'F200', vendorId: '0483', productId: '5740', friendlyName: 'F200 传感器 (虚拟)', isMock: true },
  { path: 'COM12', manufacturer: 'VCOM-CAL', friendlyName: 'VCOM 校准台 (虚拟)', isMock: true },
  { path: 'COM5', manufacturer: 'QinHeng', vendorId: '1A86', productId: '7523', friendlyName: 'USB-UART 适配器 (虚拟)', isMock: true }
];

const CYCLIC: string[] = [
  '+FLCK: 0, 120Hz, duty=48.2%, ppm=+12',
  'OK',
  '+VCAL: vcom=4.20V, offset=-3mV',
  '+FLCK: 0, 120Hz, duty=48.1%, ppm=+11',
  'WARN: UART6 RX idle > 500ms · buffer=0 · 检查线序'
];

export class MockSerial extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private cfg: SerialConfig | null = null;
  private openedAt = 0;
  private seq = 16;
  private tick = 0;
  private signals: ModemSignals = { dtr: true, rts: false, dsr: true, cts: true, dcd: false };

  async listPorts(): Promise<PortInfo[]> {
    return MOCK_PORTS.map(p => ({ ...p }));
  }

  async connect(cfg: SerialConfig): Promise<ConnectionStatus> {
    await this.disconnect();
    this.cfg = cfg;
    this.openedAt = Date.now();
    this.signals = { ...this.signals, dtr: cfg.dtr, rts: cfg.rts };
    this.emit('modem', { ...this.signals });
    this.emit('status', this.status());
    this.pushText('+SYS: 虚拟串口已就绪 · 数据由 MockSerial 生成');
    // 周期性数据流，模拟真实设备不断上报
    this.timer = setInterval(() => this.emitCyclic(), 900);
    return this.status();
  }

  async disconnect(): Promise<ConnectionStatus> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cfg = null;
    this.openedAt = 0;
    const s = this.status();
    this.emit('status', s);
    return s;
  }

  async write(data: Buffer): Promise<number> {
    const cmd = data.toString('utf8').replace(/[\r\n]/g, '').trim().toUpperCase();
    // 稍作延迟，模拟设备响应
    setTimeout(() => this.respondTo(cmd), 90);
    return data.length;
  }

  /** 手动注入 N 条模拟数据（对应 UI 的「注入模拟接收数据」按钮） */
  inject(count: number): void {
    for (let i = 0; i < count; i++) this.emitCyclic();
  }

  async setSignals(next: { dtr?: boolean; rts?: boolean }): Promise<ModemSignals> {
    if (next.dtr !== undefined) this.signals.dtr = next.dtr;
    if (next.rts !== undefined) this.signals.rts = next.rts;
    // 虚拟设备：DSR/CTS 跟随对端
    this.signals.dsr = this.signals.dtr;
    this.signals.cts = this.signals.rts;
    this.emit('modem', { ...this.signals });
    return { ...this.signals };
  }

  status(): ConnectionStatus {
    return {
      connected: this.cfg !== null,
      config: this.cfg,
      mock: true,
      openedAt: this.openedAt || undefined,
      path: this.cfg?.path
    };
  }

  get isOpen(): boolean {
    return this.cfg !== null;
  }

  /* ---------------- 内部 ---------------- */

  private pushText(text: string): void {
    this.emit('data', Buffer.from(text + '\r\n', 'utf8'));
  }

  private pushFrame(type: number, payload: number[]): void {
    this.emit('data', buildFrame(type, this.seq++ & 0xff, payload));
  }

  private emitCyclic(): void {
    if (!this.cfg) return;
    this.tick++;
    if (this.tick % 3 === 0) {
      // 每 3 拍发一帧二进制 F200 状态帧，让帧解析器 / 最近一帧卡片有真实数据
      const duty = 0x2c + (this.tick % 5);
      this.pushFrame(0x03, [duty, 0x01, 0x7f, 0x3c]);
    } else {
      this.pushText(CYCLIC[this.tick % CYCLIC.length]);
    }
  }

  private respondTo(cmd: string): void {
    if (!this.cfg) return;
    if (cmd.startsWith('AT+VER')) {
      this.pushText('+VER: F200-CTRL v2.4.1 build 20261103');
      this.pushText('OK');
    } else if (cmd.startsWith('AT+FLCK')) {
      this.pushText('+FLCK: 0, 120Hz, duty=48.2%, ppm=+12');
      this.pushText('OK');
      this.pushFrame(0x05, [0x2c, 0x01, 0x78, 0x3c]);
    } else if (cmd.startsWith('AT+VCAL')) {
      this.pushText('+VCAL: ACK, vcom=4.20V, offset=-3mV');
      this.pushText('OK');
      this.pushFrame(0x06, [0x10, 0x68, 0x00, 0x03]);
    } else if (cmd.startsWith('AT+DUMP')) {
      this.pushText('0000: 00 10 00 20 45 02 00 00 09 03 00 00 00 00 00 00');
      this.pushText('0010: 0D 0A 2B 56 45 52 3A 20 46 32 30 30 2D 43 54 52');
      this.pushText('OK');
    } else if (cmd.startsWith('AT+RST')) {
      this.pushText('+SYS: device reset');
      this.pushText('OK');
    } else {
      this.pushText('OK');
    }
  }
}
