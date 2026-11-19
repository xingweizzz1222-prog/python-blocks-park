/**
 * 主页面侧镜像广播器：把舞台状态推给大屏展示页。
 *
 * 推送双通道：
 * - 事件驱动：舞台 onChange（patch/反弹/增删等）立即 push，零延迟；
 * - 33ms 兜底轮询：覆盖未挂 onChange 的变化（如运行态切换）。
 *
 * 同时接收大屏页消息：hello → 立即 push；command → 转交绿旗/暂停/重置。
 *
 * 已知限制：主页面窗口被隐藏时浏览器节流定时器，脚本 pacing 与兜底推送
 * 都会降频；大屏页有"保持主页面窗口可见"提示（演示建议主窗口不要最小化）。
 */
import { openMirrorChannel, type MirrorMsg, type MirrorAssetData } from './channel';
import type { StageApi } from '../stage';

/** 大屏页遥控命令的落地回调（main.ts 接运行时，R1 三语义） */
export interface MirrorCommands {
  flag(): void;
  pause(): void;
  reset(): void;
}

export interface StageMirror {
  /** 立即推送一帧状态（舞台 onChange / 运行态变化时调用） */
  push(): void;
  /** 推送素材目录与背景图像（R10：连接建立 / 素材或背景变化时调用） */
  pushAssets(): void;
  /** 停止广播并关闭频道 */
  stop(): void;
}

/** 启动镜像广播（主页面装配时调用一次） */
export function startStageMirror(
  stage: StageApi,
  isRunning: () => boolean,
  isPaused: () => boolean,
  commands: MirrorCommands,
): StageMirror {
  const ch = openMirrorChannel();

  function push(): void {
    const msg: MirrorMsg = {
      type: 'state',
      sprites: stage.getSprites(),
      running: isRunning(),
      paused: isPaused(),
      monitors: stage.getMonitors(),
      background: stage.getBackground(),
    };
    ch.postMessage(msg);
  }

  /** 素材目录 → 镜像消息（dataURL 体积大，只在需要时发，不进每帧 state） */
  function pushAssets(): void {
    const catalog = stage.getAssetCatalog();
    const costumes: Record<string, MirrorAssetData> = {};
    for (const a of catalog) costumes[a.id] = { dataUrl: a.dataUrl, width: a.width, height: a.height, fit: a.cropResult === true };
    const bgId = stage.getBackground();
    const bg = bgId ? costumes[bgId] ?? null : null;
    ch.postMessage({ type: 'assets', background: bg, costumes });
  }

  ch.onmessage = (ev: MessageEvent<MirrorMsg>) => {
    const m = ev.data;
    if (m.type === 'hello') {
      pushAssets(); // 大屏页刚连接：先给素材目录，再给一帧状态
      push();
    } else if (m.type === 'command') {
      if (m.command === 'flag') commands.flag();
      else if (m.command === 'pause') commands.pause();
      else commands.reset();
    }
  };

  const timer = window.setInterval(push, 33); // 兜底 ~30fps
  pushAssets();
  push(); // 启动即推一帧（大屏页可能已开着）

  return {
    push,
    pushAssets,
    stop() {
      window.clearInterval(timer);
      ch.close();
    },
  };
}