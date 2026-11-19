/**
 * Vite 构建配置
 * - 多页应用：index.html（主编辑器）+ fullscreen.html（大屏展示页）
 * - base 使用相对路径，便于 Qoder Sites 等静态托管在任意子路径下运行
 * - Pyodide 核心文件由 scripts/copy-pyodide.mjs 复制到 public/pyodide/，随站点打包，
 *   运行时不依赖境外 CDN（国内网络可直接加载）
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // 产物体积提示阈值放宽：Blockly / Pyodide 本身较大，属预期
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: 'index.html',
        fullscreen: 'fullscreen.html',
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});