/**
 * 联调辅助：把 dist/ 挂到 /sub/ 子路径下静态服务（端口 4175）。
 * 用途：验证生产构建在子路径部署（如 Qoder Sites 子目录）下资源相对路径正确，
 * 尤其是 Pyodide（indexURL 相对 document.baseURI）与 fullscreen.html 跳转。
 * 运行：node scripts/serve-dist-subpath.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const PREFIX = '/sub/';
const PORT = 4175;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(302, { Location: PREFIX });
      res.end();
      return;
    }
    // 去掉前缀并防目录穿越
    const rel = normalize(url.pathname.slice(PREFIX.length)).replace(/^([/\\])+/, '');
    const file = join(ROOT, rel === '' || rel === '.' ? 'index.html' : rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  })
  .listen(PORT, () => console.log(`serving dist at http://localhost:${PORT}${PREFIX}`));