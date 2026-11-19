/**
 * Python ↔ JS 舞台桥接：把生成的 Python 指令翻译为舞台操作。
 *
 * 契约（与 blocks/generators.ts 对应）：
 * - 每个精灵一个 bridge 实例，作为 `stage` 注入该精灵的 Python 全局；
 * - 指令方法均为 async，Python 侧 `await stage.xxx()`；
 * - on_flag/on_key/on_message 注册 Python 协程函数，由调度器统一派发；
 * - tick() 以约 30fps 节流循环（与 Scratch 节奏一致），并让出事件循环；
 * - 停止时所有阻塞点抛出 StopError，快速 unwind 全部脚本。
 */
import type { StageApi } from '../stage';
import { nextCostumeKey } from '../stage/costumes';
import { STAGE_W, STAGE_H, type StageSprite } from '../stage/render';
import type { CollisionApi } from '../stage/collision';
import { isAssetCostume } from '../assets';
import { createSensing } from '../sensing';
import type { InputState } from './input';
import { playSound, stopAllSounds } from './sound';
import { classifyPythonError, TIMEOUT_MARKER, type ScriptErrorInfo } from './errors';

/** 循环看门狗预算（R8）：连续同步执行超过该时长未让出控制权即判定疑似死循环。
 *  正常循环每轮末尾有 tick()（约 33ms 睡眠）持续刷新让出时间，不会触发。 */
const LOOP_BUDGET_MS = 2000;

/** 停止信号异常：跨 Python/JS 边界按 name 识别 */
export class StopError extends Error {
  constructor() {
    super('script stopped');
    this.name = 'StopError';
  }
}

/** 判断捕获到的异常是否为停止信号。
 *  注意：JS 抛出的 StopError 经 Python 回传后会被 Pyodide 包装成
 *  JsException/PythonError，原始名字丢失，只能按消息标记识别。 */
export function isStopError(e: unknown): boolean {
  if (e instanceof StopError) return true;
  const err = e as Error | undefined;
  if (err?.name === 'StopError') return true;
  return typeof err?.message === 'string' && err.message.includes('StopError: script stopped');
}

/** Python globals 字典代理（按名取函数） */
export interface GlobalsDict {
  get(key: string): unknown;
  destroy(): void;
}

/** 单个精灵脚本注册的事件处理器（存函数名，派发时从 globals 取） */
export interface ScriptHandlers {
  /** 归属精灵 id（R15 碰撞事件派发按精灵定位） */
  spriteId: string;
  flag: string[];
  key: Map<string, string[]>;
  message: Map<string, string[]>;
  /** 碰撞事件（R15）：目标角色名 → 处理函数名列表 */
  touch: Map<string, string[]>;
  /** 该精灵的 Python globals（函数定义所在） */
  globals: GlobalsDict;
}

/** 创建空的事件处理器表（每个精灵一份；注册时往 map 里填函数名） */
export function createHandlers(globals: GlobalsDict, spriteId: string): ScriptHandlers {
  return { spriteId, flag: [], key: new Map(), message: new Map(), touch: new Map(), globals };
}

/** 脚本调度器：跟踪运行中的协程任务，统一停止/派发。
 *  派发走 Python 侧 __spawn（asyncio.ensure_future），
 *  不在 JS 侧 await 协程代理（那样协程得不到正确驱动）。
 *  R18 状态机基础：stopped（空闲/已重置）、paused（冻结）、
 *  active（有协程在跑或已派发未起）、其余为"结束态"（注册表保留，可轻量重启）。 */
export class Scheduler {
  stopped = true;
  /** 暂停态：协程存活但冻结在指令边界/睡眠中，可续跑（R18 沿用 R1 冻结机制） */
  paused = false;
  private busy = 0;
  /** 已派发但 Python 协程尚未执行 task_started 的间隙计数（R18）：
   *  防止"派发→协程启动"窗口内绿旗被误判为结束态而重复派发 */
  private pending = 0;
  /** 停止信号：stop() 时 reject，所有阻塞点竞速退出 */
  stopSignal: Promise<never> = Promise.reject(new StopError());
  private stopReject: ((e: StopError) => void) | null = null;
  /** 续跑信号：pause() 时重建为 pending，resume() 时 resolve（gate 等待它） */
  private resumeSignal: Promise<void> = Promise.resolve();
  private resumeResolve: (() => void) | null = null;
  /** 进入暂停信号：pause() 时 resolve 旧信号，打断睡眠计时以冻结剩余时长 */
  private pauseSignal: Promise<void> = new Promise(() => undefined);
  private pauseResolve: (() => void) | null = null;
  /** 全部精灵的事件注册表（每次运行重建） */
  registry: ScriptHandlers[] = [];
  onRunningChange: (running: boolean) => void = () => undefined;
  onPausedChange: (paused: boolean) => void = () => undefined;
  /** 结构化错误回调（R8）：runtime 装配后负责展示错误卡片并终止本轮运行 */
  onError: (info: ScriptErrorInfo) => void = () => undefined;
  /** 最近一次真实让出控制权（宏任务睡眠完成）的时刻；循环看门狗据此判定卡死 */
  lastYield = 0;
  /** 运行前导行数（R8 行号定位）：traceback 整体行号 − 前导行数 = 生成脚本行号 */
  preambleLines = 0;

  constructor() {
    // 初始 stopSignal 无人 await 时避免 unhandledrejection 噪音
    this.stopSignal.catch(() => undefined);
  }

  /** 是否有脚本在活动（运行中或已派发未启动）；R18 绿旗状态机据此区分运行/结束 */
  get active(): boolean {
    return this.busy > 0 || this.pending > 0;
  }

  /** 开始新一轮运行 */
  begin(): void {
    this.stopped = false;
    this.paused = false;
    this.busy = 0;
    this.pending = 0;
    this.registry = [];
    this.stopSignal = new Promise<never>((_, reject) => {
      this.stopReject = reject;
    });
    this.stopSignal.catch(() => undefined);
    this.resumeSignal = Promise.resolve();
    this.resumeResolve = null;
    // 首轮暂停也要能打断睡眠计时：pauseSignal 自带 resolver（清理回归发现的既有缺陷修复）
    this.pauseSignal = new Promise<void>((resolve) => {
      this.pauseResolve = resolve;
    });
    this.lastYield = performance.now();
  }

  /** 记录一次真实让出（睡眠完成时调用；微任务让出不算，页面仍可能饿死） */
  noteYield(): void {
    this.lastYield = performance.now();
  }

  /** 暂停门：非暂停立即通过；暂停时等待续跑或停止信号（停止则抛 StopError unwind） */
  gate(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return Promise.race([this.resumeSignal, this.stopSignal]);
  }

  /** 当前"进入暂停"信号（睡眠计时用它打断，冻结剩余时长） */
  pauseNotice(): Promise<void> {
    return this.pauseSignal;
  }

  /** 暂停：冻结全部协程（保留进度/位置/气泡），可续跑。
   *  结束态（无活动协程）不进入暂停——没有可冻结的对象（R18） */
  pause(): void {
    if (this.stopped || this.paused || !this.active) return;
    this.paused = true;
    this.noteYield(); // 暂停冻结不计入看门狗预算（R8）
    this.resumeSignal = new Promise<void>((resolve) => {
      this.resumeResolve = resolve;
    });
    this.pauseResolve?.(); // 唤醒正在计时的睡眠，让其进入 gate 等待
    this.pauseSignal = new Promise<void>((resolve) => {
      this.pauseResolve = resolve;
    });
    this.onPausedChange(true);
  }

  /** 续跑：从冻结处继续（位移/计时连续） */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.noteYield(); // 续跑重新起算看门狗预算（R8）
    this.resumeResolve?.();
    this.resumeResolve = null;
    this.onPausedChange(false);
  }

  /** 派发一个脚本：调用该精灵 Python 侧的 __spawn(函数名)。
   *  pending 同步计数覆盖"派发→协程启动"间隙（R18 防重复派发） */
  spawn(entry: ScriptHandlers, name: string): void {
    if (this.stopped) return;
    const spawnFn = entry.globals.get('__spawn') as ((n: string) => unknown) | undefined;
    if (typeof spawnFn !== 'function') {
      this.onError({ kind: 'engine', message: `精灵脚本未就绪（缺少 __spawn）：${name}` });
      return;
    }
    // 空闲后首次派发：重置看门狗预算（R18）——结束态/等待事件期间的时间
    // 不是脚本执行，不能计入"连续未让出"时长（否则结束一段时间后重启/按键触发
    // 会在第一轮 loop_guard 即误报超时）
    if (!this.active) this.noteYield();
    this.pending++;
    try {
      spawnFn(name);
    } catch (e) {
      this.pending--;
      if (!isStopError(e)) {
        console.error('[runtime] 派发失败', e);
        this.onError(classifyPythonError(e instanceof Error ? e.message : String(e)));
      }
    } finally {
      (spawnFn as { destroy?: () => void }).destroy?.();
    }
  }

  /** Python 协程开始/结束回调（维护运行高亮与拖拽禁用） */
  taskStarted(): void {
    this.pending = Math.max(0, this.pending - 1);
    this.busy++;
    this.onRunningChange(true);
  }
  taskFinished(): void {
    this.busy = Math.max(0, this.busy - 1);
    this.onRunningChange(this.active);
  }

  /** 停止全部脚本（重置/终止）：暂停态一并清除 */
  stop(): void {
    this.stopped = true;
    this.paused = false;
    this.busy = 0;
    this.pending = 0;
    this.stopReject?.(new StopError());
    this.onPausedChange(false);
    this.onRunningChange(false);
  }

  /** 绿旗：派发所有 flag 处理器（无脚本时保持监听按键/广播） */
  dispatchFlag(): void {
    for (const h of this.registry) for (const name of h.flag) this.spawn(h, name);
    this.onRunningChange(this.active);
  }

  /** 按键：派发匹配处理器（R17 修复："任意"帽对每个具体按键都派发） */
  dispatchKey(key: string): void {
    for (const h of this.registry) {
      for (const name of h.key.get(key) ?? []) this.spawn(h, name);
      if (key !== 'any') for (const name of h.key.get('any') ?? []) this.spawn(h, name);
    }
  }

  /** 广播：派发匹配消息处理器 */
  dispatchMessage(msg: string): void {
    for (const h of this.registry) for (const name of h.message.get(msg) ?? []) this.spawn(h, name);
  }

  /** 碰撞事件（R15）：派发指定精灵"当碰到目标"处理器（上升沿由监视器判定） */
  dispatchTouch(spriteId: string, target: string): void {
    for (const h of this.registry) {
      if (h.spriteId !== spriteId) continue;
      for (const name of h.touch.get(target) ?? []) this.spawn(h, name);
    }
  }
}

/** 可被停止/暂停打断的 sleep：暂停时冻结剩余时长，续跑后继续计完（R1） */
async function interruptibleSleep(ms: number, sched: Scheduler): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    await sched.gate(); // 暂停中：在此冻结，不消耗时间
    const start = performance.now();
    const timer = new Promise<void>((resolve) => setTimeout(resolve, remaining));
    const outcome = await Promise.race([
      timer.then(() => 'done' as const),
      sched.stopSignal, // reject → StopError unwind
      sched.pauseNotice().then(() => 'paused' as const),
    ]);
    if (outcome === 'done') {
      sched.noteYield(); // 真实宏任务让出：刷新看门狗计时（R8）
      return;
    }
    remaining -= performance.now() - start; // 暂停/续跑后只补剩余时长
  }
}

/** 创建绑定到指定精灵的 stage 桥接对象。
 *  collision（R15）：运行时共享的碰撞检测器（遮罩缓存跨精灵复用） */
export function createBridge(
  spriteId: string,
  stage: StageApi,
  sched: Scheduler,
  handlers: ScriptHandlers,
  input: InputState,
  collision: CollisionApi,
) {
  /** 每条指令前检查停止信号 */
  const guard = () => {
    if (sched.stopped) throw new StopError();
  };
  const sprite = () => stage.getSprite(spriteId);
  // R11 颜色侦测采样器（离屏画布懒创建；StageApi 满足 SensingDeps）
  const sensing = createSensing(stage);
  /** Scratch 方向 → 位移增量（90 右 / 0 上） */
  const delta = (steps: number, dir: number) => {
    const rad = (dir * Math.PI) / 180;
    return { dx: steps * Math.sin(rad), dy: steps * Math.cos(rad) };
  };
  /** 数值参数兜底：Pyodide 把 Python None 传为 undefined，Number 后得 NaN；
   *  文本等非法值同样会得到 NaN。按 Scratch 语义一律回退默认值，防止 NaN 污染坐标 */
  const fin = (v: unknown, fb = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  /** 说话内容：None/undefined 视为空串（Scratch 说空串＝清除气泡） */
  const sayText = (t: unknown): string => (t == null ? '' : String(t));
  /** 精灵包围盒（造型尺寸×大小%，舞台逻辑坐标），边缘/鼠标命中用。
   *  尺寸经舞台统一解析（内置造型或自定义素材，R10）；
   *  角色-角色碰撞已升级 R15 判定区（collision 模块），不再用包围盒 */
  const boxOf = (s: StageSprite) => {
    const c = stage.getCostumeDims(s.costume);
    const hw = (c.width * s.size) / 200;
    const hh = (c.height * s.size) / 200;
    return { l: s.x - hw, r: s.x + hw, b: s.y - hh, t: s.y + hh };
  };
  /** 按名称找精灵（侦测"碰到精灵/距离"用） */
  const byName = (name: unknown): StageSprite | undefined =>
    stage.getSprites().find((s) => s.name === String(name));
  /** 面向某点的 Scratch 方向角 */
  const dirTowards = (s: StageSprite, tx: number, ty: number): number =>
    (Math.atan2(tx - s.x, ty - s.y) * 180) / Math.PI;

  // ---------- 声音音量（每精灵独立，0-100） ----------
  let volume = 100;
  /** 特效写入（夹取到 Scratch 取值范围） */
  const applyEffect = (e: string, v: number): void => {
    if (e === 'ghost') stage.patch(spriteId, { ghost: Math.max(0, Math.min(100, v)) });
    else if (e === 'brightness') stage.patch(spriteId, { brightness: Math.max(-100, Math.min(100, v)) });
    else if (e === 'color') stage.patch(spriteId, { color: Math.max(0, Math.min(200, v)) });
  };

  // ---------- 变量监视器（R6）：轮询该精灵 Python globals 取值挂牌 ----------
  const monitorNames = new Set<string>();
  let monitorTimer: number | null = null;
  function pollMonitors(): void {
    for (const name of monitorNames) {
      let v: unknown = 0;
      try {
        v = handlers.globals.get(name);
      } catch {
        return; // globals 已释放：停止轮询
      }
      const val = typeof v === 'number' ? v : v == null ? 0 : String(v);
      stage.setMonitor(spriteId, name, val);
    }
  }
  function startMonitorPoll(): void {
    if (monitorTimer !== null) return;
    pollMonitors();
    monitorTimer = window.setInterval(pollMonitors, 200);
  }
  function stopMonitorPoll(): void {
    if (monitorTimer !== null) {
      window.clearInterval(monitorTimer);
      monitorTimer = null;
    }
  }

  return {
    // ---------- 运动 ----------
    async move(steps: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const s = sprite();
      if (!s) return;
      const { dx, dy } = delta(fin(steps), s.direction);
      stage.patch(spriteId, { x: s.x + dx, y: s.y + dy });
    },
    async turn_right(deg: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const s = sprite();
      if (s) stage.patch(spriteId, { direction: s.direction + fin(deg) });
    },
    async turn_left(deg: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const s = sprite();
      if (s) stage.patch(spriteId, { direction: s.direction - fin(deg) });
    },
    async point_dir(dir: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { direction: fin(dir, 90) });
    },
    async goto_xy(x: number, y: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { x: fin(x), y: fin(y) });
    },
    async change_x(dx: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const s = sprite();
      if (s) stage.patch(spriteId, { x: s.x + fin(dx) });
    },
    async set_x(x: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { x: fin(x) });
    },
    async change_y(dy: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const s = sprite();
      if (s) stage.patch(spriteId, { y: s.y + fin(dy) });
    },
    async set_y(y: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { y: fin(y) });
    },
    async bounce() {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.bounce(spriteId);
    },
    /** 滑行：secs 秒内匀速插值到目标点（暂停时冻结进度，R1 语义一致） */
    async glide(secs: number, x: number, y: number) {
      guard();
      await sched.gate();
      const s = sprite();
      if (!s) return;
      const ms = Math.max(0, fin(secs) * 1000);
      const tx = fin(x);
      const ty = fin(y);
      const frames = Math.max(1, Math.round(ms / (1000 / 30)));
      const fx = s.x;
      const fy = s.y;
      for (let i = 1; i <= frames; i++) {
        await sched.gate();
        const t = i / frames;
        stage.patch(spriteId, { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t });
        await interruptibleSleep(ms / frames, sched);
      }
    },
    /** 移到菜单目标：随机位置 / 鼠标指针 */
    async goto_menu(target: unknown) {
      guard();
      await sched.gate();
      const t = String(target);
      if (t === 'mouse') stage.patch(spriteId, { x: input.mouseX, y: input.mouseY });
      else
        stage.patch(spriteId, {
          x: Math.random() * STAGE_W - STAGE_W / 2,
          y: Math.random() * STAGE_H - STAGE_H / 2,
        });
    },
    /** 面向菜单目标：鼠标指针 / 指定名称精灵 */
    async point_towards(target: unknown) {
      guard();
      await sched.gate();
      const s = sprite();
      if (!s) return;
      const t = String(target);
      const other = t === 'mouse' ? null : byName(t);
      const tx = t === 'mouse' ? input.mouseX : other?.x;
      const ty = t === 'mouse' ? input.mouseY : other?.y;
      if (tx === undefined || ty === undefined) return;
      stage.patch(spriteId, { direction: dirTowards(s, tx, ty) });
    },

    // ---------- 外观 ----------
    async say(text: unknown) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const str = sayText(text);
      stage.say(spriteId, str === '' ? null : str);
    },
    async say_for(text: unknown, secs: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const str = sayText(text);
      stage.say(spriteId, str === '' ? null : str);
      await interruptibleSleep(fin(secs) * 1000, sched);
      // 仅当气泡仍是自己设置的内容时才清除，避免覆盖后续 say
      if (str !== '' && sprite()?.say === str) stage.say(spriteId, null);
    },
    /** 清除气泡（R3）：与"说空字符串"同语义的显式积木 */
    async clear_say() {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.say(spriteId, null);
    },
    async show() {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { visible: true });
    },
    async hide() {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { visible: false });
    },
    async set_size(pct: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      stage.patch(spriteId, { size: Math.max(5, Math.min(500, fin(pct, 100))) });
    },
    async change_size(d: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      const s = sprite();
      if (s) stage.patch(spriteId, { size: Math.max(5, Math.min(500, s.size + fin(d))) });
    },
    /** 切换造型（R6：下拉为全部内置造型） */
    async switch_costume(key: unknown) {
      guard();
      await sched.gate();
      stage.patch(spriteId, { costume: String(key) });
    },
    /** 下一个造型：同族变体循环（cat → cat2 → cat）；
     *  自定义素材造型无族内变体，保持不变（R10） */
    async next_costume() {
      guard();
      await sched.gate();
      const s = sprite();
      if (!s) return;
      if (isAssetCostume(s.costume)) return;
      stage.patch(spriteId, { costume: nextCostumeKey(s.costume) });
    },
    /** 设特效：ghost 0-100 / brightness -100..100 / color 0-200 */
    async set_effect(effect: unknown, value: number) {
      guard();
      await sched.gate();
      applyEffect(String(effect), fin(value));
    },
    async change_effect(effect: unknown, delta: number) {
      guard();
      await sched.gate();
      const s = sprite();
      if (!s) return;
      const e = String(effect);
      const cur = e === 'ghost' ? s.ghost : e === 'brightness' ? s.brightness : s.color;
      applyEffect(e, cur + fin(delta));
    },
    /** 清除全部特效 */
    async clear_effects() {
      guard();
      await sched.gate();
      stage.patch(spriteId, { ghost: 0, brightness: 0, color: 0 });
    },

    // ---------- 图层（R12）：只改显示顺序，不动坐标/逻辑碰撞 ----------
    async layer_front() {
      guard();
      await sched.gate();
      stage.moveLayer(spriteId, 'front');
    },
    async layer_back() {
      guard();
      await sched.gate();
      stage.moveLayer(spriteId, 'back');
    },
    async layer_forward() {
      guard();
      await sched.gate();
      stage.moveLayer(spriteId, 'forward');
    },
    async layer_backward() {
      guard();
      await sched.gate();
      stage.moveLayer(spriteId, 'backward');
    },

    // ---------- 控制 ----------
    async wait(secs: number) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      await interruptibleSleep(fin(secs) * 1000, sched);
    },
    /** 循环末尾节流：约 30fps，与 Scratch 节奏一致 */
    async tick() {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      await interruptibleSleep(1000 / 30, sched);
    },
    /** 循环看门狗（R8）：生成器在每轮循环体开头插入的同步检查。
     *  连续同步执行超预算（无真实让出）即抛超时异常终止该脚本，
     *  防止不带 tick 的死循环永久冻结编辑器主线程。 */
    loop_guard() {
      guard();
      if (performance.now() - sched.lastYield > LOOP_BUDGET_MS) {
        throw new Error(`${TIMEOUT_MARKER}: 脚本连续运行超过 ${LOOP_BUDGET_MS / 1000} 秒未让出控制权，已自动停止（疑似死循环）`);
      }
    },
    async broadcast(msg: unknown) {
      guard();
      await sched.gate(); // 暂停态冻结在指令边界（R1）
      sched.dispatchMessage(String(msg));
    },
    /** 停止全部脚本：抛出停止信号终止当前协程 */
    stop_all() {
      sched.stop();
      throw new StopError();
    },

    // ---------- 侦测（R6：同步表达式，Scratch 语义） ----------
    touching_edge(): boolean {
      const s = sprite();
      if (!s || !s.visible) return false;
      const b = boxOf(s);
      return b.l <= -STAGE_W / 2 || b.r >= STAGE_W / 2 || b.b <= -STAGE_H / 2 || b.t >= STAGE_H / 2;
    },
    touching_sprite(name: unknown): boolean {
      const s = sprite();
      const o = byName(name);
      if (!s || !o) return false;
      // R15：统一判定区碰撞（自动/矩形/圆形/透明像素），替换 R6 包围盒
      return collision.touching(s, o);
    },
    touching_mouse(): boolean {
      const s = sprite();
      if (!s || !s.visible) return false;
      const b = boxOf(s);
      return input.mouseX >= b.l && input.mouseX <= b.r && input.mouseY >= b.b && input.mouseY <= b.t;
    },
    // R11 颜色侦测：离屏逻辑分辨率采样（sensing 模块），容差匹配、透明不算边界
    touching_color(hex: unknown): boolean {
      const s = sprite();
      if (!s || !s.visible) return false;
      return sensing.touchingColor(s.id, String(hex));
    },
    color_touching_color(hex1: unknown, hex2: unknown): boolean {
      const s = sprite();
      if (!s || !s.visible) return false;
      return sensing.colorTouchingColor(s.id, String(hex1), String(hex2));
    },
    key_pressed(key: unknown): boolean {
      const k = String(key);
      return k === 'any' ? input.keys.size > 0 : input.keys.has(k);
    },
    mouse_down(): boolean {
      return input.mouseDown;
    },
    mouse_x(): number {
      return input.mouseX;
    },
    mouse_y(): number {
      return input.mouseY;
    },
    distance_to(target: unknown): number {
      const s = sprite();
      if (!s) return 0;
      const t = String(target);
      const o = t === 'mouse' ? null : byName(t);
      const tx = t === 'mouse' ? input.mouseX : o?.x;
      const ty = t === 'mouse' ? input.mouseY : o?.y;
      if (tx === undefined || ty === undefined) return 10000; // Scratch：目标不存在时的大数
      return Math.hypot(tx - s.x, ty - s.y);
    },
    timer(): number {
      return (performance.now() - input.timerStart) / 1000;
    },
    async reset_timer() {
      guard();
      await sched.gate();
      input.timerStart = performance.now();
    },

    // ---------- 声音（R6：WebAudio 本地合成） ----------
    async play_sound(name: unknown) {
      guard();
      await sched.gate();
      playSound(String(name), volume);
    },
    async play_sound_until_done(name: unknown) {
      guard();
      await sched.gate();
      const dur = playSound(String(name), volume);
      await interruptibleSleep(dur * 1000, sched);
    },
    async stop_sounds() {
      guard();
      await sched.gate();
      stopAllSounds();
    },
    async set_volume(v: number) {
      guard();
      await sched.gate();
      volume = Math.max(0, Math.min(100, fin(v, 100)));
    },
    async change_volume(d: number) {
      guard();
      await sched.gate();
      volume = Math.max(0, Math.min(100, volume + fin(d)));
    },
    volume(): number {
      return volume;
    },

    // ---------- 变量监视器（R6：显示/隐藏变量挂牌） ----------
    monitor_on(name: unknown) {
      const n = String(name);
      monitorNames.add(n);
      startMonitorPoll();
    },
    monitor_off(name: unknown) {
      const n = String(name);
      monitorNames.delete(n);
      stage.removeMonitor(spriteId, n);
      if (monitorNames.size === 0) stopMonitorPoll();
    },
    /** 运行结束/工作区失效时清理：停轮询并摘掉本精灵的挂牌 */
    dispose() {
      stopMonitorPoll();
      for (const n of monitorNames) stage.removeMonitor(spriteId, n);
      monitorNames.clear();
    },

    // ---------- 调度回调（Python 侧 __spawn 包装器调用） ----------
    task_started() {
      sched.taskStarted();
    },
    task_finished() {
      sched.taskFinished();
    },
    report_error(msg: unknown) {
      const s = String(msg);
      // 停止信号的包装异常不算错误
      if (isStopError({ message: s } as Error)) return;
      // R8：携带精灵名与前导行数分类定位（行号换算在 errors 模块完成）
      sched.onError(classifyPythonError(s, { spriteName: sprite()?.name, preambleLines: sched.preambleLines }));
    },

    // ---------- 事件注册（同步，按函数名登记） ----------
    on_flag(name: unknown) {
      handlers.flag.push(String(name));
    },
    on_key(key: unknown, name: unknown) {
      const k = String(key);
      const list = handlers.key.get(k) ?? [];
      list.push(String(name));
      handlers.key.set(k, list);
    },
    on_message(msg: unknown, name: unknown) {
      const m = String(msg);
      const list = handlers.message.get(m) ?? [];
      list.push(String(name));
      handlers.message.set(m, list);
    },
    /** 碰撞事件注册（R15）："当碰到[角色]"帽 → 目标名登记函数名 */
    on_touching(target: unknown, name: unknown) {
      const t = String(target);
      const list = handlers.touch.get(t) ?? [];
      list.push(String(name));
      handlers.touch.set(t, list);
    },
  };
}

/** 桥接对象类型（createBridge 返回值；runtime 释放时按 dispose 约定调用） */
export type Bridge = ReturnType<typeof createBridge>;