/**
 * 吸色笔工具（R11）：舞台/素材预览取色 + 颜色浮层 + 填入颜色侦测积木。
 *
 * 交互：
 * - 舞台工具栏「🖉 吸色」开关进入取色模式（舞台光标变十字，Esc 或再点按钮退出）；
 * - 取色模式下点击舞台：按逻辑坐标离屏采样（免疫显示缩放），浮层显示色块/RGB/HEX/透明度；
 * - 取色模式下点击素材卡缩略图：按素材原图自然坐标采样（可吸取导入地图的墙壁色）；
 * - 浮层按当前选中积木渲染填色按钮（单参数「填入颜色」；双参数「填入颜色1/填入颜色2」；
 *   选中 HEX 文本子积木则只给该参数按钮），把 HEX 写入对应参数（规则见 blocks.applyColor）。
 *
 * 本模块只做 UI 与采样调度；颜色匹配/侦测逻辑在 sensing/index.ts，
 * 填入积木的选择规则在 blocks/index.ts（applyColor），职责分离。
 */
import '../styles/eyedropper.css';
import { STAGE_W, STAGE_H, type AssetImage } from '../stage/render';
import { hexOf, type RGBA, type SensingApi } from './index';

export interface EyedropperOptions {
  /** 舞台工具栏开关按钮 */
  button: HTMLButtonElement;
  /** 主舞台画布（点击取色宿主） */
  stageCanvas: HTMLCanvasElement;
  /** 素材面板宿主（缩略图点击取色，事件委托） */
  assetPanelHost: HTMLElement;
  sensing: SensingApi;
  /** 素材 id → 图像（舞台素材缓存解析） */
  getAssetImage(id: string): AssetImage | undefined;
  /** 把 HEX 填入选中积木的指定参数；返回是否成功（失败时浮层给引导提示） */
  applyColor(hex: string, input?: string): boolean;
  /** 当前选中块可填色参数（浮层按钮列表；双参数积木给出 颜色1/颜色2 两个按钮） */
  colorTargets(): Array<{ input: string; label: string }>;
  /** 选中块变化时刷新浮层按钮 */
  onSelectionChange(cb: () => void): void;
}

export interface EyedropperApi {
  isActive(): boolean;
  setActive(v: boolean): void;
}

/** 初始化吸色笔（main.ts 装配时调用一次） */
export function initEyedropper(opts: EyedropperOptions): EyedropperApi {
  let active = false;

  // 取色结果浮层（全页唯一，重复取色只更新内容与位置）
  const picker = document.createElement('div');
  picker.className = 'eyedropper-picker hidden';
  document.body.appendChild(picker);
  // Blockly 全局 pointerdown 会清除工作区选中；浮层内点击（填色按钮）须保留选中积木
  picker.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  picker.addEventListener('mousedown', (ev) => ev.stopPropagation());

  function hidePicker(): void {
    picker.classList.add('hidden');
  }

  function setActive(v: boolean): void {
    active = v;
    opts.button.classList.toggle('active', v);
    opts.stageCanvas.classList.toggle('eyedropping', v);
    if (!v) hidePicker();
  }

  /** 展示取色结果：色块 + RGB + HEX + 透明度说明 + 填入/关闭 */
  let currentHex = '#000000';
  function renderActions(): void {
    const targets = opts.colorTargets();
    const actions = picker.querySelector<HTMLDivElement>('.edp-actions')!;
    actions.innerHTML =
      (targets.length
        ? targets.map((t) => `<button class="edp-apply" data-input="${t.input}">填入${t.label}</button>`).join('')
        : '<button class="edp-apply">填入选中积木</button>') + '<button class="edp-close">关闭</button>';
    actions.querySelectorAll<HTMLButtonElement>('.edp-apply').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ok = opts.applyColor(currentHex, btn.dataset.input || undefined);
        picker.querySelector<HTMLDivElement>('.edp-hint')!.textContent = ok
          ? '已填入 ✓'
          : '请先选中颜色侦测积木（或它的 HEX 参数积木）再填入';
      });
    });
    actions.querySelector<HTMLButtonElement>('.edp-close')!.addEventListener('click', hidePicker);
  }
  // 取色后用户才去选积木是常见流程：选中变化时实时刷新可填按钮
  opts.onSelectionChange(() => {
    if (!picker.classList.contains('hidden')) renderActions();
  });

  function showPicker(clientX: number, clientY: number, c: RGBA): void {
    const hex = hexOf(c);
    currentHex = hex;
    const transparent = c.a < 255;
    picker.innerHTML = `
      <div class="edp-head">
        <span class="edp-swatch" style="background-color:rgba(${c.r},${c.g},${c.b},${c.a / 255})"></span>
        <span class="edp-hex">${hex}</span>
      </div>
      <div class="edp-row">RGB：${c.r}, ${c.g}, ${c.b}</div>
      ${transparent ? `<div class="edp-row edp-alpha">透明度 ${Math.round((1 - c.a / 255) * 100)}%（透明区域不参与侦测）</div>` : ''}
      <div class="edp-actions"></div>
      <div class="edp-hint"></div>
    `;
    renderActions();
    // 视口内收敛，避免浮层出屏
    const pw = 232;
    const ph = (transparent ? 168 : 148) + (opts.colorTargets().length > 1 ? 26 : 0);
    picker.style.left = `${Math.max(8, Math.min(window.innerWidth - pw - 8, clientX + 12))}px`;
    picker.style.top = `${Math.max(8, Math.min(window.innerHeight - ph - 8, clientY + 12))}px`;
    picker.classList.remove('hidden');
  }

  opts.button.addEventListener('click', () => setActive(!active));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && active) setActive(false);
  });

  // 舞台取色：页面坐标 → 480×360 逻辑坐标 → 离屏采样（与显示缩放无关）
  opts.stageCanvas.addEventListener('click', (ev) => {
    if (!active) return;
    const r = opts.stageCanvas.getBoundingClientRect();
    const lx = ((ev.clientX - r.left) / r.width) * STAGE_W - STAGE_W / 2;
    const ly = STAGE_H / 2 - ((ev.clientY - r.top) / r.height) * STAGE_H;
    showPicker(ev.clientX, ev.clientY, opts.sensing.sampleStagePixel(lx, ly));
  });

  // 素材预览取色：缩略图点击位置 → 素材原图自然坐标（事件委托，面板重绘不失效）
  opts.assetPanelHost.addEventListener('click', (ev) => {
    if (!active) return;
    const img = (ev.target as HTMLElement).closest<HTMLImageElement>('.asset-card img');
    if (!img) return;
    const id = img.closest<HTMLElement>('.asset-card')?.dataset.assetId;
    const asset = id ? opts.getAssetImage(id) : undefined;
    if (!asset) return;
    const r = img.getBoundingClientRect();
    // 缩略图 object-fit: contain 有留边：按实际绘制区换算到原图自然坐标
    const fit = Math.min(r.width / asset.width, r.height / asset.height);
    const ox = (r.width - asset.width * fit) / 2;
    const oy = (r.height - asset.height * fit) / 2;
    const nx = (ev.clientX - r.left - ox) / fit;
    const ny = (ev.clientY - r.top - oy) / fit;
    showPicker(ev.clientX, ev.clientY, opts.sensing.sampleAssetPixel(asset, nx, ny));
  });

  return { isActive: () => active, setActive };
}