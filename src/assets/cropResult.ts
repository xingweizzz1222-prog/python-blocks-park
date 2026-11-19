/**
 * 裁剪结果独立素材生成（R22）：把裁剪/调整结果做成真正独立的新图片素材。
 *
 * 与 R16 的区别（规则演进，见清单第六节演进注）：
 * - R16：存档只存"原图 + 裁剪参数"，显示图即时推导；
 * - R22：自定义裁剪确认后，用 Canvas drawImage 把框选区域绘成新图片，
 *   经 toBlob 生成独立 PNG 素材——独立像素数据 / 独立素材 ID / 自己的宽高，
 *   不再携带 crop 参数（图片本身就是最终结果），存储/恢复走既有素材管线。
 *
 * 两种产出（均为 cropResult=true 的独立素材）：
 * - crop 模式：原图框选区域 → 新图片（最长边超 1024px 等比缩小，性能护栏，
 *   与 R16 推导一致；480×360 舞台显示精度足够）；
 * - fit/fill 模式：仅用于"对已独立素材再编辑"（场景 B 类推）——
 *   按 R16 布局规则推导 480×360 显示图后同样落成独立新素材，原素材不动。
 *
 * 独立素材的背景显示由渲染层按 contain 完整呈现（render.ts 的 fit 标记），
 * 不再经过任何裁剪/推导——禁止 cover 二次裁剪（R22.3）。
 */
import type { AssetRecord } from './store';
import { normalizeCropRect, fitLayout, fillLayout, type AssetCrop } from './crop';
import { STAGE_W, STAGE_H } from '../stage/render';

/** crop 模式输出最长边上限（像素；等比缩小，不改变画面内容比例） */
const MAX_RESULT_DIM = 1024;

/** dataURL → 已解码 Image */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('素材图片无法解码')));
    img.onerror = () => reject(new Error('素材图片无法解码'));
    img.src = dataUrl;
  });
}

/** canvas → PNG Blob → dataURL（R22 指定 toBlob 路径；失败抛友好错误） */
function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('裁剪图片生成失败（浏览器不支持 canvas 导出）'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('裁剪图片读取失败'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

/**
 * 由源素材 + 确认的显示方式生成独立新素材记录（不入库，入库由 main.ts 编排）。
 * 源素材永远不被修改：crop 取框选区域像素；fit/fill 取布局推导结果。
 * @param src 源素材（原图或已独立的裁剪素材，dataUrl 即其完整像素）
 * @param crop 调整对话框确认的参数（mode 决定产出形态）
 */
export async function generateCropResult(src: AssetRecord, crop: AssetCrop): Promise<AssetRecord> {
  const img = await loadImage(src.dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('裁剪图片生成失败（浏览器不支持 canvas）');

  if (crop.mode === 'crop') {
    const rect = normalizeCropRect(crop, w, h);
    if (!rect) throw new Error('裁剪区域非法');
    const scale = Math.min(1, MAX_RESULT_DIM / Math.max(rect.w, rect.h));
    canvas.width = Math.max(1, Math.round(rect.w * scale));
    canvas.height = Math.max(1, Math.round(rect.h * scale));
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  } else {
    // fit/fill：与 R16 推导同规则（fit 补白边；fill 铺满裁溢出），产出 480×360 独立图
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    const layout = crop.mode === 'fit' ? fitLayout(w, h) : fillLayout(w, h, crop.offsetX, crop.offsetY);
    ctx.drawImage(img, layout.dx, layout.dy, layout.dw, layout.dh);
  }

  const dataUrl = await canvasToDataUrl(canvas);
  // blob 字节数≈dataURL 去掉头部后的 3/4；容量统计用原始 PNG 字节数
  const size = Math.round((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 0.75);
  const suffix = crop.mode === 'crop' ? '（裁剪）' : '（调整）';
  return {
    id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${src.name}${suffix}`,
    type: 'image/png',
    width: canvas.width,
    height: canvas.height,
    size,
    dataUrl,
    createdAt: new Date().toISOString(),
    cropResult: true, // 独立结果标记：跳过推导、背景 contain 完整显示
    // 不带 crop 参数——图片本身即最终像素，禁止二次裁剪/推导（R22.3）
  };
}