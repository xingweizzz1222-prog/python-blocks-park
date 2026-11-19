/**
 * 大屏镜像通信协议：BroadcastChannel（同源跨页签/跨窗口）。
 *
 * 消息方向：
 * - 主页面 → 大屏页：state（全部精灵变换 + 运行态 + 暂停态 + 背景引用），事件驱动 + 33ms 兜底；
 *   assets（素材目录 + 背景图像 dataURL，R10）——仅在连接建立与素材/背景变化时发送，
 *   避免每帧携带大体积图片数据；
 * - 大屏页 → 主页面：hello（连接时请求立即推送）、command（遥控绿旗/暂停/重置）。
 *
 * 执行始终发生在主页面（Pyodide 在那边），大屏页只做渲染与遥控。
 */
import type { StageSprite, MonitorEntry } from '../stage/render';

/** 频道名（带版本后缀；R10 协议加入背景/素材，升 v3 避免与旧页签混连） */
export const MIRROR_CHANNEL = 'qoder-sc:stage:v3';

/** 主页面 → 大屏页：一帧舞台状态（轻量，不含图片二进制） */
export interface MirrorStateMsg {
  type: 'state';
  sprites: StageSprite[];
  running: boolean;
  /** 暂停态（R1）：大屏页据此切换暂停/继续按钮文案 */
  paused: boolean;
  /** 变量监视器（R6，附加字段：旧页忽略不影响） */
  monitors?: MonitorEntry[];
  /** 舞台背景素材 id（R10；null/缺省 = 白色） */
  background?: string | null;
}

/** 素材图像数据（dataURL + 原始宽高） */
export interface MirrorAssetData {
  dataUrl: string;
  width: number;
  height: number;
  /** 背景 contain 完整显示标记（R22 独立裁剪素材；旧页忽略不影响） */
  fit?: boolean;
}

/** 主页面 → 大屏页：素材目录（R10，连接时与素材/背景变化时发送） */
export interface MirrorAssetsMsg {
  type: 'assets';
  /** 背景图像（null = 无背景） */
  background: MirrorAssetData | null;
  /** 素材 id → 图像数据（精灵 `asset:` 造型引用解析用） */
  costumes: Record<string, MirrorAssetData>;
}

/** 大屏页 → 主页面：遥控命令（与主页面三按钮同语义） */
export interface MirrorCommandMsg {
  type: 'command';
  command: 'flag' | 'pause' | 'reset';
}

/** 大屏页 → 主页面：请求立即推送当前状态 */
export interface MirrorHelloMsg {
  type: 'hello';
}

export type MirrorMsg = MirrorStateMsg | MirrorAssetsMsg | MirrorCommandMsg | MirrorHelloMsg;

/** 打开镜像频道（调用方负责 close） */
export function openMirrorChannel(): BroadcastChannel {
  return new BroadcastChannel(MIRROR_CHANNEL);
}