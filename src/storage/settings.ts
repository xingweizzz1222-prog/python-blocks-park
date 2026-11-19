/**
 * 本地设置持久化（R5/R20）：与项目存档分离，只存界面偏好。
 *
 * 键 qoder-sc:settings:v1；当前包含舞台列宽度 stageWidth（px）与
 * 舞台尺寸模式 stageMode（R20：small/large 预设，与自由拖拽微调共存）。
 * 读写均带兜底：设置缺失/损坏/隐私模式写入失败都不影响作品启动与运行。
 */

const SETTINGS_KEY = 'qoder-sc:settings:v1';

/** 舞台尺寸模式（R20）：small=常规编辑布局，large=扩大舞台显示 */
export type StageMode = 'small' | 'large';

/** 本地设置结构（后续偏好可在此扩展字段） */
export interface LocalSettings {
  /** 舞台列宽度（px），含列内边距；舞台画布按 4:3 随之等比缩放 */
  stageWidth?: number;
  /** 舞台尺寸模式预设（R20）；宽度为"预设＋自由拖拽微调"后的实际值 */
  stageMode?: StageMode;
}

/** 读取本地设置（非法字段丢弃） */
export function loadSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as LocalSettings;
    const out: LocalSettings = {};
    const w = data.stageWidth;
    if (typeof w === 'number' && Number.isFinite(w)) out.stageWidth = w;
    if (data.stageMode === 'small' || data.stageMode === 'large') out.stageMode = data.stageMode;
    return out;
  } catch {
    return {};
  }
}

/** 写入本地设置（失败静默：不影响主流程） */
export function saveSettings(s: LocalSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等写入受限场景忽略 */
  }
}