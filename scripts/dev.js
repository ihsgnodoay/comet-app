/**
 * 开发启动器：清掉宿主环境可能注入的 ELECTRON_RUN_AS_NODE。
 * 该变量会让 Electron 降级成纯 Node（require('electron') 变成路径字符串，
 * app / BrowserWindow 全部 undefined），主进程直接崩。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const exe = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron');

const child = spawn(exe, ['.'], { cwd: root, env, stdio: 'inherit' });
child.on('error', err => {
  console.error('[dev] 无法启动 Electron:', err.message);
  process.exit(1);
});
child.on('exit', code => process.exit(code ?? 0));
