/**
 * 素材裁剪参数模型与纯几何（R16）。
 *
 * 三种显示方式（对应清单 R16 的 A/B/C）：
 * - fit  完整显示：原图等比缩放到 480×360 内（contain），不足处补白边，画面无缺失；
 * - fill 裁剪填充：原图等比放大铺满 480×360（cover），可拖动平移选择保留区域；
 * - crop 自定义裁剪：在原图上自由框选矩形（原图像素坐标），只保留框内画面。
 *
 * 存档只保存"原图 + 裁剪参数"，显示图由 derive.ts 按参数即时推导；
 * 再次调整永远基于原图重算，不会累积裁剪损失。本模块不碰 DOM/canvas，纯函数。
 */
import { STAGE_W, STAGE_H } from '../stage/render';

/** 裁剪参数（判别联合；存档 AssetMeta.crop / 素材记录 AssetRecord.crop 共用） */
export type AssetCrop =
  | { mode: 'fit' }
  | { mode: 'fill'; offsetX: number; offsetY: number }
  | { mode: 'crop'; x: number; y: number; w: number; h: number };

/** 默认显示方式：完整显示（R16 规格 A 为默认） */
export const DEFAULT_CROP: AssetCrop = { mode: 'fit' };

/** 自定义裁剪框最小边长（原图像素；防止拖出 0 尺寸坏框） */
export const MIN_CROP_SIDE = 8;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** fit 布局：contain 等比缩放 + 居中（白边由推导层补） */
export function fitLayout(imgW: number, imgH: number): { scale: number; dw: number; dh: number; dx: number; dy: number } {
  const scale = Math.min(STAGE_W / imgW, STAGE_H / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  return { scale, dw, dh, dx: (STAGE_W - dw) / 2, dy: (STAGE_H - dh) / 2 };
}

/** fill 平移量收敛：图片铺满后，偏移不得露出白边（各轴最大 = 溢出量的一半） */
export function clampFillOffset(imgW: number, imgH: number, offsetX: number, offsetY: number): { offsetX: number; offsetY: number } {
  const scale = Math.max(STAGE_W / imgW, STAGE_H / imgH);
  const maxX = Math.max(0, (imgW * scale - STAGE_W) / 2);
  const maxY = Math.max(0, (imgH * scale - STAGE_H) / 2);
  return { offsetX: clamp(offsetX, -maxX, maxX), offsetY: clamp(offsetY, -maxY, maxY) };
}

/** fill 布局：cover 等比放大 + 居中 + 收敛后的平移 */
export function fillLayout(imgW: number, imgH: number, offsetX: number, offsetY: number): { scale: number; dw: number; dh: number; dx: number; dy: number } {
  const scale = Math.max(STAGE_W / imgW, STAGE_H / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  const off = clampFillOffset(imgW, imgH, offsetX, offsetY);
  return { scale, dw, dh, dx: (STAGE_W - dw) / 2 + off.offsetX, dy: (STAGE_H - dh) / 2 + off.offsetY };
}

/** 裁剪框规范化：收敛到原图边界内、边长取整且 ≥ MIN_CROP_SIDE；完全非法返回 null */
export function normalizeCropRect(
  raw: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!isNum(raw.x) || !isNum(raw.y) || !isNum(raw.w) || !isNum(raw.h)) return null;
  const minSide = Math.min(MIN_CROP_SIDE, imgW, imgH);
  let w = clamp(Math.round(raw.w), minSide, imgW);
  let h = clamp(Math.round(raw.h), minSide, imgH);
  let x = clamp(Math.round(raw.x), 0, imgW - w);
  let y = clamp(Math.round(raw.y), 0, imgH - h);
  return { x, y, w, h };
}

/** 裁剪参数规范化（存档载入/推导前兜底）：非法或缺省一律回落默认"完整显示"。
 *  字段级宽容：fill 偏移非法按 0；crop 框非法回落 fit（不静默改用户数据语义）。 */
export function normalizeCrop(raw: unknown, imgW: number, imgH: number): AssetCrop {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CROP };
  const r = raw as Record<string, unknown>;
  if (r.mode === 'fill') {
    const ox = isNum(r.offsetX) ? r.offsetX : 0;
    const oy = isNum(r.offsetY) ? r.offsetY : 0;
    return { mode: 'fill', ...clampFillOffset(imgW, imgH, ox, oy) };
  }
  if (r.mode === 'crop') {
    const rect = normalizeCropRect(
      { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) },
      imgW,
      imgH,
    );
    if (rect) return { mode: 'crop', ...rect };
    return { ...DEFAULT_CROP };
  }
  return { ...DEFAULT_CROP };
}

/** 裁剪参数签名（推导缓存键用：同参数同原图 → 同结果） */
export function cropSignature(crop: AssetCrop): string {
  return JSON.stringify(crop);
}