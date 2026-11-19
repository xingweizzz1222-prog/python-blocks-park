/**
 * Pyodide 加载器：加载本地打包的 Pyodide（public/pyodide/，国内可访问）。
 *
 * - 二期第二批起由启动初始化管线前置调用（silent 模式：无舞台覆盖层，
 *   失败直接抛给管线走启动失败态）；进入编辑器前完成准备（清单第十四节）。
 * - 单例缓存：前置完成后绿旗 run() 再调用直接命中缓存，不再出现覆盖层，
 *   首旗零等待；舞台"转圈渐变圆"＋失败重试 UI 保留为兜底（非 silent 调用路径）。
 * - 通过 UMD 版 pyodide.js 注入全局 loadPyodide，indexURL 指向站点自带目录，
 *   不依赖任何境外 CDN。
 */
import '../styles/runtime.css';

/** 本项目用到的 Pyodide 最小接口（避免依赖包类型导出路径） */
export interface PyodideLike {
  runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>;
  toPy(value: unknown): unknown;
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string; stdout?: (s: string) => void; stderr?: (s: string) => void }) => Promise<PyodideLike>;
  }
}

let loadPromise: Promise<PyodideLike> | null = null;

/** 动态插入 script 标签加载 UMD 版 pyodide.js */
function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove(); // 清理失败节点，重试时重新注入，避免残留死标签
      reject(new Error(`无法加载 ${url}`));
    };
    document.head.appendChild(s);
  });
}

/** HTML 转义（错误详情插入 innerHTML 前防注入） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 创建"一直转圈的渐变圆"加载覆盖层（占位方案，最终开幕动画待用户确定） */
function createLoadingOverlay(host: HTMLElement): { destroy(): void; fail(msg: string, retry: () => void): void } {
  // 重试/再次绿旗时清掉上一轮残留的覆盖层（失败卡片或旧转圈），避免叠加
  host.querySelectorAll('.runtime-overlay').forEach((el) => el.remove());
  const overlay = document.createElement('div');
  overlay.className = 'runtime-overlay';
  overlay.innerHTML = `
    <div class="gradient-spinner" aria-label="加载中"></div>
    <div class="runtime-overlay-text">正在加载 Python 运行时…<br><small>首次加载约需几秒，请稍候</small></div>
  `;
  host.appendChild(overlay);
  return {
    destroy() {
      overlay.remove();
    },
    fail(msg, retry) {
      // R13：明确「Pyodide 加载失败」＋检查网络环境提示＋重试入口；
      // 覆盖层只罩舞台，Blockly 编辑/代码视图/保存不受影响
      overlay.innerHTML = `
        <div class="runtime-error">⚠ Pyodide 加载失败<br><small>请检查网络环境后重试（运行时文件由站点本地提供，断网或文件缺失都会导致失败）</small></div>
        <div class="runtime-error-detail">${escapeHtml(msg)}</div>
        <button class="runtime-retry">重试</button>
      `;
      overlay.querySelector('.runtime-retry')!.addEventListener('click', () => {
        overlay.remove();
        retry();
      });
    },
  };
}

/**
 * 加载 Pyodide（单例缓存）。
 * @param host 加载动画覆盖的舞台容器（silent 模式下不使用）
 * @param opts silent=true：启动初始化管线前置调用——不创建舞台覆盖层，
 *   失败直接抛给调用方（走启动失败态＋重试）；缺省 false 保留舞台转圈/重试兜底路径。
 *   单例缓存命中时（前置已完成）直接返回缓存 Promise，不创建任何覆盖层 → 首旗零等待。
 */
export function loadPyodideRuntime(host: HTMLElement, opts?: { silent?: boolean }): Promise<PyodideLike> {
  if (loadPromise) return loadPromise;

  // silent：空操作覆盖层（失败 UI 不挂舞台，由启动画面统一展示真实原因）
  const overlay = opts?.silent
    ? { destroy(): void {}, fail(_msg: string, _retry: () => void): void {} }
    : createLoadingOverlay(host);
  // indexURL 相对当前页面解析，兼容子路径部署
  const indexURL = new URL('pyodide/', document.baseURI).href;

  loadPromise = (async () => {
    try {
      if (!window.loadPyodide) {
        await injectScript(new URL('pyodide.js', indexURL).href);
      }
      if (!window.loadPyodide) throw new Error('pyodide.js 未导出 loadPyodide');
      const py = await window.loadPyodide({
        indexURL,
        stdout: (s) => console.log('[python]', s),
        stderr: (s) => console.warn('[python]', s),
      });
      overlay.destroy();
      return py;
    } catch (err) {
      // 失败后清除缓存，允许重试
      loadPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      overlay.fail(msg, () => {
        loadPyodideRuntime(host).catch(() => undefined);
      });
      throw err;
    }
  })();

  return loadPromise;
}