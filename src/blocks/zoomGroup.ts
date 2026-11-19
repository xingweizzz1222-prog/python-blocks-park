/**
 * UI-02 脚本区缩放三按钮组视觉分组（方案 A · 纯视觉，二期美化第一批）。
 *
 * 工程事实：Blockly 13 的放大/缩小/居中是三个独立 SVG 组
 * （g.blocklyZoomIn / blocklyZoomOut / blocklyZoomReset），各自带 transform 定位，
 * 图标默认引用远程 sprites.svg 的裁剪区域。
 *
 * 本模块只做视觉统一，零功能改动：
 * - 三个图标换成本地 dataURL 线条图标（统一风格/尺寸 24×24，居中于原 32×32 命中盒），
 *   顺带去掉这三枚图标对境外 sprite 资源的依赖；点击处理器仍挂在原组上，功能不变；
 * - 在三组共同父级插入一块浅色圆角背景矩形，把三按钮罩成同一控件组；
 *   矩形 pointer-events: none，不遮挡任何工作区操作；
 * - 不覆盖 Blockly 的定位 transform：用 MutationObserver 监听三组 transform 变化
 *   （窗口缩放/工具箱显隐时 Blockly 会重新定位），实时重算背景矩形包围盒。
 */
import * as Blockly from 'blockly';
import '../styles/zoomGroup.css';

/** 统一线条图标（24 viewBox，圆头笔画，与界面灰蓝文字色一致） */
function icon(paths: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="#5b6472" stroke-width="2.2" stroke-linecap="round">${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 放大＋ / 缩小− / 居中定位（圆环＋十字刻度＋中心点） */
const ICONS = {
  in: icon('<path d="M12 5v14M5 12h14"/>'),
  out: icon('<path d="M5 12h14"/>'),
  reset: icon(
    '<circle cx="12" cy="12" r="6.5"/>' +
      '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>' +
      '<circle cx="12" cy="12" r="1.4" fill="#5b6472" stroke="none"/>',
  ),
};

/** Blockly 单枚缩放控件的命中盒边长（createDom 固定 32×32） */
const CELL = 32;
/** 背景容器相对按钮组的外扩 padding */
const PAD = 7;

/** 装配缩放三按钮视觉分组（initBlocks 注入后调用一次） */
export function initZoomGroup(workspace: Blockly.WorkspaceSvg): void {
  const svg = workspace.getParentSvg();
  const groups = {
    in: svg.querySelector<SVGGElement>('g.blocklyZoom.blocklyZoomIn'),
    out: svg.querySelector<SVGGElement>('g.blocklyZoom.blocklyZoomOut'),
    reset: svg.querySelector<SVGGElement>('g.blocklyZoom.blocklyZoomReset'),
  };
  if (!groups.in || !groups.out || !groups.reset) return;
  const entries: Array<[SVGGElement, string]> = [
    [groups.in, ICONS.in],
    [groups.out, ICONS.out],
    [groups.reset, ICONS.reset],
  ];

  // 统一图标：替换远程 sprite 引用为本地图标，尺寸/位置统一（命中盒不变）
  for (const [g, url] of entries) {
    const img = g.querySelector('image');
    if (!img) continue;
    img.setAttribute('width', '24');
    img.setAttribute('height', '24');
    img.setAttribute('x', '4');
    img.setAttribute('y', '4');
    img.setAttribute('href', url);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
  }

  // 共享浅色圆角容器：插到文档序第一个缩放组之前（渲染在三按钮之下）
  const list = entries.map(([g]) => g);
  const parent = list[0].parentElement;
  if (!parent) return;
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('class', 'sc-zoom-group-bg');
  bg.setAttribute('rx', '10');
  parent.insertBefore(bg, parent.querySelector('g.blocklyZoom'));

  /** 按三组当前 transform 重算包围盒（Blockly 重新定位后自动跟随） */
  const layout = (): void => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const g of list) {
      const m = /translate\(\s*([-.\d]+)[ ,]+([-.\d]+)/.exec(g.getAttribute('transform') ?? '');
      const x = m ? parseFloat(m[1]) : 0;
      const y = m ? parseFloat(m[2]) : 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + CELL);
      maxY = Math.max(maxY, y + CELL);
    }
    bg.setAttribute('x', String(minX - PAD));
    bg.setAttribute('y', String(minY - PAD));
    bg.setAttribute('width', String(maxX - minX + PAD * 2));
    bg.setAttribute('height', String(maxY - minY + PAD * 2));
  };
  layout();
  const mo = new MutationObserver(layout);
  for (const g of list) mo.observe(g, { attributes: true, attributeFilter: ['transform'] });
}