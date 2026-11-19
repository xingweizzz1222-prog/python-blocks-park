/**
 * 存档数据模型：项目/精灵结构定义 + 默认项目。
 *
 * 存档格式 v1：JSON 文件，含应用标识与版本号。导入/本地读取前做严格校验
 * （R9：结构完整＋必要字段＋数据类型＋版本兼容），避免坏数据进入 Blockly/舞台/运行时。
 * 精灵脚本以 Blockly 序列化状态保存。
 *
 * 存档格式 v2（R10）：新增舞台背景引用、素材元数据列表、精灵图层号（R12 用）；
 * 精灵 costume 可为 `asset:<id>` 引用自定义素材。项目 JSON 只存引用与元数据，
 * 图片二进制在 IndexedDB（assets 模块）；导出文件额外内嵌 assetData（dataURL）。
 * v2 完全兼容 v1：旧存档缺省背景/素材/图层，读取语义不变。
 */
import type { HitboxConfig } from '../stage/hitbox';
import type { AssetCrop } from '../assets/crop';

/** 素材元数据（存档内的引用信息；二进制另存 IndexedDB / 导出文件 assetData） */
export interface AssetMeta {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  /** 原始文件字节数（导入回灌时做容量检查） */
  size: number;
  /** 裁剪参数（R16，可选：缺省 = 完整显示）。width/height 恒为原图尺寸，
   *  导出内嵌的 assetData 恒为原图——导入后按参数重新推导显示图。
   *  R22 独立裁剪素材不带本字段（图片本身即最终像素）。 */
  crop?: AssetCrop;
  /** 独立裁剪结果标记（R22）：width/height 为裁剪图自身尺寸，
   *  assetData 内嵌的即最终像素；导入后跳过推导、背景 contain 完整显示。 */
  cropResult?: boolean;
}

/** 单个精灵的完整状态（变换 + 脚本） */
export interface SpriteData {
  id: string;
  name: string;
  /** 造型键：内置造型键或 `asset:<素材id>`（v2 自定义素材造型） */
  costume: string;
  x: number;
  y: number;
  /** Scratch 方向：90 右 / 0 上 / -90 左 / 180 下 */
  direction: number;
  /** 大小百分比，100 为原始大小 */
  size: number;
  visible: boolean;
  /** 特效（R6，可选：旧存档缺省为 0） */
  ghost?: number;
  brightness?: number;
  color?: number;
  /** 图层序号（R12，可选：v1 旧存档缺省按数组顺序） */
  layer?: number;
  /** 判定区配置（R14，可选：旧存档缺省为"自动"模式，载入时规范化） */
  hitbox?: HitboxConfig;
  /** Blockly 工作区序列化状态 */
  workspace: Record<string, unknown>;
}

/** 项目存档根结构（v1 | v2） */
export interface ProjectData {
  app: 'qoder-sc';
  version: 1 | 2;
  savedAt: string;
  sprites: SpriteData[];
  selectedSpriteId: string;
  /** v2：舞台背景素材 id（null/缺省 = 白色默认背景） */
  background?: string | null;
  /** v2：素材元数据列表（项目引用到的全部素材） */
  assets?: AssetMeta[];
}

/** 导出文件结构（R10）：v2 项目 + 内嵌所用素材的 dataURL（导入时回灌素材库） */
export interface ExportBundle extends ProjectData {
  version: 2;
  /** 素材 id → dataURL（仅打包项目用到的素材） */
  assetData?: Record<string, string>;
}

/** 默认示例脚本：当⚑被点击 → 说"你好，世界！"2秒 → 重复4次(移动60步+右转90度)
 *  R3：用"说…几秒"避免留下无法清除的常驻气泡 */
const DEMO_WORKSPACE: Record<string, unknown> = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'sc_when_flag',
        x: 40,
        y: 40,
        next: {
          block: {
            type: 'sc_say_secs',
            inputs: {
              TEXT: { shadow: { type: 'text', fields: { TEXT: '你好，世界！' } } },
              SECS: { shadow: { type: 'math_number', fields: { NUM: 2 } } },
            },
            next: {
              block: {
                type: 'sc_repeat',
                inputs: {
                  TIMES: { shadow: { type: 'math_number', fields: { NUM: 4 } } },
                  DO: {
                    block: {
                      type: 'sc_move',
                      inputs: { STEPS: { shadow: { type: 'math_number', fields: { NUM: 60 } } } },
                      next: {
                        block: {
                          type: 'sc_turn_right',
                          inputs: { DEG: { shadow: { type: 'math_number', fields: { NUM: 90 } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};

/** 首次打开（无本地存档）时的默认项目：一只小猫 + 示例脚本 */
export function createDefaultProject(): ProjectData {
  return {
    app: 'qoder-sc',
    version: 1,
    savedAt: new Date().toISOString(),
    sprites: [
      {
        id: 'sprite-1',
        name: '小猫',
        costume: 'cat',
        x: 0,
        y: 0,
        direction: 90,
        size: 100,
        visible: true,
        workspace: DEMO_WORKSPACE,
      },
    ],
    selectedSpriteId: 'sprite-1',
  };
}

/** 有限数值判定（拒绝 NaN/Infinity/数字字符串等非法类型） */
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 普通对象判定（排除 null 与数组） */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 工作区序列化状态结构校验（R9）：整体为对象；blocks 容器若存在则顶层积木须有字符串 type。
 *  更深的可载入性由 blocks.validateWorkspaceState 无头试载入把关。 */
function validWorkspace(ws: unknown): boolean {
  if (!isObj(ws)) return false;
  const container = ws.blocks;
  if (container === undefined) return true; // 空工作区合法（新建精灵默认脚本）
  if (!isObj(container) || !Array.isArray(container.blocks)) return false;
  return container.blocks.every((b) => isObj(b) && typeof b.type === 'string');
}

/** 单个精灵结构校验（R9：必要字段齐全且类型正确；特效/图层字段可选，兼容旧存档）。
 *  assetIds：v2 素材 id 集合，用于校验 `asset:` 造型引用必须可解析。 */
function validSprite(s: unknown, assetIds: Set<string>): boolean {
  if (!isObj(s)) return false;
  if (
    typeof s.id !== 'string' || s.id.length === 0 ||
    typeof s.name !== 'string' ||
    typeof s.costume !== 'string' ||
    !isNum(s.x) || !isNum(s.y) || !isNum(s.direction) || !isNum(s.size) ||
    typeof s.visible !== 'boolean' ||
    !(s.ghost === undefined || isNum(s.ghost)) ||
    !(s.brightness === undefined || isNum(s.brightness)) ||
    !(s.color === undefined || isNum(s.color)) ||
    !(s.layer === undefined || isNum(s.layer)) ||
    !(s.hitbox === undefined || isObj(s.hitbox)) || // R14：判定区可选，字段级兜底在载入时规范化
    !validWorkspace(s.workspace)
  ) {
    return false;
  }
  // 自定义素材造型引用必须指向存档内声明的素材（R10）
  if (s.costume.startsWith('asset:') && !assetIds.has(s.costume.slice(6))) return false;
  return true;
}

/** 素材元数据结构校验（R10；R16 增加可选裁剪参数：字段级兜底在载入时 normalizeCrop） */
function validAssetMeta(a: unknown): boolean {
  return (
    isObj(a) &&
    typeof a.id === 'string' && a.id.length > 0 &&
    typeof a.name === 'string' &&
    typeof a.type === 'string' &&
    isNum(a.width) && a.width > 0 &&
    isNum(a.height) && a.height > 0 &&
    isNum(a.size) && a.size >= 0 &&
    (a.crop === undefined || isObj(a.crop)) &&
    (a.cropResult === undefined || typeof a.cropResult === 'boolean')
  );
}

/** 校验导入/本地读取的数据是否为合法存档（R9 加固＋R10 双版本兼容）。
 *  任一不符即整体拒绝，禁止坏数据进入 Blockly/舞台/运行时。
 *  导出文件（ExportBundle）的 assetData 一并校验：键必须对应声明的素材、值必须是图片 dataURL。 */
export function validateProject(data: unknown): data is ProjectData {
  if (!isObj(data)) return false;
  const p = data as Partial<ProjectData> & { assetData?: unknown };
  if (p.app !== 'qoder-sc' || (p.version !== 1 && p.version !== 2)) return false; // 版本不兼容一律拒绝
  if (typeof p.savedAt !== 'string') return false;
  if (!Array.isArray(p.sprites) || p.sprites.length === 0) return false;

  // v2 素材声明（v1 无素材概念，缺省合法）
  const assets = p.assets ?? [];
  if (!Array.isArray(assets) || !assets.every(validAssetMeta)) return false;
  const assetIds = new Set(assets.map((a) => a.id));
  if (assetIds.size !== assets.length) return false; // 素材 id 不得重复

  if (!p.sprites.every((s) => validSprite(s, assetIds))) return false;
  // 精灵 id 不得重复；选中精灵必须存在
  const ids = p.sprites.map((s) => (s as SpriteData).id);
  if (new Set(ids).size !== ids.length) return false;
  if (typeof p.selectedSpriteId !== 'string' || !ids.includes(p.selectedSpriteId)) return false;

  // v2 背景引用必须可解析（null/缺省 = 白色背景）
  if (p.background != null && (typeof p.background !== 'string' || !assetIds.has(p.background))) return false;

  // 导出文件内嵌素材数据校验（本地存档无此字段）
  if (p.assetData !== undefined) {
    if (!isObj(p.assetData)) return false;
    for (const [id, url] of Object.entries(p.assetData)) {
      if (!assetIds.has(id) || typeof url !== 'string' || !url.startsWith('data:image/')) return false;
    }
  }
  return true;
}