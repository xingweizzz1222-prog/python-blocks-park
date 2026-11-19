/**
 * 运行时模块入口：Pyodide 加载 + 逐精灵执行 + 绿旗/暂停/重置/键盘编排。
 *
 * 运行控制语义（R18，取代 R1 绿旗语义）：
 * - 绿旗不承担重置：空闲→直接开始；运行→暂停（保留状态）；暂停→续跑；
 *   结束→轻量重启绿旗脚本（不重置角色位置、不重新初始化变量）；
 * - 暂停按钮：运行↔暂停切换（与绿旗共用同一调度器状态机）；
 * - 重置按钮唯一负责重置：终止执行、精灵回保存的初始基准（R14/R19）、
 *   清除气泡/声音/错误卡片与运行态，返回编辑状态。
 *
 * 执行流程（空闲/重置后首次启动）：
 * 1. 停止上一轮 → 加载 Pyodide（首次显示转圈渐变圆动画）；
 * 2. 逐精灵：无头工作区生成 Python → 注入该精灵的 stage 桥接 → 执行顶层注册；
 * 3. 派发全部"当⚑被点击"协程；按键/广播事件在运行期间持续派发；
 * 4. 全部协程结束 → 进入结束态（注册表保留，绿旗可轻量重启；编辑触发 R4 失效）。
 *
 * 异常保护（R8）：五类异常来源（语法/运行/桥接/引擎/超时）统一经 errors 模块
 * 分类定位（精灵/脚本行号），舞台错误卡片展示；出错即终止本轮并清理运行状态，
 * 编辑器保持可用；循环看门狗（bridge.loop_guard）防止死循环冻结主线程。
 */
import { loadPyodideRuntime, type PyodideLike } from './loader';
import { Scheduler, createBridge, createHandlers, isStopError } from './bridge';
import { createInput, attachInput, mapBrowserKey } from './input';
import { unlockAudio, stopAllSounds } from './sound';
import { classifyPythonError, looksLikePythonError, showErrorCard, clearErrorCard, type ScriptErrorInfo } from './errors';
import { generatePythonFromState } from '../blocks';
import { createCollision } from '../stage/collision';
import type { StageApi } from '../stage';

/** 运行时装配参数（DOM 按钮＋舞台＋脚本来源＋运行态回调，均由 main.ts 提供） */
export interface RuntimeOptions {
  stage: StageApi;
  /** 加载动画覆盖的容器（舞台宿主） */
  stageHost: HTMLElement;
  greenFlagBtn: HTMLButtonElement;
  /** 暂停/继续切换按钮 */
  pauseBtn: HTMLButtonElement;
  /** 重置按钮 */
  resetBtn: HTMLButtonElement;
  /** 收集全部精灵的 id + 脚本状态（main.ts 提供） */
  getSprites(): Array<{ id: string; workspace: Record<string, unknown> }>;
  onRunningChange(running: boolean): void;
  onPausedChange(paused: boolean): void;
  /** UI-03 成功态观测回调：仅在状态机真实迁移点调用（绿旗四迁移/暂停两迁移），
   *  供成功态扩散波纹使用；无效点击（加载/注册守卫期、结束态按暂停）不调用。
   *  纯观测钩子，不参与任何控制逻辑。 */
  onFeedback?: (kind: 'flag' | 'pause') => void;
}

/** 运行时对外 API（绿旗/暂停/重置/失效，语义见模块头注释 R18/R4） */
export interface RuntimeApi {
  /** 绿旗状态机（R18）：空闲→开始；运行→暂停；暂停→续跑；结束→轻量重启（不重置位置） */
  flag(): Promise<void>;
  /** 暂停/继续切换（结束态无作用） */
  pause(): void;
  /** 终止执行并恢复保存的初始基准（唯一重置入口，R18） */
  reset(): void;
  /** 工作区/精灵结构变化：终止旧协程并释放注入对象（R4 实时同步） */
  invalidate(): void;
  /** 调试句柄：取已加载的 Pyodide 实例（未加载为 null）；供控制台排查与自动化联调 */
  debugPyodide(): PyodideLike | null;
}

/** 初始化运行时并接线按钮/键盘 */
export function initRuntime(opts: RuntimeOptions): RuntimeApi {
  const sched = new Scheduler();
  sched.onRunningChange = opts.onRunningChange;
  sched.onPausedChange = opts.onPausedChange;

  let pyodide: PyodideLike | null = null;
  let loading = false;
  /** 注册进行中（R18）：绿旗此间不响应，防止对半建成的注册表重复派发 */
  let starting = false;
  /** 上一轮运行注入的 Python globals 代理与 js 桥接键（新一轮开始时释放） */
  let lastGlobals: Array<{ destroy(): void }> = [];
  let lastBridgeKeys: string[] = [];
  /** 上一轮桥接对象（释放时 dispose：停监视器轮询等，R6） */
  let lastBridges: Array<{ dispose(): void }> = [];
  /** 共享侦测输入（R6）：键盘/鼠标/计时器，主页面挂载一次 */
  const input = createInput();
  /** 共享碰撞检测器（R15）：遮罩缓存跨精灵/跨轮复用 */
  const collision = createCollision(opts.stage);
  const canvas = opts.stageHost.querySelector('canvas');
  if (canvas) attachInput(input, canvas);
  /** 运行纪元（R4）：invalidate 自增。Blockly 的变更事件经 setTimeout 异步派发，
   *  可能在绿旗启动后才落地；注册循环发现纪元变化即干净中止本轮，
   *  避免释放正在注册的桥接对象导致 Python 侧 AttributeError。 */
  let runEpoch = 0;

  function releaseLastRun(): void {
    for (const b of lastBridges) b.dispose();
    for (const g of lastGlobals) {
      try {
        g.destroy();
      } catch {
        /* 已释放则忽略 */
      }
    }
    for (const k of lastBridgeKeys) delete (globalThis as Record<string, unknown>)[k];
    lastGlobals = [];
    lastBridgeKeys = [];
    lastBridges = [];
  }

  /** 统一错误处置（R8）：展示结构化错误卡片 → 终止本轮全部脚本并释放运行状态。
   *  出错后编辑器保持可用（积木/代码视图/保存不受影响），绿旗可重新运行。
   *  注意：本回调可能在 Python 协程 unwind 过程中触发，释放的只是 globals/桥接键，
   *  协程包装器 finally 仅调用 stage.task_finished()，不访问已释放对象。 */
  function handleScriptError(info: ScriptErrorInfo): void {
    showErrorCard(opts.stageHost, info);
    runEpoch++; // 注册循环若仍在进行，发现纪元变化即干净中止
    sched.stop();
    releaseLastRun();
  }
  sched.onError = handleScriptError;

  /** 重置（R18 唯一重置入口）：终止协程 + 释放注入对象 + 精灵回保存的初始基准（R14/R19） */
  function reset(): void {
    sched.stop();
    releaseLastRun();
    stopAllSounds(); // 重置同时止声（R6）
    clearErrorCard(opts.stageHost); // 异常状态一并清除（R8）
    opts.stage.resetToInitial();
  }

  /** 实时同步（R4）：工作区变更/精灵删除/导入时调用。
   *  终止旧协程并释放 globals/桥接；暂停态一并清除——
   *  内容已变，旧进度不再有意义，下次绿旗以当前工作区重新生成执行。 */
  function invalidate(): void {
    runEpoch++;
    sched.stop();
    releaseLastRun();
  }

  /** 暂停/继续切换（暂停态保留全部运行状态） */
  function pause(): void {
    if (sched.stopped) return;
    if (sched.paused) {
      sched.resume();
      opts.onFeedback?.('pause'); // 暂停→续跑：真实迁移（UI-03）
    } else if (sched.active) {
      sched.pause();
      opts.onFeedback?.('pause'); // 运行→暂停：真实迁移（UI-03）
    }
    // 结束态（无活动协程）：sched.pause 本就无作用，无迁移不播波纹（UI-03）
  }

  /** 绿旗状态机（R18，不再承担重置）：
   *  暂停→续跑；运行→暂停（保留状态）；结束→轻量重启绿旗脚本（不重置位置）；
   *  空闲（首次/重置后/失效后）→ 完整启动。加载与注册期间不响应。 */
  async function flag(): Promise<void> {
    unlockAudio(); // 用户手势内解锁 WebAudio（R6 自动播放策略）
    if (loading || starting) return;
    if (sched.paused) {
      sched.resume();
      opts.onFeedback?.('flag'); // 暂停→续跑：真实迁移（UI-03）
      return;
    }
    if (!sched.stopped) {
      if (sched.active) {
        sched.pause(); // 运行→暂停：冻结全部协程，进度/位置/气泡保留
        opts.onFeedback?.('flag'); // 运行→暂停：真实迁移（UI-03）
        return;
      }
      // 结束态：注册表仍有效（编辑会经 R4 invalidate 回到空闲态），
      // 直接重新派发绿旗脚本——不重置角色位置、不重新初始化变量（执行方定：
      // 轻量重启比重跑顶层更贴近 Scratch"变量跨绿旗保留"语义，且无 Pyodide 往返）
      console.log('[runtime] 绿旗：结束态轻量重启');
      sched.dispatchFlag();
      opts.onFeedback?.('flag'); // 结束→重启：真实迁移（UI-03）
      return;
    }
    await run(); // 空闲→开始（R18：启动不再重置位置）
  }

  async function run(): Promise<void> {
    if (loading || starting) return;
    starting = true;
    try {
      sched.stop(); // 新一轮：先停上一轮（仅终止协程，不动精灵位置，R18）
      loading = true;
      const epoch = runEpoch;
      console.log('[runtime] 绿旗：开始加载 Pyodide');
      try {
        pyodide = await loadPyodideRuntime(opts.stageHost);
      } catch (e) {
        console.error('[runtime] Pyodide 加载失败', e);
        loading = false;
        return; // 加载器已显示错误与重试
      }
      loading = false;
      // 加载期间工作区被编辑/导入（invalidate）：本轮作废，下次绿旗重新生成
      if (epoch !== runEpoch) return;
      console.log('[runtime] Pyodide 就绪，开始执行脚本');

      sched.begin();
      opts.onRunningChange(true);
      opts.onFeedback?.('flag'); // 空闲→开始：状态机已离开 stopped（UI-03）
      clearErrorCard(opts.stageHost); // 新一轮运行清除上一轮错误卡片（R8）

      // 逐精灵生成并执行顶层代码（注册事件处理器）
      releaseLastRun(); // 释放上一轮的 globals/桥接引用
      for (const { id, workspace } of opts.getSprites()) {
        // 注册过程中被 invalidate（异步落地的编辑事件等）：干净中止本轮
        if (epoch !== runEpoch) return;
        const generated = generatePythonFromState(workspace);
        // 桥接对象挂到 globalThis，经 Python 的 js 模块取回（保持 JsProxy，
        // 不能用 toPy 注入——那会把对象递归转成 dict，丢失方法）
        const bridgeKey = `__stage_bridge_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        // 每个精灵独立 globals，避免 _script_N 等名字互相覆盖；
        // 事件按函数名注册，派发时从该 globals 取函数（规避跨语言代理生命周期问题）
        const globals = pyodide.toPy({}) as { destroy(): void; get(k: string): unknown };
        lastGlobals.push(globals);
        const handlers = createHandlers(globals, id);
        sched.registry.push(handlers);
        (globalThis as Record<string, unknown>)[bridgeKey] = createBridge(id, opts.stage, sched, handlers, input, collision);
        lastBridges.push((globalThis as Record<string, unknown>)[bridgeKey] as { dispose(): void });
        lastBridgeKeys.push(bridgeKey);
        // 运行时前导：注入 stage 桥接 + Python 侧协程派发器 __spawn。
        // 派发必须在 Python 侧用 asyncio.ensure_future 完成，
        // JS 侧直接 await 协程代理无法正确驱动协程。
        // R8：协程异常用 traceback.format_exc() 回传完整栈，供错误卡片定位行号。
        const preamble = [
          'import asyncio as _asyncio',
          'import traceback as _traceback',
          'import js',
          `stage = js.${bridgeKey}`,
          '_tasks = set()',
          'def __spawn(name):',
          '    async def __wrap():',
          '        stage.task_started()',
          '        try:',
          '            await globals()[name]()',
          '        except Exception as _e:',
          '            stage.report_error(_traceback.format_exc())',
          '        finally:',
          '            stage.task_finished()',
          '    _t = _asyncio.ensure_future(__wrap())',
          '    _tasks.add(_t)',
          '    _t.add_done_callback(_tasks.discard)',
          '',
        ].join('\n');
        // 前导行数：traceback 整体行号 − 前导行数 = 生成脚本行号（R8 定位）
        sched.preambleLines = preamble.split('\n').length - 1;
        const code = preamble + generated;
        try {
          await pyodide.runPythonAsync(code, { globals });
        } catch (e) {
          console.error('[runtime] 顶层执行出错', e);
          if (isStopError(e)) continue;
          // R8：语法/运行/桥接/引擎四类来源统一分类展示，并终止本轮运行
          const raw = e instanceof Error ? e.message : String(e);
          const spriteName = opts.stage.getSprite(id)?.name;
          const info = looksLikePythonError(raw)
            ? classifyPythonError(raw, { spriteName, preambleLines: sched.preambleLines })
            : { kind: 'engine' as const, spriteName, message: raw };
          handleScriptError(info);
          return; // 注册失败：不再继续后续精灵，绿旗可重试
        }
      }

      // 派发绿旗脚本
      console.log('[runtime] 派发绿旗脚本');
      sched.dispatchFlag();
    } finally {
      starting = false;
    }
  }

  opts.greenFlagBtn.addEventListener('click', () => void flag());
  opts.pauseBtn.addEventListener('click', pause);
  opts.resetBtn.addEventListener('click', reset);

  // 运行期间响应按键事件（并阻止空格/方向键滚动页面）；暂停态不派发
  window.addEventListener('keydown', (e) => {
    if (sched.stopped || sched.paused) return;
    const key = mapBrowserKey(e);
    if (!key) return;
    // 焦点在输入框/Blockly 文本编辑时不拦截
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    e.preventDefault();
    sched.dispatchKey(key);
  });

  // ---------- 碰撞事件监视器（R15）----------
  // 运行期间 ~30fps 巡检"当碰到[角色]"注册表：上升沿（未碰→碰）派发一次；
  // 持续接触不重复；离开解除；再进入重新触发；每对角色独立维护状态。
  // 编辑态拖拽不经过这里（sched.stopped 直接返回），不会触发游戏事件（R15.1）。
  /** 每对角色的当前碰撞状态（selfId|otherId → touching） */
  const touchState = new Map<string, boolean>();
  let watcherWasStopped = true;
  window.setInterval(() => {
    if (sched.stopped) {
      if (!watcherWasStopped) touchState.clear(); // 运行结束清状态：下轮从"未碰"起算
      watcherWasStopped = true;
      return;
    }
    watcherWasStopped = false;
    if (sched.paused) return; // 暂停冻结碰撞事件（与脚本冻结语义一致）
    const sprites = opts.stage.getSprites();
    for (const h of sched.registry) {
      if (h.touch.size === 0) continue;
      const self = sprites.find((s) => s.id === h.spriteId);
      if (!self || !self.visible) continue;
      for (const target of h.touch.keys()) {
        const other = sprites.find((s) => s.name === target);
        const key = `${self.id}|${other?.id ?? target}`;
        if (!other || other.id === self.id || !other.visible) {
          touchState.set(key, false); // 目标缺失/隐藏＝未碰；恢复后接触算新一轮进入
          continue;
        }
        const now = collision.touching(self, other);
        const prev = touchState.get(key) ?? false;
        if (now && !prev) sched.dispatchTouch(self.id, target);
        touchState.set(key, now);
      }
    }
  }, 33);

  return { flag, pause, reset, invalidate, debugPyodide: () => pyodide };
}