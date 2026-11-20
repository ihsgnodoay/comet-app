import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * 阶段 2 说明：
 * 当前 renderer 是已定稿原型，采用 classic script 直接由 Electron 以 file:// 加载。
 * 这样避免 file:// 协议下 ES module 触发 CORS 限制，也不需要打包器介入，
 * 保证 UI 视觉与 ui-prototype/index.html 逐像素一致。
 *
 * 本配置供后续「原型拆成 React 组件」时启用开发服务器使用：
 *   npm run dev:renderer  →  http://localhost:5173
 * 届时可把 build 流程切换为 vite build + 自定义 app:// 协议。
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'out/renderer-vite'),
    emptyOutDir: true,
    target: 'chrome120'
  }
});
