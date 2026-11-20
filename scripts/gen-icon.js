/**
 * 零依赖生成 build/icon.ico（多尺寸 PNG 帧）。
 * 视觉沿用项目规范：深蓝相位底 #101322 + 单一冷蓝 #3B8CFF + RX 青 #6FD3E8。
 * 运行： node scripts/gen-icon.js
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function insideRound(x, y, w, h, r) {
  if (x >= r && x <= w - r) return y >= 0 && y <= h;
  if (y >= r && y <= h - r) return x >= 0 && x <= w;
  const cx = x < r ? r : w - r;
  const cy = y < r ? r : h - r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const sa = a / 255, da = buf[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    buf[i] = (r * sa + buf[i] * da * (1 - sa)) / oa;
    buf[i + 1] = (g * sa + buf[i + 1] * da * (1 - sa)) / oa;
    buf[i + 2] = (b * sa + buf[i + 2] * da * (1 - sa)) / oa;
    buf[i + 3] = oa * 255;
  };
  const S = n => n * size;
  const rr = S(0.17);

  // 圆角底
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRound(x + 0.5, y + 0.5, size, size, rr)) put(x, y, 16, 19, 34, 255);
    }
  }
  // 内描边（1px 冷蓝低对比）
  const edge = Math.max(1, Math.round(S(0.008)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRound(x + 0.5, y + 0.5, size, size, rr)) continue;
      if (!insideRound(x + 0.5, y + 0.5, size - 2 * edge, size - 2 * edge, rr - edge)) {
        put(x, y, 59, 140, 255, 70);
      }
    }
  }

  // 顶部标题栏（半透明白层）+ 冷蓝状态点
  for (let y = Math.round(S(0.14)); y < Math.round(S(0.235)); y++) {
    for (let x = Math.round(S(0.16)); x < Math.round(S(0.84)); x++) put(x, y, 255, 255, 255, 26);
  }
  const dotR = Math.max(1, S(0.022));
  for (let y = Math.round(S(0.15)); y <= Math.round(S(0.225)); y++) {
    for (let x = Math.round(S(0.20)); x <= Math.round(S(0.26)); x++) {
      if (Math.hypot(x - S(0.23), y - S(0.1875)) <= dotR) put(x, y, 59, 140, 255, 255);
    }
  }

  // 中部：串口波形（折线）
  const wave = [
    [0.16, 0.50], [0.28, 0.50], [0.34, 0.34], [0.42, 0.66],
    [0.50, 0.44], [0.62, 0.44], [0.68, 0.30], [0.76, 0.62], [0.84, 0.48]
  ];
  const lineW = Math.max(1, S(0.045));
  for (let i = 0; i < wave.length - 1; i++) {
    const [ax, ay] = wave[i], [bx, by] = wave[i + 1];
    const x0 = S(ax), y0 = S(ay), x1 = S(bx), y1 = S(by);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - lineW));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + lineW));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - lineW));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + lineW));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (distanceToSegment(x + 0.5, y + 0.5, x0, y0, x1, y1) <= lineW / 2) {
          put(x, y, 59, 140, 255, 255);
        }
      }
    }
  }

  // 底部：两条 RX 日志线
  const logH = Math.max(1, Math.round(S(0.022)));
  [[0.16, 0.78, 0.62], [0.16, 0.86, 0.44]].forEach(([x0, y0, x1]) => {
    for (let y = Math.round(S(y0)); y < Math.round(S(y0)) + logH; y++) {
      for (let x = Math.round(S(x0)); x < Math.round(S(x1)); x++) put(x, y, 111, 211, 232, 190);
    }
  });

  return encodePNG(size, buf);
}

const SIZES = [16, 32, 48, 64, 128, 256];
const images = SIZES.map(s => ({ size: s, png: draw(s) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const dir = [];
for (const img of images) {
  const e = Buffer.alloc(16);
  e[0] = img.size >= 256 ? 0 : img.size;
  e[1] = img.size >= 256 ? 0 : img.size;
  e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.png.length;
  dir.push(e);
}

const outDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const ico = Buffer.concat([header, ...dir, ...images.map(i => i.png)]);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('[icon] build/icon.ico  ' + ico.length + ' bytes  sizes=' + SIZES.join(','));
