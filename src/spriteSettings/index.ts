/**
 * 角色设置界面（R14）：整体替换中间脚本/代码编辑区（非弹窗），右侧舞台保持显示。
 *
 * 交互设计（执行方定，记入日志）：
 * - 打开时快照当前角色状态为"草稿"，所有输入即时 stage.patch 实时预览；
 *   取消 = 恢复快照；保存 = 交由 main.ts 提交基准（patchSaved）＋改名同步＋持久化。
 * - 名称不做实时预览（改名涉及全部脚本引用同步，只在保存时一次性提交）。
 * - 初始 X/Y 与舞台拖拽双向同步：拖拽角色时 onChange → syncFromStage 回填输入框。
 * - 判定区参数即时预览；设置界面打开期间该角色判定框强制显示（橙色虚线），
 *   "显示判定区"勾选则保存后常驻显示（蓝色虚线）。show 只影响可视化不影响碰撞。
 * - Esc 等价取消；保存/取消后由 main.ts 恢复原编辑视图（积木/代码）。
 */
import '../styles/spriteSettings.css';
import type { StageApi } from '../stage';
import type { HitboxConfig } from '../stage/hitbox';
import { getCostume, costumeDataUrl } from '../stage/costumes';
import { assetIdFromCostume } from '../assets';

/** 设置草稿（保存时提交给 main.ts 的完整字段集） */
export interface SpriteSettingsDraft {
  name: string;
  size: number;
  direction: number;
  visible: boolean;
  x: number;
  y: number;
  hitbox: HitboxConfig;
}

export interface SpriteSettingsOptions {
  /** 面板宿主（editor-body，absolute 覆盖积木/代码区） */
  host: HTMLElement;
  stage: StageApi;
  /** 保存提交（main.ts 负责改名同步 + patchSaved + 自动保存） */
  onSave(id: string, draft: SpriteSettingsDraft): void;
  /** 面板关闭（保存或取消后都会调用；main.ts 恢复原编辑视图） */
  onClose(): void;
}

export interface SpriteSettingsApi {
  open(id: string): void;
  isOpen(): boolean;
  getOpenId(): string | null;
  /** 舞台变化时回填初始 X/Y（拖拽同步）与造型缩略图 */
  syncFromStage(): void;
}

/** 数值输入解析：非法/空输入返回 null（保留原值，不打断 typing） */
function parseNum(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function initSpriteSettings(opts: SpriteSettingsOptions): SpriteSettingsApi {
  const { stage } = opts;

  // ---------- 面板结构（一次性构建，open 时填充） ----------
  const panel = document.createElement('div');
  panel.className = 'ss-panel hidden';
  panel.innerHTML = `
    <div class="ss-head">
      <span class="ss-title">⚙ 角色设置 · <b id="ss-name-label"></b></span>
      <span class="ss-actions">
        <button id="ss-save" class="ss-btn primary" title="保存设置并返回原编辑界面">💾 保存并返回</button>
        <button id="ss-cancel" class="ss-btn" title="放弃修改，恢复打开前的状态（Esc）">✕ 取消</button>
      </span>
    </div>
    <div class="ss-body">
      <section class="ss-section">
        <h3>A · 基础信息</h3>
        <div class="ss-row">
          <label class="ss-label" for="ss-name">角色名称</label>
          <input id="ss-name" class="ss-input" type="text" maxlength="20" />
        </div>
        <div class="ss-row ss-costume-row">
          <span class="ss-label">当前素材</span>
          <img id="ss-costume-img" class="ss-costume-img" alt="角色造型预览" />
          <span id="ss-costume-name" class="ss-hint"></span>
        </div>
        <p class="ss-hint">改名后角色列表与积木中的角色引用会自动同步，不会破坏已有脚本。</p>
      </section>

      <section class="ss-section">
        <h3>B · 外观与变换</h3>
        <div class="ss-row">
          <label class="ss-label" for="ss-size">大小（%）</label>
          <input id="ss-size" class="ss-input num" type="number" min="5" max="500" step="5" />
          <label class="ss-label" for="ss-direction">方向（°）</label>
          <input id="ss-direction" class="ss-input num" type="number" min="-360" max="360" step="15" />
        </div>
        <div class="ss-row">
          <label class="ss-check"><input id="ss-visible" type="checkbox" /> 在舞台上显示</label>
          <span class="ss-hint">90° 朝右 · 0° 朝上 · -90° 朝左 · 180° 朝下</span>
        </div>
      </section>

      <section class="ss-section">
        <h3>C · 初始位置</h3>
        <div class="ss-row">
          <label class="ss-label" for="ss-x">X</label>
          <input id="ss-x" class="ss-input num" type="number" min="-240" max="240" step="5" />
          <label class="ss-label" for="ss-y">Y</label>
          <input id="ss-y" class="ss-input num" type="number" min="-180" max="180" step="5" />
        </div>
        <p class="ss-hint">也可以直接拖动右侧舞台上的角色设置初始位置（坐标实时回填）。
        重置时角色回到这里保存的位置。</p>
      </section>

      <section class="ss-section">
        <h3>D · 角色判定区（碰撞范围）</h3>
        <div class="ss-row">
          <label class="ss-label" for="ss-hb-mode">判定模式</label>
          <select id="ss-hb-mode" class="ss-input">
            <option value="auto">自动（透明图按像素，不透明图按矩形）</option>
            <option value="rect">矩形</option>
            <option value="circle">圆形</option>
          </select>
        </div>
        <div class="ss-row" id="ss-hb-rect-row">
          <label class="ss-label" for="ss-hb-w">宽（%）</label>
          <input id="ss-hb-w" class="ss-input num" type="number" min="5" max="400" step="5" />
          <label class="ss-label" for="ss-hb-h">高（%）</label>
          <input id="ss-hb-h" class="ss-input num" type="number" min="5" max="400" step="5" />
        </div>
        <div class="ss-row hidden" id="ss-hb-circle-row">
          <label class="ss-label" for="ss-hb-r">半径（%）</label>
          <input id="ss-hb-r" class="ss-input num" type="number" min="5" max="400" step="5" />
          <span class="ss-hint">100% = 造型短边一半（内切圆）</span>
        </div>
        <div class="ss-row" id="ss-hb-offset-row">
          <label class="ss-label" for="ss-hb-ox">中心偏移 X</label>
          <input id="ss-hb-ox" class="ss-input num" type="number" min="-200" max="200" step="2" />
          <label class="ss-label" for="ss-hb-oy">Y</label>
          <input id="ss-hb-oy" class="ss-input num" type="number" min="-200" max="200" step="2" />
        </div>
        <div class="ss-row">
          <label class="ss-check"><input id="ss-hb-show" type="checkbox" /> 在舞台上显示判定区（调试虚线框）</label>
        </div>
        <p class="ss-hint" id="ss-hb-hint"></p>
      </section>
    </div>
  `;
  opts.host.appendChild(panel);

  const q = <T extends HTMLElement>(sel: string): T => panel.querySelector<T>(sel)!;
  const nameLabel = q<HTMLElement>('#ss-name-label');
  const nameInput = q<HTMLInputElement>('#ss-name');
  const costumeImg = q<HTMLImageElement>('#ss-costume-img');
  const costumeName = q<HTMLElement>('#ss-costume-name');
  const sizeInput = q<HTMLInputElement>('#ss-size');
  const dirInput = q<HTMLInputElement>('#ss-direction');
  const visibleInput = q<HTMLInputElement>('#ss-visible');
  const xInput = q<HTMLInputElement>('#ss-x');
  const yInput = q<HTMLInputElement>('#ss-y');
  const modeSelect = q<HTMLSelectElement>('#ss-hb-mode');
  const hbW = q<HTMLInputElement>('#ss-hb-w');
  const hbH = q<HTMLInputElement>('#ss-hb-h');
  const hbR = q<HTMLInputElement>('#ss-hb-r');
  const hbOx = q<HTMLInputElement>('#ss-hb-ox');
  const hbOy = q<HTMLInputElement>('#ss-hb-oy');
  const hbShow = q<HTMLInputElement>('#ss-hb-show');
  const rectRow = q<HTMLElement>('#ss-hb-rect-row');
  const circleRow = q<HTMLElement>('#ss-hb-circle-row');
  const offsetRow = q<HTMLElement>('#ss-hb-offset-row');
  const hbHint = q<HTMLElement>('#ss-hb-hint');

  // ---------- 草稿状态 ----------
  let openId: string | null = null;
  let draft: SpriteSettingsDraft | null = null;
  /** 打开前快照（取消时恢复） */
  let snapshot: Omit<SpriteSettingsDraft, 'name'> | null = null;

  /** 造型缩略图与名称（素材造型用素材图，内置造型用 SVG） */
  function refreshCostume(): void {
    const s = openId ? stage.getSprite(openId) : undefined;
    if (!s) return;
    const assetId = assetIdFromCostume(s.costume);
    const asset = assetId ? stage.getSceneExtras().assetCostume?.(s.costume) : undefined;
    if (asset) {
      costumeImg.src = asset.img.src;
      costumeName.textContent = `自定义素材（${asset.width}×${asset.height}）`;
    } else {
      const c = getCostume(s.costume);
      costumeImg.src = costumeDataUrl(c);
      costumeName.textContent = `内置造型 · ${c.name}（${c.width}×${c.height}）`;
    }
  }

  /** 判定区参数行的模式联动显隐 + 提示文案 */
  function refreshHitboxRows(): void {
    if (!draft) return;
    const m = draft.hitbox.mode;
    rectRow.classList.toggle('hidden', m !== 'rect');
    circleRow.classList.toggle('hidden', m !== 'circle');
    offsetRow.classList.toggle('hidden', m === 'auto');
    hbHint.textContent =
      m === 'auto'
        ? '自动模式：透明 PNG 按不透明像素判定，JPG 等不透明图片按造型矩形判定（R15 检测）。'
        : m === 'rect'
          ? '矩形判定：轴对齐包围盒，宽高相对造型原始尺寸百分比，随角色大小缩放。'
          : '圆形判定：半径相对造型短边一半的百分比，随角色大小缩放。';
  }

  /** 草稿 → 舞台实时预览（名称除外：保存时才提交改名） */
  function applyPreview(): void {
    if (!openId || !draft) return;
    stage.patch(openId, {
      size: draft.size,
      direction: draft.direction,
      visible: draft.visible,
      x: draft.x,
      y: draft.y,
      hitbox: { ...draft.hitbox },
    });
  }

  /** 草稿 → 输入框回填（open / 拖拽同步用） */
  function fillInputs(): void {
    if (!draft) return;
    nameInput.value = draft.name;
    nameLabel.textContent = draft.name;
    sizeInput.value = String(draft.size);
    dirInput.value = String(draft.direction);
    visibleInput.checked = draft.visible;
    xInput.value = String(Math.round(draft.x * 10) / 10);
    yInput.value = String(Math.round(draft.y * 10) / 10);
    modeSelect.value = draft.hitbox.mode;
    hbW.value = String(draft.hitbox.width);
    hbH.value = String(draft.hitbox.height);
    hbR.value = String(draft.hitbox.radius);
    hbOx.value = String(draft.hitbox.offsetX);
    hbOy.value = String(draft.hitbox.offsetY);
    hbShow.checked = draft.hitbox.show;
    refreshHitboxRows();
    refreshCostume();
  }

  // ---------- 输入事件（即时预览） ----------
  nameInput.addEventListener('input', () => {
    if (!draft) return;
    draft.name = nameInput.value;
    nameLabel.textContent = nameInput.value || '（未命名）';
  });
  sizeInput.addEventListener('input', () => {
    const n = parseNum(sizeInput.value);
    if (n === null || !draft) return;
    draft.size = clamp(n, 5, 500);
    applyPreview();
  });
  dirInput.addEventListener('input', () => {
    const n = parseNum(dirInput.value);
    if (n === null || !draft) return;
    draft.direction = clamp(n, -360, 360);
    applyPreview();
  });
  visibleInput.addEventListener('change', () => {
    if (!draft) return;
    draft.visible = visibleInput.checked;
    applyPreview();
  });
  xInput.addEventListener('input', () => {
    const n = parseNum(xInput.value);
    if (n === null || !draft) return;
    draft.x = clamp(n, -240, 240);
    applyPreview();
  });
  yInput.addEventListener('input', () => {
    const n = parseNum(yInput.value);
    if (n === null || !draft) return;
    draft.y = clamp(n, -180, 180);
    applyPreview();
  });
  modeSelect.addEventListener('change', () => {
    if (!draft) return;
    draft.hitbox.mode = modeSelect.value as HitboxConfig['mode'];
    refreshHitboxRows();
    applyPreview();
  });
  const hbNumBind = (el: HTMLInputElement, key: 'width' | 'height' | 'radius' | 'offsetX' | 'offsetY') => {
    el.addEventListener('input', () => {
      const n = parseNum(el.value);
      if (n === null || !draft) return;
      const lo = key === 'offsetX' || key === 'offsetY' ? -200 : 5;
      draft.hitbox[key] = clamp(n, lo, key === 'offsetX' || key === 'offsetY' ? 200 : 400);
      applyPreview();
    });
  };
  hbNumBind(hbW, 'width');
  hbNumBind(hbH, 'height');
  hbNumBind(hbR, 'radius');
  hbNumBind(hbOx, 'offsetX');
  hbNumBind(hbOy, 'offsetY');
  hbShow.addEventListener('change', () => {
    if (!draft) return;
    draft.hitbox.show = hbShow.checked;
    applyPreview();
  });

  // ---------- 保存 / 取消 ----------
  function hidePanel(): void {
    panel.classList.add('hidden');
    stage.setHitboxPreview(null);
    openId = null;
    draft = null;
    snapshot = null;
    opts.onClose();
  }

  function save(): void {
    if (!openId || !draft) return;
    const id = openId;
    const d = { ...draft, hitbox: { ...draft.hitbox } };
    opts.onSave(id, d); // main.ts：改名同步 + patchSaved + 持久化
    hidePanel();
  }

  function cancel(): void {
    if (!openId || !snapshot) return;
    // 恢复打开前快照：用 patchSaved 连"已保存基准"一起还原——
    // 设置期间的舞台拖拽会更新基准（C 区交互），取消须一并撤销，保证"取消不改原有设置"
    stage.patchSaved(openId, {
      size: snapshot.size,
      direction: snapshot.direction,
      visible: snapshot.visible,
      x: snapshot.x,
      y: snapshot.y,
      hitbox: { ...snapshot.hitbox },
    });
    hidePanel();
  }

  q<HTMLButtonElement>('#ss-save').addEventListener('click', save);
  q<HTMLButtonElement>('#ss-cancel').addEventListener('click', cancel);
  // Esc 取消（仅面板打开期间；输入框内同样生效）
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      cancel();
    }
  });

  // ---------- 对外 API ----------
  return {
    open(id) {
      const s = stage.getSprite(id);
      if (!s) return;
      openId = id;
      draft = {
        name: s.name,
        size: s.size,
        direction: s.direction,
        visible: s.visible,
        x: s.x,
        y: s.y,
        hitbox: { ...s.hitbox },
      };
      snapshot = {
        size: s.size,
        direction: s.direction,
        visible: s.visible,
        x: s.x,
        y: s.y,
        hitbox: { ...s.hitbox },
      };
      fillInputs();
      panel.classList.remove('hidden');
      stage.setHitboxPreview(id); // 打开期间强制显示该角色判定框（橙色）
      applyPreview();
      nameInput.focus();
      nameInput.select();
    },
    isOpen: () => openId !== null,
    getOpenId: () => openId,
    syncFromStage() {
      if (!openId || !draft) return;
      const s = stage.getSprite(openId);
      if (!s) return;
      // 拖拽同步：只回填 X/Y（其他字段以草稿为准，避免覆盖正在输入的值）
      draft.x = s.x;
      draft.y = s.y;
      if (document.activeElement !== xInput) xInput.value = String(Math.round(s.x * 10) / 10);
      if (document.activeElement !== yInput) yInput.value = String(Math.round(s.y * 10) / 10);
      refreshCostume(); // 素材面板可能在设置期间换了造型
    },
  };
}