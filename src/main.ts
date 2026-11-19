/**
 * 应用主入口（主编辑器页面 index.html）
 * 职责：装配各模块 —— 布局 → 积木 → 代码视图 → 舞台 → 存档 → 运行时/大屏。
 * 本文件只做装配与跨模块编排，具体实现见 src/ 下对应目录。
 *
 * 二期第二批（清单第十四节）：装配改为"分阶段初始化管线"，与启动动画并行——
 * - 启动画面由独立小入口 intro/boot.ts 先于本入口挂载（进入网站立即显示）；
 * - 本入口按真实里程碑逐步装配并上报 intro.step（editor/project/systems/assets/python/bridge），
 *   阶段间让出一帧给动画循环，进度条按完成步数推进（禁止假进度）；
 * - Pyodide 在管线内前置准备（silent 模式）＋stdlib 探针＋JS↔Python 桥接往返探针，
 *   全部真实完成后 intro.ready()，由启动画面按"≥2.5s 且全就绪"门槛执行穿越转场；
 * - 失败 intro.fail(真实错误) → 启动失败态；重试只重跑未完成阶段（phaseA 守卫不重复装配）。
 *
 * 多精灵数据流：
 * - 舞台持有精灵变换/造型；main.ts 用 workspaces Map 持有每个精灵的脚本；
 * - 切换精灵时保存旧脚本、载入新脚本；存档时合并两者。
 *
 * 自定义素材（R10）：素材二进制在 IndexedDB（assets 模块），项目存档 v2 只存
 * 元数据与引用（背景/素材造型）；导出打包所用素材 dataURL，导入先回灌素材库再替换项目。
 */
// 首个 import：启动画面立即挂载（同 chunk 内先于 Blockly 等重依赖求值，第十四节）
import './intro/boot';
import './styles/main.css';
import { mountLayout, type LayoutRefs } from './layout';
import { initStageResize } from './layout/stageResize';
import { playRipple } from './layout/ripple';
import { initBlocks, setSpriteNamesProvider, setSelfNameProvider, validateWorkspaceState, renameSpriteInState } from './blocks';
import { initCodeView } from './codeview';
import { initStage, type StageApi } from './stage';
import { initSpriteSettings, type SpriteSettingsApi, type SpriteSettingsDraft } from './spriteSettings';
import { initRuntime, type RuntimeApi } from './runtime';
import { loadPyodideRuntime } from './runtime/loader';
import { startStageMirror, type StageMirror } from './fullscreen/mirror';
import {
  loadLocal,
  createDefaultProject,
  createAutoSaver,
  exportFile,
  importFile,
  validateProject,
  IMPORT_ERROR_MESSAGE,
  type ProjectData,
  type SpriteData,
  type AssetMeta,
} from './storage';
import {
  initAssetPanel,
  pickAssetDraft,
  openAssetAdjust,
  deriveAssetViews,
  invalidateDeriveCache,
  normalizeCrop,
  generateCropResult,
  listAssets,
  getAsset,
  putAsset,
  deleteAsset,
  totalSize,
  assetCostumeKey,
  assetIdFromCostume,
  MAX_TOTAL_BYTES,
  type AssetRecord,
} from './assets';
import { createSensing } from './sensing';
import { initEyedropper, type EyedropperApi } from './sensing/eyedropper';
import { getIntro } from './intro';

const app = document.querySelector<HTMLDivElement>('#app')!;
/** 启动画面句柄（boot.ts 已挂载；index.html 保证本入口之前执行） */
const intro = getIntro()!;

/** 让出一帧：阶段间给动画循环运行时间（初始化与动画并行，互不阻塞） */
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

// ---------- 模块句柄（管线阶段内赋值；跨阶段闭包引用） ----------
let layout: LayoutRefs;
let blocks: ReturnType<typeof initBlocks>;
let stageResize: ReturnType<typeof initStageResize>;
let codeView: ReturnType<typeof initCodeView>;
let stage: StageApi;
let sensing: ReturnType<typeof createSensing>;
let eyedropper: EyedropperApi | null = null;
let spriteSettings: SpriteSettingsApi | null = null;
let assetPanel: ReturnType<typeof initAssetPanel>;
let saver: ReturnType<typeof createAutoSaver>;
let runtimeApi: RuntimeApi | null = null;
let mirror: StageMirror | null = null;
let project: ProjectData;
let currentSpriteId = '';
let assetCatalog: AssetRecord[] = [];

/** 每个精灵的脚本工作区状态（id → Blockly 序列化状态） */
const workspaces = new Map<string, Record<string, unknown>>();

/** 空工作区（新建精灵的默认脚本） */
const emptyWorkspace = (): Record<string, unknown> => ({
  blocks: { languageVersion: 0, blocks: [] },
});

/** 程序性载入工作区（切换精灵/导入/初始化）期间抑制 R4 同步：
 *  这些 loadState 会触发内容事件，但不是用户编辑，不应终止运行中的脚本。
 *  注意：Blockly 的事件是异步派发的（loadState 返回时事件还没到监听器），
 *  因此不能在 loadState 之后立刻解除抑制——否则切换精灵会误杀正在运行的脚本。
 *  解除点取 FINISHED_LOADING：它是 serialization.load 内部最后派发的事件，
 *  排在本次载入的全部积木事件之后，到达即代表"程序性载入的事件已派发完毕"。 */
let suppressWorkspaceSync = false;
function loadWorkspace(state: Record<string, unknown>): void {
  suppressWorkspaceSync = true;
  blocks.loadState(state);
}

// 运行状态标记（运行时编排改写；控制舞台拖拽与绿旗按钮高亮）
let running = false;
/** 暂停态标记（R1：暂停保留状态可续跑） */
let paused = false;
function setRunning(v: boolean): void {
  running = v;
  layout.greenFlagBtn.classList.toggle('running', v && !paused);
  mirror?.push(); // 运行态变化立即同步大屏页按钮高亮
}
/** 暂停态回显：暂停按钮文案切换 + 绿旗高亮熄灭 + 镜像同步 */
function setPaused(v: boolean): void {
  paused = v;
  layout.pauseBtn.textContent = v ? '▶ 继续' : '⏸ 暂停';
  layout.pauseBtn.classList.toggle('paused', v);
  layout.greenFlagBtn.classList.toggle('running', running && !v);
  mirror?.push();
}

/** 打开设置前的视图模式（保存/取消后按原模式返回：积木回积木、代码回代码） */
let settingsPrevMode: 'blocks' | 'code' = 'blocks';

/** 打开角色设置：仅编辑态允许（运行/暂停中先重置）；隐藏编辑区、锁定视图切换 */
function openSpriteSettings(id: string): void {
  if (!spriteSettings || spriteSettings.isOpen()) return;
  if (running) {
    alert('运行中不能修改角色设置，请先点「⟲ 重置」回到编辑状态');
    return;
  }
  settingsPrevMode = codeView.getMode();
  // 覆盖编辑区：Blockly 与代码面板都隐藏（面板 z-index 更高，双保险）
  layout.blocklyHost.style.visibility = 'hidden';
  layout.codePanel.classList.add('hidden');
  layout.viewToggleBtn.disabled = true; // 设置期间禁止切换视图
  spriteSettings.open(id);
}

/** 设置面板关闭后恢复原编辑视图（setMode 重放可见性；Blockly 重算画布） */
function restoreEditorAfterSettings(): void {
  layout.viewToggleBtn.disabled = false;
  codeView.setMode(settingsPrevMode);
  blocks.resize();
}

/** 保存提交（R14）：改名同步全部脚本引用 → patchSaved 提交基准 → 自动保存 */
function commitSpriteSettings(id: string, draft: SpriteSettingsDraft): void {
  const s = stage.getSprite(id);
  if (!s) return;
  let newName = draft.name.trim();
  if (!newName) newName = s.name; // 空名回落原名（不产生无名角色）
  // 重名自动加数字后缀（内部 ID 稳定，显示名唯一，避免下拉/桥接按名查找歧义）
  const otherNames = stage.getSprites().filter((o) => o.id !== id).map((o) => o.name);
  if (otherNames.includes(newName)) {
    let i = 2;
    while (otherNames.includes(`${newName}${i}`)) i++;
    console.info(`[main] 角色名「${newName}」重复，自动改为「${newName}${i}」`);
    newName = `${newName}${i}`;
  }
  if (newName !== s.name) {
    // 改名同步：遍历全部精灵工作区，把 TARGET 字段旧名改为新名（不破坏脚本结构）
    workspaces.set(currentSpriteId, blocks.saveState());
    for (const [sid, state] of workspaces) {
      if (renameSpriteInState(state, s.name, newName) && sid === currentSpriteId) {
        loadWorkspace(state); // 当前激活工作区改完后重载（程序性载入，不终止运行）
      }
    }
  }
  stage.patchSaved(id, {
    name: newName,
    size: draft.size,
    direction: draft.direction,
    visible: draft.visible,
    x: draft.x,
    y: draft.y,
    hitbox: draft.hitbox,
  });
  saver.trigger();
  mirror?.push();
}

/** 整库刷新：读原图目录 → 推导显示图 → 舞台/面板/镜像同步（R16） */
async function refreshAssets(): Promise<void> {
  assetCatalog = await listAssets();
  stage.setAssets(await deriveAssetViews(assetCatalog));
  refreshAssetPanel();
  mirror?.pushAssets();
}

/** 用舞台当前素材目录与背景选择重绘素材面板 */
function refreshAssetPanel(): void {
  assetPanel.render(stage.getAssetCatalog(), stage.getBackground());
}

/** 合并舞台变换 + 脚本 + 素材引用，收集完整项目状态（存档/导出用，R10 起为 v2） */
function collectProject(): ProjectData {
  workspaces.set(currentSpriteId, blocks.saveState());
  const sprites: SpriteData[] = stage.getSprites().map((t, i) => ({
    id: t.id,
    name: t.name,
    costume: t.costume,
    x: t.x,
    y: t.y,
    direction: t.direction,
    size: t.size,
    visible: t.visible,
    ghost: t.ghost,
    brightness: t.brightness,
    color: t.color,
    hitbox: t.hitbox, // R14：判定区配置随存档持久化
    layer: i, // R12：数组序即图层序，存档记录图层号供恢复排序
    workspace: workspaces.get(t.id) ?? emptyWorkspace(),
  }));
  // 素材只存元数据引用（二进制在 IndexedDB）；背景为素材 id 或 null。
  // R16：从原图目录收集——width/height 恒为原图尺寸，crop 参数随存档持久化。
  // R22：独立裁剪素材携带 cropResult 标记（width/height 为裁剪图自身尺寸，无 crop 参数）。
  const assets: AssetMeta[] = assetCatalog.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    width: a.width,
    height: a.height,
    size: a.size,
    crop: a.crop,
    cropResult: a.cropResult,
  }));
  project = {
    app: 'qoder-sc',
    version: 2,
    savedAt: new Date().toISOString(),
    sprites,
    selectedSpriteId: currentSpriteId,
    background: stage.getBackground(),
    assets,
  };
  return project;
}

/** 收集项目用到的素材 dataURL（导出打包用：背景 + 各精灵素材造型）。
 *  R16：打包原图（而非派生显示图）——导入方按 crop 参数重新推导，再编辑不失真。
 *  R22：独立裁剪素材打包的即其最终像素（导入方跳过推导，直接恢复）。 */
function collectUsedAssetData(): Record<string, string> {
  const used = new Set<string>();
  const bg = stage.getBackground();
  if (bg) used.add(bg);
  for (const s of stage.getSprites()) {
    const id = assetIdFromCostume(s.costume);
    if (id) used.add(id);
  }
  const data: Record<string, string> = {};
  for (const a of assetCatalog) {
    if (used.has(a.id)) data[a.id] = a.dataUrl;
  }
  return data;
}

// ---------- 阶段 A：本地装配（编辑器/舞台/系统；重试守卫不重复执行） ----------
async function phaseA(): Promise<void> {
  // 1) 三栏布局 + 2) Blockly 积木系统 + 2.5) 舞台缩放（R5/R20）+ 3) 代码视图
  layout = mountLayout(app);
  blocks = initBlocks(layout.blocklyHost);
  stageResize = initStageResize({
    column: layout.stageColumn,
    wrap: layout.stageResizeWrap,
    onResize: () => blocks.resize(),
    // 模式回显：按钮文案显示"可切换到的目标模式"，大舞台态高亮
    onModeChange: (m) => {
      layout.stageModeBtn.textContent = m === 'small' ? '🗖 大舞台' : '🗗 小舞台';
      layout.stageModeBtn.title =
        m === 'small'
          ? '切换到大舞台模式：扩大舞台显示，压缩脚本编辑区（R20）'
          : '切换到小舞台模式：恢复常规编辑布局，为积木和代码编辑留出更多空间（R20）';
      layout.stageModeBtn.classList.toggle('active', m === 'large');
    },
  });
  stageResize.restore();
  layout.stageModeBtn.addEventListener('click', () => {
    stageResize.setMode(stageResize.getMode() === 'small' ? 'large' : 'small');
  });
  // 运行时稍后装配；事件行/帽积木点击经此引用转交绿旗语义（R2）
  codeView = initCodeView(layout.codePanel, layout.viewToggleBtn, blocks, layout.blocklyHost, () => {
    void runtimeApi?.flag();
  });
  blocks.onFlagHatClick(() => {
    void runtimeApi?.flag();
  });
  intro.step('editor');
  await frame();

  // 4) 存档数据：打开自动恢复（无存档则用默认示例项目）+ 5) 舞台 + 精灵面板
  project = loadLocal() ?? createDefaultProject();
  for (const s of project.sprites) workspaces.set(s.id, s.workspace);
  currentSpriteId = project.selectedSpriteId;
  blocks.onLoadFinished(() => {
    suppressWorkspaceSync = false;
  });
  stage = initStage(layout.stageHost, layout.spritePanel, {
    onSelect(id) {
      // 切换精灵：保存旧脚本 → 载入新脚本（不终止运行，R4）
      if (id === currentSpriteId) return;
      workspaces.set(currentSpriteId, blocks.saveState());
      currentSpriteId = id;
      loadWorkspace(workspaces.get(id) ?? emptyWorkspace());
    },
    onStructuralChange() {
      saver.trigger();
      // 精灵增删立即生效：终止旧协程，下次绿旗按新结构重新生成（R4）
      runtimeApi?.invalidate();
    },
    // 图层变化（R12）：只自动保存，不终止运行（积木可在运行中改图层）
    onLayerChange() {
      saver.trigger();
    },
    // 运行时禁止拖拽精灵（任务 7 接入运行状态后生效）；吸色模式点击是取色不是拖拽（R11）
    canDrag: () => !running && !eyedropper?.isActive(),
    // 设置界面打开期间锁定选择与增删（R14：面板只针对当前角色，避免错位）
    canSelect: () => !spriteSettings?.isOpen(),
    // R14：卡片齿轮/操作行设置按钮 → 打开角色设置界面
    onOpenSettings: (id) => openSpriteSettings(id),
    // R14：设置保存 → 自动保存（不终止运行）
    onSettingsChange: () => saver.trigger(),
    // 舞台任何变化即时推送大屏镜像（事件驱动，零延迟）；设置界面打开时回填拖拽坐标（R14）
    onChange: () => {
      mirror?.push();
      spriteSettings?.syncFromStage();
    },
  });
  stage.setSprites(project.sprites, project.selectedSpriteId);
  // R6：侦测/运动类积木的"精灵名称"下拉实时取舞台当前精灵列表
  // R15 修复：提供者必须在首次 loadWorkspace 之前接线——否则启动载入时下拉选项为空，
  // 存档里的角色名引用会被 Blockly 字段校验拒绝而回落 'none'，造成引用丢失。
  setSpriteNamesProvider(() => stage.getSprites().map((s) => s.name));
  // R15：碰撞类下拉排除自身——当前选中角色名随切换实时变化
  setSelfNameProvider(() => stage.getSprite(currentSpriteId)?.name ?? '');
  loadWorkspace(workspaces.get(currentSpriteId) ?? emptyWorkspace());

  // 5.6) 颜色侦测 + 吸色笔（R11）：离屏采样器 + 取色 UI（填色规则在 blocks.applyColor）
  sensing = createSensing(stage);
  eyedropper = initEyedropper({
    button: layout.eyedropperBtn,
    stageCanvas: layout.stageHost.querySelector('canvas')!,
    assetPanelHost: layout.assetPanel,
    sensing,
    getAssetImage: (id) => stage.getSceneExtras().assetCostume?.(assetCostumeKey(id)),
    applyColor: (hex, input) => blocks.applyColor(hex, input),
    colorTargets: () => blocks.colorTargets(),
    onSelectionChange: (cb) => blocks.onSelectionChange(cb),
  });

  // 5.7) 角色设置界面（R14）：整体替换编辑区，保存提交基准 + 改名同步 + 持久化
  spriteSettings = initSpriteSettings({
    host: layout.editorBody,
    stage,
    onSave: commitSpriteSettings,
    onClose: restoreEditorAfterSettings,
  });

  // 5.5) 素材库（R10）：面板 + IndexedDB 素材载入 + 背景/造型应用编排
  // R16 双目录约定：assetCatalog 恒为"原图 + 裁剪参数"（存档/导出/容量统计用）；
  // 舞台/面板/镜像拿到的是 deriveAssetViews 推导出的显示图（fit/fill→480×360，crop→框选区域）。
  assetPanel = initAssetPanel(layout.assetPanel, {
    async onImport() {
      try {
        // R16 两段式：选图检查 → 调整对话框确认显示方式 → 才入库
        const draft = await pickAssetDraft();
        if (!draft) return; // 用户取消选图
        const crop = await openAssetAdjust(draft, { confirmText: '确认导入' });
        if (!crop) return; // 用户取消调整：不留下素材残留
        if (crop.mode === 'crop') {
          // R22 场景 A：导入时直接自定义裁剪 → 只入库裁剪生成的独立新素材，
          // 原图仅作裁剪输入，不占用素材列表位置（fit/fill 仍走 R16 原图+参数）
          const result = await generateCropResult(draft, crop);
          if ((await totalSize()) + result.size > MAX_TOTAL_BYTES) {
            alert(`素材总容量将超过上限 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB，已取消导入`);
            return;
          }
          await putAsset(result);
        } else {
          await putAsset({ ...draft, crop });
        }
        await refreshAssets();
        saver.trigger();
      } catch (err) {
        alert(err instanceof Error ? err.message : '素材导入失败');
      }
    },
    async onAdjust(id) {
      // R16 再编辑：永远基于原图重调（draft 即库中原图记录），无累积裁剪损失
      const rec = assetCatalog.find((a) => a.id === id);
      if (!rec) return;
      try {
        const crop = await openAssetAdjust(rec, { confirmText: '保存调整' });
        if (!crop) return; // 用户取消
        if (crop.mode === 'crop' || rec.cropResult) {
          // R22 场景 B：已导入素材再裁剪 → 原素材原样保留，新增独立裁剪素材；
          // 对已独立素材再编辑（含 fit/fill）同样保留原素材、新增独立结果（执行方定）
          const result = await generateCropResult(rec, crop);
          if ((await totalSize()) + result.size > MAX_TOTAL_BYTES) {
            alert(`素材总容量将超过上限 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB，已取消本次裁剪`);
            return;
          }
          await putAsset(result); // 新 ID 追加，不覆盖原素材
        } else {
          // fit/fill 维持 R16 现状：原图 + 参数就地更新，显示图重新推导
          await putAsset({ ...rec, crop });
          invalidateDeriveCache(id);
        }
        await refreshAssets();
        saver.trigger();
      } catch (err) {
        alert(err instanceof Error ? err.message : '素材调整失败');
      }
    },
    onSetBackground(id) {
      stage.setBackground(id);
      refreshAssetPanel();
      saver.trigger();
      mirror?.pushAssets();
    },
    onApplyCostume(id) {
      // 用作当前选中精灵的造型（舞台 patch 经 onChange 即时镜像）
      stage.patch(stage.getSelectedId(), { costume: assetCostumeKey(id) });
      refreshAssetPanel();
      saver.trigger();
    },
    async onDelete(id) {
      // 使用中的素材禁止删除，避免背景/造型引用悬空
      const inUse =
        stage.getBackground() === id ||
        stage.getSprites().some((s) => assetIdFromCostume(s.costume) === id);
      if (inUse) {
        alert('该素材正在使用中，请先更换背景或造型后再删除');
        return;
      }
      try {
        await deleteAsset(id);
        invalidateDeriveCache(id);
        await refreshAssets();
        saver.trigger();
      } catch (err) {
        alert(err instanceof Error ? err.message : '素材删除失败');
      }
    },
  });

  // 6) 自动保存（防抖 800ms）+ 顶栏状态回显
  saver = createAutoSaver(collectProject, (ok, time) => {
    layout.saveStatus.textContent = ok
      ? `已自动保存 ${time.toLocaleTimeString('zh-CN', { hour12: false })}`
      : '⚠ 本地保存失败';
  });
  blocks.onContentChange(() => {
    saver.trigger();
    // 用户编辑积木 → 旧执行立即失效（含暂停态），下次绿旗重新生成（R4/F4）
    if (!suppressWorkspaceSync) runtimeApi?.invalidate();
  });
  // 页面隐藏/关闭前立即落盘，避免丢最后一次改动
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver.flush();
  });
  window.addEventListener('beforeunload', () => saver.flush());
  // pagehide 兜底（移动端/bfcache 场景 beforeunload 可能不触发）
  window.addEventListener('pagehide', () => saver.flush());
  // 导出存档：下载当前项目 JSON 文件（R10：v2 格式，用到的自定义素材一并打包）
  layout.exportBtn.addEventListener('click', () => exportFile(collectProject(), collectUsedAssetData()));
  // 导入存档：文件恢复（R9 先校验后替换——结构校验＋Blockly 无头试载入全部通过才动当前项目；
  // 替换过程若意外失败，用快照整体回滚，保证当前积木/精灵/存档分毫不损）
  layout.importBtn.addEventListener('click', async () => {
    try {
      const imported = await importFile();
      if (!imported) return; // 用户取消
      // 深度校验：每个精灵的脚本状态必须能被 Blockly 完整载入，坏数据不得进入工作区
      if (!imported.sprites.every((s) => validateWorkspaceState(s.workspace))) {
        alert(IMPORT_ERROR_MESSAGE);
        return;
      }
      // R10 素材恢复：导出包内嵌 assetData → 回灌 IndexedDB（先查容量）；
      // 无内嵌数据的 v2 存档 → 引用的素材必须已在本地素材库，缺失即拒绝导入。
      // R16：内嵌数据为原图，crop 参数随元数据回灌（规范化兜底），显示图随后重新推导。
      const prevCatalog = stage.getAssetCatalog();
      const prevCanonical = assetCatalog;
      try {
        if (imported.assetData) {
          const missing: Array<[string, string]> = [];
          for (const [id, url] of Object.entries(imported.assetData)) {
            if (!(await getAsset(id))) missing.push([id, url]);
          }
          const addBytes = missing.reduce(
            (sum, [id]) => sum + (imported.assets?.find((a) => a.id === id)?.size ?? 0),
            0,
          );
          if ((await totalSize()) + addBytes > MAX_TOTAL_BYTES) {
            alert(`素材总容量将超过上限 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB，已取消导入`);
            return;
          }
          for (const [id, url] of missing) {
            const meta = imported.assets?.find((a) => a.id === id);
            if (!meta) {
              alert(IMPORT_ERROR_MESSAGE);
              return;
            }
            await putAsset({
              ...meta,
              // R22：独立裁剪素材的内嵌数据即最终像素——保留标记、不做参数规范化/推导；
              // R16 旧记录（含 crop 参数）仍规范化兜底，载入后重新推导
              ...(meta.cropResult
                ? { cropResult: true, crop: undefined }
                : { crop: normalizeCrop(meta.crop, meta.width, meta.height) }),
              dataUrl: url,
              createdAt: new Date().toISOString(),
            });
          }
        } else if (imported.version === 2) {
          const needed = new Set<string>();
          if (imported.background) needed.add(imported.background);
          for (const s of imported.sprites) {
            const id = assetIdFromCostume(s.costume);
            if (id) needed.add(id);
          }
          for (const id of needed) {
            if (!(await getAsset(id))) {
              console.warn('[main] 导入被拒绝：本地素材库缺少素材', id);
              alert(IMPORT_ERROR_MESSAGE);
              return;
            }
          }
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : IMPORT_ERROR_MESSAGE);
        return;
      }
      const backup = collectProject(); // 当前项目快照（含全部脚本与舞台状态）
      try {
        project = imported;
        workspaces.clear();
        for (const s of project.sprites) workspaces.set(s.id, s.workspace);
        currentSpriteId = project.selectedSpriteId;
        await refreshAssets(); // 素材目录先行（含 R16 推导），造型/背景引用才可解析
        stage.setBackground(imported.background ?? null);
        refreshAssetPanel(); // 背景行文案需在 setBackground 之后重绘（R16 联调修复）
        stage.setSprites(project.sprites, currentSpriteId);
        loadWorkspace(workspaces.get(currentSpriteId) ?? emptyWorkspace());
        runtimeApi?.invalidate(); // 导入覆盖项目：清理旧运行时状态（R4）
        saver.flush();
      } catch (e) {
        // 回滚：恢复快照数据与界面（工作区/舞台/素材目录/选中精灵），不保存坏数据
        console.error('[main] 导入替换失败，回滚到导入前项目', e);
        project = backup;
        workspaces.clear();
        for (const s of backup.sprites) workspaces.set(s.id, s.workspace);
        currentSpriteId = backup.selectedSpriteId;
        assetCatalog = prevCanonical;
        stage.setAssets(prevCatalog);
        stage.setBackground(backup.background ?? null);
        stage.setSprites(backup.sprites, currentSpriteId);
        loadWorkspace(workspaces.get(currentSpriteId) ?? emptyWorkspace());
        runtimeApi?.invalidate();
        refreshAssetPanel();
        mirror?.pushAssets();
        alert(IMPORT_ERROR_MESSAGE);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : IMPORT_ERROR_MESSAGE);
    }
  });
  // 积木栏开关 → 显隐 Blockly 工具箱
  layout.onSidebarToggle((visible) => blocks.setToolboxVisible(visible));
  intro.step('project');
  await frame();

  // 7) 运行时：舞台桥接 + 绿旗/暂停/重置/键盘/碰撞事件（Pyodide 由管线前置准备）
  runtimeApi = initRuntime({
    stage,
    stageHost: layout.stageHost,
    greenFlagBtn: layout.greenFlagBtn,
    pauseBtn: layout.pauseBtn,
    resetBtn: layout.resetBtn,
    getSprites() {
      // 当前精灵的脚本以工作区实时状态为准，其余用缓存
      workspaces.set(currentSpriteId, blocks.saveState());
      return stage.getSprites().map((t) => ({
        id: t.id,
        workspace: workspaces.get(t.id) ?? emptyWorkspace(),
      }));
    },
    onRunningChange: setRunning,
    onPausedChange: setPaused,
    // UI-03：状态机真实迁移成功 → 对应按钮播单次扩散波纹（颜色取按钮自身色）
    onFeedback: (kind) => playRipple(kind === 'flag' ? layout.greenFlagBtn : layout.pauseBtn),
  });

  // 8) 大屏展示：另开页面镜像舞台；镜像广播 + 接收大屏页遥控命令（同 R18 语义）
  mirror = startStageMirror(stage, () => running, () => paused, {
    flag: () => void runtimeApi?.flag(),
    pause: () => runtimeApi?.pause(),
    reset: () => runtimeApi?.reset(),
  });
  layout.fullscreenBtn.addEventListener('click', () => {
    // 相对当前页面解析，兼容子路径部署；BroadcastChannel 同源即可通信
    window.open(new URL('fullscreen.html', document.baseURI).href, '_blank');
  });

  // 调试句柄：便于浏览器控制台排查与自动化联调（不影响正常功能）
  (window as unknown as Record<string, unknown>).__app = {
    layout,
    blocks,
    codeView,
    stage,
    runtime: runtimeApi,
    mirror,
    setRunning,
    stageResize,
    assetPanel,
    sensing,
    eyedropper,
    spriteSettings,
    getProject: collectProject,
    storage: { exportFile, importFile, validateProject, loadLocal },
    assets: {
      listAssets, getAsset, putAsset, deleteAsset, totalSize,
      pickAssetDraft, openAssetAdjust, deriveAssetViews,
      /** R16 原图目录（含裁剪参数；舞台/面板持有的是推导后的显示图） */
      catalog: () => assetCatalog,
    },
    intro,
  };
  intro.step('systems');
  await frame();
}

// ---------- 阶段 B：资源准备（素材恢复 ∥ Pyodide 前置＋探针 → 桥接探针） ----------
async function phaseB(): Promise<void> {
  // 素材恢复与 Pyodide 下载并行（互不阻塞；任一必要失败即整体失败）
  const assetsP = (async () => {
    try {
      await refreshAssets();
      if (project.version === 2 && project.background) stage.setBackground(project.background);
      refreshAssetPanel();
      mirror?.pushAssets();
    } catch (err) {
      // 必要素材口径：项目实际引用素材/背景时恢复失败＝必要初始化失败；
      // 无引用时降级为无素材（沿用 R13 加固语义，不挡编辑器）
      const used =
        (project.assets?.length ?? 0) > 0 ||
        !!project.background ||
        project.sprites.some((s) => assetIdFromCostume(s.costume));
      if (used) throw err instanceof Error ? err : new Error(String(err));
      console.warn('[main] 素材库恢复失败（降级为无素材）', err);
      refreshAssetPanel();
    }
    intro.step('assets');
  })();
  const pythonP = (async () => {
    // silent：无舞台覆盖层；失败抛给管线走启动失败态（转圈/重试 UI 保留为兜底路径）
    const py = await loadPyodideRuntime(layout.stageHost, { silent: true });
    // 真实探针：stdlib（协程/栈回溯，运行时前导依赖）导入＋算术验证
    const v = await py.runPythonAsync('import asyncio, traceback\n6 * 7');
    if (v !== 42) throw new Error('Pyodide 探针异常：stdlib 导入或算术结果不正确');
    intro.step('python');
    return py;
  })();
  const [, py] = await Promise.all([assetsP, pythonP]);
  // 桥接往返探针：Python 经 js 模块真调 JS 函数并取回结果（成功判定有真实依据）
  const probeKey = '__sc_intro_probe';
  (globalThis as Record<string, unknown>)[probeKey] = { ping: (n: number) => n + 1 };
  try {
    const r = await py.runPythonAsync(`import js\njs.${probeKey}.ping(41)`);
    if (r !== 42) throw new Error('桥接探针异常：JS↔Python 往返结果不正确');
  } finally {
    delete (globalThis as Record<string, unknown>)[probeKey];
  }
  intro.step('bridge');
}

// ---------- 管线编排：失败→启动失败态；重试只重跑未完成阶段 ----------
let phaseADone = false;
async function runInit(): Promise<void> {
  try {
    if (!phaseADone) {
      await phaseA();
      phaseADone = true;
    }
    await phaseB();
    intro.ready(); // 全部必要资源真实就绪（转场时机由启动画面按门槛判定）
  } catch (err) {
    console.error('[main] 启动初始化失败', err);
    intro.fail(err instanceof Error ? err : new Error(String(err)));
  }
}
intro.onRetry(() => {
  // 装配已完成 → 只重跑资源阶段（不重复装配/不重复监听器）；
  // 装配阶段灾难性失败（极罕见）→ 整页重建兜底
  if (phaseADone) void runInit();
  else window.location.reload();
});
intro.onEntered(() => {
  console.log('[main] 启动完成，编辑器已解锁（首旗零等待：Pyodide 已前置）');
});
void runInit();