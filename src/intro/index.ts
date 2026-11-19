/**
 * 启动动画与初始化绑定编排（二期第二批 · 清单第十四节 · 双状态机）。
 *
 * 动画状态：INTRO → LOADING →（SUCCESS_TRANSITION → ENTERED）｜（FAILURE_DRAIN → FAILED →重试回 LOADING）
 * 初始化状态：INITIALIZING → READY ｜ ERROR（由 main.ts 初始化管线经 step/ready/fail 驱动）
 *
 * 关键语义（清单硬性要求）：
 * - 进入网站立即显示本画面（boot.ts 独立小入口先于主入口执行），初始化并行推进；
 * - 最低展示 2.5s：从首帧实际显示计时；成功转场须同时满足 A(≥2.5s) 与 B(全部里程碑完成)；
 *   2.5s 是门槛不是固定时长，也不是超时——判定只认真实 Promise 结果，绝无固定 setTimeout 判成功；
 * - 进度百分比按真实里程碑步数推进（6 步），禁止按时间假进度；
 * - 失败：立即停跳停生成（FAILURE_DRAIN），已有物体自然消散；失败界面展示时机＝
 *   max(首显+2.5s, 失败时刻+消散宽限)，早失败凑足最低展示、晚失败立即走失败流程；
 * - 重试：清理失败 UI 回 LOADING，回调主入口重跑初始化（已完成阶段不重复装配）；
 * - 守卫：转场只触发一次、初始化结果只采纳一次、监听器统一登记统一拆除、
 *   页面隐藏停 rAF、ENTERED 后移除 overlay 与全部监听，无残留 Canvas。
 *
 * 镜头转场（SUCCESS_TRANSITION，约 1.4s，执行方定）：CSS 负责箱子居中放大＋箱口暖光，
 * Canvas 负责剩余物体两侧掠过＋隧环；末尾 overlay 淡出露出已就绪的主界面（无白屏）。
 */
import '../styles/intro.css';
import { boxSvg } from './box';
import { createScene, type SceneApi } from './scene';

/** 动画状态机 */
export type AnimState = 'INTRO' | 'LOADING' | 'FAILURE_DRAIN' | 'FAILED' | 'SUCCESS_TRANSITION' | 'ENTERED';
/** 初始化状态机 */
export type InitState = 'INITIALIZING' | 'READY' | 'ERROR';

/** 真实初始化里程碑（main.ts 管线逐步上报；百分比＝完成步数/总步数） */
export const INTRO_STEPS = ['editor', 'project', 'systems', 'assets', 'python', 'bridge'] as const;
export type IntroStep = (typeof INTRO_STEPS)[number];
/** 里程碑中文标签（日志/排查用） */
export const STEP_LABELS: Record<IntroStep, string> = {
  editor: '编辑器核心与 Blockly 工作区',
  project: '舞台与项目存档恢复',
  systems: '事件/运行/镜像系统装配',
  assets: '素材库恢复',
  python: 'Pyodide 运行环境与依赖探针',
  bridge: 'JS↔Python 桥接往返探针',
};

/** 最低展示时间（硬性门槛，清单第十四节） */
const MIN_DISPLAY_MS = 2500;
/** INTRO 静止停顿（执行方定：片刻后进入跳动加载） */
const INTRO_HOLD_MS = 700;
/** 失败消散宽限：晚失败时最多等已有物体跑完这么久再挂失败界面 */
const DRAIN_GRACE_MS = 1200;
/** 穿越转场时长（执行方定，不计入 2.5s） */
const WARP_MS = 1400;
/** 转场末尾淡出时长 */
const LEAVE_MS = 300;

export interface IntroHandle {
  /** 上报一个真实完成的初始化里程碑（推进进度条） */
  step(id: IntroStep): void;
  /** 全部必要初始化成功（真实 Promise 完成后调用） */
  ready(): void;
  /** 必要初始化不可恢复失败（真实错误对象，失败界面展示其原因） */
  fail(err: Error): void;
  onRetry(cb: () => void): void;
  onEntered(cb: () => void): void;
  /** 调试/自动化取证句柄 */
  debug(): {
    anim: AnimState; init: InitState; elapsedMs: number;
    steps: IntroStep[]; counts: { blocks: number; particles: number; streaks: number };
    loopRunning: boolean; listeners: number; warpAtMs: number | null; enteredAtMs: number | null;
  };
}

let singleton: IntroHandle | null = null;
/** 主入口取启动画面句柄（boot.ts 已挂载） */
export function getIntro(): IntroHandle | null {
  return singleton;
}

/** 挂载启动画面（幂等：重复调用返回既有句柄） */
export function mountIntro(): IntroHandle {
  if (singleton) return singleton;

  // ---------- DOM ----------
  const overlay = document.createElement('div');
  overlay.className = 'sc-intro';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-label', '网站启动动画');
  overlay.innerHTML = `
    <div class="sc-intro-bg"></div>
    <canvas class="sc-intro-canvas"></canvas>
    <div class="sc-box-slot">
      <div class="sc-box-shadow"></div>
      <div class="sc-box-hop">${boxSvg()}</div>
    </div>
    <div class="sc-intro-ui">
      <div class="sc-intro-loading">
        <div class="sc-intro-text">正在加载创作工具...</div>
        <div class="sc-intro-bar-row">
          <div class="sc-intro-bar"><div class="sc-intro-fill"></div></div>
          <span class="sc-intro-pct">0%</span>
        </div>
      </div>
      <div class="sc-intro-failed" hidden>
        <div class="sc-intro-fail-title">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 3 L22 20 H2 Z" fill="#f2555a" stroke="#f2555a" stroke-width="2" stroke-linejoin="round"/>
            <rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/>
            <circle cx="12" cy="17.4" r="1.2" fill="#fff"/>
          </svg>
          <span>加载失败</span>
        </div>
        <div class="sc-intro-fail-sub">初始化未完成，请重试</div>
        <div class="sc-intro-reason"></div>
        <button class="sc-intro-retry" type="button">⟳ 重新加载</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('sc-intro-lock'); // 启动期间主界面不可操作（验收 4）
  // 跳动交给合成器：挂载即加 --hop（delay 0.7s＝INTRO 静止片刻），
  // 主线程被 Pyodide 实例化占用期间跳动仍持续；状态机另管 --loading（箱盖/生成）
  overlay.classList.add('sc-intro--hop');

  const canvas = overlay.querySelector<HTMLCanvasElement>('.sc-intro-canvas')!;
  const slot = overlay.querySelector<HTMLElement>('.sc-box-slot')!;
  const hop = overlay.querySelector<HTMLElement>('.sc-box-hop')!;
  const fill = overlay.querySelector<HTMLElement>('.sc-intro-fill')!;
  const pct = overlay.querySelector<HTMLElement>('.sc-intro-pct')!;
  const loadingUi = overlay.querySelector<HTMLElement>('.sc-intro-loading')!;
  const failedUi = overlay.querySelector<HTMLElement>('.sc-intro-failed')!;
  const reasonEl = overlay.querySelector<HTMLElement>('.sc-intro-reason')!;
  const retryBtn = overlay.querySelector<HTMLButtonElement>('.sc-intro-retry')!;

  /** 箱口锚点（slot 不受跳动 transform 影响，定位稳定） */
  const anchor = (): { x: number; y: number; w: number } => {
    const r = slot.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.34, w: r.width };
  };
  const scene: SceneApi = createScene(canvas, anchor);

  // ---------- 双状态机 ----------
  let anim: AnimState = 'INTRO';
  let init: InitState = 'INITIALIZING';
  const done = new Set<IntroStep>();
  let t0 = 0; // 首帧实际显示时刻（首 rAF 落地）
  let failAt = 0;
  let warpAt: number | null = null;
  let enteredAt: number | null = null;
  let retryCb: (() => void) | null = null;
  let enteredCb: (() => void) | null = null;
  let raf = 0;
  let prev = 0;
  let loopRunning = false;
  let destroyed = false;

  const now = (): number => performance.now();
  const elapsed = (): number => (t0 ? now() - t0 : 0);

  /** 监听器统一登记（destroy 时全部拆除，验收 12） */
  const removers: Array<() => void> = [];
  function listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    removers.push(() => target.removeEventListener(type, fn, opts));
  }

  function setAnim(next: AnimState): void {
    anim = next;
    overlay.dataset.state = next;
  }

  function updateProgress(): void {
    const p = Math.round((done.size / INTRO_STEPS.length) * 100);
    fill.style.width = `${p}%`;
    pct.textContent = `${p}%`;
  }

  // ---------- 循环（单条 rAF；隐藏停、可见续） ----------
  function frame(ts: number): void {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (ts - prev) / 1000));
    prev = ts;
    if (!t0) {
      t0 = ts; // 首帧实际显示：最低展示计时起点
    }
    // INTRO 停顿片刻 → LOADING（与初始化结果无关的纯动画节奏）
    if (anim === 'INTRO' && elapsed() >= INTRO_HOLD_MS) {
      setAnim('LOADING');
      overlay.classList.add('sc-intro--loading');
      scene.setMode('loading');
    }
    // 成功门槛：A(≥2.5s) 且 B(初始化 READY) 同时满足才转场，只触发一次
    if (init === 'READY' && warpAt === null && (anim === 'INTRO' || anim === 'LOADING') && elapsed() >= MIN_DISPLAY_MS) {
      startWarp();
    }
    // 失败界面时机：早失败凑足最低展示；晚失败等消散宽限（物体跑完或宽限到期）
    if (anim === 'FAILURE_DRAIN' && elapsed() >= MIN_DISPLAY_MS && (scene.empty() || now() - failAt >= DRAIN_GRACE_MS)) {
      setAnim('FAILED');
      failedUi.hidden = false;
    }
    scene.tick(dt);
  }
  function startLoop(): void {
    if (loopRunning || destroyed) return;
    loopRunning = true;
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stopLoop(): void {
    loopRunning = false;
    cancelAnimationFrame(raf);
  }

  // ---------- 成功穿越 ----------
  function startWarp(): void {
    warpAt = now();
    setAnim('SUCCESS_TRANSITION');
    overlay.classList.remove('sc-intro--loading');
    overlay.classList.remove('sc-intro--hop'); // 穿越期箱子不再跳动（镜头推进接管）
    overlay.classList.add('sc-intro--warp');
    scene.setMode('warp');
    window.setTimeout(() => {
      if (destroyed) return;
      overlay.classList.add('sc-intro--leave');
      window.setTimeout(() => destroy(), LEAVE_MS);
    }, WARP_MS);
  }

  /** 拆除：停循环、清监听、移除 overlay（ENTERED 后无残留 Canvas） */
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    for (const rm of removers) rm();
    removers.length = 0;
    scene.destroy();
    overlay.remove();
    document.body.classList.remove('sc-intro-lock');
    setAnim('ENTERED');
    enteredAt = now();
    enteredCb?.();
  }

  // ---------- 对外 API ----------
  const handle: IntroHandle = {
    step(id) {
      if (destroyed || done.has(id)) return;
      done.add(id);
      updateProgress();
    },
    ready() {
      if (destroyed || init !== 'INITIALIZING') return; // 结果只采纳一次
      init = 'READY';
      // 转场时机由循环按门槛判定（不足 2.5s 继续播放加载动画）
    },
    fail(err) {
      if (destroyed || init === 'READY' || anim === 'SUCCESS_TRANSITION' || anim === 'ENTERED') return;
      init = 'ERROR';
      failAt = now();
      setAnim('FAILURE_DRAIN');
      overlay.classList.remove('sc-intro--loading'); // 立即停跳
      overlay.classList.remove('sc-intro--hop');
      overlay.classList.add('sc-intro--failed');
      loadingUi.hidden = true; // 失败态不再显示加载文案与进度条（概念图第三格）
      scene.setMode('drain'); // 停新生成，已有物体按原轨迹消散
      reasonEl.textContent = err.message || String(err);
      console.error('[intro] 初始化失败：', err.message || String(err));
    },
    onRetry(cb) {
      retryCb = cb;
    },
    onEntered(cb) {
      enteredCb = cb;
    },
    debug: () => ({
      anim, init, elapsedMs: Math.round(elapsed()), steps: [...done],
      counts: scene.counts(), loopRunning, listeners: removers.length,
      warpAtMs: warpAt === null ? null : Math.round(warpAt - t0),
      enteredAtMs: enteredAt === null ? null : Math.round(enteredAt - t0),
    }),
  };

  // ---------- 事件接线（一次性登记） ----------
  // 纸箱跳动每周期抖落粒子（CSS animationiteration 与跳动画同步）
  listen(hop, 'animationiteration', () => scene.hopBurst());
  listen(window, 'resize', () => scene.resize());
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopLoop(); // 页面隐藏停循环，省资源
      overlay.dataset.hidden = '1';
    } else {
      delete overlay.dataset.hidden;
      startLoop();
    }
  });
  listen(retryBtn, 'click', () => {
    if (anim !== 'FAILED') return;
    failedUi.hidden = true;
    loadingUi.hidden = false; // 重试恢复加载文案与进度条（里程碑续跑）
    overlay.classList.remove('sc-intro--failed');
    init = 'INITIALIZING';
    setAnim('LOADING');
    overlay.classList.add('sc-intro--loading');
    overlay.classList.add('sc-intro--hop'); // 重试恢复跳动
    scene.setMode('loading');
    retryCb?.();
  });

  updateProgress();
  startLoop();
  (window as unknown as Record<string, unknown>).__scIntro = handle; // 控制台排查/自动化取证
  singleton = handle;
  return handle;
}