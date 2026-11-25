/**
 * 会话缓冲与统计（主进程内存态）
 *
 * 每个顶部标签对应一个 session：独立日志、字节计数、速率、HEX 缓冲、帧统计。
 * 串口字节流在这里被拆成「文本行」与「HEX 转储」，帧解析由 FrameParser 负责。
 */
import type { LogDirection, LogLine, SessionStats } from '../shared/types';

const MAX_LINES = 5000;
const MAX_HEX_BYTES = 64 * 1024;
const THROUGHPUT_POINTS = 60;

interface Sample {
  t: number;
  n: number;
}

interface Session {
  id: string;
  name: string;
  lines: LogLine[];
  rxBytes: number;
  txBytes: number;
  openedAt: number;
  frameCount: number;
  frameErrors: number;
  hex: number[];
  textBuf: string;
  rxRecent: Sample[];
  txRecent: Sample[];
  rxSeries: number[];
  txSeries: number[];
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export interface HexRow {
  offset: string;
  bytes: string;
  ascii: string;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private nextId = 1;

  constructor() {
    // 内部兜底会话：UI 启动时是零会话，但串口日志 / 统计始终需要一个写入目标。
    // 它不对应任何标签，用户可见的会话一律由 renderer 调 create() 创建。
    this.create('内部');
  }

  create(name: string): string {
    const id = 's' + this.nextId++;
    this.sessions.set(id, {
      id,
      name,
      lines: [],
      rxBytes: 0,
      txBytes: 0,
      openedAt: Date.now(),
      frameCount: 0,
      frameErrors: 0,
      hex: [],
      textBuf: '',
      rxRecent: [],
      txRecent: [],
      rxSeries: new Array(THROUGHPUT_POINTS).fill(0),
      txSeries: new Array(THROUGHPUT_POINTS).fill(0)
    });
    return id;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  list(): { id: string; name: string }[] {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, name: s.name }));
  }

  private get(id: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      const newId = this.create('会话');
      s = this.sessions.get(newId)!;
    }
    return s;
  }

  addLine(sessionId: string, dir: LogDirection, text: string, bytes = 0): LogLine {
    const s = this.get(sessionId);
    const line: LogLine = { id: Date.now() * 1000 + (s.lines.length % 1000), ts: stamp(), dir, text, sessionId, bytes };
    s.lines.push(line);
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
    return line;
  }

  /** 处理一段 RX 字节：统计 + HEX 缓冲 + 拆出可打印文本行 */
  pushRx(sessionId: string, chunk: Buffer): LogLine[] {
    const s = this.get(sessionId);
    const out: LogLine[] = [];
    s.rxBytes += chunk.length;
    s.rxRecent.push({ t: Date.now(), n: chunk.length });

    for (const b of chunk) {
      s.hex.push(b);
      if (b === 0x0d || b === 0x0a) {
        if (s.textBuf.trim()) out.push(this.addLine(sessionId, 'rx', s.textBuf, s.textBuf.length));
        s.textBuf = '';
      } else if (b >= 0x20 && b < 0x7f) {
        s.textBuf += String.fromCharCode(b);
      } else if (b === 0x09) {
        s.textBuf += '\t';
      }
      // 其余二进制字节只进 HEX 缓冲，不进文本行
    }
    if (s.hex.length > MAX_HEX_BYTES) s.hex.splice(0, s.hex.length - MAX_HEX_BYTES);
    return out;
  }

  pushTx(sessionId: string, byteCount: number): void {
    const s = this.get(sessionId);
    s.txBytes += byteCount;
    s.txRecent.push({ t: Date.now(), n: byteCount });
  }

  noteFrame(sessionId: string, crcOk: boolean): void {
    const s = this.get(sessionId);
    s.frameCount++;
    if (!crcOk) s.frameErrors++;
  }

  /** 每秒调用一次：把当前速率压进吞吐序列并清理过期采样 */
  tick(): void {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      s.rxRecent = s.rxRecent.filter(x => now - x.t < 1500);
      s.txRecent = s.txRecent.filter(x => now - x.t < 1500);
      s.rxSeries.push(this.rateOf(s.rxRecent));
      s.txSeries.push(this.rateOf(s.txRecent));
      if (s.rxSeries.length > THROUGHPUT_POINTS) s.rxSeries.shift();
      if (s.txSeries.length > THROUGHPUT_POINTS) s.txSeries.shift();
    }
  }

  private rateOf(samples: Sample[]): number {
    const now = Date.now();
    let n = 0;
    for (const x of samples) if (now - x.t < 1000) n += x.n;
    return n;
  }

  stats(sessionId: string): SessionStats {
    const s = this.get(sessionId);
    return {
      sessionId,
      rxBytes: s.rxBytes,
      txBytes: s.txBytes,
      rxRate: this.rateOf(s.rxRecent),
      txRate: this.rateOf(s.txRecent),
      uptimeMs: Date.now() - s.openedAt,
      frameCount: s.frameCount,
      frameErrors: s.frameErrors,
      lineCount: s.lines.length,
      throughput: { rx: [...s.rxSeries], tx: [...s.txSeries] }
    };
  }

  lines(sessionId: string): LogLine[] {
    return [...this.get(sessionId).lines];
  }

  logText(sessionId: string): string {
    return this.get(sessionId)
      .lines.map(l => `[${l.ts}] [${l.dir.toUpperCase().padEnd(4)}] ${l.text}`)
      .join('\n');
  }

  hexRows(sessionId: string, maxRows = 64): HexRow[] {
    const bytes = this.get(sessionId).hex;
    const start = Math.max(0, bytes.length - maxRows * 16);
    const rows: HexRow[] = [];
    for (let off = start; off < bytes.length; off += 16) {
      const slice = bytes.slice(off, off + 16);
      rows.push({
        offset: off.toString(16).toUpperCase().padStart(4, '0'),
        bytes: slice.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
        ascii: slice.map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
      });
    }
    return rows;
  }

  clear(sessionId: string): void {
    const s = this.get(sessionId);
    s.lines = [];
    s.hex = [];
    s.textBuf = '';
    s.rxBytes = 0;
    s.txBytes = 0;
    s.frameCount = 0;
    s.frameErrors = 0;
    s.rxRecent = [];
    s.txRecent = [];
    s.openedAt = Date.now();
  }
}
