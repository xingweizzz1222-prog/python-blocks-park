/**
 * 素材导入管线（R10；R16 改为两段式）：
 * 本地图片选择 → 类型/大小/解码/容量四重检查 → 返回"草稿"记录（不入库）。
 * 入库时机由 main.ts 编排：草稿先经裁剪调整对话框（adjust.ts）确认参数，
 * 用户确认后才 putAsset——取消调整不留下任何素材残留。
 *
 * 支持 PNG / JPG(JPEG) / WebP；任何一步失败抛出友好中文错误，
 * 不写入坏数据、不影响编辑器运行。用户取消返回 null。
 */
import { totalSize, MAX_FILE_BYTES, MAX_TOTAL_BYTES, type AssetRecord } from './store';

/** 支持的图片 MIME 白名单 */
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** 扩展名兜底（部分系统 File.type 为空） */
const ALLOWED_EXT = /\.(png|jpe?g|webp)$/i;

/** MB 显示（超限提示用） */
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;

/** 解码校验：object URL → Image，取原始宽高；失败/零尺寸视为损坏 */
function decodeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error('图片无法解码（文件可能已损坏）'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法解码（文件可能已损坏）'));
    };
    img.src = url;
  });
}

/** File → dataURL（入库与渲染用） */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 弹出文件选择器，导入一张图片素材的"草稿"（R16：检查通过但不入库）。
 * 检查顺序：类型 → 单文件大小 → 解码 → 总容量。
 * @returns 草稿记录（dataUrl 为原图，crop 未定）；用户取消返回 null；失败抛出中文错误。
 */
export function pickAssetDraft(): Promise<AssetRecord | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      void (async () => {
        // 1) 类型检查（MIME 优先，扩展名兜底）
        const typeOk = ALLOWED_TYPES.includes(file.type) || (file.type === '' && ALLOWED_EXT.test(file.name));
        if (!typeOk) {
          reject(new Error('不支持的图片格式，仅支持 PNG / JPG / WebP'));
          return;
        }
        // 2) 单文件大小
        if (file.size > MAX_FILE_BYTES) {
          reject(new Error(`图片超过单文件上限 ${mb(MAX_FILE_BYTES)}，请压缩后再导入`));
          return;
        }
        // 3) 解码检查（损坏文件在此拦截）
        const dims = await decodeImage(file);
        // 4) 总容量
        const used = await totalSize();
        if (used + file.size > MAX_TOTAL_BYTES) {
          reject(new Error(`素材总容量将超过上限 ${mb(MAX_TOTAL_BYTES)}，请先删除部分素材`));
          return;
        }
        // 5) 生成草稿（R16：不在此入库——main.ts 先弹裁剪调整对话框，确认后才 putAsset）
        const type = ALLOWED_TYPES.includes(file.type) ? file.type : 'image/png';
        const rec: AssetRecord = {
          id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name.replace(/\.[^.]+$/, '') || '素材',
          type,
          width: dims.width,
          height: dims.height,
          size: file.size,
          dataUrl: await readDataUrl(file),
          createdAt: new Date().toISOString(),
        };
        resolve(rec);
      })().catch(reject);
    });

    // 用户取消选择时部分浏览器不触发 change，用 cancel 事件兜底
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}