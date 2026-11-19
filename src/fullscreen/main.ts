/**
 * 大屏展示页入口（fullscreen.html）：镜像主页面舞台，全屏演示。
 *
 * - 画面：Canvas 按窗口等比放大（4:3 留黑边），与主舞台共用渲染器 drawScene；
 * - 顶栏：绿旗/停止（BroadcastChannel 遥控主页面运行时）、⛶ 全屏切换、连接状态；
 * - 依赖：主页面必须保持打开（Python 执行在主页面 Pyodide）；
 *   主窗口被隐藏时浏览器节流会导致镜像降频，顶栏有相应提示。
 */
import '../styles/main.css';
import '../styles/fullscreen.css';
import { openMirrorChannel, type MirrorMsg } from './channel';
import { drawScene, createImageFor, STAGE_W, STAGE_H, type StageSprite, type MonitorEntry, type AssetImage } from '../stage/render';
import { assetIdFromCostume } from '../assets';

const root = document.querySelector<HTMLDivElement>('#fullscreen-app')!;
root.innerHTML = `
  <div class="fs-shell">
    <header class="fs-bar">
      <span class="fs-title">🐍 Python 积木乐园 · 大屏演示</span>
      <span class="fs-status" id="fs-status">正在连接主页面…</span>
      <span class="fs-hint">镜像来自主页面 · 请保持主页面打开且窗口可见</span>
      <span class="fs-actions">
        <button id="fs-flag" class="fs-btn flag" title="遥控主页面：开始 / 运行中点击暂停 / 暂停后点击续跑（R18：不重置位置）">⚑ 绿旗</button>
        <button id="fs-pause" class="fs-btn pause" title="遥控主页面暂停/继续">⏸ 暂停</button>
        <button id="fs-reset" class="fs-btn reset" title="遥控主页面重置（精灵回初始状态）">⟲ 重置</button>
        <button id="fs-full" class="fs-btn" title="切换浏览器全屏">⛶ 全屏</button>
      </span>
    </header>
    <div class="fs-stage-wrap" id="fs-wrap">
      <canvas id="fs-canvas"></canvas>
    </div>
  </div>
`;

const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
const statusEl = q<HTMLSpanElement>('#fs-status');
const flagBtn = q<HTMLButtonElement>('#fs-flag');
const pauseBtn = q<HTMLButtonElement>('#fs-pause');
const resetBtn = q<HTMLButtonElement>('#fs-reset');
const fullBtn = q<HTMLButtonElement>('#fs-full');
const wrap = q<HTMLDivElement>('#fs-wrap');
const canvas = q<HTMLCanvasElement>('#fs-canvas');
const ctx = canvas.getContext('2d')!;
const imageFor = createImageFor();

// ---------- 镜像状态 ----------
let sprites: StageSprite[] = [];
/** 变量监视器（R6 镜像附加字段） */
let monitors: MonitorEntry[] = [];
let running = false;
/** 主页面暂停态（R18）：据此切换暂停/继续文案与绿旗高亮 */
let paused = false;
/** 最近一次收到主页面状态的时间（performance.now）；0 表示尚未连接 */
let lastStateAt = 0;
/** 脏标记：状态/尺寸变化才重绘，省电 */
let dirty = true;

// ---------- 自定义素材镜像（R10）：assets 消息建立图像缓存，state 只带引用 ----------
const assetCache = new Map<string, AssetImage>();
let backgroundId: string | null = null;

/** 渲染附加层：背景 + 素材造型解析（与主页面同一份 drawScene 逻辑） */
function sceneExtras() {
  return {
    background: backgroundId ? assetCache.get(backgroundId) ?? null : null,
    assetCostume: (key: string): AssetImage | undefined => {
      const id = assetIdFromCostume(key);
      return id ? assetCache.get(id) : undefined;
    },
  };
}

const ch = openMirrorChannel();
ch.onmessage = (ev: MessageEvent<MirrorMsg>) => {
  const m = ev.data;
  if (m.type === 'assets') {
    // 素材目录：重建图像缓存（dataURL → Image，浏览器异步解码）
    assetCache.clear();
    for (const [id, data] of Object.entries(m.costumes)) {
      const img = new Image();
      img.onload = () => { dirty = true; };
      img.src = data.dataUrl;
      assetCache.set(id, { img, width: data.width, height: data.height, fit: data.fit });
    }
    dirty = true;
    return;
  }
  if (m.type !== 'state') return; // 大屏页只关心 assets/state
  sprites = m.sprites;
  monitors = m.monitors ?? [];
  running = m.running;
  paused = m.paused;
  backgroundId = m.background ?? null;
  lastStateAt = performance.now();
  dirty = true;
  flagBtn.classList.toggle('running', running && !paused);
  pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';
  pauseBtn.classList.toggle('paused', paused);
};
ch.postMessage({ type: 'hello' }); // 请求主页面立即推素材目录 + 一帧状态

// 连接状态巡检（本页在前台，定时器不受节流影响）
window.setInterval(() => {
  const fresh = lastStateAt > 0 && performance.now() - lastStateAt < 2000;
  if (lastStateAt === 0) {
    statusEl.textContent = '正在连接主页面…（请先打开主页面）';
    statusEl.className = 'fs-status';
  } else if (fresh) {
    statusEl.textContent = '● 已连接主页面';
    statusEl.className = 'fs-status ok';
  } else {
    statusEl.textContent = '⚠ 与主页面连接中断（请检查主页面是否打开）';
    statusEl.className = 'fs-status bad';
  }
}, 500);

// ---------- 遥控按钮 ----------
flagBtn.addEventListener('click', () => ch.postMessage({ type: 'command', command: 'flag' }));
pauseBtn.addEventListener('click', () => ch.postMessage({ type: 'command', command: 'pause' }));
resetBtn.addEventListener('click', () => ch.postMessage({ type: 'command', command: 'reset' }));
fullBtn.addEventListener('click', () => {
  // 环境不允许全屏时（如 iframe 无 allowfullscreen）静默降级，不抛未处理拒绝
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
});
document.addEventListener('fullscreenchange', () => {
  fullBtn.textContent = document.fullscreenElement ? '🗗 退出全屏' : '⛶ 全屏';
});

// ---------- 画布自适应（dpr 感知 + 4:3 留边） ----------
function resize(): void {
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  dirty = true;
}
new ResizeObserver(resize).observe(wrap);
resize();

// ---------- 渲染循环：逻辑坐标 480×360 等比映射到画布 ----------
function frame(): void {
  if (dirty) {
    dirty = false;
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#151a24'; // 留边暗色背景
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / STAGE_W, h / STAGE_H);
    const ox = (w - STAGE_W * scale) / 2;
    const oy = (h - STAGE_H * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    drawScene(ctx, sprites, imageFor, monitors, sceneExtras());
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 调试句柄：便于自动化联调核对镜像状态
(window as unknown as Record<string, unknown>).__fs = {
  getSprites: () => sprites,
  isRunning: () => running,
  isPaused: () => paused,
  getLastStateAt: () => lastStateAt,
  getBackground: () => backgroundId,
  getAssetIds: () => [...assetCache.keys()],
};