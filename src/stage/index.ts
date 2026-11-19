/**
 * 舞台模块：480×360 Scratch 坐标系渲染 + 精灵管理 + 精灵面板。
 *
 * 坐标系：中心 (0,0)，x 向右、y 向上，范围约 ±240 / ±180（与 Scratch 一致）。
 * 方向：90 右 / 0 上 / -90 左 / 180 下；造型默认朝右，渲染旋转 direction-90。
 * 渲染：Canvas + requestAnimationFrame 常开循环（精灵数量少，开销可忽略）。
 *
 * 数据所有权：舞台只持有精灵的"变换/造型/说话"状态；脚本工作区归 main.ts
 * 的项目数据管理，切换精灵时由 main.ts 交换 Blockly 状态。
 */
import '../styles/stage.css';
import { getCostume, costumeDataUrl, COSTUMES } from './costumes';
import { createImageFor, drawScene, STAGE_W, STAGE_H, type StageSprite, type MonitorEntry, type AssetImage, type SceneExtras } from './render';
import { assetIdFromCostume, type AssetRecord } from '../assets';
import { DEFAULT_HITBOX, normalizeHitbox, drawHitboxOutline } from './hitbox';
import type { SpriteData } from '../storage';

// 渲染逻辑与大屏镜像页共享（stage/render.ts）；此处复导出兼容既有引用
export { STAGE_W, STAGE_H } from './render';
export type { StageSprite } from './render';

export interface StageOptions {
  /** 选中精灵变化（main.ts 据此交换 Blockly 工作区） */
  onSelect(id: string): void;
  /** 结构性变化：添加/删除/拖拽精灵（触发自动保存） */
  onStructuralChange(): void;
  /** 是否允许拖拽精灵（运行时禁止，避免与脚本打架） */
  canDrag(): boolean;
  /** 舞台状态变化（patch/反弹/增删精灵等）：大屏镜像据此即时推送 */
  onChange?(): void;
  /** 图层顺序变化（R12）：只触发自动保存，不终止运行（区别于增删精灵的结构性变化） */
  onLayerChange?(): void;
  /** 点击角色设置入口（R14：卡片悬停齿轮 / 操作行设置按钮），main.ts 打开设置界面 */
  onOpenSettings?(id: string): void;
  /** 保存的角色设置变化（R14 patchSaved）：只触发自动保存，不终止运行 */
  onSettingsChange?(): void;
  /** 是否允许切换选中/增删精灵（R14：设置界面打开期间锁定，避免面板与选中角色错位） */
  canSelect?(): boolean;
}

/** 图层四操作（R12）：数组序即图层序（越靠后越在前），背景恒最底 */
export type LayerOp = 'front' | 'back' | 'forward' | 'backward';

export interface StageApi {
  /** 用项目数据整体重置精灵列表 */
  setSprites(sprites: SpriteData[], selectedId: string): void;
  /** 读取全部精灵变换（存档收集用） */
  getSprites(): StageSprite[];
  getSelectedId(): string;
  setSelectedId(id: string): void;
  /** 运行时更新精灵属性（不触发自动保存） */
  patch(id: string, partial: Partial<Omit<StageSprite, 'id'>>): void;
  /** 保存角色设置（R14）：更新当前状态并同步"已保存基准"快照，重置回到这里 */
  patchSaved(id: string, partial: Partial<Omit<StageSprite, 'id'>>): void;
  /** 判定区预览（R14）：设置界面打开期间强制显示该角色判定框；null 关闭 */
  setHitboxPreview(id: string | null): void;
  getSprite(id: string): StageSprite | undefined;
  /** 设置/清除说话气泡 */
  say(id: string, text: string | null): void;
  /** 碰到边缘反弹（Scratch 规则） */
  bounce(id: string): void;
  /** 添加精灵（返回新 id） */
  addSprite(): string;
  removeSprite(id: string): void;
  /** 重置：全部精灵恢复初始快照（载入/导入/添加时的变换），清除气泡（R1） */
  resetToInitial(): void;
  /** 图层四操作（R12）：移到最前/最后/前移一层/后移一层；只改显示顺序，不动坐标与逻辑碰撞 */
  moveLayer(id: string, op: LayerOp): void;
  /** 变量监视器（R6）：设置/移除/清除/读取舞台左上角挂牌（按精灵归属键控） */
  setMonitor(owner: string, name: string, value: string | number): void;
  removeMonitor(owner: string, name: string): void;
  clearMonitors(): void;
  getMonitors(): MonitorEntry[];
  /** 自定义素材（R10）：整体设置素材目录（元数据+图像缓存由此建立） */
  setAssets(records: AssetRecord[]): void;
  /** 读取素材目录（素材面板/导出打包/大屏镜像用） */
  getAssetCatalog(): AssetRecord[];
  /** 设置/清除舞台背景（恒最底层；id 必须在素材目录中） */
  setBackground(id: string | null): void;
  getBackground(): string | null;
  /** 造型原始宽高（内置造型或自定义素材；碰撞/反弹/拖拽命中统一用它） */
  getCostumeDims(costume: string): { width: number; height: number };
  /** 渲染附加层快照（R11：颜色侦测离屏采样复用同一份背景/素材解析） */
  getSceneExtras(): SceneExtras;
}

/** 坐标限制：保证精灵中心不越出舞台 */
function clampX(x: number): number {
  return Math.max(-STAGE_W / 2, Math.min(STAGE_W / 2, x));
}
function clampY(y: number): number {
  return Math.max(-STAGE_H / 2, Math.min(STAGE_H / 2, y));
}

/** 初始化舞台与精灵面板 */
export function initStage(host: HTMLElement, panel: HTMLElement, opts: StageOptions): StageApi {
  // ---------- Canvas ----------
  const canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  // R5：物理像素随宿主尺寸变化（dpr 感知），逻辑坐标恒为 480×360；
  // 渲染时每帧 setTransform 等比映射，舞台放大后精灵/气泡同步放大不模糊
  function fitCanvas(): void {
    const r = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }
  new ResizeObserver(fitCanvas).observe(host);
  fitCanvas();

  // 造型图片缓存（共享渲染器提供）
  const imageFor = createImageFor();

  let sprites: StageSprite[] = [];
  let selectedId = '';
  /** 已保存基准快照（R14/R19 取代 R1"载入时快照"语义）：
   *  载入/导入/添加时记录；编辑态拖拽结束与设置保存会更新它；
   *  运行期间脚本造成的变化不改写它；重置回到这里。 */
  const initial = new Map<string, StageSprite>();
  /** 判定区预览角色（R14 设置界面打开期间强制画虚线框） */
  let hitboxPreviewId: string | null = null;
  /** 变量监视器（R6）：归属键 → 挂牌；运行期间由桥接轮询刷新 */
  const monitors = new Map<string, MonitorEntry>();

  // ---------- 自定义素材（R10）：目录 + 图像缓存 + 背景选择 ----------
  const assetMap = new Map<string, AssetRecord>();
  const assetImages = new Map<string, AssetImage>();
  let backgroundId: string | null = null;

  /** 造型原始宽高：素材造型查目录，内置造型查 SVG 定义 */
  function costumeDims(costume: string): { width: number; height: number } {
    const id = assetIdFromCostume(costume);
    const rec = id ? assetMap.get(id) : undefined;
    if (rec) return { width: rec.width, height: rec.height };
    const c = getCostume(costume);
    return { width: c.width, height: c.height };
  }

  /** 渲染附加层：背景图像 + 素材造型解析器（传给共享渲染器） */
  function sceneExtras() {
    return {
      background: backgroundId ? assetImages.get(backgroundId) ?? null : null,
      assetCostume: (key: string): AssetImage | undefined => {
        const id = assetIdFromCostume(key);
        return id ? assetImages.get(id) : undefined;
      },
    };
  }

  // ---------- 渲染（绘制逻辑见 stage/render.ts，与大屏镜像共用） ----------
  function render(): void {
    // 逻辑 480×360 → 物理画布等比变换（宿主 aspect-ratio 锁 4:3，横纵同比例）
    const scale = canvas.width / STAGE_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawScene(ctx, sprites, imageFor, [...monitors.values()], sceneExtras());
    // 判定区调试可视化（R14）：只画在主舞台，不进镜像/侦测采样。
    // show 开关持久显示；设置界面预览中的角色强制显示（橙色区分）
    for (const s of sprites) {
      if (!s.visible) continue;
      const preview = s.id === hitboxPreviewId;
      if (!s.hitbox.show && !preview) continue;
      drawHitboxOutline(ctx, s, costumeDims(s.costume), preview ? '#ff8c1a' : '#4c97ff');
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // ---------- 舞台拖拽（非运行时移动精灵） ----------
  let dragId: string | null = null;

  /** 页面坐标 → 舞台坐标 */
  function toStage(ev: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * STAGE_W;
    const py = ((ev.clientY - rect.top) / rect.height) * STAGE_H;
    return { x: px - STAGE_W / 2, y: STAGE_H / 2 - py };
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!opts.canDrag()) return;
    const p = toStage(ev);
    // 从上层往下找命中的精灵（半径近似）
    for (let i = sprites.length - 1; i >= 0; i--) {
      const s = sprites[i];
      if (!s.visible) continue;
      // 设置界面打开期间只允许拖动当前设置的角色（R14 C 区交互）
      if (opts.canSelect && !opts.canSelect() && s.id !== selectedId) continue;
      const c = costumeDims(s.costume);
      const r = (Math.max(c.width, c.height) * s.size) / 200;
      if (Math.hypot(p.x - s.x, p.y - s.y) <= r) {
        dragId = s.id;
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch {
          /* 合成指针等场景捕获失败不中断拖拽 */
        }
        setSelectedId(s.id);
        break;
      }
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragId) return;
    const p = toStage(ev);
    patch(dragId, { x: clampX(p.x), y: clampY(p.y) });
  });
  const endDrag = () => {
    if (dragId) {
      // R14/R19：编辑态拖拽结束即更新"已保存初始位置"（重置回到拖拽后的位置）
      const s = sprites.find((sp) => sp.id === dragId);
      const init = initial.get(dragId);
      if (s && init) {
        init.x = s.x;
        init.y = s.y;
      }
      dragId = null;
      // R19：拖拽是基准编辑而非结构变化——只自动保存＋镜像/设置同步，
      // 不终止运行时（结束态保留事件注册表；拖拽不得影响程序运行状态）
      opts.onSettingsChange?.();
      opts.onChange?.();
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- 精灵面板 ----------
  function renderPanel(): void {
    panel.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'sprite-list';

    for (const s of sprites) {
      const card = document.createElement('button');
      card.className = 'sprite-card' + (s.id === selectedId ? ' selected' : '');
      card.title = `选中 ${s.name}`;
      const img = document.createElement('img');
      // 素材造型用素材图缩略图，内置造型用 SVG（R10）
      const assetId = assetIdFromCostume(s.costume);
      const assetRec = assetId ? assetMap.get(assetId) : undefined;
      img.src = assetRec ? assetRec.dataUrl : costumeDataUrl(getCostume(s.costume));
      img.alt = s.name;
      const name = document.createElement('span');
      name.className = 'sprite-name';
      name.textContent = s.name;
      // R14 设置入口：悬停卡片时缩略图淡化、中央浮现齿轮（触屏等效入口在下方操作行）
      const gear = document.createElement('span');
      gear.className = 'sprite-gear';
      gear.textContent = '⚙';
      gear.title = `打开「${s.name}」的角色设置`;
      gear.setAttribute('role', 'button');
      gear.addEventListener('click', (ev) => {
        ev.stopPropagation(); // 不触发卡片的选中逻辑
        setSelectedId(s.id);
        opts.onOpenSettings?.(s.id);
      });
      card.append(img, name, gear);
      card.addEventListener('click', () => setSelectedId(s.id));
      list.appendChild(card);
    }

    // 添加精灵按钮
    const add = document.createElement('button');
    add.className = 'sprite-add';
    add.textContent = '＋ 添加精灵';
    add.title = '添加一个新精灵（内置造型轮换）';
    add.addEventListener('click', () => api.addSprite());
    list.appendChild(add);

    panel.appendChild(list);

    // 选中精灵的操作行：图层四操作（R12）+ 删除
    const sel = sprites.find((s) => s.id === selectedId);
    if (sel) {
      // 图层按钮行：数组序=图层序，越靠后越在前；仅改显示顺序，不动坐标
      const layerRow = document.createElement('div');
      layerRow.className = 'sprite-ops sprite-layer';
      const layerOps: Array<[LayerOp, string, string]> = [
        ['front', '⏫ 最前', '移到最前面'],
        ['forward', '⬆ 前一层', '前移一层'],
        ['backward', '⬇ 后一层', '后移一层'],
        ['back', '⏬ 最后', '移到最后面'],
      ];
      for (const [op, label, tip] of layerOps) {
        const btn = document.createElement('button');
        btn.className = 'sprite-layer-btn';
        btn.textContent = label;
        btn.title = tip;
        btn.addEventListener('click', () => api.moveLayer(sel.id, op));
        layerRow.appendChild(btn);
      }
      panel.appendChild(layerRow);

      const row = document.createElement('div');
      row.className = 'sprite-ops sprite-ops-row';
      // R14 触屏等效设置入口：选中角色的操作行常驻"设置"按钮（形态执行方定，记入日志）
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'sprite-settings-btn';
      settingsBtn.textContent = '⚙ 角色设置';
      settingsBtn.title = '打开当前角色的设置界面（名称/外观/初始位置/判定区）';
      settingsBtn.addEventListener('click', () => opts.onOpenSettings?.(sel.id));
      row.appendChild(settingsBtn);
      const del = document.createElement('button');
      del.className = 'sprite-del';
      del.textContent = `🗑 删除「${sel.name}」`;
      del.disabled = sprites.length <= 1;
      del.title = sprites.length <= 1 ? '至少保留一个精灵' : '删除选中精灵';
      del.addEventListener('click', () => api.removeSprite(sel.id));
      row.appendChild(del);
      panel.appendChild(row);
    }
  }

  // ---------- 内部工具 ----------
  function patch(id: string, partial: Partial<Omit<StageSprite, 'id'>>): void {
    const s = sprites.find((sp) => sp.id === id);
    if (!s) return;
    // 防御：忽略 NaN/Infinity 数值字段，避免上游异常污染精灵状态与存档
    const safe: Partial<Omit<StageSprite, 'id'>> = {};
    for (const k of Object.keys(partial) as Array<keyof typeof partial>) {
      const v = partial[k];
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      (safe as Record<string, unknown>)[k] = v;
    }
    Object.assign(s, safe);
    if (safe.x !== undefined) s.x = clampX(s.x);
    if (safe.y !== undefined) s.y = clampY(s.y);
    opts.onChange?.();
  }

  function setSelectedId(id: string): void {
    if (selectedId === id) return;
    if (opts.canSelect && !opts.canSelect()) return; // 设置界面打开期间锁定选择（R14）
    selectedId = id;
    renderPanel();
    opts.onSelect(id);
  }

  // ---------- 对外 API ----------
  const api: StageApi = {
    setSprites(list, selId) {
      // 历史存档可能含被污染的数值（NaN 序列化为 null）：读取时兜底修复
      const numOr = (v: unknown, fb: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fb;
      // R12：按存档图层号恢复显示顺序（v1 无 layer 字段 → 保持数组顺序；稳定排序）
      const ordered = list
        .map((d, i) => ({ d, i }))
        .sort((a, b) => numOr(a.d.layer, a.i) - numOr(b.d.layer, b.i) || a.i - b.i)
        .map((x) => x.d);
      sprites = ordered.map((d) => ({
        id: d.id,
        name: d.name,
        costume: d.costume,
        x: numOr(d.x, 0),
        y: numOr(d.y, 0),
        direction: numOr(d.direction, 90),
        size: numOr(d.size, 100),
        visible: d.visible,
        say: null,
        ghost: numOr((d as { ghost?: number }).ghost, 0),
        brightness: numOr((d as { brightness?: number }).brightness, 0),
        color: numOr((d as { color?: number }).color, 0),
        hitbox: normalizeHitbox((d as { hitbox?: unknown }).hitbox), // R14：旧存档缺省自动模式
      }));
      selectedId = selId;
      // 记录初始快照（重置时回到这里；运行中的位移不会改写它）
      initial.clear();
      for (const s of sprites) initial.set(s.id, { ...s });
      renderPanel();
      opts.onChange?.();
    },
    getSprites() {
      return sprites.map((s) => ({ ...s }));
    },
    getSelectedId: () => selectedId,
    setSelectedId,
    patch,
    getSprite: (id) => sprites.find((s) => s.id === id),
    patchSaved(id, partial) {
      // R14：设置保存 = 更新当前状态 + 同步已保存基准快照（重置回到这里）
      patch(id, partial);
      const init = initial.get(id);
      const s = sprites.find((sp) => sp.id === id);
      if (init && s) {
        Object.assign(init, {
          name: s.name,
          x: s.x,
          y: s.y,
          direction: s.direction,
          size: s.size,
          visible: s.visible,
          // R15 联调修复：造型一并提交基准，否则重置会把已保存的造型回退成旧快照
          costume: s.costume,
          hitbox: { ...s.hitbox },
        });
      }
      renderPanel(); // 名称等变化即时回显面板
      opts.onSettingsChange?.(); // 自动保存（不终止运行）
    },
    setHitboxPreview(id) {
      hitboxPreviewId = id;
    },
    say(id, text) {
      patch(id, { say: text });
    },
    bounce(id) {
      const s = sprites.find((sp) => sp.id === id);
      if (!s) return;
      const c = costumeDims(s.costume);
      const halfW = (c.width * s.size) / 200;
      const halfH = (c.height * s.size) / 200;
      // 左右边缘：方向取反；上下边缘：180-方向（Scratch 反弹规则）
      if (s.x + halfW >= STAGE_W / 2 || s.x - halfW <= -STAGE_W / 2) {
        s.direction = -s.direction;
      }
      if (s.y + halfH >= STAGE_H / 2 || s.y - halfH <= -STAGE_H / 2) {
        s.direction = 180 - s.direction;
      }
      opts.onChange?.();
    },
    addSprite() {
      if (opts.canSelect && !opts.canSelect()) return ''; // 设置期间锁定增删（R14）
      const costume = COSTUMES[sprites.length % COSTUMES.length];
      const id = `sprite-${Date.now()}`;
      sprites.push({
        id,
        name: `${costume.name}${sprites.length + 1}`,
        costume: costume.key,
        x: 0,
        y: 0,
        direction: 90,
        size: 100,
        visible: true,
        say: null,
        ghost: 0,
        brightness: 0,
        color: 0,
        hitbox: { ...DEFAULT_HITBOX },
      });
      selectedId = id;
      initial.set(id, { ...sprites[sprites.length - 1] });
      renderPanel();
      opts.onSelect(id);
      opts.onStructuralChange();
      opts.onChange?.();
      return id;
    },
    removeSprite(id) {
      if (sprites.length <= 1) return;
      if (opts.canSelect && !opts.canSelect()) return; // 设置期间锁定增删（R14）
      sprites = sprites.filter((s) => s.id !== id);
      initial.delete(id);
      if (selectedId === id) {
        selectedId = sprites[0].id;
        opts.onSelect(selectedId);
      }
      renderPanel();
      opts.onStructuralChange();
      opts.onChange?.();
    },
    resetToInitial() {
      for (const s of sprites) {
        const init = initial.get(s.id);
        if (!init) continue;
        s.x = init.x;
        s.y = init.y;
        s.direction = init.direction;
        s.size = init.size;
        s.visible = init.visible;
        s.costume = init.costume;
        s.say = null; // 重置清除气泡（R1/R3）
        s.ghost = init.ghost;
        s.brightness = init.brightness;
        s.color = init.color;
        s.hitbox = { ...init.hitbox }; // R14：判定区配置也回已保存基准
      }
      // R12：图层顺序也回初始快照序（与造型恢复同语义；运行中积木改的图层被重置）
      const order = [...initial.keys()];
      sprites.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      monitors.clear(); // 重置清除变量监视器（R6）
      opts.onChange?.();
    },
    moveLayer(id, op) {
      const i = sprites.findIndex((s) => s.id === id);
      if (i < 0) return;
      const [s] = sprites.splice(i, 1);
      // 数组序=图层序（尾=最前）；splice 后 i 即"原下一位"的下标
      if (op === 'front') sprites.push(s);
      else if (op === 'back') sprites.unshift(s);
      else if (op === 'forward') sprites.splice(Math.min(i + 1, sprites.length), 0, s);
      else sprites.splice(Math.max(i - 1, 0), 0, s);
      renderPanel();
      opts.onLayerChange?.(); // 自动保存（不终止运行）
      opts.onChange?.(); // 镜像即时推送
    },
    setMonitor(owner, name, value) {
      const str = typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value);
      const key = `${owner}|${name}`;
      if (monitors.get(key)?.value === str) return;
      monitors.set(key, { name, value: str });
      opts.onChange?.();
    },
    removeMonitor(owner, name) {
      if (monitors.delete(`${owner}|${name}`)) opts.onChange?.();
    },
    clearMonitors() {
      if (monitors.size === 0) return;
      monitors.clear();
      opts.onChange?.();
    },
    getMonitors() {
      return [...monitors.values()];
    },
    setAssets(records) {
      assetMap.clear();
      assetImages.clear();
      for (const rec of records) {
        assetMap.set(rec.id, rec);
        const img = new Image();
        img.src = rec.dataUrl;
        // R22：独立裁剪素材作背景时 contain 完整显示（fit 标记透传渲染层）
        assetImages.set(rec.id, { img, width: rec.width, height: rec.height, fit: rec.cropResult === true });
      }
      // 背景引用失效（素材被删）时回落白色
      if (backgroundId && !assetMap.has(backgroundId)) backgroundId = null;
      renderPanel();
      opts.onChange?.();
    },
    getAssetCatalog() {
      return [...assetMap.values()];
    },
    setBackground(id) {
      if (id !== null && !assetMap.has(id)) return;
      backgroundId = id;
      opts.onChange?.();
    },
    getBackground: () => backgroundId,
    getCostumeDims: costumeDims,
    getSceneExtras: sceneExtras,
  };

  return api;
}