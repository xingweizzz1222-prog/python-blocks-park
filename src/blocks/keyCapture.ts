/**
 * 自定义按键捕获浮层（R17）：点击积木按键输入区选"自定义按键…"后弹出。
 *
 * 交互：提示"按下要设置的按键"→ 用户按下任意支持的单键 → 自动识别为键名 token
 * 并回传（Promise resolve）→ 浮层关闭，字段保存该 token。Esc / 取消按钮 → null。
 *
 * 抢占保护（R17.4）：监听挂在 window **捕获阶段**并 stopPropagation + preventDefault，
 * 先于游戏控制监听器（runtime/index.ts 的 bubble 阶段 keydown）与侦测输入
 * （input.ts attachInput）执行——捕获期间的按键不会触发游戏事件、不会进入侦测集合、
 * 不会滚动页面；也不影响 Blockly 编辑（浮层期间键盘事件全部被拦截）。
 * 不支持的键（F 功能键/组合键等）给出提示并继续等待，不关闭浮层。
 */
import '../styles/keyCapture.css';
import { mapBrowserKey, keyLabel } from '../runtime/input';

/** 同一时刻只允许一个捕获浮层；重复打开先按取消关闭旧的 */
let activeCleanup: (() => void) | null = null;

/**
 * 弹出按键捕获浮层。
 * @returns 识别出的键名 token；用户取消返回 null
 */
export function captureKey(): Promise<string | null> {
  if (activeCleanup) activeCleanup();

  return new Promise<string | null>((resolve) => {
    let settled = false;

    // ---------- DOM ----------
    const overlay = document.createElement('div');
    overlay.className = 'kc-overlay';
    const card = document.createElement('div');
    card.className = 'kc-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', '自定义按键');
    const title = document.createElement('div');
    title.className = 'kc-title';
    title.textContent = '⌨ 按下要设置的按键';
    const sub = document.createElement('div');
    sub.className = 'kc-sub';
    sub.textContent = '支持字母、数字、方向键、空格与回车/退格等常见单键；暂不支持组合键';
    const hint = document.createElement('div');
    hint.className = 'kc-hint';
    hint.textContent = '等待按键…（Esc 取消）';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'kc-cancel';
    cancelBtn.textContent = '取消';
    card.append(title, sub, hint, cancelBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // ---------- 收尾 ----------
    function cleanup(): void {
      finish(null);
    }
    function finish(token: string | null): void {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      overlay.remove();
      if (activeCleanup === cleanup) activeCleanup = null;
      resolve(token);
    }
    activeCleanup = cleanup;
    cancelBtn.addEventListener('click', () => finish(null));
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) finish(null); });

    // ---------- 捕获阶段监听（先于游戏/侦测/Blockly 的一切键盘处理） ----------
    function onKeyDown(e: KeyboardEvent): void {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'Escape') { finish(null); return; } // Esc 保留为取消手势
      if (e.repeat) return; // 长按重复不重复识别
      const token = mapBrowserKey(e);
      if (!token) {
        hint.textContent = '该按键不支持（或为组合键），请换一个单键';
        hint.classList.add('is-warn');
        return;
      }
      hint.classList.remove('is-warn');
      hint.textContent = `已识别：${keyLabel(token)}`;
      finish(token);
    }
    /** keyup 一并拦截：捕获期间的抬起不进入侦测集合 */
    function onKeyUp(e: KeyboardEvent): void {
      e.stopPropagation();
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
  });
}