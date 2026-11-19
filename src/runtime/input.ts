/**
 * 共享侦测输入状态（R6；R17 扩展按键范围）：键盘 / 鼠标 / 计时器。
 *
 * 主页面装配时 attach 一次监听；桥接的侦测积木同步读取（表达式不求值暂停门）。
 * 鼠标坐标换算为舞台逻辑坐标（480×360 中心原点）；指针离开舞台保留最后位置。
 * 计时器为 performance.now 基准的秒数，"计时器归零"积木重置基准。
 *
 * 按键键名（token）是全系统唯一按键标识：积木下拉/自定义捕获（blocks/fieldKey.ts、
 * keyCapture.ts）、事件派发（bridge.dispatchKey）、侦测（key_pressed）共用同一套。
 * R17 范围：A-Z、0-9、方向键、空格、回车/退格等常见特殊键、其他可打印单键；
 * 第一版不支持组合键（Ctrl/Alt/Meta 按住其他键时不映射，也不抢占浏览器快捷键）。
 */
import { STAGE_W, STAGE_H } from '../stage/render';

export interface InputState {
  /** 当前按下的键（积木键名 token：space/up/enter/字母/数字/标点等） */
  keys: Set<string>;
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  /** 计时器基准时刻（performance.now） */
  timerStart: number;
}

/** 创建共享侦测输入状态（键鼠按下集合＋计时器起点；全页面一份） */
export function createInput(): InputState {
  return { keys: new Set(), mouseX: 0, mouseY: 0, mouseDown: false, timerStart: performance.now() };
}

/** 特殊键：浏览器 e.key → 积木键名 token（R17 扩充；Escape 保留给对话框取消，不参与） */
const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'space',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'enter',
  Backspace: 'backspace',
  Tab: 'tab',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Shift: 'shift',
  Control: 'control',
  Alt: 'alt',
  Meta: 'meta',
  CapsLock: 'capslock',
};

/** 键名 token → 中文/符号显示标签（下拉菜单与捕获提示共用） */
const KEY_LABELS: Record<string, string> = {
  space: '空格', up: '↑', down: '↓', left: '←', right: '→',
  enter: '回车', backspace: '退格', tab: 'Tab', delete: '删除', insert: '插入',
  home: 'Home', end: 'End', pageup: '上页', pagedown: '下页',
  shift: 'Shift', control: 'Ctrl', alt: 'Alt', meta: 'Win/⌘', capslock: '大写锁定',
  any: '任意',
};
export function keyLabel(token: string): string {
  return KEY_LABELS[token] ?? token;
}

/** 浏览器按键 → 积木按键键名（与事件帽积木下拉一致；R17 扩展）。
 *  组合键不映射（返回 null）：避免抢占 Ctrl+C/R 等浏览器快捷键，也避免误触发游戏。
 *  Shift+字母按基础字母处理（e.key 为大写，归一为小写，与 Scratch 一致）。 */
export function mapBrowserKey(e: KeyboardEvent): string | null {
  const k = e.key;
  if ((e.ctrlKey && k !== 'Control') || (e.altKey && k !== 'Alt') || (e.metaKey && k !== 'Meta')) {
    return null; // 组合键第一版不支持
  }
  if (SPECIAL_KEYS[k]) return SPECIAL_KEYS[k];
  if (/^[a-z]$/i.test(k)) return k.toLowerCase();
  if (/^[0-9]$/.test(k)) return k;
  // 其他可打印单键（标点等；排除空白——空格已在 SPECIAL_KEYS）
  if (k.length === 1 && !/\s/.test(k)) return k;
  return null;
}

/** 焦点在输入框/Blockly 文本编辑时不记录按键（避免打字误触发侦测） */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** 挂载全局监听（主页面装配时调用一次） */
export function attachInput(input: InputState, canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    const k = mapBrowserKey(e);
    if (k) input.keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    const k = mapBrowserKey(e);
    if (k) input.keys.delete(k);
  });
  // 窗口失焦时清空按键，避免"卡键"
  window.addEventListener('blur', () => input.keys.clear());

  const toLogical = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    input.mouseX = ((e.clientX - r.left) / r.width) * STAGE_W - STAGE_W / 2;
    input.mouseY = STAGE_H / 2 - ((e.clientY - r.top) / r.height) * STAGE_H;
  };
  canvas.addEventListener('pointermove', toLogical);
  canvas.addEventListener('pointerdown', (e) => {
    toLogical(e);
    input.mouseDown = true;
  });
  window.addEventListener('pointerup', () => {
    input.mouseDown = false;
  });
}