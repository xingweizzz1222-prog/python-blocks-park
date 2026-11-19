/**
 * 布局模块：应用三栏结构与侧边栏隐藏。
 *
 * 结构说明：
 * - 顶栏：标题、自动保存状态、导出/导入存档、大屏展示按钮、积木栏开关。
 * - 内容区左侧+中间：同一个 Blockly 容器（Blockly 的分类工具箱天然位于容器左侧，
 *   即"左侧积木栏"；右侧工作区即"中间脚本区"）。隐藏积木栏 = 隐藏 Blockly 工具箱。
 * - 内容区右侧：舞台区（绿旗/停止、舞台画布宿主、精灵面板宿主）。
 * - 代码视图面板覆盖在编辑器列上，由 codeview 模块控制显隐。
 *
 * 本模块只负责 DOM 结构与布局交互，不依赖 Blockly/舞台的具体实现，
 * 通过返回的引用对象（LayoutRefs）供 main.ts 装配其他模块。
 */
import '../styles/layout.css';

/** 布局对外暴露的元素引用与钩子 */
export interface LayoutRefs {
  /** Blockly 注入宿主（含工具箱+工作区） */
  blocklyHost: HTMLDivElement;
  /** 编辑器主体容器（R14：角色设置面板覆盖其上，整体替换编辑区） */
  editorBody: HTMLDivElement;
  /** 代码视图面板（只读 Python 展示） */
  codePanel: HTMLDivElement;
  /** “积木/代码”视图切换按钮 */
  viewToggleBtn: HTMLButtonElement;
  /** 舞台画布宿主 */
  stageHost: HTMLDivElement;
  /** 舞台列（R5 缩放宽度作用于它） */
  stageColumn: HTMLElement;
  /** 舞台缩放把手容器（R5） */
  stageResizeWrap: HTMLDivElement;
  /** 精灵面板宿主 */
  spritePanel: HTMLDivElement;
  /** 素材库面板宿主（R10：舞台列下方，素材列表/导入/背景与造型应用） */
  assetPanel: HTMLDivElement;
  /** 绿旗启动 / 暂停 / 重置按钮（R18 运行控制三件套） */
  greenFlagBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  /** 吸色笔开关按钮（R11） */
  eyedropperBtn: HTMLButtonElement;
  /** 小舞台/大舞台模式切换按钮（R20） */
  stageModeBtn: HTMLButtonElement;
  /** 存档相关按钮与状态文本 */
  exportBtn: HTMLButtonElement;
  importBtn: HTMLButtonElement;
  saveStatus: HTMLSpanElement;
  /** 大屏展示按钮 */
  fullscreenBtn: HTMLButtonElement;
  /** 侧边栏（积木栏）当前是否可见 */
  sidebarVisible: boolean;
  /** 注册侧边栏显隐回调（Blockly 需要据此 resize） */
  onSidebarToggle(cb: (visible: boolean) => void): void;
  /** 切换积木栏显隐 */
  toggleSidebar(): void;
}

/** 渲染三栏布局并返回引用对象 */
export function mountLayout(root: HTMLElement): LayoutRefs {
  root.innerHTML = `
    <div class="app-shell">
      <!-- 顶栏 -->
      <header class="topbar">
        <div class="topbar-left">
          <button id="btn-sidebar" class="topbar-btn" title="隐藏/展开积木栏">☰ 积木栏</button>
          <span class="app-title">🐍 Python 积木乐园</span>
        </div>
        <div class="topbar-right">
          <span id="save-status" class="save-status">尚未保存</span>
          <button id="btn-export" class="topbar-btn" title="把作品下载为存档文件">⬇ 导出存档</button>
          <button id="btn-import" class="topbar-btn" title="从存档文件恢复作品">⬆ 导入存档</button>
          <button id="btn-fullscreen" class="topbar-btn accent" title="另开页面大屏演示舞台">🖥 大屏展示</button>
        </div>
      </header>

      <!-- 内容区：编辑器列（积木栏+脚本区） + 舞台列 -->
      <div class="content">
        <section class="editor-column">
          <div class="editor-toolbar">
            <button id="btn-view-toggle" class="view-toggle" title="切换积木/代码视图">
              <span class="seg seg-blocks active">🧩 积木</span><span class="seg seg-code">🐍 代码</span>
            </button>
            <span class="editor-hint">拖拽积木搭建脚本，点击绿旗运行</span>
          </div>
          <div class="editor-body">
            <div id="blockly-host" class="blockly-host"></div>
            <div id="code-panel" class="code-panel hidden"></div>
          </div>
        </section>

        <aside class="stage-column">
          <div class="stage-toolbar">
            <button id="btn-greenflag" class="stage-btn flag" title="开始 / 运行中点击暂停 / 暂停后点击续跑（R18：不重置位置，重置请用重置按钮）">⚑ 绿旗</button>
            <button id="btn-pause" class="stage-btn pause" title="暂停全部脚本（保留状态），再点继续">⏸ 暂停</button>
            <button id="btn-reset" class="stage-btn reset" title="终止执行，精灵恢复初始状态并清除气泡">⟲ 重置</button>
            <button id="btn-eyedropper" class="stage-btn eyedropper" title="吸色笔：点击舞台或素材缩略图取色，可填入颜色侦测积木（Esc 退出）">🖉 吸色</button>
            <button id="btn-stage-mode" class="stage-btn mode" title="切换小舞台/大舞台显示模式（R20）">🗖 大舞台</button>
          </div>
          <div class="stage-resize-wrap" id="stage-resize-wrap">
            <div id="stage-host" class="stage-host"></div>
            <!-- R5：四边+四角等比缩放把手（拖拽逻辑见 layout/stageResize.ts） -->
            <div class="rz-handle rz-n" data-dir="n" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-s" data-dir="s" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-e" data-dir="e" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-w" data-dir="w" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-ne" data-dir="ne" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-nw" data-dir="nw" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-se" data-dir="se" title="拖拽调整舞台大小（等比 4:3）"></div>
            <div class="rz-handle rz-sw" data-dir="sw" title="拖拽调整舞台大小（等比 4:3）"></div>
          </div>
          <div id="sprite-panel" class="sprite-panel"></div>
          <div id="asset-panel" class="asset-panel"></div>
        </aside>
      </div>
    </div>
  `;

  // 收集元素引用（上方结构为本模块私有，id 查询安全）
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const blocklyHost = q<HTMLDivElement>('#blockly-host');
  const codePanel = q<HTMLDivElement>('#code-panel');
  const sidebarBtn = q<HTMLButtonElement>('#btn-sidebar');

  const toggleCallbacks: Array<(visible: boolean) => void> = [];
  const refs: LayoutRefs = {
    blocklyHost,
    editorBody: q<HTMLDivElement>('.editor-body'),
    codePanel,
    viewToggleBtn: q<HTMLButtonElement>('#btn-view-toggle'),
    stageHost: q<HTMLDivElement>('#stage-host'),
    stageColumn: q<HTMLElement>('.stage-column'),
    stageResizeWrap: q<HTMLDivElement>('#stage-resize-wrap'),
    spritePanel: q<HTMLDivElement>('#sprite-panel'),
    assetPanel: q<HTMLDivElement>('#asset-panel'),
    greenFlagBtn: q<HTMLButtonElement>('#btn-greenflag'),
    pauseBtn: q<HTMLButtonElement>('#btn-pause'),
    resetBtn: q<HTMLButtonElement>('#btn-reset'),
    eyedropperBtn: q<HTMLButtonElement>('#btn-eyedropper'),
    stageModeBtn: q<HTMLButtonElement>('#btn-stage-mode'),
    exportBtn: q<HTMLButtonElement>('#btn-export'),
    importBtn: q<HTMLButtonElement>('#btn-import'),
    saveStatus: q<HTMLSpanElement>('#save-status'),
    fullscreenBtn: q<HTMLButtonElement>('#btn-fullscreen'),
    sidebarVisible: true,
    onSidebarToggle(cb) {
      toggleCallbacks.push(cb);
    },
    toggleSidebar() {
      refs.sidebarVisible = !refs.sidebarVisible;
      // 通过 CSS 类隐藏 Blockly 工具箱区域；工作区随之占满编辑器列
      blocklyHost.classList.toggle('toolbox-hidden', !refs.sidebarVisible);
      sidebarBtn.classList.toggle('off', !refs.sidebarVisible);
      toggleCallbacks.forEach((cb) => cb(refs.sidebarVisible));
    },
  };

  sidebarBtn.addEventListener('click', () => refs.toggleSidebar());
  return refs;
}