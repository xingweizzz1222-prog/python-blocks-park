/**
 * UI-01 积木悬浮中文说明框（二期美化第一批）。
 *
 * 交互规则（清单第十节 UI-01.2/3）：
 * - 仅作用于积木栏飞行栏（.blocklyToolboxFlyout）内的自定义积木；
 * - 连续悬浮同一积木超过 1.5 秒才显示说明框；提前离开不显示；
 * - 鼠标离开积木立即消失（无延迟淡出）；切换到其他积木重新计时，
 *   且旧说明立即隐藏，绝不串到新积木上；
 * - 浮层 pointer-events: none，不拦截指针，不影响拖动/连接/编辑/执行。
 *
 * 实现要点：
 * - 飞行栏积木是独立于工作区的 Blockly 实例：把这些实例的原生 tooltip 置空
 *   （仅飞行栏实例，工作区实例不受影响），避免原生 750ms 短提示与
 *   本浮层 1.5s 长说明双重弹出；内置积木（运算/控制等）保留原生提示不在本批范围。
 * - 悬浮判定用事件委托：mouseover/mouseout 挂在注入容器上，
 *   以"积木 SVG 根.contains(target)"定位积木，同一积木内部移动不重置计时。
 * - 拖动按下、飞行栏滚动/换类别、页面滚动/缩放时立即隐藏，保证不残留。
 */
import * as Blockly from 'blockly';
import { BLOCK_HELP } from './helpTexts';
import '../styles/hoverHelp.css';

/** 连续悬浮阈值（清单 UI-01.2：1.5 秒） */
const HOVER_MS = 1500;

/** 装配悬浮说明：workspace 用于取飞行栏工作区，host 为 Blockly 注入容器 */
export function initHoverHelp(workspace: Blockly.WorkspaceSvg, host: HTMLElement): void {
  const flyoutWs = workspace.getFlyout()?.getWorkspace();
  if (!flyoutWs) return;

  // 抑制飞行栏自定义积木实例的原生 tooltip（工作区实例保持原样）
  const suppressNative = (): void => {
    for (const b of flyoutWs.getTopBlocks(false)) {
      if (BLOCK_HELP[b.type]) b.setTooltip('');
    }
  };
  suppressNative();
  flyoutWs.addChangeListener((e) => {
    if (e.type === Blockly.Events.BLOCK_CREATE) suppressNative();
  });

  // 说明浮层：淡灰轻量、无关闭按钮、不拦截指针
  const tip = document.createElement('div');
  tip.className = 'sc-hover-help';
  tip.setAttribute('role', 'tooltip');
  tip.style.display = 'none';
  document.body.appendChild(tip);

  /** 当前计时中的积木（同一积木内部移动不重置） */
  let hoverBlock: Blockly.BlockSvg | null = null;
  let timer: number | null = null;

  /** 立即隐藏＋取消计时（离开/切换/拖动/滚动共用） */
  const hide = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    hoverBlock = null;
    tip.style.display = 'none';
  };

  /** 计时到期：渲染文案并按积木屏幕位置摆放（夹取在视口内） */
  const show = (b: Blockly.BlockSvg): void => {
    timer = null;
    const help = BLOCK_HELP[b.type];
    if (!help || b.disposed || !b.getSvgRoot().isConnected) return;
    const r = b.getSvgRoot().getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // 飞行栏已收起等不可见态：不显示
    tip.textContent = '';
    const t = document.createElement('div');
    t.className = 'sc-hover-help-title';
    t.textContent = help.title;
    const d = document.createElement('div');
    d.className = 'sc-hover-help-body';
    d.textContent = help.body;
    tip.append(t, d);
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    // 默认放在积木右侧（飞行栏在左，右侧为脚本区上空，不遮积木本身）
    let left = r.right + 12;
    if (left + tw > window.innerWidth - 8) left = Math.max(8, r.left - tw - 12);
    const top = Math.max(8, Math.min(r.top + r.height / 2 - th / 2, window.innerHeight - th - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  /** 事件目标 → 飞行栏积木（SVG 根包含判定，兼容字段/插槽等子元素） */
  const blockAt = (target: Element): Blockly.BlockSvg | null => {
    for (const b of flyoutWs.getTopBlocks(false)) {
      if (b.getSvgRoot().contains(target)) return b as Blockly.BlockSvg;
    }
    return null;
  };

  host.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.closest('.blocklyToolboxFlyout')) {
      hide();
      return;
    }
    // 飞行栏收起态（点击放置后自动关闭等）：不可悬浮，直接收起
    if (!workspace.getFlyout()?.isVisible()) {
      hide();
      return;
    }
    const b = blockAt(t);
    if (!b || !BLOCK_HELP[b.type]) {
      hide();
      return;
    }
    if (b === hoverBlock) return; // 同一积木内部移动：继续累计悬浮时间
    hide(); // 切换积木：旧说明立即消失＋重新计时
    hoverBlock = b;
    timer = window.setTimeout(() => show(b), HOVER_MS);
  });

  host.addEventListener('mouseout', (e) => {
    if (!hoverBlock) return;
    const to = e.relatedTarget;
    // 离开当前积木（含离开飞行栏/窗口）立即隐藏
    if (!(to instanceof Node) || !hoverBlock.getSvgRoot().contains(to)) hide();
  });

  // 按下即拖拽/点击：立即收起浮层，绝不干扰积木操作。
  // 捕获 phase：Blockly 手势在冒泡 phase 会 stopPropagation，冒泡监听收不到按下事件。
  host.addEventListener('pointerdown', hide, true);
  // 飞行栏滚动、换类别删除积木、页面滚动/窗口缩放：立即收起防残留
  flyoutWs.addChangeListener((e) => {
    if (e.type === Blockly.Events.VIEWPORT_CHANGE) hide();
    if (e.type === Blockly.Events.BLOCK_DELETE && hoverBlock) {
      const de = e as Blockly.Events.BlockDelete;
      if (de.blockId === hoverBlock.id) hide();
    }
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}