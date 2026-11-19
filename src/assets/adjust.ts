/**
 * 素材显示调整对话框（R16）：导入确认前 / 素材库"裁剪"再编辑共用。
 *
 * 三种方式（与 crop.ts 参数模型一一对应）：
 * - 完整显示(fit)：静态预览等比缩放+白边效果，无需操作；
 * - 裁剪填充(fill)：预览铺满 480×360，按住拖动平移选择保留区域（偏移自动收敛不露白边）；
 * - 自定义裁剪(crop)：原图 contain 预览 + 可拖拽/八向缩放的裁剪框（原图像素坐标实时显示）。
 *
 * 对话框只产出裁剪参数（Promise<AssetCrop|null>），不写素材库——
 * 入库/推导/镜像刷新由 main.ts 编排。取消（按钮/Esc/点遮罩）返回 null。
 * 再编辑时以 rec.crop 为初值，预览与推导永远基于原图，无累积损失。
 */
import '../styles/assetAdjust.css';
import type { AssetRecord } from './store';
import {
  normalizeCrop, fitLayout, fillLayout, clampFillOffset, normalizeCropRect,
  MIN_CROP_SIDE, type AssetCrop,
} from './crop';
import { STAGE_W, STAGE_H } from '../stage/render';

/** 对话框选项 */
export interface AdjustOptions {
  /** 确认按钮文案（导入流程"确认导入"；再编辑"保存调整"） */
  confirmText?: string;
}

type Mode = AssetCrop['mode'];
type Rect = { x: number; y: number; w: number; h: number };

/** 裁剪框八个手柄（相对框的位置；resize 时对角/对边锚定） */
const HANDLES: Array<{ hx: number; hy: number; cursor: string }> = [
  { hx: 0, hy: 0, cursor: 'nwse-resize' }, { hx: 0.5, hy: 0, cursor: 'ns-resize' },
  { hx: 1, hy: 0, cursor: 'nesw-resize' }, { hx: 1, hy: 0.5, cursor: 'ew-resize' },
  { hx: 1, hy: 1, cursor: 'nwse-resize' }, { hx: 0.5, hy: 1, cursor: 'ns-resize' },
  { hx: 0, hy: 1, cursor: 'nesw-resize' }, { hx: 0, hy: 0.5, cursor: 'ew-resize' },
];
/** 手柄命中半径（画布逻辑像素） */
const HANDLE_HIT = 9;

/** 当前是否有对话框打开（同一时刻只允许一个；重复打开先关掉旧的） */
let activeCleanup: (() => void) | null = null;

/**
 * 打开调整对话框。
 * @param rec 素材记录（dataUrl 必须是原图；crop 为再编辑初值，缺省 fit）
 * @returns 确认 → 规范化裁剪参数；取消 → null
 */
export function openAssetAdjust(rec: AssetRecord, opts: AdjustOptions = {}): Promise<AssetCrop | null> {
  if (activeCleanup) activeCleanup(); // 关闭旧对话框（按取消处理）

  return new Promise<AssetCrop | null>((resolve) => {
    // ---------- 状态 ----------
    const init = normalizeCrop(rec.crop, rec.width, rec.height);
    let mode: Mode = init.mode;
    let fillOff = init.mode === 'fill' ? { x: init.offsetX, y: init.offsetY } : { x: 0, y: 0 };
    let cropRect: Rect = init.mode === 'crop'
      ? { x: init.x, y: init.y, w: init.w, h: init.h }
      : { x: 0, y: 0, w: rec.width, h: rec.height }; // 默认整图，用户直接拖框调整
    let img: HTMLImageElement | null = null;
    let settled = false;

    // ---------- DOM ----------
    const overlay = document.createElement('div');
    overlay.className = 'aa-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'aa-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '调整素材显示');

    const head = document.createElement('div');
    head.className = 'aa-head';
    const title = document.createElement('span');
    title.className = 'aa-title';
    title.textContent = '调整素材显示';
    const sub = document.createElement('span');
    sub.className = 'aa-sub';
    sub.textContent = `${rec.name} · 原图 ${rec.width}×${rec.height}`;
    head.append(title, sub);

    const tabs = document.createElement('div');
    tabs.className = 'aa-tabs';
    const tabDefs: Array<{ mode: Mode; label: string }> = [
      { mode: 'fit', label: '完整显示' },
      { mode: 'fill', label: '裁剪填充' },
      { mode: 'crop', label: '自定义裁剪' },
    ];
    const tabBtns = new Map<Mode, HTMLButtonElement>();
    for (const t of tabDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'aa-tab';
      b.textContent = t.label;
      b.addEventListener('click', () => { mode = t.mode; syncTabs(); redraw(); });
      tabBtns.set(t.mode, b);
      tabs.appendChild(b);
    }

    const stageWrap = document.createElement('div');
    stageWrap.className = 'aa-stage';
    const canvas = document.createElement('canvas');
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    stageWrap.appendChild(canvas);

    const info = document.createElement('div');
    info.className = 'aa-info';

    const foot = document.createElement('div');
    foot.className = 'aa-foot';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'aa-cancel';
    cancelBtn.textContent = '取消';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'aa-ok';
    okBtn.textContent = opts.confirmText ?? '确认';
    okBtn.disabled = true; // 图片解码完成前不可确认
    foot.append(cancelBtn, okBtn);

    dialog.append(head, tabs, stageWrap, info, foot);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const ctx = canvas.getContext('2d')!;

    // ---------- 收尾 ----------
    function finish(result: AssetCrop | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }
    function cleanup(): void {
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      if (activeCleanup === cleanup) activeCleanup = null;
    }
    activeCleanup = cleanup;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
    }
    window.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', () => finish(null));
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) finish(null); });
    okBtn.addEventListener('click', () => {
      if (!img) return;
      const w = img.naturalWidth, h = img.naturalHeight;
      if (mode === 'fit') finish({ mode: 'fit' });
      else if (mode === 'fill') finish({ mode: 'fill', ...clampFillOffset(w, h, fillOff.x, fillOff.y) });
      else {
        const rect = normalizeCropRect(cropRect, w, h);
        finish(rect ? { mode: 'crop', ...rect } : { mode: 'fit' });
      }
    });

    function syncTabs(): void {
      for (const [m, b] of tabBtns) b.classList.toggle('is-active', m === mode);
      canvas.style.cursor = mode === 'fill' ? 'grab' : mode === 'crop' ? 'crosshair' : 'default';
    }

    // ---------- 预览绘制 ----------
    /** crop 模式：原图 contain 进 480×360 的视图变换 */
    function cropView(): { vs: number; vx: number; vy: number } {
      const w = img!.naturalWidth, h = img!.naturalHeight;
      const vs = Math.min(STAGE_W / w, STAGE_H / h);
      return { vs, vx: (STAGE_W - w * vs) / 2, vy: (STAGE_H - h * vs) / 2 };
    }
    const toLogical = (e: PointerEvent): { lx: number; ly: number } => {
      const r = canvas.getBoundingClientRect();
      return { lx: ((e.clientX - r.left) / r.width) * STAGE_W, ly: ((e.clientY - r.top) / r.height) * STAGE_H };
    };
    const toOrig = (lx: number, ly: number): { ox: number; oy: number } => {
      const { vs, vx, vy } = cropView();
      return { ox: (lx - vx) / vs, oy: (ly - vy) / vs };
    };

    function redraw(): void {
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      if (!img) {
        ctx.fillStyle = '#f0f2f5';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
        ctx.fillStyle = '#8a93a2';
        ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('图片加载中…', STAGE_W / 2, STAGE_H / 2);
        ctx.textAlign = 'left';
        info.textContent = '';
        return;
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      if (mode === 'fit') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
        const l = fitLayout(w, h);
        ctx.drawImage(img, l.dx, l.dy, l.dw, l.dh);
        info.textContent = '等比缩放完整显示，画面无缺失；不足 4:3 处补白边（白边即舞台所见）';
      } else if (mode === 'fill') {
        const l = fillLayout(w, h, fillOff.x, fillOff.y);
        ctx.drawImage(img, l.dx, l.dy, l.dw, l.dh);
        info.textContent = '按住拖动图片，选择铺满舞台后保留的区域（溢出部分被裁掉）';
      } else {
        const { vs, vx, vy } = cropView();
        // 灰底 + 原图 contain + 框外压暗 + 框内重绘亮部
        ctx.fillStyle = '#e8ebf0';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
        ctx.drawImage(img, vx, vy, w * vs, h * vs);
        const r = normalizeCropRect(cropRect, w, h) ?? cropRect;
        const rx = vx + r.x * vs, ry = vy + r.y * vs, rw = r.w * vs, rh = r.h * vs;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(vx, vy, w * vs, h * vs);
        ctx.drawImage(img, r.x, r.y, r.w, r.h, rx, ry, rw, rh);
        // 三分构图参考线
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i <= 2; i++) {
          ctx.moveTo(rx + (rw * i) / 3, ry); ctx.lineTo(rx + (rw * i) / 3, ry + rh);
          ctx.moveTo(rx, ry + (rh * i) / 3); ctx.lineTo(rx + rw, ry + (rh * i) / 3);
        }
        ctx.stroke();
        // 边框 + 八向手柄
        ctx.strokeStyle = '#4c97ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
        for (const hd of HANDLES) {
          const px = rx + rw * hd.hx, py = ry + rh * hd.hy;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px - 4, py - 4, 8, 8);
          ctx.strokeRect(px - 4, py - 4, 8, 8);
        }
        info.textContent = `裁剪区域（原图像素）：x=${r.x} y=${r.y} 宽=${r.w} 高=${r.h} —— 拖动框移动，拖手柄缩放，框外拖动重画`;
      }
    }

    // ---------- 指针交互 ----------
    /** 拖拽状态：fill 平移 / crop 移动 / crop 手柄缩放（锚定对角） / crop 新画框 */
    let drag:
      | { kind: 'pan'; lastLx: number; lastLy: number }
      | { kind: 'move'; startOx: number; startOy: number; startRect: Rect }
      | { kind: 'resize'; anchorX: number; anchorY: number; freeX: boolean; freeY: boolean }
      | { kind: 'new'; startOx: number; startOy: number }
      | null = null;

    /** crop 模式命中检测：手柄 → 框内 → 框外 */
    function hitCrop(lx: number, ly: number): { type: 'handle'; index: number } | { type: 'inside' } | { type: 'outside' } {
      const w = img!.naturalWidth, h = img!.naturalHeight;
      const r = normalizeCropRect(cropRect, w, h) ?? cropRect;
      const { vs, vx, vy } = cropView();
      const rx = vx + r.x * vs, ry = vy + r.y * vs, rw = r.w * vs, rh = r.h * vs;
      for (let i = 0; i < HANDLES.length; i++) {
        const px = rx + rw * HANDLES[i].hx, py = ry + rh * HANDLES[i].hy;
        if (Math.abs(lx - px) <= HANDLE_HIT && Math.abs(ly - py) <= HANDLE_HIT) return { type: 'handle', index: i };
      }
      if (lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh) return { type: 'inside' };
      return { type: 'outside' };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!img || mode === 'fit') return;
      e.preventDefault();
      // 指针捕获失败不阻断拖拽（部分内嵌浏览器/指针已释放时会抛异常）
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 忽略捕获失败 */ }
      const { lx, ly } = toLogical(e);
      if (mode === 'fill') {
        drag = { kind: 'pan', lastLx: lx, lastLy: ly };
        canvas.style.cursor = 'grabbing';
        return;
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      const { ox, oy } = toOrig(lx, ly);
      const hit = hitCrop(lx, ly);
      const r = normalizeCropRect(cropRect, w, h) ?? cropRect;
      if (hit.type === 'handle') {
        const hd = HANDLES[hit.index];
        // 锚定手柄的对角/对边：hx=0 锚右边，hx=1 锚左边，hx=0.5 水平自由；垂直同理
        drag = {
          kind: 'resize',
          anchorX: hd.hx === 0 ? r.x + r.w : hd.hx === 1 ? r.x : ox,
          anchorY: hd.hy === 0 ? r.y + r.h : hd.hy === 1 ? r.y : oy,
          freeX: hd.hx === 0.5, freeY: hd.hy === 0.5,
        };
        if (hd.hx === 0.5) drag.anchorX = r.x; // 边中点手柄：该轴保持原范围
        if (hd.hy === 0.5) drag.anchorY = r.y;
        canvas.style.cursor = hd.cursor;
      } else if (hit.type === 'inside') {
        drag = { kind: 'move', startOx: ox, startOy: oy, startRect: { ...r } };
        canvas.style.cursor = 'move';
      } else {
        drag = { kind: 'new', startOx: ox, startOy: oy };
        cropRect = { x: ox, y: oy, w: MIN_CROP_SIDE, h: MIN_CROP_SIDE };
      }
      redraw();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!img) return;
      const { lx, ly } = toLogical(e);
      if (!drag) {
        // 悬停光标提示（crop 模式）
        if (mode === 'crop') {
          const hit = hitCrop(lx, ly);
          canvas.style.cursor = hit.type === 'handle' ? HANDLES[hit.index].cursor : hit.type === 'inside' ? 'move' : 'crosshair';
        }
        return;
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      if (drag.kind === 'pan') {
        const off = clampFillOffset(w, h, fillOff.x + (lx - drag.lastLx), fillOff.y + (ly - drag.lastLy));
        fillOff = { x: off.offsetX, y: off.offsetY };
        drag.lastLx = lx; drag.lastLy = ly;
      } else {
        const { ox, oy } = toOrig(lx, ly);
        if (drag.kind === 'move') {
          const nx = drag.startRect.x + (ox - drag.startOx);
          const ny = drag.startRect.y + (oy - drag.startOy);
          cropRect = normalizeCropRect({ ...drag.startRect, x: nx, y: ny }, w, h) ?? drag.startRect;
        } else if (drag.kind === 'resize') {
          // 锚点 + 当前指针 → 新框（支持拖过锚点翻转，min/max 归一）
          const x0 = drag.freeX ? cropRect.x : Math.min(drag.anchorX, ox);
          const y0 = drag.freeY ? cropRect.y : Math.min(drag.anchorY, oy);
          const x1 = drag.freeX ? cropRect.x + cropRect.w : Math.max(drag.anchorX, ox);
          const y1 = drag.freeY ? cropRect.y + cropRect.h : Math.max(drag.anchorY, oy);
          cropRect = normalizeCropRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, w, h) ?? cropRect;
        } else {
          const x0 = Math.min(drag.startOx, ox), y0 = Math.min(drag.startOy, oy);
          cropRect = normalizeCropRect(
            { x: x0, y: y0, w: Math.abs(ox - drag.startOx), h: Math.abs(oy - drag.startOy) }, w, h,
          ) ?? cropRect;
        }
      }
      redraw();
    });

    function endDrag(e: PointerEvent): void {
      if (!drag) return;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = mode === 'fill' ? 'grab' : mode === 'crop' ? 'crosshair' : 'default';
      redraw();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // ---------- 启动 ----------
    syncTabs();
    redraw();
    const image = new Image();
    image.onload = () => {
      if (settled) return;
      img = image;
      // 以解码后的真实尺寸为准规范化初值（元数据与文件不一致时兜底）
      const n = normalizeCrop(rec.crop, image.naturalWidth, image.naturalHeight);
      if (n.mode === 'fill') fillOff = { x: n.offsetX, y: n.offsetY };
      if (n.mode === 'crop') cropRect = { x: n.x, y: n.y, w: n.w, h: n.h };
      okBtn.disabled = false;
      redraw();
    };
    image.onerror = () => {
      if (settled) return;
      info.textContent = '图片无法解码，请取消后重新导入';
    };
    image.src = rec.dataUrl;
  });
}