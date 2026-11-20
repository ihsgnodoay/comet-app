/**
 * 后端逻辑冒烟测试（纯 Node，不需要 Electron / 串口硬件）
 * 运行： node scripts/smoke-test.js
 * 覆盖：CRC 自洽、单帧、拆包、粘包+文本夹杂、帧错误处理、
 *       SessionStore 统计/日志/HEX、MockSerial 回环全链路。
 */
const assert = require('node:assert/strict');
const { buildFrame, crc8, FrameParser } = require('../out/main/FrameParser.js');
const { SessionStore } = require('../out/main/SessionStore.js');
const { MockSerial } = require('../out/main/MockSerial.js');
const { DEFAULT_SERIAL } = require('../out/shared/types.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  PASS  ' + name);
}

console.log('[smoke] F200 帧解析');

check('crc8 自洽 + buildFrame 生成 9 字节合法帧', () => {
  const f = buildFrame(0x03, 16, [0x2c, 0x01, 0x7f, 0x3c]);
  assert.equal(f.length, 9);
  assert.equal(f[0], 0xaa);
  assert.equal(f[1], 0x55);
  assert.equal(f[8], crc8([0x03, 0x10, 0x2c, 0x01, 0x7f, 0x3c]));
});

check('完整单帧解析：CRC OK / seq / 类型名 / 字段', () => {
  const frames = [];
  const p = new FrameParser(f => frames.push(f));
  p.push(buildFrame(0x03, 16, [0x2c, 0x01, 0x7f, 0x3c]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].crcOk, true);
  assert.equal(frames[0].seq, 16);
  assert.equal(frames[0].type, 0x03);
  assert.equal(frames[0].typeName, '状态帧');
  assert.equal(frames[0].length, 9);
  assert.ok(frames[0].fields.duty);
  assert.ok(frames[0].raw.startsWith('AA 55 03 10'));
});

check('拆包：帧分两次到达仍能拼出', () => {
  const f = buildFrame(0x05, 21, [0x2d, 0x01, 0x80, 0x3d]);
  const frames = [];
  const p = new FrameParser(f => frames.push(f));
  p.push(f.subarray(0, 4));
  assert.equal(frames.length, 0);
  p.push(f.subarray(4));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].crcOk, true);
  assert.equal(frames[0].seq, 21);
});

check('粘包 + 文本夹杂：一次收到 文本/帧/文本 只吐 1 帧', () => {
  const frames = [];
  const p = new FrameParser(f => frames.push(f));
  const chunk = Buffer.concat([
    Buffer.from('+FLCK: 0, 120Hz\r\n', 'utf8'),
    buildFrame(0x03, 17, [0x2e, 0x01, 0x81, 0x3e]),
    Buffer.from('OK\r\n', 'utf8')
  ]);
  p.push(chunk);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].crcOk, true);
  assert.equal(frames[0].seq, 17);
});

check('CRC 错误能被识别', () => {
  const f = buildFrame(0x03, 18, [1, 2, 3, 4]);
  f[8] ^= 0xff;
  const frames = [];
  const p = new FrameParser(x => frames.push(x));
  p.push(f);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].crcOk, false);
});

console.log('[smoke] SessionStore');

check('RX 文本行拆分 + 字节统计 + HEX 转储', () => {
  const s = new SessionStore();
  const id = s.list()[0].id;
  const lines = s.pushRx(id, Buffer.from('+VER: F200\r\nOK\r\n', 'utf8'));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].dir, 'rx');
  assert.ok(lines[0].text.includes('F200'));
  const st = s.stats(id);
  assert.equal(st.rxBytes, 16);
  assert.equal(st.lineCount, 2);
  assert.ok(s.hexRows(id).length > 0);
});

check('TX 计数 / 帧统计 / 清空归零', () => {
  const s = new SessionStore();
  const id = s.list()[0].id;
  s.pushTx(id, 12);
  s.noteFrame(id, true);
  s.noteFrame(id, false);
  let st = s.stats(id);
  assert.equal(st.txBytes, 12);
  assert.equal(st.frameCount, 2);
  assert.equal(st.frameErrors, 1);
  s.clear(id);
  st = s.stats(id);
  assert.equal(st.txBytes, 0);
  assert.equal(st.rxBytes, 0);
  assert.equal(st.frameCount, 0);
  assert.equal(st.lineCount, 0);
});

check('多会话隔离', () => {
  const s = new SessionStore();
  const a = s.list()[0].id;
  const b = s.create('第二会话');
  s.pushTx(a, 10);
  s.pushTx(b, 99);
  assert.equal(s.stats(a).txBytes, 10);
  assert.equal(s.stats(b).txBytes, 99);
  assert.equal(s.list().length, 2);
});

console.log('[smoke] MockSerial 回环');

(async () => {
  const m = new MockSerial();
  const s = new SessionStore();
  const id = s.list()[0].id;
  const frames = [];
  const p = new FrameParser(f => frames.push(f));
  let rxChunks = 0;
  m.on('data', chunk => {
    rxChunks++;
    s.pushRx(id, chunk);
    p.push(chunk);
  });

  const status = await m.connect({ ...DEFAULT_SERIAL, path: 'COM3' });
  assert.equal(status.connected, true);
  assert.equal(status.mock, true);

  // 指令响应
  const n = await m.write(Buffer.from('AT+VER?\r\n', 'utf8'));
  assert.equal(n, 9);
  await new Promise(r => setTimeout(r, 150));
  assert.ok(s.stats(id).txBytes >= 0);

  // 手动注入 6 拍：每 3 拍一帧，应至少 2 帧
  m.inject(6);
  assert.ok(frames.length >= 2, '期望至少解析出 2 帧, 实际 ' + frames.length);
  assert.ok(frames.every(f => f.crcOk), 'Mock 生成的帧 CRC 必须全部通过');
  assert.ok(rxChunks > 0);
  assert.ok(s.stats(id).rxBytes > 0);

  const lines = s.logText(id).split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Mock 应产生文本日志行');

  await m.disconnect();
  assert.equal(m.status().connected, false);

  console.log('  PASS  Mock 连接 / 指令响应 / 注入 / 帧解析 / 日志 / 断开');
  passed++;
  console.log('\n[smoke] 全部通过：' + passed + ' 项');
})().catch(err => {
  console.error('\n[smoke] FAILED:', err);
  process.exit(1);
});
