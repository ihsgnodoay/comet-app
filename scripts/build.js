/**
 * 阶段 2 构建脚本：零依赖，只用 Node 内置模块 + 本地 typescript。
 *
 * 步骤：
 *   1. tsc 编译 main / preload / shared → out/
 *   2. 把 renderer 静态文件原样复制到 out/renderer/（不改一个字节的 CSS / DOM）
 *
 * 不调用 vite build：renderer 用 classic script，Electron 直接 loadFile，
 * 避免 file:// 下 ESM 的 CORS 限制；vite.config.ts 留给后续 React 化。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

if (!fs.existsSync(tsc)) {
  console.error('[build] 找不到 typescript，请先运行 npm install');
  process.exit(1);
}

console.log('[build] 1/2 编译 TypeScript (main / preload / shared) ...');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.main.json'], {
  cwd: root,
  stdio: 'inherit'
});

console.log('[build] 2/2 复制 renderer 静态文件 ...');
const src = path.join(root, 'src', 'renderer');
const dst = path.join(root, 'out', 'renderer');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

const copied = [];
for (const name of fs.readdirSync(src)) {
  const from = path.join(src, name);
  if (!fs.statSync(from).isFile()) continue;
  fs.copyFileSync(from, path.join(dst, name));
  copied.push(name);
}

// 基本校验
const html = fs.readFileSync(path.join(dst, 'index.html'), 'utf8');
if (!html.includes('app.js')) {
  console.error('[build] index.html 未引用 app.js，renderer 入口有问题');
  process.exit(1);
}
if ((html.match(/<script>[\s\S]*?<\/script>/g) || []).length > 0) {
  console.error('[build] index.html 仍残留内联脚本，应全部抽到 app.js');
  process.exit(1);
}

console.log('[build] OK  renderer: ' + copied.join(', '));
console.log('[build] 产物: out/main, out/preload, out/shared, out/renderer');
