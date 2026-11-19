/**
 * 素材库面板（R10）：舞台列下方的素材列表视图。
 *
 * 功能：导入图片入口、素材缩略图列表、每个素材三种操作——
 * 设为舞台背景 / 用作选中精灵的造型 / 删除；背景状态行（当前背景 + 清除）。
 * 本模块只做 DOM 与交互回调，素材数据与落地逻辑由 main.ts 编排。
 */
import '../styles/assets.css';
import type { AssetRecord } from './store';

/** 面板交互回调（main.ts 提供落地逻辑） */
export interface AssetPanelCallbacks {
  /** 点击"导入图片" */
  onImport(): void;
  /** 设为背景（id）或清除背景（null） */
  onSetBackground(id: string | null): void;
  /** 把素材用作当前选中精灵的造型 */
  onApplyCostume(id: string): void;
  /** 调整素材显示方式（R16：完整显示/裁剪填充/自定义裁剪，基于原图再编辑） */
  onAdjust(id: string): void;
  /** 删除素材（使用中会被 main.ts 拦截提示） */
  onDelete(id: string): void;
}

/** 素材库面板 API */
export interface AssetPanelApi {
  /** 用最新素材列表与背景选择重绘面板 */
  render(assets: AssetRecord[], backgroundId: string | null): void;
}

/** 挂载素材库面板 */
export function initAssetPanel(host: HTMLElement, cb: AssetPanelCallbacks): AssetPanelApi {
  function render(assets: AssetRecord[], backgroundId: string | null): void {
    host.innerHTML = '';

    // 标题行 + 导入入口
    const head = document.createElement('div');
    head.className = 'asset-head';
    const title = document.createElement('span');
    title.className = 'asset-title';
    title.textContent = '🖼 素材库';
    const importBtn = document.createElement('button');
    importBtn.className = 'asset-import';
    importBtn.textContent = '＋ 导入图片';
    importBtn.title = '从本地导入 PNG / JPG / WebP 图片（单文件 ≤5MB）';
    importBtn.addEventListener('click', () => cb.onImport());
    head.append(title, importBtn);
    host.appendChild(head);

    // 背景状态行
    const bgRow = document.createElement('div');
    bgRow.className = 'asset-bg-row';
    const bg = assets.find((a) => a.id === backgroundId);
    const bgLabel = document.createElement('span');
    bgLabel.textContent = bg ? `舞台背景：${bg.name}` : '舞台背景：白色（默认）';
    bgRow.appendChild(bgLabel);
    if (bg) {
      const clear = document.createElement('button');
      clear.className = 'asset-bg-clear';
      clear.textContent = '清除背景';
      clear.addEventListener('click', () => cb.onSetBackground(null));
      bgRow.appendChild(clear);
    }
    host.appendChild(bgRow);

    // 素材网格
    const grid = document.createElement('div');
    grid.className = 'asset-grid';
    if (assets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'asset-empty';
      empty.textContent = '还没有素材，导入图片后可设为背景或精灵造型';
      grid.appendChild(empty);
    }
    for (const a of assets) {
      const card = document.createElement('div');
      card.className = 'asset-card' + (a.id === backgroundId ? ' is-bg' : '');
      card.dataset.assetId = a.id; // R11 吸色笔：缩略图取色按 id 找原图
      const img = document.createElement('img');
      img.src = a.dataUrl;
      img.alt = a.name;
      img.loading = 'lazy';
      const name = document.createElement('div');
      name.className = 'asset-name';
      name.textContent = a.name;
      name.title = `${a.name}（${a.width}×${a.height}）`;
      const ops = document.createElement('div');
      ops.className = 'asset-ops';
      const bgBtn = document.createElement('button');
      bgBtn.textContent = '背景';
      bgBtn.title = '设为舞台背景（恒在最底层）';
      bgBtn.addEventListener('click', () => cb.onSetBackground(a.id));
      const costumeBtn = document.createElement('button');
      costumeBtn.textContent = '造型';
      costumeBtn.title = '用作当前选中精灵的造型';
      costumeBtn.addEventListener('click', () => cb.onApplyCostume(a.id));
      // R16：再编辑显示方式（永远基于原图重调，不累积裁剪损失）
      const adjustBtn = document.createElement('button');
      adjustBtn.textContent = '裁剪';
      adjustBtn.title = '调整显示方式：完整显示 / 裁剪填充 / 自定义裁剪';
      adjustBtn.addEventListener('click', () => cb.onAdjust(a.id));
      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑';
      delBtn.title = '删除素材';
      delBtn.addEventListener('click', () => cb.onDelete(a.id));
      ops.append(bgBtn, costumeBtn, adjustBtn, delBtn);
      card.append(img, name, ops);
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }

  return { render };
}