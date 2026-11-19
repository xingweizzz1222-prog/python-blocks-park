/**
 * 自定义积木定义（Scratch 对照基础子集）。
 *
 * 命名约定：自定义积木一律 `sc_` 前缀，避免与 Blockly 内置积木冲突。
 * 配色向 Scratch 靠拢：运动蓝 / 外观紫 / 事件黄 / 控制橙 / 运算绿 / 变量橙红。
 * 运算、变量、如果/否则等直接复用 Blockly 内置积木（中文语言包已覆盖文案）。
 *
 * 运行时契约：所有舞台指令积木生成 `await stage.xxx(...)` 异步调用，
 * 由 runtime 模块注入的 stage 桥接对象驱动 JS 舞台（见 generators.ts 注释）。
 */
import * as Blockly from 'blockly';
import { COSTUMES } from '../stage/costumes';
import { SOUND_OPTIONS } from '../runtime/sound';
// R17：注册 field_key 自定义按键字段（副作用导入，须先于下方 JSON 定义）
import './fieldKey';

/** Scratch 风格分类色 */
export const CATEGORY_COLORS = {
  motion: '#4C97FF',
  looks: '#9966FF',
  sound: '#CF63CF',
  events: '#FFBF00',
  control: '#FFAB19',
  sensing: '#5CB1D6',
  operators: '#59C059',
  variables: '#FF8C1A',
  custom: '#FF6680',
} as const;

/** 颜色积木的实时色板图（R11）：14×14 圆角 SVG dataURL；hex 须已校验（parseHexColor） */
export function colorSwatchUrl(hex: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="${hex}" stroke="#00000033"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 精灵名提供者（R6 动态下拉：面向/碰到/距离 的精灵选项），main.ts 装配时注入 */
let spriteNamesProvider: () => string[] = () => [];
/** 注入精灵名提供者（main.ts 装配时接线，使下拉选项随舞台精灵实时变化） */
export function setSpriteNamesProvider(fn: () => string[]): void {
  spriteNamesProvider = fn;
}
/** 当前选中角色名提供者（R15：碰撞类下拉不允许选择自身），main.ts 装配时注入 */
let selfNameProvider: () => string = () => '';
/** 注入当前角色名提供者（切换选中角色时下拉选项随之排除自身） */
export function setSelfNameProvider(fn: () => string): void {
  selfNameProvider = fn;
}
/** 无头宽容开关（第四轮回归修复）：无头载入/生成期间动态下拉返回全部精灵名、
 *  不按"当前 UI 选中角色"排除自身——存档字段值必须忠实载入，与界面选中谁无关。
 *  否则为精灵 A 生成代码时若 UI 选中的是 B，A 的"碰到 B"目标会被下拉判为非法
 *  而回退成首选项（可能是 A 自身），碰撞事件链静默失效。UI 编辑态排除自身规则不变。 */
let headlessPermissive = false;
/** 设置无头宽容开关（仅 blocks 入口的无头载入/生成路径使用，try/finally 成对调用） */
export function setHeadlessPermissive(on: boolean): void {
  headlessPermissive = on;
}
/** 精灵下拉选项（至少一项，避免空下拉报错）；
 *  withMouse=false 为碰撞类（R15：排除自身，目标只能是其他角色；无头宽容态不排除） */
function spriteOptions(withMouse: boolean): Array<[string, string]> {
  const names = spriteNamesProvider();
  const self = selfNameProvider();
  const opts: Array<[string, string]> = withMouse ? [['鼠标指针', 'mouse']] : [];
  for (const n of names) {
    if (!withMouse && !headlessPermissive && n === self) continue; // 碰撞目标不允许自身
    opts.push([n, n]);
  }
  if (opts.length === 0) opts.push(['（暂无精灵）', 'none']);
  return opts;
}
/** 按键菜单已迁移至 fieldKey.ts（R17：基础菜单＋自定义捕获入口，field_key 字段内置） */
/** 特效下拉 */
const EFFECT_OPTIONS: Array<[string, string]> = [
  ['虚影', 'ghost'],
  ['亮度', 'brightness'],
  ['颜色', 'color'],
];
/** 数学函数下拉（Scratch 运算类对照） */
const MATH_OP_OPTIONS: Array<[string, string]> = [
  ['绝对值', 'abs'],
  ['向下取整', 'floor'],
  ['向上取整', 'ceil'],
  ['平方根', 'sqrt'],
  ['sin', 'sin'],
  ['cos', 'cos'],
  ['tan', 'tan'],
  ['ln', 'ln'],
  ['log', 'log'],
  ['e ^', 'exp'],
  ['10 ^', 'pow10'],
];

/** 自定义积木 JSON 定义清单（Blockly defineBlocksWithJsonArray 格式） */
const BLOCK_DEFS = [
  // ---------- 运动 ----------
  {
    type: 'sc_move',
    message0: '移动 %1 步',
    args0: [{ type: 'input_value', name: 'STEPS', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
    tooltip: '沿当前方向前进指定步数',
  },
  {
    type: 'sc_turn_right',
    message0: '右转 %1 度',
    args0: [{ type: 'input_value', name: 'DEG', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_turn_left',
    message0: '左转 %1 度',
    args0: [{ type: 'input_value', name: 'DEG', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_point',
    message0: '面向 %1 方向',
    args0: [{ type: 'input_value', name: 'DIR', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
    tooltip: 'Scratch 方向：90 为右，0 为上，-90 为左',
  },
  {
    type: 'sc_goto_xy',
    message0: '移到 x: %1 y: %2',
    args0: [
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_change_x',
    message0: '将 x 坐标增加 %1',
    args0: [{ type: 'input_value', name: 'DX', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_set_x',
    message0: '将 x 坐标设为 %1',
    args0: [{ type: 'input_value', name: 'X', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_change_y',
    message0: '将 y 坐标增加 %1',
    args0: [{ type: 'input_value', name: 'DY', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_set_y',
    message0: '将 y 坐标设为 %1',
    args0: [{ type: 'input_value', name: 'Y', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_bounce',
    message0: '碰到边缘就反弹',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_glide',
    message0: '在 %1 秒内滑行到 x: %2 y: %3',
    args0: [
      { type: 'input_value', name: 'SECS', check: 'Number' },
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
    tooltip: '匀速滑行到目标点（暂停时冻结进度）',
  },
  {
    type: 'sc_goto_menu',
    message0: '移到 %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'TARGET',
        options: [
          ['随机位置', 'random'],
          ['鼠标指针', 'mouse'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },
  {
    type: 'sc_point_towards',
    message0: '面向 %1',
    args0: [{ type: 'field_dropdown', name: 'TARGET', options: () => spriteOptions(true) }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.motion,
  },

  // ---------- 外观 ----------
  {
    type: 'sc_say',
    message0: '说 %1',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '说空字符串＝清除气泡；也可用"清除气泡"积木',
  },
  {
    type: 'sc_say_secs',
    message0: '说 %1 %2 秒',
    args0: [
      { type: 'input_value', name: 'TEXT' },
      { type: 'input_value', name: 'SECS', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '到时自动清除气泡',
  },
  {
    type: 'sc_clear_say',
    message0: '清除气泡',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '立即清除该精灵的说话气泡（R3）',
  },
  {
    type: 'sc_show',
    message0: '显示',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  {
    type: 'sc_hide',
    message0: '隐藏',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  {
    type: 'sc_set_size',
    message0: '将大小设为 %1 %',
    args0: [{ type: 'input_value', name: 'PCT', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  {
    type: 'sc_change_size',
    message0: '将大小增加 %1',
    args0: [{ type: 'input_value', name: 'DELTA', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  {
    type: 'sc_switch_costume',
    message0: '换成 %1 造型',
    args0: [
      {
        type: 'field_dropdown',
        name: 'COSTUME',
        options: COSTUMES.map((c) => [c.name, c.key] as [string, string]),
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  {
    type: 'sc_next_costume',
    message0: '下一个造型',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '在同族造型间循环切换（如 小猫 → 小猫·蓝）',
  },
  {
    type: 'sc_set_effect',
    message0: '将 %1 特效设为 %2',
    args0: [
      { type: 'field_dropdown', name: 'EFFECT', options: EFFECT_OPTIONS },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '虚影 0-100 / 亮度 -100~100 / 颜色 0-200',
  },
  {
    type: 'sc_change_effect',
    message0: '将 %1 特效增加 %2',
    args0: [
      { type: 'field_dropdown', name: 'EFFECT', options: EFFECT_OPTIONS },
      { type: 'input_value', name: 'DELTA', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  {
    type: 'sc_clear_effects',
    message0: '清除图形特效',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
  },
  // ---------- 图层（R12）：只改显示顺序，不动坐标与逻辑碰撞 ----------
  {
    type: 'sc_layer_front',
    message0: '移到最前面',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '把本精灵移到所有精灵的最上层（背景恒在最底层）',
  },
  {
    type: 'sc_layer_back',
    message0: '移到最后面',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '把本精灵移到所有精灵的最下层（仍在背景之上）',
  },
  {
    type: 'sc_layer_forward',
    message0: '前移一层',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '把本精灵往上挪一层（已在最前则不变）',
  },
  {
    type: 'sc_layer_backward',
    message0: '后移一层',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.looks,
    tooltip: '把本精灵往下挪一层（已在最后则不变）',
  },

  // ---------- 事件 ----------
  {
    type: 'sc_when_flag',
    message0: '当 ⚑ 被点击',
    hat: 'cap',
    nextStatement: null,
    colour: CATEGORY_COLORS.events,
    tooltip: '点击绿旗时运行下方脚本',
  },
  {
    type: 'sc_when_key',
    message0: '当按下 %1 键',
    args0: [
      {
        // R17：自定义按键字段（基础菜单＋"⌨ 自定义按键…"按下捕获，token 存档可恢复）
        type: 'field_key',
        name: 'KEY',
      },
    ],
    hat: 'cap',
    nextStatement: null,
    colour: CATEGORY_COLORS.events,
  },
  {
    type: 'sc_when_receive',
    message0: '当接收到 %1',
    args0: [{ type: 'field_input', name: 'MSG', text: '消息1' }],
    hat: 'cap',
    nextStatement: null,
    colour: CATEGORY_COLORS.events,
  },
  {
    // R15：碰撞事件帽——首次进入目标角色判定区触发一次（上升沿由运行时监视器判定）
    type: 'sc_when_touching',
    message0: '当碰到 %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'TARGET',
        // 碰撞目标下拉：排除自身（R15.5），随舞台精灵实时变化
        options: () => spriteOptions(false),
      },
    ],
    hat: 'cap',
    nextStatement: null,
    colour: CATEGORY_COLORS.events,
    tooltip: '首次碰到目标角色时触发一次；离开后再进入会重新触发',
  },
  {
    type: 'sc_broadcast',
    message0: '广播 %1',
    args0: [{ type: 'field_input', name: 'MSG', text: '消息1' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.events,
    tooltip: '向所有精灵发送消息，触发"当接收到"脚本',
  },

  // ---------- 控制 ----------
  {
    type: 'sc_wait',
    message0: '等待 %1 秒',
    args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.control,
  },
  {
    type: 'sc_repeat',
    message0: '重复执行 %1 次',
    args0: [{ type: 'input_value', name: 'TIMES', check: 'Number' }],
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.control,
  },
  {
    type: 'sc_forever',
    message0: '重复执行',
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.control,
    tooltip: '无限循环，直到点击停止',
  },
  {
    type: 'sc_stop',
    message0: '停止全部脚本',
    previousStatement: null,
    colour: CATEGORY_COLORS.control,
    tooltip: '立即停止所有正在运行的脚本',
  },
  {
    type: 'sc_wait_until',
    message0: '等待直到 %1',
    args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.control,
    tooltip: '条件成立前一直等待（每帧检查）',
  },
  {
    type: 'sc_repeat_until',
    message0: '重复执行直到 %1',
    args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.control,
  },
  {
    type: 'sc_stop_menu',
    message0: '停止 %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'SCOPE',
        options: [
          ['全部脚本', 'all'],
          ['这个脚本', 'this'],
        ],
      },
    ],
    previousStatement: null,
    colour: CATEGORY_COLORS.control,
    tooltip: '停止全部脚本，或仅结束当前这条脚本',
  },

  // ---------- 声音（R6：WebAudio 本地原创合成） ----------
  {
    type: 'sc_play_sound',
    message0: '播放声音 %1',
    args0: [{ type: 'field_dropdown', name: 'SOUND', options: SOUND_OPTIONS }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sound,
    tooltip: '本地合成音色，不等待播放完成',
  },
  {
    type: 'sc_play_sound_until_done',
    message0: '播放声音 %1 直到完成',
    args0: [{ type: 'field_dropdown', name: 'SOUND', options: SOUND_OPTIONS }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sound,
  },
  {
    type: 'sc_stop_sounds',
    message0: '停止所有声音',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sound,
  },
  {
    type: 'sc_set_volume',
    message0: '将音量设为 %1 %',
    args0: [{ type: 'input_value', name: 'VOL', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sound,
  },
  {
    type: 'sc_change_volume',
    message0: '将音量增加 %1',
    args0: [{ type: 'input_value', name: 'DELTA', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sound,
  },
  {
    type: 'sc_volume',
    message0: '音量',
    output: 'Number',
    colour: CATEGORY_COLORS.sound,
  },

  // ---------- 侦测（R6：Scratch 语义） ----------
  {
    type: 'sc_touching_edge',
    message0: '碰到边缘？',
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_touching_sprite',
    message0: '碰到 %1 ？',
    args0: [{ type: 'field_dropdown', name: 'TARGET', options: () => spriteOptions(false) }],
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_touching_mouse',
    message0: '碰到鼠标指针？',
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
  },
  // R11 颜色侦测：HEX 文本参数 + 实时色板（FieldImage，blocks/index.ts 随参数刷新）
  {
    type: 'sc_touching_color',
    message0: '碰到颜色 %1%2？',
    args0: [
      { type: 'field_image', name: 'SWATCH', src: colorSwatchUrl('#ff0000'), width: 14, height: 14, alt: '当前颜色' },
      { type: 'input_value', name: 'COLOR', check: 'String' },
    ],
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
    tooltip: '本角色可见像素碰到舞台（背景+其他角色，不含自己）上的指定颜色即为真；透明区域不算碰到；颜色容差约±30',
  },
  {
    type: 'sc_color_touching_color',
    message0: '颜色 %1%2 碰到颜色 %3%4？',
    args0: [
      { type: 'field_image', name: 'SWATCH1', src: colorSwatchUrl('#ff0000'), width: 14, height: 14, alt: '角色上的颜色' },
      { type: 'input_value', name: 'C1', check: 'String' },
      { type: 'field_image', name: 'SWATCH2', src: colorSwatchUrl('#0000ff'), width: 14, height: 14, alt: '舞台上的颜色' },
      { type: 'input_value', name: 'C2', check: 'String' },
    ],
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
    tooltip: '本角色上颜色1的像素碰到舞台（背景+其他角色，不含自己）上颜色2的像素即为真；可用吸色笔取色填入',
  },
  {
    type: 'sc_key_pressed',
    message0: '按下 %1 键？',
    args0: [{ type: 'field_key', name: 'KEY' }],
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_mouse_down',
    message0: '按下鼠标？',
    output: 'Boolean',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_mouse_x',
    message0: '鼠标的 x 坐标',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_mouse_y',
    message0: '鼠标的 y 坐标',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_distance_to',
    message0: '到 %1 的距离',
    args0: [{ type: 'field_dropdown', name: 'TARGET', options: () => spriteOptions(true) }],
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
  },
  {
    type: 'sc_timer',
    message0: '计时器',
    output: 'Number',
    colour: CATEGORY_COLORS.sensing,
    tooltip: '距上次"计时器归零"的秒数',
  },
  {
    type: 'sc_reset_timer',
    message0: '计时器归零',
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.sensing,
  },

  // ---------- 运算扩充（R6） ----------
  {
    type: 'sc_letter_of',
    message0: '%2 的第 %1 个字符',
    args0: [
      { type: 'input_value', name: 'INDEX', check: 'Number' },
      { type: 'input_value', name: 'TEXT' },
    ],
    output: 'String',
    colour: CATEGORY_COLORS.operators,
    tooltip: '序号从 1 开始；越界返回空字符串',
  },
  {
    type: 'sc_length',
    message0: '%1 的长度',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    output: 'Number',
    colour: CATEGORY_COLORS.operators,
  },
  {
    type: 'sc_round',
    message0: '四舍五入 %1',
    args0: [{ type: 'input_value', name: 'NUM', check: 'Number' }],
    output: 'Number',
    colour: CATEGORY_COLORS.operators,
  },
  {
    type: 'sc_math_op',
    message0: '%1 %2',
    args0: [
      { type: 'field_dropdown', name: 'OP', options: MATH_OP_OPTIONS },
      { type: 'input_value', name: 'NUM', check: 'Number' },
    ],
    output: 'Number',
    colour: CATEGORY_COLORS.operators,
    tooltip: '三角函数按角度制（与 Scratch 一致）',
  },

  // ---------- 变量监视器（R6） ----------
  {
    type: 'sc_show_var',
    message0: '显示变量 %1',
    args0: [{ type: 'field_variable', name: 'VAR', variable: '速度' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.variables,
    tooltip: '在舞台左上角挂牌实时显示变量值',
  },
  {
    type: 'sc_hide_var',
    message0: '隐藏变量 %1',
    args0: [{ type: 'field_variable', name: 'VAR', variable: '速度' }],
    previousStatement: null,
    nextStatement: null,
    colour: CATEGORY_COLORS.variables,
  },
];

/** 注册全部自定义积木（幂等：重复调用不会报错） */
export function defineCustomBlocks(): void {
  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFS);
}