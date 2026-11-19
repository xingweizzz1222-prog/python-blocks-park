/**
 * Blockly 工具箱配置：九大类（R6 对照 Scratch 扩充）。
 * 运动/外观/事件/控制/运算/变量 + 新增 声音/侦测/自制积木。
 * 数值/文本输入预置 shadow 积木，拖出即可用，降低上手门槛。
 */
import { CATEGORY_COLORS } from './definitions';

/** 生成一个带默认值的数字 shadow 输入 */
const n = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
/** 生成一个带默认值的文本 shadow 输入 */
const t = (value: string) => ({ shadow: { type: 'text', fields: { TEXT: value } } });

/** 工具箱 JSON（categoryToolbox） */
export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: '运动',
      colour: CATEGORY_COLORS.motion,
      contents: [
        { kind: 'block', type: 'sc_move', inputs: { STEPS: n(10) } },
        { kind: 'block', type: 'sc_turn_right', inputs: { DEG: n(15) } },
        { kind: 'block', type: 'sc_turn_left', inputs: { DEG: n(15) } },
        { kind: 'block', type: 'sc_point', inputs: { DIR: n(90) } },
        { kind: 'block', type: 'sc_goto_xy', inputs: { X: n(0), Y: n(0) } },
        { kind: 'block', type: 'sc_glide', inputs: { SECS: n(1), X: n(0), Y: n(0) } },
        { kind: 'block', type: 'sc_goto_menu' },
        { kind: 'block', type: 'sc_point_towards' },
        { kind: 'block', type: 'sc_change_x', inputs: { DX: n(10) } },
        { kind: 'block', type: 'sc_set_x', inputs: { X: n(0) } },
        { kind: 'block', type: 'sc_change_y', inputs: { DY: n(10) } },
        { kind: 'block', type: 'sc_set_y', inputs: { Y: n(0) } },
        { kind: 'block', type: 'sc_bounce' },
      ],
    },
    {
      kind: 'category',
      name: '外观',
      colour: CATEGORY_COLORS.looks,
      contents: [
        { kind: 'block', type: 'sc_say', inputs: { TEXT: t('你好！') } },
        { kind: 'block', type: 'sc_say_secs', inputs: { TEXT: t('你好！'), SECS: n(2) } },
        { kind: 'block', type: 'sc_clear_say' },
        { kind: 'block', type: 'sc_switch_costume' },
        { kind: 'block', type: 'sc_next_costume' },
        { kind: 'block', type: 'sc_show' },
        { kind: 'block', type: 'sc_hide' },
        { kind: 'block', type: 'sc_set_size', inputs: { PCT: n(100) } },
        { kind: 'block', type: 'sc_change_size', inputs: { DELTA: n(10) } },
        { kind: 'block', type: 'sc_set_effect', inputs: { VALUE: n(25) } },
        { kind: 'block', type: 'sc_change_effect', inputs: { DELTA: n(25) } },
        { kind: 'block', type: 'sc_clear_effects' },
        { kind: 'block', type: 'sc_layer_front' },
        { kind: 'block', type: 'sc_layer_back' },
        { kind: 'block', type: 'sc_layer_forward' },
        { kind: 'block', type: 'sc_layer_backward' },
      ],
    },
    {
      kind: 'category',
      name: '声音',
      colour: CATEGORY_COLORS.sound,
      contents: [
        { kind: 'block', type: 'sc_play_sound' },
        { kind: 'block', type: 'sc_play_sound_until_done' },
        { kind: 'block', type: 'sc_stop_sounds' },
        { kind: 'block', type: 'sc_set_volume', inputs: { VOL: n(100) } },
        { kind: 'block', type: 'sc_change_volume', inputs: { DELTA: n(-10) } },
        { kind: 'block', type: 'sc_volume' },
      ],
    },
    {
      kind: 'category',
      name: '事件',
      colour: CATEGORY_COLORS.events,
      contents: [
        { kind: 'block', type: 'sc_when_flag' },
        { kind: 'block', type: 'sc_when_key' },
        { kind: 'block', type: 'sc_when_receive' },
        { kind: 'block', type: 'sc_when_touching' },
        { kind: 'block', type: 'sc_broadcast' },
      ],
    },
    {
      kind: 'category',
      name: '控制',
      colour: CATEGORY_COLORS.control,
      contents: [
        { kind: 'block', type: 'sc_wait', inputs: { SECS: n(1) } },
        { kind: 'block', type: 'sc_repeat', inputs: { TIMES: n(10) } },
        { kind: 'block', type: 'sc_forever' },
        { kind: 'block', type: 'sc_wait_until' },
        { kind: 'block', type: 'sc_repeat_until' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_ifelse' },
        { kind: 'block', type: 'sc_stop_menu' },
      ],
    },
    {
      kind: 'category',
      name: '侦测',
      colour: CATEGORY_COLORS.sensing,
      contents: [
        { kind: 'block', type: 'sc_touching_edge' },
        { kind: 'block', type: 'sc_touching_sprite' },
        { kind: 'block', type: 'sc_touching_mouse' },
        { kind: 'block', type: 'sc_touching_color', inputs: { COLOR: t('#ff0000') } },
        {
          kind: 'block',
          type: 'sc_color_touching_color',
          inputs: { C1: t('#ff0000'), C2: t('#0000ff') },
        },
        { kind: 'block', type: 'sc_key_pressed' },
        { kind: 'block', type: 'sc_mouse_down' },
        { kind: 'block', type: 'sc_mouse_x' },
        { kind: 'block', type: 'sc_mouse_y' },
        { kind: 'block', type: 'sc_distance_to' },
        { kind: 'block', type: 'sc_timer' },
        { kind: 'block', type: 'sc_reset_timer' },
      ],
    },
    {
      kind: 'category',
      name: '运算',
      colour: CATEGORY_COLORS.operators,
      contents: [
        { kind: 'block', type: 'math_number', fields: { NUM: 123 } },
        {
          kind: 'block',
          type: 'math_arithmetic',
          fields: { OP: 'ADD' },
          inputs: { A: n(1), B: n(1) },
        },
        { kind: 'block', type: 'math_modulo', inputs: { DIVIDEND: n(64), DIVISOR: n(10) } },
        { kind: 'block', type: 'math_random_int', inputs: { FROM: n(1), TO: n(10) } },
        {
          kind: 'block',
          type: 'logic_compare',
          fields: { OP: 'EQ' },
          inputs: { A: n(1), B: n(1) },
        },
        { kind: 'block', type: 'logic_operation', fields: { OP: 'AND' } },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'text', fields: { TEXT: '你好' } },
        { kind: 'block', type: 'text_join' },
        { kind: 'block', type: 'sc_letter_of', inputs: { INDEX: n(1), TEXT: t('你好') } },
        { kind: 'block', type: 'sc_length', inputs: { TEXT: t('你好') } },
        { kind: 'block', type: 'sc_round', inputs: { NUM: n(3.6) } },
        { kind: 'block', type: 'sc_math_op', inputs: { NUM: n(9) } },
      ],
    },
    {
      kind: 'category',
      name: '变量',
      colour: CATEGORY_COLORS.variables,
      // 自定义回调：内置变量积木 + R6 显示/隐藏变量挂牌（见 blocks/index.ts）
      custom: 'VARIABLE',
    },
    {
      kind: 'category',
      name: '自制积木',
      colour: CATEGORY_COLORS.custom,
      // Blockly 内置过程分类回调：制作积木按钮 + 定义/调用积木
      custom: 'PROCEDURE',
    },
  ],
};