/**
 * 自定义素材模块（R10）：本地图片导入、IndexedDB 存储、素材库面板。
 *
 * 素材用途：舞台背景（恒最底层，R12 联动）或精灵造型。
 * 造型引用约定：精灵 costume 字段为 `asset:<素材id>` 时即自定义素材造型，
 * 其余取值仍为内置造型键（stage/costumes.ts）。
 *
 * 存档约定（v2）：项目 JSON 只存素材元数据与引用，二进制在 IndexedDB；
 * 导出文件额外内嵌所用素材的 dataURL（assetData），导入时回灌素材库。
 */
export { listAssets, getAsset, putAsset, deleteAsset, totalSize, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './store';
export type { AssetRecord } from './store';
export { pickAssetDraft } from './import';
export { initAssetPanel, type AssetPanelCallbacks } from './panel';
// R16：裁剪参数模型 / 显示图推导 / 调整对话框
export { normalizeCrop, DEFAULT_CROP, type AssetCrop } from './crop';
export { deriveAssetView, deriveAssetViews, invalidateDeriveCache } from './derive';
export { openAssetAdjust } from './adjust';
// R22：裁剪结果独立素材生成（drawImage + toBlob，独立 ID/像素/宽高）
export { generateCropResult } from './cropResult';

/** 素材造型键前缀 */
const ASSET_PREFIX = 'asset:';

/** 素材 id → 精灵造型引用键 */
export function assetCostumeKey(id: string): string {
  return `${ASSET_PREFIX}${id}`;
}

/** 是否自定义素材造型键 */
export function isAssetCostume(key: string): boolean {
  return key.startsWith(ASSET_PREFIX);
}

/** 造型引用键 → 素材 id（非素材键返回 null） */
export function assetIdFromCostume(key: string): string | null {
  return isAssetCostume(key) ? key.slice(ASSET_PREFIX.length) : null;
}