/**
 * 运行时错误处理（R8）：五类异常来源的统一分类、定位与编辑器内展示。
 *
 * 异常来源与分类：
 * - syntax  语法错误：生成代码无法通过 Python 编译（注册期 runPythonAsync 抛出）；
 * - runtime 运行错误：协程执行中抛出的 Python 异常（__spawn 包装器捕获回传）；
 * - bridge  桥接错误：Python ↔ JS 边界异常（Pyodide 包装为 JsException）；
 * - engine  引擎错误：Pyodide 加载/执行基础设施故障（非 Python 业务异常）；
 * - timeout 超时保护：循环看门狗判定脚本长时间未让出控制权（疑似死循环）。
 *
 * 定位：Pyodide  traceback 中的行号是"前导 + 生成代码"的整体行号，
 * 减去前导行数即得生成脚本行号；精灵名由桥接/注册上下文提供。
 * 展示：舞台底部错误卡片（类型 + 精灵 + 行号 + 消息 + 关闭按钮），
 * 持续到用户关闭或下一轮运行开始，保证错误不被静默吞掉。
 */

/** 错误类别（五类异常来源） */
export type ScriptErrorKind = 'syntax' | 'runtime' | 'bridge' | 'engine' | 'timeout';

/** 结构化错误信息（编辑器展示与日志共用） */
export interface ScriptErrorInfo {
  kind: ScriptErrorKind;
  /** 出错精灵名（注册期/协程上下文提供；引擎级错误可能缺失） */
  spriteName?: string;
  /** 人类可读的错误消息（取 traceback 末行异常说明） */
  message: string;
  /** 生成 Python 脚本中的行号（已扣除运行前导；无法定位时缺省） */
  line?: number;
}

/** 类别 → 中文标签 */
const KIND_LABEL: Record<ScriptErrorKind, string> = {
  syntax: '语法错误',
  runtime: '运行错误',
  bridge: '桥接错误',
  engine: '引擎错误',
  timeout: '超时保护',
};

/** 看门狗标记：桥接 loop_guard 抛出的超时异常按此消息识别 */
export const TIMEOUT_MARKER = 'ScriptTimeoutError';

/** 消息长度上限（卡片展示用，完整内容仍进 console） */
const MAX_MSG = 300;

/**
 * 从 Python traceback / 异常文本提取结构化错误信息。
 * @param raw 原始文本（traceback.format_exc() 或 Pyodide PythonError.message）
 * @param ctx spriteName 出错精灵；preambleLines 运行前导行数（行号换算用）
 */
export function classifyPythonError(
  raw: string,
  ctx: { spriteName?: string; preambleLines?: number } = {},
): ScriptErrorInfo {
  const text = String(raw);
  // 类别判定（超时标记优先；语法/桥接按异常名识别）
  let kind: ScriptErrorKind = 'runtime';
  if (text.includes(TIMEOUT_MARKER)) kind = 'timeout';
  else if (/SyntaxError|IndentationError|TabError/.test(text)) kind = 'syntax';
  else if (text.includes('JsException')) kind = 'bridge';

  // 行号：取 traceback 最深一层 <exec> 帧；兼容 SyntaxError 的 "(<exec>, line N)" 形式
  const frames = [...text.matchAll(/File "<exec>", line (\d+)/g)];
  const inline = text.match(/\(<exec>, line (\d+)\)/);
  const execLine = frames.length ? Number(frames[frames.length - 1][1]) : inline ? Number(inline[1]) : NaN;
  let line: number | undefined;
  if (Number.isFinite(execLine)) {
    const scriptLine = execLine - (ctx.preambleLines ?? 0);
    if (scriptLine > 0) line = scriptLine; // ≤0 表示错误在前导内，不归因于用户脚本
  }

  // 消息：traceback 末行即异常说明；无 traceback 时直接用原文
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let message = lines.length ? lines[lines.length - 1] : text;
  // 去掉 Pyodide 的 "PythonError:" 前缀重复
  message = message.replace(/^PythonError:\s*/, '');
  if (message.length > MAX_MSG) message = `${message.slice(0, MAX_MSG)}…`;

  return { kind, spriteName: ctx.spriteName, message, line };
}

/**
 * 判断原始文本是否为 Python 侧异常（含 traceback / PythonError 标记）。
 * 注册期 runPythonAsync 的失败若不是 Python 异常，则归为引擎错误。
 */
export function looksLikePythonError(raw: string): boolean {
  return /PythonError|Traceback|File "<exec>"|SyntaxError/.test(raw);
}

/** 错误卡片 DOM 类名（样式见 styles/runtime.css） */
const CARD_CLASS = 'runtime-error-card';

/** 清除舞台上的错误卡片（新一轮运行/重置时调用） */
export function clearErrorCard(host: HTMLElement): void {
  host.querySelector(`.${CARD_CLASS}`)?.remove();
}

/**
 * 在舞台底部展示结构化错误卡片（替换旧卡片；可手动关闭）。
 * 完整错误同时写入 console，便于排查。
 */
export function showErrorCard(host: HTMLElement, info: ScriptErrorInfo): void {
  clearErrorCard(host);
  console.error('[runtime] 脚本错误', info);
  const card = document.createElement('div');
  card.className = CARD_CLASS;

  const title = document.createElement('div');
  title.className = 'runtime-error-card-title';
  title.textContent = `⚠ 脚本出错 · ${KIND_LABEL[info.kind]}`;
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'runtime-error-card-meta';
  const parts: string[] = [];
  if (info.spriteName) parts.push(`精灵：${info.spriteName}`);
  if (info.line) parts.push(`位置：Python 脚本第 ${info.line} 行`);
  meta.textContent = parts.join('　');
  if (parts.length) card.appendChild(meta);

  const msg = document.createElement('div');
  msg.className = 'runtime-error-card-msg';
  msg.textContent = info.message;
  card.appendChild(msg);

  const close = document.createElement('button');
  close.className = 'runtime-error-card-close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭错误提示');
  close.addEventListener('click', () => card.remove());
  card.appendChild(close);

  host.appendChild(card);
}