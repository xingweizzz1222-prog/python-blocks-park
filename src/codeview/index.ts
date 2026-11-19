/**
 * 代码视图模块：积木 → Python 单向实时生成与"积木/代码"切换。
 *
 * 设计要点（对应已确认决策 2）：
 * - 积木是唯一事实来源；代码视图只读，不做反向解析。
 * - 切到代码视图时立即生成一次；停留期间积木若有变化（如导入存档）实时刷新。
 * - 切回积木视图后继续搭建，互不干扰。
 */
import '../styles/codeview.css';
import type { BlocksApi } from '../blocks';
import { generatePython } from '../blocks';

/** 脚本区视图模式：积木搭建 / 只读代码 */
export type ViewMode = 'blocks' | 'code';

export interface CodeViewApi {
  /** 当前视图模式 */
  getMode(): ViewMode;
  /** 切换视图（供外部按钮/快捷键调用） */
  setMode(mode: ViewMode): void;
  /** 刷新代码内容（代码视图激活时） */
  refresh(): void;
}

/** HTML 转义，防止积木文本注入页面 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 轻量 Python 语法高亮（单遍正则分词，避免嵌套替换问题）。
 * 分类：注释 / 字符串 / 关键字 / 数字 / stage 桥接调用。
 */
function highlightPython(code: string): string {
  const escaped = escapeHtml(code);
  const pattern =
    /(#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(async|def|await|for|while|in|if|elif|else|return|import|from|True|False|None|and|or|not|pass|break|continue|range|int|str)\b|\b(\d+(?:\.\d+)?)\b|\b(stage)\b/g;
  return escaped.replace(pattern, (m, comment, str, kw, num_, bridge) => {
    if (comment) return `<span class="tok-comment">${m}</span>`;
    if (str) return `<span class="tok-string">${m}</span>`;
    if (kw) return `<span class="tok-keyword">${m}</span>`;
    if (num_) return `<span class="tok-number">${m}</span>`;
    if (bridge) return `<span class="tok-bridge">${m}</span>`;
    return m;
  });
}

/** 初始化代码视图：面板渲染 + 视图切换 + 实时刷新
 *  @param onRunFlag 点击绿旗事件行（stage.on_flag(...)）时的触发回调（R2，与绿旗同语义） */
export function initCodeView(
  panel: HTMLElement,
  toggleBtn: HTMLButtonElement,
  blocks: BlocksApi,
  blocklyHost: HTMLElement,
  onRunFlag?: () => void,
): CodeViewApi {
  let mode: ViewMode = 'blocks';

  // 面板内部结构：工具条（只读标识/复制/切回）+ 代码区
  panel.innerHTML = `
    <div class="code-toolbar">
      <span class="code-badge">🐍 Python · 只读（由积木实时生成）</span>
      <span class="code-actions">
        <button class="code-btn" id="code-copy">复制代码</button>
        <button class="code-btn primary" id="code-back">🧩 切回积木继续编辑</button>
      </span>
    </div>
    <pre class="code-pre"><code id="code-content"></code></pre>
  `;
  const contentEl = panel.querySelector<HTMLElement>('#code-content')!;
  const copyBtn = panel.querySelector<HTMLButtonElement>('#code-copy')!;
  const backBtn = panel.querySelector<HTMLButtonElement>('#code-back')!;
  const segBlocks = toggleBtn.querySelector<HTMLElement>('.seg-blocks')!;
  const segCode = toggleBtn.querySelector<HTMLElement>('.seg-code')!;

  let currentCode = '';

  function refresh(): void {
    currentCode = generatePython(blocks.workspace);
    // 逐行高亮；绿旗注册行包一层可点击 span（R2：代码视图的同等触发入口）
    contentEl.innerHTML = currentCode
      .split('\n')
      .map((line) => {
        const html = highlightPython(line);
        if (/^stage\.on_flag\(/.test(line)) {
          return `<span class="code-run-line" role="button" tabindex="0" title="点击运行：与舞台绿旗完全相同（含暂停续跑）">${html}</span>`;
        }
        return html;
      })
      .join('\n');
  }

  // 事件行点击/键盘委托 → 与绿旗相同的启动逻辑
  contentEl.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('.code-run-line')) onRunFlag?.();
  });
  contentEl.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if ((ev.target as HTMLElement).closest('.code-run-line')) {
      ev.preventDefault();
      onRunFlag?.();
    }
  });

  function setMode(next: ViewMode): void {
    // R14：不做"同模式早退"——角色设置面板关闭后需重放当前模式，
    // 恢复被面板覆盖期间的 Blockly 可见性/代码面板显隐
    mode = next;
    const isCode = mode === 'code';
    if (isCode) refresh();
    panel.classList.toggle('hidden', !isCode);
    // 代码面板覆盖期间隐藏 Blockly 画布，避免焦点/滚动干扰
    blocklyHost.style.visibility = isCode ? 'hidden' : 'visible';
    segBlocks.classList.toggle('active', !isCode);
    segCode.classList.toggle('active', isCode);
    if (!isCode) blocks.resize();
  }

  toggleBtn.addEventListener('click', () => setMode(mode === 'blocks' ? 'code' : 'blocks'));
  backBtn.addEventListener('click', () => setMode('blocks'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      copyBtn.textContent = '已复制 ✓';
    } catch {
      copyBtn.textContent = '复制失败';
    }
    setTimeout(() => (copyBtn.textContent = '复制代码'), 1500);
  });

  // 积木内容变化时，若正处于代码视图则实时刷新
  blocks.onContentChange(() => {
    if (mode === 'code') refresh();
  });

  return { getMode: () => mode, setMode, refresh };
}