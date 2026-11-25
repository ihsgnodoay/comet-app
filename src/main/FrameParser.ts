/**
 * F200 协议流式帧解析器
 *
 * 帧格式（9 字节定长）：
 *   AA 55 | type(1) | seq(1) | payload(4) | crc(1)
 *   crc = (type + seq + payload[0..3]) & 0xFF
 *
 * 串口是字节流，可能粘包 / 拆包 / 夹杂 AT 文本，
 * 因此这里做累积缓冲 + 滑动找帧头，而不是按 chunk 边界切帧。
 */
import { Buffer } from 'buffer';
import type { FrameResult } from '../shared/types';

const HEAD_A = 0xaa;
const HEAD_B = 0x55;
const FRAME_LEN = 9;

const TYPE_NAMES: Record<number, string> = {
  0x01: '心跳帧',
  0x02: '配置帧',
  0x03: '状态帧',
  0x04: '事件帧',
  0x05: 'flicker 数据帧',
  0x06: 'VCOM 校准帧',
  0x7f: '错误帧'
};

export function crc8(bytes: readonly number[]): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + (b & 0xff)) & 0xff;
  return sum;
}

/** 构造一帧合法 F200 数据（Mock 与单元测试共用） */
export function buildFrame(type: number, seq: number, payload: number[]): Buffer {
  const p = [type & 0xff, seq & 0xff, ...payload.map(x => x & 0xff)];
  while (p.length < 6) p.push(0);
  return Buffer.from([HEAD_A, HEAD_B, ...p, crc8(p)]);
}

function toHex(bytes: readonly number[]): string {
  return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function decodeFields(type: number, seq: number, payload: number[]): Record<string, string | number> {
  const base: Record<string, string | number> = { seq, typeHex: '0x' + type.toString(16).toUpperCase().padStart(2, '0') };
  if (type === 0x03 || type === 0x05) {
    base['duty'] = ((payload[0] / 255) * 100).toFixed(1) + '%';
    base['channel'] = payload[1];
    base['vcom_mV'] = ((payload[2] << 8) | payload[3]) / 10;
    base['flicker_Hz'] = payload[2];
  } else if (type === 0x06) {
    base['vcom_mV'] = ((payload[0] << 8) | payload[1]);
    base['offset_mV'] = (payload[2] << 8) | payload[3];
  } else {
    base['payloadHex'] = toHex(payload);
  }
  return base;
}

export class FrameParser {
  private buf: number[] = [];
  private readonly emit: (frame: FrameResult) => void;

  constructor(emit: (frame: FrameResult) => void) {
    this.emit = emit;
  }

  /** 喂入一段字节，返回本次解析出的所有帧 */
  push(chunk: Buffer): FrameResult[] {
    for (const b of chunk) this.buf.push(b);
    // 防止异常流把内存吃满
    if (this.buf.length > 64 * 1024) this.buf.splice(0, this.buf.length - 1024);

    const found: FrameResult[] = [];
    for (;;) {
      const idx = this.findHeader();
      if (idx < 0) {
        // 只保留最后一个可能是帧头的字节
        if (this.buf.length > 1) this.buf.splice(0, this.buf.length - 1);
        break;
      }
      if (idx > 0) this.buf.splice(0, idx);
      if (this.buf.length < FRAME_LEN) break;

      const raw = this.buf.slice(0, FRAME_LEN);
      const given = raw[8];
      const crcOk = crc8(raw.slice(2, 8)) === given;
      const payload = raw.slice(4, 8);
      const type = raw[2];
      const seq = raw[3];
      const frame: FrameResult = {
        raw: toHex(raw),
        type,
        typeName: TYPE_NAMES[type] || '未知帧',
        seq,
        payload,
        crcOk,
        length: FRAME_LEN,
        ts: nowStamp(),
        fields: decodeFields(type, seq, payload)
      };
      found.push(frame);
      this.emit(frame);
      this.buf.splice(0, FRAME_LEN);
    }
    return found;
  }

  private findHeader(): number {
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i] === HEAD_A && this.buf[i + 1] === HEAD_B) return i;
    }
    return -1;
  }

  reset(): void {
    this.buf = [];
  }

  get pending(): number {
    return this.buf.length;
  }
}
