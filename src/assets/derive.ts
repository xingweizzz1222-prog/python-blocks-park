/**
 * 素材显示图推导（R16）：原图 + 裁剪参数 → 渲染/面板/镜像实际使用的派生图。
 *
 * 为什么"推导"而不是"裁掉原图"：存档与素材库永远保留原图与参数，
 * 调整裁剪时从原图重新推导，多次调整不会累积画质/范围损失（R16 规格）。
 *
 * 推导规则：
 * - fit / fill → 固定 480×360 画布（fit 补白边；fill 铺满裁溢出）。
 *   舞台背景渲染器（render.ts 的 cover 适配）拿到 480×360 的派生图后
 *   scale 恰为 1、零裁切——无需改动一期渲染代码即满足"完整显示无缺失"。
 * - crop → 原图框选区域；输出最长边超过 1024px 时等比缩小（性能护栏，
 *   避免超大原图的框选区域生成巨型 PNG；480×360 舞台显示精度足够）。
 * 输出统一 PNG dataURL（无损）。结果按 id+参数签名 缓存，参数不变不重算。
 */
import type { AssetRecord } from './store';
import { normalizeCrop, cropSignature, fitLayout, fillLayout, normalizeCropRect, type AssetCrop } from './crop';
import { STAGE_W, STAGE_H } from '../stage/render';

/** crop 模式输出最长边上限（像素；等比缩小，不改变画面内容比例） */
const MAX_DERIVED_DIM = 1024;

/** 派生结果缓存：id → { 签名, 视图 }（签名含参数与原图长度，原图被覆盖时自动失效） */
const cache = new Map<string, { key: string; view: AssetRecord }>();

/** dataURL → 已解码 Image（推导一次性使用，不做长期缓存以免占用内存） */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('素材图片无法解码')));
    img.onerror = () => reject(new Error('素材图片无法解码'));
    img.src = dataUrl;
  });
}

/**
 * 推导单个素材的显示视图。
 * 返回记录保留 id/name/type/size/createdAt/crop 等元数据，
 * dataUrl/width/height 替换为派生结果（渲染、碰撞尺寸、镜像、面板缩略图共用）。
 */
export async function deriveAssetView(rec: AssetRecord): Promise<AssetRecord> {
  // R22：独立裁剪素材本身就是最终像素——直接原样使用，不做任何推导/二次裁剪
  if (rec.cropResult) return rec;
  const crop: AssetCrop = normalizeCrop(rec.crop, rec.width, rec.height);
  const key = `${cropSignature(crop)}|${rec.dataUrl.length}`;
  const hit = cache.get(rec.id);
  if (hit && hit.key === key) return hit.view;

  const img = await loadImage(rec.dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('素材推导失败（浏览器不支持 canvas）');

  if (crop.mode === 'crop') {
    const rect = normalizeCropRect(crop, w, h);
    if (!rect) throw new Error('裁剪区域非法');
    const scale = Math.min(1, MAX_DERIVED_DIM / Math.max(rect.w, rect.h));
    canvas.width = Math.max(1, Math.round(rect.w * scale));
    canvas.height = Math.max(1, Math.round(rect.h * scale));
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  } else {
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    // fit 补白底（fill 铺满无露底，白底仅作兜底）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    const layout = crop.mode === 'fit' ? fitLayout(w, h) : fillLayout(w, h, crop.offsetX, crop.offsetY);
    ctx.drawImage(img, layout.dx, layout.dy, layout.dw, layout.dh);
  }

  const view: AssetRecord = {
    ...rec,
    crop,
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
  cache.set(rec.id, { key, view });
  return view;
}

/** 批量推导（启动恢复/导入回灌后整库刷新；顺序执行避免大图并发解码内存峰值） */
export async function deriveAssetViews(recs: AssetRecord[]): Promise<AssetRecord[]> {
  const out: AssetRecord[] = [];
  for (const rec of recs) out.push(await deriveAssetView(rec));
  return out;
}

/** 删除素材时清掉其派生缓存（防止同 id 重新导入命中旧图） */
export function invalidateDeriveCache(id: string): void {
  cache.delete(id);
}