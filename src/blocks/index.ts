/**
 * 积木模块入口：Blockly 工作区初始化与对外 API。
 *
 * - 中文界面（zh-hans 语言包）+ zelos 渲染器（圆润拼图外观，向 Scratch 靠拢）。
 * - 左侧分类工具箱即"积木栏"，可通过 Toolbox API 显隐（布局模块调用）。
 * - 多精灵支持：同一工作区实例，切换精灵时通过 saveState/loadState 交换脚本。
 */
import * as Blockly from 'blockly';
import 'blockly/blocks'; // 内置积木（运算/变量/如果等）
import * as zhHans from 'blockly/msg/zh-hans';
import { defineCustomBlocks, colorSwatchUrl, setHeadlessPermissive } from './definitions';
import { registerGenerators } from './generators';
import { TOOLBOX } from './toolbox';
import { parseHexColor, hexOf } from '../sensing';
// 二期美化第一批：UI-01 悬浮中文说明 / UI-02 缩放三按钮视觉分组（纯视觉模块）
import { initHoverHelp } from './hoverHelp';
import { initZoomGroup } from './zoomGroup';

export { generatePython } from './generators';
export { setSpriteNamesProvider, setSelfNameProvider } from './definitions';
export { renameSpriteInState } from './rename';
import { generatePython } from './generators';

/**
 * 从序列化状态生成 Python（无头工作区，不影响界面上的工作区）。
 * 运行时逐精灵生成代码时使用。
 * 第四轮回归修复：无头宽容态载入——动态下拉不按 UI 选中角色排除自身，
 * 保证存档里的碰撞/面向目标值忠实还原（生成结果与界面选中谁无关）。
 */
export function generatePythonFromState(state: Record<string, unknown>): string {
  const headless = new Blockly.Workspace();
  setHeadlessPermissive(true);
  try {
    Blockly.serialization.workspaces.load(state, headless);
    return generatePython(headless);
  } finally {
    setHeadlessPermissive(false);
    headless.dispose();
  }
}

/**
 * 工作区状态可载入性校验（R9 导入安全防护）：无头工作区试载入，
 * 能完整载入即通过；任何异常（未知积木/非法连接/结构损坏）返回 false。
 * 不触碰界面工作区，导入方据此在替换当前项目前做深度校验。
 * 同样启用无头宽容态：校验只关心结构可载入，字段值不应被 UI 选中态改写。
 */
export function validateWorkspaceState(state: Record<string, unknown>): boolean {
  const headless = new Blockly.Workspace();
  setHeadlessPermissive(true);
  try {
    Blockly.serialization.workspaces.load(state, headless);
    return true;
  } catch (e) {
    console.warn('[blocks] 工作区状态试载入失败：', e);
    return false;
  } finally {
    setHeadlessPermissive(false);
    headless.dispose();
  }
}

/** 工作区序列化状态类型（存档用） */
export type WorkspaceState = ReturnType<typeof Blockly.serialization.workspaces.save>;

/** 积木模块对外 API */
export interface BlocksApi {
  workspace: Blockly.WorkspaceSvg;
  /** 显隐左侧积木栏（Blockly 工具箱） */
  setToolboxVisible(visible: boolean): void;
  /** 导出当前工作区状态（用于存档/切换精灵） */
  saveState(): WorkspaceState;
  /** 载入工作区状态（覆盖当前内容） */
  loadState(state: WorkspaceState): void;
  /** 清空工作区 */
  clear(): void;
  /** 监听内容变化（已过滤 UI 事件），用于自动保存与代码实时生成 */
  onContentChange(cb: () => void): void;
  /** 监听"程序性载入完成"（FINISHED_LOADING）：
   *  Blockly 事件异步派发，loadState 返回时载入事件尚未到达监听器；
   *  该事件是 serialization.load 最后派发的一条，可用于安全解除载入期间的抑制标记 */
  onLoadFinished(cb: () => void): void;
  /** 点击脚本区"当⚑被点击"帽积木（R2：与舞台绿旗同语义启动） */
  onFlagHatClick(cb: () => void): void;
  /** 吸色笔填色（R11）：HEX 写入选中的颜色侦测积木参数；无合适选中块返回 false。
   *  规则：选中颜色积木 → 默认第一个颜色参数（input 可指定 C2 等）；选中 HEX 文本子积木 → 该参数。 */
  applyColor(hex: string, input?: string): boolean;
  /** 当前选中块可填色的参数列表（吸色笔浮层据此渲染按钮；无合适选中块为空） */
  colorTargets(): Array<{ input: string; label: string }>;
  /** 选中块变化回调（吸色笔浮层实时刷新可填参数按钮） */
  onSelectionChange(cb: () => void): void;
  /** 调试口（R11 联调）：当前全局选中块类型与是否本工作区 */
  debugSelected(): { type: string; sameWs: boolean } | null;
  /** 容器尺寸变化后重算画布 */
  resize(): void;
}

/** R11 颜色积木 → [颜色输入名, 色板字段名] 映射（色板刷新与填色共用） */
const COLOR_SWATCH_INPUTS: Record<string, Array<[string, string]>> = {
  sc_touching_color: [['COLOR', 'SWATCH']],
  sc_color_touching_color: [
    ['C1', 'SWATCH1'],
    ['C2', 'SWATCH2'],
  ],
};

/** 参数名 → 儿童可读标签（吸色笔浮层按钮文案） */
const COLOR_INPUT_LABELS: Record<string, string> = { COLOR: '颜色', C1: '颜色1', C2: '颜色2' };

/** 按颜色参数当前值刷新色板（非法/空值显示灰板）；src 相同不 setValue，避免事件回环 */
function refreshSwatch(block: Blockly.Block): void {
  const pairs = COLOR_SWATCH_INPUTS[block.type];
  if (!pairs) return;
  for (const [inputName, fieldName] of pairs) {
    const child = block.getInputTargetBlock(inputName);
    const raw = child?.type === 'text' ? String(child.getFieldValue('TEXT') ?? '') : '';
    const parsed = parseHexColor(raw);
    const url = colorSwatchUrl(parsed ? hexOf(parsed) : '#cccccc');
    const field = block.getField(fieldName) as Blockly.FieldImage | null;
    if (field && field.getValue() !== url) field.setValue(url);
  }
}

/** 初始化 Blockly 并返回 API */
export function initBlocks(host: HTMLElement): BlocksApi {
  // 中文语言包（模块命名空间对象 → 字典）
  Blockly.setLocale(zhHans as unknown as { [key: string]: string });
  defineCustomBlocks();
  registerGenerators();

  const workspace = Blockly.inject(host, {
    toolbox: TOOLBOX as unknown as Blockly.utils.toolbox.ToolboxDefinition,
    renderer: 'zelos', // Scratch 式圆润积木外观
    grid: { spacing: 24, length: 3, colour: '#d5dbe5', snap: true },
    zoom: { controls: true, wheel: false, startScale: 0.9, maxScale: 2, minScale: 0.5, scaleSpeed: 1.1 },
    move: { scrollbars: true, drag: true, wheel: true },
    trashcan: true,
    sounds: false,
  });

  // 容器尺寸变化（侧边栏显隐/窗口缩放）时重算 SVG 画布
  const ro = new ResizeObserver(() => Blockly.svgResize(workspace));
  ro.observe(host);

  // 二期美化第一批装配：UI-01 飞行栏悬浮说明；UI-02 缩放三按钮组视觉分组
  initHoverHelp(workspace, host);
  initZoomGroup(workspace);

  // 变量分类：内置变量积木（创建/设为/增加/变量 reporters）+ R6 显示/隐藏挂牌积木。
  // 'PROCEDURE'（自制积木）分类用 Blockly 默认注册的过程回调，无需额外接线。
  workspace.registerToolboxCategoryCallback('VARIABLE', (ws) => {
    const contents = Blockly.Variables.flyoutCategory(ws);
    contents.push(
      { kind: 'block', type: 'sc_show_var' } as Blockly.utils.toolbox.BlockInfo,
      { kind: 'block', type: 'sc_hide_var' } as Blockly.utils.toolbox.BlockInfo,
    );
    return contents;
  });

  // R11 选中块跟踪：以工作区 SELECTED 事件为准记录"最近选中的积木"。
  // （联调发现 common.getSelected() 在打包子路径多实例场景下可能读空，事件是唯一可靠信号；
  //   取消选中不清空记录，吸色笔"填入选中积木"语义=最近选中的积木，删除时失效。）
  let lastSelected: Blockly.BlockSvg | null = null;
  const selectionCallbacks: Array<() => void> = [];
  workspace.addChangeListener((e) => {
    if (e.type === Blockly.Events.SELECTED) {
      const se = e as Blockly.Events.Selected;
      if (se.newElementId) {
        lastSelected = workspace.getBlockById(se.newElementId) as Blockly.BlockSvg | null;
      }
      selectionCallbacks.forEach((cb) => cb());
    } else if (e.type === Blockly.Events.BLOCK_DELETE) {
      const de = e as Blockly.Events.BlockDelete;
      if (de.blockId && de.blockId === lastSelected?.id) lastSelected = null;
    }
  });
  const effectiveSelection = (): Blockly.BlockSvg | null => {
    // 事件跟踪优先：common.getSelected() 在 dev 多实例下读空、在生产构建的程序性
    // select() 场景读旧值（UI 点击路径两者皆正常）；SELECTED 事件是跨构建唯一可靠信号。
    const tracked =
      lastSelected && !lastSelected.disposed && lastSelected.workspace === workspace ? lastSelected : null;
    const sel = tracked ?? (Blockly.common.getSelected() as Blockly.BlockSvg | null);
    if (!sel || sel.workspace !== workspace || sel.disposed) return null;
    return sel;
  };
  /** 定位填色目标：选中颜色积木 → 指定/第一个参数；选中其 HEX 文本子积木 → 对应参数 */
  const resolveColorTarget = (input?: string): { block: Blockly.BlockSvg; input: string } | null => {
    const sel = effectiveSelection();
    if (!sel) return null;
    const pairs = COLOR_SWATCH_INPUTS[sel.type];
    if (pairs) {
      const hit = input ? pairs.find(([inp]) => inp === input) : pairs[0];
      return hit ? { block: sel, input: hit[0] } : null;
    }
    if (sel.type === 'text') {
      const parent = sel.getParent() as Blockly.BlockSvg | null;
      const pp = parent ? COLOR_SWATCH_INPUTS[parent.type] : undefined;
      const hit = pp?.find(([inp]) => parent!.getInputTargetBlock(inp) === sel);
      if (parent && hit && (!input || input === hit[0])) return { block: parent, input: hit[0] };
    }
    return null;
  };

  // R11 色板同步：颜色参数（含 shadow 文本子积木）变化 / 新建 / 程序性载入完成时刷新色板
  workspace.addChangeListener((e) => {
    if (e.type === Blockly.Events.BLOCK_CHANGE || e.type === Blockly.Events.BLOCK_CREATE) {
      const be = e as Blockly.Events.BlockChange;
      const b = (be.blockId ? workspace.getBlockById(be.blockId) : null) as Blockly.BlockSvg | null;
      if (!b) return;
      if (COLOR_SWATCH_INPUTS[b.type]) refreshSwatch(b);
      else {
        const p = b.getParent();
        if (p && COLOR_SWATCH_INPUTS[p.type]) refreshSwatch(p);
      }
    } else if (e.type === Blockly.Events.FINISHED_LOADING) {
      for (const type of Object.keys(COLOR_SWATCH_INPUTS)) {
        for (const b of workspace.getBlocksByType(type)) refreshSwatch(b);
      }
    }
  });

  return {
    workspace,
    setToolboxVisible(visible: boolean) {
      workspace.getToolbox()?.setVisible(visible);
      Blockly.svgResize(workspace);
    },
    saveState() {
      return Blockly.serialization.workspaces.save(workspace);
    },
    loadState(state: WorkspaceState) {
      Blockly.serialization.workspaces.load(state, workspace);
    },
    clear() {
      workspace.clear();
    },
    onContentChange(cb: () => void) {
      workspace.addChangeListener((e) => {
        // 过滤拖拽高亮、选中、工具箱开合等 UI 事件，只响应真实内容变化。
        // FINISHED_LOADING 是"程序性载入完成"标记（切换精灵/导入），不是用户编辑：
        // 若不过滤，它会在 onLoadFinished 解除抑制后立刻触发一次 R4 失效，误杀运行中的脚本。
        if (e.isUiEvent || e.type === Blockly.Events.FINISHED_LOADING) return;
        cb();
      });
    },
    onLoadFinished(cb: () => void) {
      workspace.addChangeListener((e) => {
        if (e.type === Blockly.Events.FINISHED_LOADING) cb();
      });
    },
    onFlagHatClick(cb: () => void) {
      workspace.addChangeListener((e) => {
        // Blockly 的 click 事件只在"点下且未拖拽"时触发，正是 R2 想要的点击语义
        if (e.type !== Blockly.Events.CLICK) return;
        const click = e as Blockly.Events.Click;
        if (click.targetType !== 'block') return;
        const block = workspace.getBlockById(click.blockId ?? '');
        if (block?.type === 'sc_when_flag') cb();
      });
    },
    applyColor(hex: string, input?: string): boolean {
      const resolved = resolveColorTarget(input);
      if (!resolved) return false;
      const { block: target, input: inputName } = resolved;
      const child = target.getInputTargetBlock(inputName);
      if (child && child.type !== 'text') return false; // 接了 reporter 等非文本积木：不覆盖用户连接
      if (child) {
        child.setFieldValue(hex, 'TEXT');
      } else {
        // 空插座：补一个文本 shadow 语义的普通文本积木
        const nb = workspace.newBlock('text');
        nb.setFieldValue(hex, 'TEXT');
        nb.initSvg();
        nb.render();
        target.getInput(inputName)!.connection!.connect(nb.outputConnection!);
      }
      refreshSwatch(target);
      return true;
    },
    colorTargets() {
      const sel = effectiveSelection();
      if (!sel) return [];
      const pairs = COLOR_SWATCH_INPUTS[sel.type];
      if (pairs) return pairs.map(([inp]) => ({ input: inp, label: COLOR_INPUT_LABELS[inp] ?? inp }));
      if (sel.type === 'text') {
        const parent = sel.getParent() as Blockly.BlockSvg | null;
        const pp = parent ? COLOR_SWATCH_INPUTS[parent.type] : undefined;
        const hit = pp?.find(([inp]) => parent!.getInputTargetBlock(inp) === sel);
        if (hit) return [{ input: hit[0], label: COLOR_INPUT_LABELS[hit[0]] ?? hit[0] }];
      }
      return [];
    },
    onSelectionChange(cb: () => void) {
      selectionCallbacks.push(cb);
    },
    debugSelected() {
      const s = effectiveSelection();
      return s ? { type: s.type, sameWs: s.workspace === workspace } : null;
    },
    resize() {
      Blockly.svgResize(workspace);
    },
  };
}