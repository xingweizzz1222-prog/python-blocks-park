/**
 * 存档模块：本地自动保存/恢复、存档导出（文件下载）、导入（文件恢复）。
 *
 * - 本地存储键带版本号，未来格式升级可平滑迁移。
 * - 自动保存由 main.ts 在内容变化时触发（防抖），状态文案回显到顶栏。
 * - 导出/导入均为纯 JSON 文件；导入先校验后替换（R9），任何失败统一提示
 *   「存档有误，无法导入」，不触碰当前项目。
 */
import { validateProject, type ProjectData, type ExportBundle } from './project';

export { createDefaultProject, validateProject } from './project';
export type { ProjectData, SpriteData, AssetMeta, ExportBundle } from './project';

const STORAGE_KEY = 'qoder-sc:project:v1';

/** 从 localStorage 读取存档；不存在或损坏时返回 null */
export function loadLocal(): ProjectData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return validateProject(data) ? data : null;
  } catch {
    return null; // 隐私模式/配额异常等场景下降级为"无存档"
  }
}

/** 写入 localStorage；返回是否成功（配额满等情况会失败） */
export function saveLocal(project: ProjectData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

/**
 * 导出存档：触发浏览器下载 JSON 文件。
 * R10：统一导出为 v2 格式；传入 assetData 时把项目用到的素材 dataURL 一并打包，
 * 对方导入时即可回灌素材库（二进制不经过 localStorage）。
 */
export function exportFile(project: ProjectData, assetData?: Record<string, string>): void {
  const bundle: ExportBundle = {
    ...project,
    version: 2,
    background: project.background ?? null,
    assets: project.assets ?? [],
    ...(assetData && Object.keys(assetData).length > 0 ? { assetData } : {}),
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `python积木乐园-存档-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟释放，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 导入失败的统一用户提示（R9：损坏/空/无法解析/结构不完整/版本不兼容/类型错误一律相同文案） */
export const IMPORT_ERROR_MESSAGE = '存档有误，无法导入';

/**
 * 导入存档：弹出文件选择器，读取并校验 JSON（R9：先校验后替换）。
 * 用户取消返回 null；任何失败统一抛出「存档有误，无法导入」，
 * 具体原因仅写入 console 供排查，不向用户暴露内部细节。
 * 本函数只产出经过校验的数据，不触碰当前项目——替换由调用方在校验通过后执行。
 * R10：返回值可能携带导出文件内嵌的 assetData（素材 dataURL），由调用方回灌素材库。
 */
export function importFile(): Promise<ExportBundle | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    /** 统一失败出口：记录真实原因，向用户给统一提示 */
    const fail = (reason: string) => {
      console.warn('[storage] 导入被拒绝：', reason);
      reject(new Error(IMPORT_ERROR_MESSAGE));
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        if (text.trim() === '') {
          fail('空文件');
          return;
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (e) {
          fail(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        if (!validateProject(data)) {
          fail('结构/字段/版本校验未通过');
          return;
        }
        // 校验通过的数据可能是 v1/v2 项目或带 assetData 的导出包，统一按导出包类型交出
        resolve(data as ExportBundle);
      };
      reader.onerror = () => {
        input.remove();
        fail('文件读取失败');
      };
      reader.readAsText(file);
    });

    // 用户取消选择时部分浏览器不触发 change，用 cancel 事件兜底
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/**
 * 创建防抖自动保存器。
 * @param collect 收集当前完整项目状态（由 main.ts 提供，聚合积木+舞台）
 * @param onSaved 保存结果回调（成功时间/失败），用于顶栏状态文案
 */
export function createAutoSaver(
  collect: () => ProjectData,
  onSaved: (ok: boolean, time: Date) => void,
  delayMs = 800,
): { trigger(): void; flush(): void } {
  let timer: number | undefined;

  const doSave = () => {
    const project = collect();
    project.savedAt = new Date().toISOString();
    const ok = saveLocal(project);
    onSaved(ok, new Date());
  };

  return {
    trigger() {
      window.clearTimeout(timer);
      timer = window.setTimeout(doSave, delayMs);
    },
    /** 立即保存（页面隐藏/关闭前调用，避免丢最后一次改动） */
    flush() {
      window.clearTimeout(timer);
      doSave();
    },
  };
}