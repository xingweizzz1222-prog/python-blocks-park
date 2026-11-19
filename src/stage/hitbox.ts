/**
 * 角色判定区（R14）：统一配置模型 + 世界坐标形状换算 + 调试可视化绘制。
 *
 * 设计说明（执行方定，记入日志）：
 * - 判定区挂在精灵状态上（StageSprite.hitbox），随存档持久化；旧存档缺省为"自动"。
 * - 三种模式：auto 自动（R15 按素材透明度选像素/矩形）、rect 矩形、circle 圆形。
 * - 尺寸参数为相对造型原始尺寸的百分比（100 = 造型原大），再随角色 size% 缩放，
 *   与 Scratch"大小"积木语义一致；偏移量为逻辑像素，同样随 size% 缩放。
 * - show 只控制舞台上的调试虚线框，不影响实际碰撞检测（R15 读同一份配置）。
 * - 可视化只画在主舞台（大屏镜像与侦测采样不画，避免污染画面/像素判定）。
 */
import type { StageSprite } from './render';

/** 判定模式：自动 / 矩形 / 圆形 */
export type HitboxMode = 'auto' | 'rect' | 'circle';

/** 单个角色的判定区配置 */
export interface HitboxConfig {
  mode: HitboxMode;
  /** 矩形宽（相对造型原始宽的百分比，100 = 原宽） */
  width: number;
  /** 矩形高（相对造型原始高的百分比） */
  height: number;
  /** 圆形半径（相对 min(造型宽,高)/2 的百分比，100 = 内切圆） */
  radius: number;
  /** 判定区中心相对角色中心的 X 偏移（逻辑像素，随 size% 缩放） */
  offsetX: number;
  /** 判定区中心相对角色中心的 Y 偏移（逻辑像素，舞台坐标 y 向上） */
  offsetY: number;
  /** 调试可视化开关（不影响碰撞检测） */
  show: boolean;
}

/** 默认判定区：自动模式、原大、无偏移、不显示 */
export const DEFAULT_HITBOX: HitboxConfig = {
  mode: 'auto',
  width: 100,
  height: 100,
  radius: 100,
  offsetX: 0,
  offsetY: 0,
  show: false,
};

/** 数值兜底（存档可能被污染：NaN 序列化为 null） */
function numOr(v: unknown, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fb;
}

/** 宽容解析存档/外部数据中的判定区配置：缺省/非法字段一律回落默认值 */
export function normalizeHitbox(raw: unknown): HitboxConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_HITBOX };
  const r = raw as Record<string, unknown>;
  const mode: HitboxMode = r.mode === 'rect' || r.mode === 'circle' ? r.mode : 'auto';
  return {
    mode,
    width: Math.max(5, numOr(r.width, 100)),
    height: Math.max(5, numOr(r.height, 100)),
    radius: Math.max(5, numOr(r.radius, 100)),
    offsetX: numOr(r.offsetX, 0),
    offsetY: numOr(r.offsetY, 0),
    show: r.show === true,
  };
}

/** 判定区在世界坐标（舞台逻辑坐标）下的形状 */
export type WorldShape =
  | { kind: 'rect'; cx: number; cy: number; hw: number; hh: number }
  | { kind: 'circle'; cx: number; cy: number; r: number };

/**
 * 计算判定区世界形状（R15 碰撞检测与 R14 可视化共用）。
 * dims 为造型原始宽高；auto 模式按造型整体包围盒（中心即角色中心）。
 * 注意：矩形判定为轴对齐包围盒（不随方向旋转），与 Scratch 碰撞语义一致。
 */
export function hitboxShape(s: StageSprite, dims: { width: number; height: number }): WorldShape {
  const scale = s.size / 100;
  const hb = s.hitbox;
  if (hb.mode === 'circle') {
    return {
      kind: 'circle',
      cx: s.x + hb.offsetX * scale,
      cy: s.y + hb.offsetY * scale,
      r: (Math.min(dims.width, dims.height) / 2) * scale * (hb.radius / 100),
    };
  }
  // rect / auto：auto 用造型原大包围盒，rect 用配置百分比
  const wPct = hb.mode === 'auto' ? 100 : hb.width;
  const hPct = hb.mode === 'auto' ? 100 : hb.height;
  const ox = hb.mode === 'auto' ? 0 : hb.offsetX * scale;
  const oy = hb.mode === 'auto' ? 0 : hb.offsetY * scale;
  return {
    kind: 'rect',
    cx: s.x + ox,
    cy: s.y + oy,
    hw: (dims.width / 2) * scale * (wPct / 100),
    hh: (dims.height / 2) * scale * (hPct / 100),
  };
}

/**
 * 在主舞台画判定区调试虚线框（逻辑坐标 480×360，调用方已设好变换）。
 * 矩形画轴对齐框；圆形画圆；auto 用灰色虚线（提示"自动=造型包围盒/像素"）。
 */
export function drawHitboxOutline(
  ctx: CanvasRenderingContext2D,
  s: StageSprite,
  dims: { width: number; height: number },
  color: string,
): void {
  const shape = hitboxShape(s, dims);
  // 舞台坐标 y 向上 → 画布 y 向下
  const cx = 240 + shape.cx;
  const cy = 180 - shape.cy;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (shape.kind === 'rect') {
    ctx.rect(cx - shape.hw, cy - shape.hh, shape.hw * 2, shape.hh * 2);
  } else {
    ctx.arc(cx, cy, Math.max(1, shape.r), 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}