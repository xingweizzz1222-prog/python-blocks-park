/**
 * 舞台等比缩放拖拽（R5）＋尺寸模式切换（R20）：四边 + 四角共 8 个把手。
 *
 * - 拖任意把手调整舞台列宽度；高度由 CSS aspect-ratio 锁定 4:3，始终等比；
 * - 逻辑坐标保持 480×360 不变，画布按物理尺寸等比放大（见 stage 模块渲染变换）；
 * - 宽度夹取：最小 280px；宽屏时保证编辑器列至少 320px；窄屏竖排时以容器为上限；
 * - R20 模式预设：small=500px（常规编辑布局）/ large=860px（扩大舞台）；
 *   模式按钮应用预设宽度，自由拖拽在当前模式上微调；两者一并写入本地设置
 *   （storage/settings），下次启动 restore() 恢复"模式＋微调后宽度"；
 *   窄屏下预设同样被夹取（不挤占竖排布局），模式选择仍持久化；
 * - 编辑器列为 flex:1，舞台列宽变化后自动让位/收回，无需额外干预。
 */
import '../styles/stageResize.css';
import { loadSettings, saveSettings, type StageMode } from '../storage/settings';

export interface StageResizeOptions {
  /** 舞台列元素（宽度作用于它） */
  column: HTMLElement;
  /** 把手定位容器（包裹 stage-host） */
  wrap: HTMLElement;
  /** 宽度变化回调（Blockly 重算画布等） */
  onResize(): void;
  /** 模式变化回调（R20：按钮文案/高亮回显；restore 时也会触发一次） */
  onModeChange?(mode: StageMode): void;
}

export interface StageResizeApi {
  /** 当前舞台列实际宽度（px） */
  getWidth(): number;
  /** 设置宽度（自动夹取到合法区间） */
  setWidth(px: number): void;
  /** 当前尺寸模式（R20） */
  getMode(): StageMode;
  /** 切换尺寸模式（R20）：应用预设宽度并持久化 */
  setMode(mode: StageMode): void;
  /** 启动时恢复本地设置中的模式与宽度 */
  restore(): void;
}

/** 舞台列最小宽度（画布约 262px，再小积木面板放不下） */
const MIN_W = 280;
/** 宽屏时编辑器列保留的最小宽度 */
const EDITOR_MIN = 320;
/** 窄屏竖排断点（与 layout.css 媒体查询一致） */
const NARROW_QUERY = '(max-width: 900px)';
/** 窄屏时舞台列上限：画布 max-width 480 + 列内边距/边框 18 */
const NARROW_MAX = 498;
/** R20 模式预设宽度（执行方定：small=CSS 默认 500；large≈1.7 倍舞台显示） */
export const STAGE_MODE_PRESETS: Record<StageMode, number> = { small: 500, large: 860 };

/** 装配舞台缩放：绑定 8 个把手拖拽＋宽窄布局夹取＋模式预设＋本地设置恢复 */
export function initStageResize(opts: StageResizeOptions): StageResizeApi {
  const narrow = window.matchMedia(NARROW_QUERY);
  /** 用户设定过的宽度；0 表示尚未设定（跟随 CSS 默认） */
  let width = 0;
  /** 当前尺寸模式（R20）；自由拖拽只微调宽度，不改模式 */
  let mode: StageMode = 'small';

  /** 当前布局下的宽度上限 */
  function maxWidth(): number {
    const content = opts.column.parentElement; // .content
    const avail = content ? content.clientWidth : window.innerWidth;
    return narrow.matches ? Math.min(NARROW_MAX, avail) : Math.max(MIN_W, avail - EDITOR_MIN);
  }

  /** 夹取并应用宽度（拖拽与恢复共用） */
  function apply(px: number): void {
    width = Math.round(Math.max(MIN_W, Math.min(maxWidth(), px)));
    opts.column.style.width = `${width}px`;
    opts.onResize();
  }

  // ---------- 把手拖拽：起点宽度 + 指针位移按方向换算宽度增量 ----------
  opts.wrap.querySelectorAll<HTMLElement>('.rz-handle').forEach((h) => {
    h.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      // 捕获失败（如合成指针事件）不中断拖拽：move/up 监听仍挂在把手上
      try {
        h.setPointerCapture(ev.pointerId);
      } catch {
        /* 忽略 */
      }
      const dir = h.dataset.dir ?? '';
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startW = opts.column.getBoundingClientRect().width;
      document.body.classList.add('stage-resizing');

      const move = (e: PointerEvent): void => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let dw = 0;
        // 水平边/角：横向位移直接换算；垂直边/角：纵向位移按 4:3 换算成宽度
        if (dir.includes('e')) dw += dx;
        if (dir.includes('w')) dw -= dx;
        if (dir.includes('s')) dw += (dy * 4) / 3;
        if (dir.includes('n')) dw -= (dy * 4) / 3;
        apply(startW + dw);
      };
      const up = (e: PointerEvent): void => {
        try {
          if (h.hasPointerCapture(e.pointerId)) h.releasePointerCapture(e.pointerId);
        } catch {
          /* 忽略 */
        }
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        document.body.classList.remove('stage-resizing');
        // 拖拽结束才落盘，避免高频写 localStorage
        saveSettings({ ...loadSettings(), stageWidth: width });
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
  });

  // 宽窄布局切换 / 窗口缩放：重新夹取已设定宽度（竖排不挤占编辑器）
  const reclamp = (): void => {
    if (width) apply(width);
  };
  narrow.addEventListener('change', reclamp);
  window.addEventListener('resize', reclamp);

  /** 切换尺寸模式（R20）：应用预设宽度（夹取后）＋持久化模式与实际宽度 */
  function setMode(m: StageMode): void {
    mode = m;
    apply(STAGE_MODE_PRESETS[m]);
    saveSettings({ ...loadSettings(), stageMode: m, stageWidth: width });
    opts.onModeChange?.(m);
  }

  return {
    getWidth: () => opts.column.getBoundingClientRect().width,
    setWidth: apply,
    getMode: () => mode,
    setMode,
    restore() {
      const s = loadSettings();
      mode = s.stageMode ?? 'small';
      // 微调过的宽度优先（模式预设＋自由拖拽共存）；否则按模式预设展开
      if (typeof s.stageWidth === 'number') apply(s.stageWidth);
      else apply(STAGE_MODE_PRESETS[mode]);
      opts.onModeChange?.(mode);
    },
  };
}