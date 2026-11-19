/**
 * 自定义按键字段（R17）：扩展 Blockly 下拉字段，不另起按键系统。
 *
 * 菜单 = 基础按键菜单（R6 字母/数字/方向/空格/任意 ＋ R17 常见特殊键）
 *      ＋ "⌨ 自定义按键…" 入口（点击弹捕获浮层，按下即记录）。
 * 捕获/菜单外按键（如标点）以键名 token 直接存为字段值：
 * - doClassValidation_ 宽容接受任意非空 token —— 存档恢复不依赖菜单预注册
 *   （规避 R15 踩过的"载入时选项为空→值被拒→回落默认"数据丢失坑）；
 * - getOptions 动态把当前自定义值补进菜单（带中文标签），可再次选择/查看。
 * 序列化即 token 字符串，保存/恢复/导出/导入天然可用；代码生成读同一字段值。
 */
import * as Blockly from 'blockly';
import { captureKey } from './keyCapture';
import { keyLabel } from '../runtime/input';

/** 菜单里的捕获入口哨兵值（不会被保存为字段值） */
const CAPTURE_VALUE = '__capture__';

/** 基础按键菜单（R17 扩展：回车/退格/Tab/Shift/Ctrl/Alt；其余键经捕获入口记录） */
const BASE_OPTIONS: Array<[string, string]> = [
  ['空格', 'space'],
  ['↑', 'up'],
  ['↓', 'down'],
  ['←', 'left'],
  ['→', 'right'],
  ['回车', 'enter'],
  ['退格', 'backspace'],
  ['Tab', 'tab'],
  ['Shift', 'shift'],
  ['Ctrl', 'control'],
  ['Alt', 'alt'],
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((k): [string, string] => [k, k]),
  ...'0123456789'.split('').map((k): [string, string] => [k, k]),
  ['任意', 'any'],
];

/** 菜单生成器：基础菜单 ＋ 捕获入口（每次打开实时生成） */
function menuGenerator(): Array<[string, string]> {
  return [...BASE_OPTIONS, ['⌨ 自定义按键…', CAPTURE_VALUE]];
}

/** 按键字段：下拉菜单 ＋ 按下捕获 ＋ 自定义 token 宽容校验 */
export class FieldKey extends Blockly.FieldDropdown {
  constructor(value?: string) {
    // Blockly 13 构造签名为 (menuGenerator, validator?, config?)，初值经 setValue 写入
    super(menuGenerator);
    this.setValue(value ?? 'space');
  }

  /** JSON 积木定义入口（field_key 无 options 参数，菜单内置） */
  static fromJson(options: Record<string, unknown>): FieldKey {
    return new FieldKey(options.value as string | undefined);
  }

  /** 宽容校验：任意非空 token 合法（自定义捕获键/旧存档键都能恢复）；
   *  捕获入口哨兵值不得落库；缺省回落空格。 */
  protected doClassValidation_(newValue?: string): string | null {
    if (newValue === undefined) return 'space';
    if (typeof newValue !== 'string' || newValue.length === 0 || newValue === CAPTURE_VALUE) return null;
    return newValue;
  }

  /** 当前值不在基础菜单时（自定义捕获键）动态补一项，保证可见可选。
   *  强制重新生成基础菜单（不用缓存），避免历史自定义项在菜单里累积。 */
  getOptions(): Array<[string, string]> {
    const opts = super.getOptions(false) as Array<[string, string]>;
    const v = this.getValue();
    if (v && v !== CAPTURE_VALUE && !opts.some((o) => o[1] === v)) {
      opts.push([keyLabel(v), v]);
    }
    return opts;
  }

  /** 选中"自定义按键…"→ 弹捕获浮层；识别成功写回字段（触发工作区同步/自动保存） */
  protected onItemSelected_(menu: Blockly.Menu, menuItem: Blockly.MenuItem): void {
    if (menuItem.getValue() === CAPTURE_VALUE) {
      void captureKey().then((token) => {
        if (token) this.setValue(token);
      });
      return;
    }
    super.onItemSelected_(menu, menuItem);
  }
}

// 注册字段类型（definitions.ts 的 JSON 定义以 "type": "field_key" 引用）
Blockly.fieldRegistry.register('field_key', FieldKey);