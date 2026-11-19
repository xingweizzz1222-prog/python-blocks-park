/**
 * 角色碰撞检测（R15）：统一使用 R14 判定区配置，替换 R6 的包围盒实现。
 *
 * 三套检测系统独立（清单 R15.7）：本模块只负责"角色-角色"；
 * 角色-颜色 / 颜色-颜色 仍归 sensing 模块（R11），互不混用。
 *
 * 判定模式（effectiveMode）：
 * - rect / circle：直接用 R14 判定区世界形状做几何相交（轴对齐矩形/圆）。
 * - auto：造型含透明像素 → pixel（Alpha 遮罩像素级）；否则 rect。
 *   内置 SVG 造型带透明背景 → pixel；JPG/不透明 PNG（如迷宫素材）→ rect。
 *
 * 性能方案（执行方定，记日志）：
 * - 遮罩缓存：每个造型键只解码一次 Alpha 遮罩，自然尺寸封顶 128px（内存≈16KB/造型）；
 * - 包围盒预检：先算两判定区世界形状，不相交直接 false，不做像素运算；
 * - 像素扫描只在相交区域内以 2 逻辑像素步长采样，逐点逆变换回各自遮罩查 Alpha；
 * - 图像未解码完成时回落 rect（不缓存半成品），下一轮自然升级。
 */
import { hitboxShape, type WorldShape } from './hitbox';
import { createImageFor, type StageSprite } from './render';
import type { StageApi } from './index';

/** 遮罩采样步长（逻辑像素）：2px 在 480×360 舞台上足够精确且开销小 */
const SCAN_STEP = 2;
/** 遮罩自然尺寸封顶（像素级判定的精度上限，兼顾内存与采样速度） */
const MASK_CAP = 128;
/** Alpha 阈值：低于此值视为透明（抗锯齿边缘半透明像素不算实体） */
const ALPHA_MIN = 16;

/** 造型 Alpha 遮罩（缓存条目） */
interface AlphaMask {
  /** 逐像素 alpha（0-255），行优先 */
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  /** 自然尺寸下是否存在透明像素（auto 模式分流依据） */
  hasAlpha: boolean;
}

export interface CollisionApi {
  /** 两角色是否碰撞（含可见性/自身排除；调用方无需再判） */
  touching(a: StageSprite, b: StageSprite): boolean;
  /** 生效判定模式（调试/验收用） */
  effectiveMode(s: StageSprite): 'rect' | 'circle' | 'pixel';
}

/** 创建碰撞检测器（遮罩缓存随实例生命周期；运行时每轮共享一个实例） */
export function createCollision(stage: StageApi): CollisionApi {
  const masks = new Map<string, AlphaMask>();
  const imageFor = createImageFor();

  /** 取造型图像（素材优先，R10）；未解码完成返回 null */
  function imageOf(s: StageSprite): { img: HTMLImageElement; w: number; h: number } | null {
    const asset = stage.getSceneExtras().assetCostume?.(s.costume);
    if (asset) {
      return asset.img.complete && asset.img.naturalWidth > 0
        ? { img: asset.img, w: asset.width, h: asset.height }
        : null;
    }
    const dims = stage.getCostumeDims(s.costume);
    const img = imageFor(s.costume);
    return img.complete && img.naturalWidth > 0 ? { img, w: dims.width, h: dims.height } : null;
  }

  /** 造型 Alpha 遮罩（缓存；图像未就绪返回 null → 调用方回落 rect） */
  function maskOf(s: StageSprite): AlphaMask | null {
    const hit = masks.get(s.costume);
    if (hit) return hit;
    const src = imageOf(s);
    if (!src) return null;
    const scale = Math.min(1, MASK_CAP / Math.max(src.w, src.h));
    const w = Math.max(1, Math.round(src.w * scale));
    const h = Math.max(1, Math.round(src.h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src.img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Uint8ClampedArray(w * h);
    let hasAlpha = false;
    for (let i = 0; i < w * h; i++) {
      const a = data[i * 4 + 3];
      alpha[i] = a;
      if (a < 250) hasAlpha = true;
    }
    const mask: AlphaMask = { alpha, width: w, height: h, hasAlpha };
    masks.set(s.costume, mask);
    return mask;
  }

  function effectiveMode(s: StageSprite): 'rect' | 'circle' | 'pixel' {
    if (s.hitbox.mode === 'rect') return 'rect';
    if (s.hitbox.mode === 'circle') return 'circle';
    const mask = maskOf(s);
    return mask && mask.hasAlpha ? 'pixel' : 'rect';
  }

  /** 世界形状（pixel 模式用造型包围盒做预检与扫描域） */
  function shapeOf(s: StageSprite): WorldShape {
    return hitboxShape(s, stage.getCostumeDims(s.costume));
  }

  /** 点是否在形状内（世界坐标） */
  function inShape(shape: WorldShape, px: number, py: number): boolean {
    if (shape.kind === 'circle') return Math.hypot(px - shape.cx, py - shape.cy) <= shape.r;
    return Math.abs(px - shape.cx) <= shape.hw && Math.abs(py - shape.cy) <= shape.hh;
  }

  /** 两形状包围盒是否相交（预检；circle 取其外接盒） */
  function precheck(a: WorldShape, b: WorldShape): boolean {
    const box = (s: WorldShape) =>
      s.kind === 'circle'
        ? { l: s.cx - s.r, r: s.cx + s.r, b: s.cy - s.r, t: s.cy + s.r }
        : { l: s.cx - s.hw, r: s.cx + s.hw, b: s.cy - s.hh, t: s.cy + s.hh };
    const A = box(a);
    const B = box(b);
    return A.l < B.r && B.l < A.r && A.b < B.t && B.b < A.t;
  }

  /** 世界点 → 造型遮罩像素坐标（逆旋转/逆缩放/逆平移）；越界返回 null */
  function maskPixel(s: StageSprite, mask: AlphaMask, px: number, py: number): number | null {
    const dims = stage.getCostumeDims(s.costume);
    const rad = ((s.direction - 90) * Math.PI) / 180;
    // 世界 y 向上 → 屏幕 y 向下，再逆旋转回造型本地坐标
    const sx = px - s.x;
    const sy = -(py - s.y);
    const lx = sx * Math.cos(rad) + sy * Math.sin(rad);
    const ly = -sx * Math.sin(rad) + sy * Math.cos(rad);
    const scale = s.size / 100;
    const mx = Math.floor(((lx / scale + dims.width / 2) / dims.width) * mask.width);
    const my = Math.floor(((ly / scale + dims.height / 2) / dims.height) * mask.height);
    if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return null;
    return mask.alpha[my * mask.width + mx];
  }

  /** 像素级判定：相交域内步长采样，双方（或一方遮罩＋另一方几何）同时命中 */
  function pixelTouch(
    ps: StageSprite,
    pm: AlphaMask,
    other: StageSprite,
    otherShape: WorldShape,
    otherMask: AlphaMask | null,
  ): boolean {
    // pixel 模式只来自 auto，其预检盒必为造型包围盒（rect）
    const pb = shapeOf(ps) as Extract<WorldShape, { kind: 'rect' }>;
    const ob =
      otherShape.kind === 'rect'
        ? { l: otherShape.cx - otherShape.hw, r: otherShape.cx + otherShape.hw, b: otherShape.cy - otherShape.hh, t: otherShape.cy + otherShape.hh }
        : { l: otherShape.cx - otherShape.r, r: otherShape.cx + otherShape.r, b: otherShape.cy - otherShape.r, t: otherShape.cy + otherShape.r };
    const l = Math.max(pb.cx - pb.hw, ob.l);
    const r = Math.min(pb.cx + pb.hw, ob.r);
    const b = Math.max(pb.cy - pb.hh, ob.b);
    const t = Math.min(pb.cy + pb.hh, ob.t);
    for (let py = b; py <= t; py += SCAN_STEP) {
      for (let px = l; px <= r; px += SCAN_STEP) {
        const a1 = maskPixel(ps, pm, px, py);
        if (a1 === null || a1 < ALPHA_MIN) continue;
        if (otherMask) {
          const a2 = maskPixel(other, otherMask, px, py);
          if (a2 !== null && a2 >= ALPHA_MIN) return true;
        } else if (inShape(otherShape, px, py)) {
          return true;
        }
      }
    }
    return false;
  }

  return {
    effectiveMode,
    touching(a, b) {
      if (a.id === b.id || !a.visible || !b.visible) return false;
      const ma = effectiveMode(a);
      const mb = effectiveMode(b);
      const sa = shapeOf(a);
      const sb = shapeOf(b);
      if (!precheck(sa, sb)) return false; // 包围盒预检：不相交直接否
      // 双方均非像素：几何相交即碰撞
      if (ma !== 'pixel' && mb !== 'pixel') {
        if (ma === 'rect' && mb === 'rect') return true; // 轴对齐矩形：预检相交即碰撞
        if (ma === 'circle' && mb === 'circle') {
          // 圆×圆：圆心距 ≤ 半径和（预检只是外接盒粗筛，不能代替本判定）
          const ca = sa as Extract<WorldShape, { kind: 'circle' }>;
          const cb = sb as Extract<WorldShape, { kind: 'circle' }>;
          return Math.hypot(ca.cx - cb.cx, ca.cy - cb.cy) <= ca.r + cb.r;
        }
        // rect × circle：圆心到矩形最近点距离 ≤ 半径
        const rect = ma === 'rect' ? (sa as Extract<WorldShape, { kind: 'rect' }>) : (sb as Extract<WorldShape, { kind: 'rect' }>);
        const circ = ma === 'circle' ? (sa as Extract<WorldShape, { kind: 'circle' }>) : (sb as Extract<WorldShape, { kind: 'circle' }>);
        const nx = Math.max(rect.cx - rect.hw, Math.min(circ.cx, rect.cx + rect.hw));
        const ny = Math.max(rect.cy - rect.hh, Math.min(circ.cy, rect.cy + rect.hh));
        return Math.hypot(circ.cx - nx, circ.cy - ny) <= circ.r;
      }
      // 含像素模式：扫描相交域
      if (ma === 'pixel' && mb === 'pixel') {
        const maskA = maskOf(a)!;
        const maskB = maskOf(b)!;
        return pixelTouch(a, maskA, b, sb, maskB);
      }
      if (ma === 'pixel') return pixelTouch(a, maskOf(a)!, b, sb, null);
      return pixelTouch(b, maskOf(b)!, a, sa, null);
    },
  };
}