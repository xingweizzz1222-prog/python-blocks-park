/**
 * 舞台共享渲染器：纯绘制逻辑（不持有 DOM/状态）。
 * 主页面舞台（stage/index.ts）与大屏镜像页（fullscreen/main.ts）共用，
 * 保证两边画面完全一致（坐标换算、旋转、气泡折行规则同一份代码）。
 *
 * 坐标系：中心 (0,0)，x 向右、y 向上；方向 90 右，渲染旋转 direction-90。
 * 绘制目标为 480×360 逻辑坐标；调用方自行设置 ctx 变换实现缩放。
 */
import { getCostume, costumeDataUrl } from './costumes';
import type { HitboxConfig } from './hitbox';

/** 舞台逻辑分辨率（Scratch 同规格；显示缩放不改变该坐标系） */
export const STAGE_W = 480;
export const STAGE_H = 360;

/** 舞台精灵状态（变换/造型/说话/特效），主页面与镜像页共用同一结构 */
export interface StageSprite {
  id: string;
  name: string;
  costume: string;
  x: number;
  y: number;
  direction: number;
  size: number;
  visible: boolean;
  /** 当前说话内容（null 表示不显示气泡） */
  say: string | null;
  /** 虚影特效 0-100（100 全透明） */
  ghost: number;
  /** 亮度特效 -100..100 */
  brightness: number;
  /** 颜色特效 0-200（色相旋转） */
  color: number;
  /** 判定区配置（R14：碰撞检测 R15 与调试可视化共用；旧存档载入时补默认值） */
  hitbox: HitboxConfig;
}

/** 变量监视器条目（R6：变量"显示"积木在舞台左上角挂牌） */
export interface MonitorEntry {
  name: string;
  value: string;
}

/** 造型图片查询函数（SVG data URL → Image，带缓存） */
export type ImageFor = (costumeKey: string) => HTMLImageElement;

/** 自定义素材造型的图像与原始尺寸（R10） */
export interface AssetImage {
  img: HTMLImageElement;
  width: number;
  height: number;
  /** 背景适配方式（R22）：true = contain 完整显示留白（独立裁剪素材，
   *  禁止 cover 二次裁剪）；缺省/false = cover 铺满（R10/R16 现状） */
  fit?: boolean;
}

/** 场景附加层（R10）：舞台背景 + 自定义素材造型解析器。
 *  主页面与大屏镜像各自提供；缺省时渲染行为与一期完全一致。 */
export interface SceneExtras {
  /** 舞台背景（恒最底层；cover 适配：铺满 480×360、保持比例、裁掉溢出） */
  background?: AssetImage | null;
  /** costume 键 → 素材图像（`asset:<id>` 引用；非素材键返回 undefined 走内置造型） */
  assetCostume?: (costumeKey: string) => AssetImage | undefined;
}

/** 创建带缓存的造型图片查询函数（每个页面各自持有一份缓存） */
export function createImageFor(): ImageFor {
  const cache = new Map<string, HTMLImageElement>();
  return (costumeKey) => {
    let img = cache.get(costumeKey);
    if (!img) {
      img = new Image();
      img.src = costumeDataUrl(getCostume(costumeKey));
      cache.set(costumeKey, img);
    }
    return img;
  };
}

/** 画说话气泡（舞台逻辑坐标，不随精灵旋转；自动折行最多 3 行 + 尾巴 + 边界收敛） */
function drawBubble(
  ctx: CanvasRenderingContext2D,
  s: StageSprite,
  screenX: number,
  screenY: number,
  halfH: number,
): void {
  if (!s.say) return;
  const text = s.say;
  ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
  // 简单按宽度折行（最多 3 行）
  const maxW = 150;
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines.push(line);
      line = ch;
      if (lines.length === 3) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < 3 && line) lines.push(line);
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16;
  const h = lines.length * 18 + 12;
  let bx = screenX - w / 2;
  const by = Math.max(4, screenY - halfH - h - 10);
  bx = Math.max(4, Math.min(STAGE_W - w - 4, bx));

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#b8c0cc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 10);
  ctx.fill();
  ctx.stroke();
  // 气泡小尾巴
  ctx.beginPath();
  ctx.moveTo(screenX - 6, by + h - 1);
  ctx.lineTo(screenX + 2, by + h + 8);
  ctx.lineTo(screenX + 8, by + h - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#333a45';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 18 + i * 18));
}

/** 绘制选项（R11 侦测/取色用）：缺省与舞台显示完全一致 */
export interface SceneDrawOptions {
  /** 是否画说话气泡（侦测采样不含气泡：气泡是 UI 不是角色像素） */
  bubbles?: boolean;
  /** 是否铺白底（false = 透明底，用于单独渲染精灵取可见像素掩码） */
  whiteBase?: boolean;
}

/**
 * 绘制一帧完整舞台（白底 + 背景 + 全部可见精灵 + 气泡 + 变量监视器）。
 * 调用前 ctx 变换应已映射到 480×360 逻辑坐标；函数内不清除变换外的区域。
 * extras（R10）：背景恒最底；素材造型按原始宽高参与缩放/旋转，不比例失调。
 * opts（R11）：离屏侦测采样关气泡/白底，保证"可见像素"语义与显示一致。
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  sprites: StageSprite[],
  imageFor: ImageFor,
  monitors: MonitorEntry[] = [],
  extras: SceneExtras = {},
  opts: SceneDrawOptions = {},
): void {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  if (opts.whiteBase !== false) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }

  // 背景层（R10/R12：恒最底）：默认 cover 铺满保持比例；
  // R22 独立裁剪素材（fit 标记）改 contain 完整显示——不截断不拉伸，比例不符留白
  const bg = extras.background;
  if (bg && bg.img.complete && bg.img.naturalWidth > 0) {
    const scale = bg.fit
      ? Math.min(STAGE_W / bg.width, STAGE_H / bg.height)
      : Math.max(STAGE_W / bg.width, STAGE_H / bg.height);
    const dw = bg.width * scale;
    const dh = bg.height * scale;
    ctx.drawImage(bg.img, (STAGE_W - dw) / 2, (STAGE_H - dh) / 2, dw, dh);
  }

  for (const s of sprites) {
    if (!s.visible) continue;
    // 造型解析：自定义素材优先（R10），否则内置 SVG 造型
    const asset = extras.assetCostume?.(s.costume);
    const costume = asset ?? getCostume(s.costume);
    const img = asset ? asset.img : imageFor(s.costume);
    const scale = s.size / 100;
    const w = costume.width * scale;
    const h = costume.height * scale;
    const sx = STAGE_W / 2 + s.x;
    const sy = STAGE_H / 2 - s.y;

    if (img.complete && img.naturalWidth > 0) {
      ctx.save();
      // R6 特效：虚影=透明度，亮度/颜色=canvas 滤镜（Scratch 语义近似）
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - s.ghost / 100));
      const filters: string[] = [];
      if (s.brightness !== 0) filters.push(`brightness(${Math.max(0, 1 + s.brightness / 100)})`);
      if (s.color !== 0) filters.push(`hue-rotate(${s.color * 1.8}deg)`);
      ctx.filter = filters.length ? filters.join(' ') : 'none';
      ctx.translate(sx, sy);
      ctx.rotate(((s.direction - 90) * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    if (opts.bubbles !== false) drawBubble(ctx, s, sx, sy, h / 2);
  }

  drawMonitors(ctx, monitors);
}

/** 变量监视器挂牌（左上角竖排：名称 + 橙色值胶囊，Scratch 风格） */
function drawMonitors(ctx: CanvasRenderingContext2D, monitors: MonitorEntry[]): void {
  if (monitors.length === 0) return;
  ctx.save();
  ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'middle';
  monitors.forEach((m, i) => {
    const value = m.value.length > 12 ? `${m.value.slice(0, 12)}…` : m.value;
    const nameW = ctx.measureText(m.name).width;
    const valW = ctx.measureText(value).width;
    const x = 8;
    const y = 8 + i * 26;
    const boxW = nameW + valW + 30;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#c8cdd6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5b6472';
    ctx.fillText(m.name, x + 8, y + 11);
    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath();
    ctx.roundRect(x + nameW + 14, y + 3, valW + 12, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(value, x + nameW + 20, y + 11);
  });
  ctx.restore();
}