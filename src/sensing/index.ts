/**
 * 颜色侦测模块（R11）：逻辑分辨率离屏采样 + 颜色容差匹配。
 *
 * 采样语义（对照 Scratch）：
 * - 「碰到颜色」：本精灵的可见像素 与 "去掉本精灵后的舞台"（白底/背景 + 其余精灵，
 *   按图层顺序）中指定颜色的像素重叠即为真；精灵自身像素不参与被碰方。
 * - 「颜色碰到颜色」：本精灵上颜色1的可见像素 碰到 上述舞台中颜色2的像素。
 * - 透明不算边界：掩码 alpha=0 的像素直接跳过（虚影特效降低 alpha 时同样按可见度生效）。
 * - 气泡/变量监视器是 UI 覆盖层，不属于角色像素，侦测采样不画（取色笔所见即所得则包含）。
 *
 * 缩放免疫：采样画布恒为 480×360 逻辑分辨率，与主舞台共用 drawScene（含图层顺序、
 * 背景 cover、素材造型等比、特效滤镜），显示缩放只改变主画布物理像素，不影响侦测。
 *
 * 颜色容差：RGB 欧氏距离 ≤ COLOR_TOLERANCE（执行者选定 30，约单通道 ±17），
 * 覆盖抗锯齿边缘与 JPEG 压缩偏差；不暴露为积木参数，保持积木面简洁（清单允许执行方定）。
 */
import {
  drawScene,
  createImageFor,
  STAGE_W,
  STAGE_H,
  type StageSprite,
  type SceneExtras,
  type MonitorEntry,
  type AssetImage,
} from '../stage/render';

/** 侦测依赖注入（StageApi 天然满足；避免 sensing ↔ stage 循环引用） */
export interface SensingDeps {
  getSprites(): StageSprite[];
  getMonitors(): MonitorEntry[];
  getSceneExtras(): SceneExtras;
  getCostumeDims(costume: string): { width: number; height: number };
}

/** 采样得到的像素（a=0 表示全透明） */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SensingApi {
  /** 精灵可见像素是否碰到舞台（除自身外）上的指定颜色 */
  touchingColor(spriteId: string, hex: string): boolean;
  /** 精灵上颜色1的像素是否碰到舞台（除自身外）上颜色2的像素 */
  colorTouchingColor(spriteId: string, hex1: string, hex2: string): boolean;
  /** 取色笔：舞台显示内容在逻辑坐标 (x,y) 处的像素（含气泡/监视器，所见即所得） */
  sampleStagePixel(x: number, y: number): RGBA;
  /** 取色笔：素材原图在自然坐标 (nx,ny) 处的像素 */
  sampleAssetPixel(asset: AssetImage, nx: number, ny: number): RGBA;
}

/** 默认颜色容差（RGB 欧氏距离）：抗锯齿/压缩偏差容忍度，执行者选定 */
export const COLOR_TOLERANCE = 30;

/** 解析 HEX 颜色（#rgb / #rrggbb，# 可省略）；非法返回 null */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** RGB → 标准小写 #rrggbb */
export function hexOf(c: { r: number; g: number; b: number }): string {
  const p = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

/** 容差匹配：RGB 欧氏距离平方 ≤ 容差平方 */
function close(c: RGBA, t: { r: number; g: number; b: number }): boolean {
  const dr = c.r - t.r;
  const dg = c.g - t.g;
  const db = c.b - t.b;
  return dr * dr + dg * dg + db * db <= COLOR_TOLERANCE * COLOR_TOLERANCE;
}

/** 创建侦测采样器（离屏画布懒创建：不用颜色积木/取色笔则零开销） */
export function createSensing(deps: SensingDeps): SensingApi {
  const imageFor = createImageFor();
  /** 三块离屏画布：scene=除自身外舞台；mask=精灵单独透明底；pick=取色（尺寸可变） */
  const canvases: Partial<Record<'scene' | 'mask' | 'pick', HTMLCanvasElement>> = {};
  function ctxOf(key: 'scene' | 'mask' | 'pick', w = STAGE_W, h = STAGE_H): CanvasRenderingContext2D {
    let c = canvases[key];
    if (!c) {
      c = document.createElement('canvas');
      canvases[key] = c;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c.getContext('2d', { willReadFrequently: true })!;
  }

  /** 渲染"除自身外舞台"与"精灵透明掩码"，并给出旋转外接圆扫描区（限制像素循环范围） */
  function renderPair(s: StageSprite): { scene: ImageData; mask: ImageData; x0: number; y0: number; x1: number; y1: number } {
    const extras = deps.getSceneExtras();
    const others = deps.getSprites().filter((o) => o.id !== s.id);
    const sc = ctxOf('scene');
    drawScene(sc, others, imageFor, [], extras, { bubbles: false });
    const mc = ctxOf('mask');
    drawScene(mc, [s], imageFor, [], { assetCostume: extras.assetCostume }, { bubbles: false, whiteBase: false });
    const d = deps.getCostumeDims(s.costume);
    const r = (Math.hypot(d.width, d.height) / 2) * (s.size / 100) + 2;
    const cx = STAGE_W / 2 + s.x;
    const cy = STAGE_H / 2 - s.y;
    return {
      scene: sc.getImageData(0, 0, STAGE_W, STAGE_H),
      mask: mc.getImageData(0, 0, STAGE_W, STAGE_H),
      x0: Math.max(0, Math.floor(cx - r)),
      y0: Math.max(0, Math.floor(cy - r)),
      x1: Math.min(STAGE_W - 1, Math.ceil(cx + r)),
      y1: Math.min(STAGE_H - 1, Math.ceil(cy + r)),
    };
  }

  /** 扫描掩码可见像素，谓词命中即真 */
  function scan(s: StageSprite, hit: (mask: RGBA, scene: RGBA) => boolean): boolean {
    const { scene, mask, x0, y0, x1, y1 } = renderPair(s);
    const sd = scene.data;
    const md = mask.data;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * STAGE_W + x) * 4;
        if (md[i + 3] === 0) continue; // 透明不算边界
        const m: RGBA = { r: md[i], g: md[i + 1], b: md[i + 2], a: md[i + 3] };
        const sc: RGBA = { r: sd[i], g: sd[i + 1], b: sd[i + 2], a: sd[i + 3] };
        if (hit(m, sc)) return true;
      }
    }
    return false;
  }

  return {
    touchingColor(spriteId, hex) {
      const target = parseHexColor(hex);
      const s = deps.getSprites().find((sp) => sp.id === spriteId);
      if (!target || !s || !s.visible) return false;
      return scan(s, (_m, sc) => close(sc, target));
    },
    colorTouchingColor(spriteId, hex1, hex2) {
      const c1 = parseHexColor(hex1);
      const c2 = parseHexColor(hex2);
      const s = deps.getSprites().find((sp) => sp.id === spriteId);
      if (!c1 || !c2 || !s || !s.visible) return false;
      return scan(s, (m, sc) => close(m, c1) && close(sc, c2));
    },
    sampleStagePixel(x, y) {
      const px = Math.max(0, Math.min(STAGE_W - 1, Math.round(STAGE_W / 2 + x)));
      const py = Math.max(0, Math.min(STAGE_H - 1, Math.round(STAGE_H / 2 - y)));
      const ctx = ctxOf('pick', STAGE_W, STAGE_H);
      drawScene(ctx, deps.getSprites(), imageFor, deps.getMonitors(), deps.getSceneExtras());
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    sampleAssetPixel(asset, nx, ny) {
      const w = Math.max(1, asset.width);
      const h = Math.max(1, asset.height);
      const px = Math.max(0, Math.min(w - 1, Math.round(nx)));
      const py = Math.max(0, Math.min(h - 1, Math.round(ny)));
      const ctx = ctxOf('pick', w, h);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(asset.img, 0, 0, w, h);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
  };
}