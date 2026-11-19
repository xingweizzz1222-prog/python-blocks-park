/**
 * 将 node_modules/pyodide 中的“核心运行时文件”复制到 public/pyodide/，
 * 使 Pyodide 随站点一起打包部署（国内可直接访问，不依赖境外 CDN）。
 *
 * 只复制核心文件（JS 胶水 + WASM + Python 标准库 + 包锁文件），
 * 不复制可选科学计算包，控制产物体积。
 * 由 npm scripts 在 dev / build 前自动执行（prepare:pyodide）。
 */
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'node_modules', 'pyodide');
const destDir = join(root, 'public', 'pyodide');

if (!existsSync(srcDir)) {
  console.error('[copy-pyodide] 未找到 node_modules/pyodide，请先执行 npm install');
  process.exit(1);
}

// 核心文件清单：加载 Pyodide 运行纯 Python 所需的最小集合
const CORE_FILES = [
  'pyodide.js',
  'pyodide.mjs',
  'pyodide.asm.js',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const name of CORE_FILES) {
  const from = join(srcDir, name);
  if (!existsSync(from)) {
    console.warn(`[copy-pyodide] 跳过缺失文件：${name}`);
    continue;
  }
  const to = join(destDir, name);
  // 已存在且大小一致则跳过，避免每次 dev 都重复复制大文件
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  cpSync(from, to);
  copied++;
  console.log(`[copy-pyodide] 复制 ${name} (${(statSync(from).size / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`[copy-pyodide] 完成，本次复制 ${copied} 个文件 → public/pyodide/`);