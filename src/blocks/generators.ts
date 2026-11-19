/**
 * Python 代码生成：自定义积木 → Python 语句 + 整份脚本装配。
 *
 * 运行时契约（与 runtime/bridge 模块约定）：
 * - 生成的代码在 async 函数体内执行，`stage` 为注入的舞台桥接对象；
 * - 所有舞台指令均为异步方法，用 `await` 调用，桥接层借此实现动画与节流；
 * - 事件帽积木装配为 `async def _script_N()` 并通过 stage.on_flag / on_key /
 *   on_message 注册；未连接事件帽的散块不注册（与 Scratch 行为一致）。
 * - stage.tick() 在每轮循环末尾让出控制权，防止死循环卡死页面；
 * - stage.loop_guard() 在每轮循环体开头做同步看门狗检查（R8 运行保护）。
 */
import * as Blockly from 'blockly';
import { pythonGenerator, Order } from 'blockly/python';

/** definitions_ 声明为 protected，但运行时为公开属性；按结构类型读写（收集 import/辅助函数） */
const genDefs = pythonGenerator as unknown as { definitions_: Record<string, string> };
/** nameDB_ 在 init() 后必然存在（生成期调用），类型上为可选，这里断言收窄 */
const nameDB = (): Blockly.Names => pythonGenerator.nameDB_ as Blockly.Names;
/** 工作区全部变量模型（Blockly v13 经 variableMap 访问） */
const allVariables = (ws: Blockly.Workspace) => ws.getVariableMap().getAllVariables();

/** 可读标识符：Python3 标识符允许中文等 Unicode 字母，保留原名；
 *  仅把空白/符号替换为下划线、数字开头加前缀。
 *  覆盖 Blockly Names 默认的 encodeURI _hex 转义（否则"得分"变 _E5_BE_97…，启蒙可读性差） */
function readableName(name: string): string {
  let s = (name || 'unnamed').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '_');
  if (/^[0-9]/.test(s)) s = `my_${s}`;
  return s || 'unnamed';
}

/** 取数值输入的代码，缺省回退（积木输入为空时保证生成代码仍可运行） */
function num(block: Blockly.Block, name: string, fallback = '0'): string {
  return pythonGenerator.valueToCode(block, name, Order.NONE) || fallback;
}

/** 取文本输入的代码（Blockly 文本积木自带引号），缺省为空字符串 */
function text(block: Blockly.Block, name: string): string {
  return pythonGenerator.valueToCode(block, name, Order.NONE) || "''";
}

/** 取语句分支代码；空分支补 pass，保证 Python 语法合法 */
function branch(block: Blockly.Block, name: string): string {
  return pythonGenerator.statementToCode(block, name) || `${pythonGenerator.INDENT}pass\n`;
}

/** 注册全部自定义积木的 Python 生成器 */
export function registerGenerators(): void {
  const g = pythonGenerator.forBlock;

  // ---------- 运动 ----------
  g['sc_move'] = (b) => `await stage.move(${num(b, 'STEPS', '10')})\n`;
  g['sc_turn_right'] = (b) => `await stage.turn_right(${num(b, 'DEG', '15')})\n`;
  g['sc_turn_left'] = (b) => `await stage.turn_left(${num(b, 'DEG', '15')})\n`;
  g['sc_point'] = (b) => `await stage.point_dir(${num(b, 'DIR', '90')})\n`;
  g['sc_goto_xy'] = (b) => `await stage.goto_xy(${num(b, 'X')}, ${num(b, 'Y')})\n`;
  g['sc_change_x'] = (b) => `await stage.change_x(${num(b, 'DX', '10')})\n`;
  g['sc_set_x'] = (b) => `await stage.set_x(${num(b, 'X')})\n`;
  g['sc_change_y'] = (b) => `await stage.change_y(${num(b, 'DY', '10')})\n`;
  g['sc_set_y'] = (b) => `await stage.set_y(${num(b, 'Y')})\n`;
  g['sc_bounce'] = () => `await stage.bounce()\n`;
  g['sc_glide'] = (b) => `await stage.glide(${num(b, 'SECS', '1')}, ${num(b, 'X')}, ${num(b, 'Y')})\n`;
  g['sc_goto_menu'] = (b) =>
    `await stage.goto_menu(${pythonGenerator.quote_(String(b.getFieldValue('TARGET') ?? 'random'))})\n`;
  g['sc_point_towards'] = (b) =>
    `await stage.point_towards(${pythonGenerator.quote_(String(b.getFieldValue('TARGET') ?? 'mouse'))})\n`;

  // ---------- 外观 ----------
  g['sc_say'] = (b) => `await stage.say(${text(b, 'TEXT')})\n`;
  g['sc_say_secs'] = (b) => `await stage.say_for(${text(b, 'TEXT')}, ${num(b, 'SECS', '2')})\n`;
  g['sc_clear_say'] = () => `await stage.clear_say()\n`;
  g['sc_show'] = () => `await stage.show()\n`;
  g['sc_hide'] = () => `await stage.hide()\n`;
  g['sc_set_size'] = (b) => `await stage.set_size(${num(b, 'PCT', '100')})\n`;
  g['sc_change_size'] = (b) => `await stage.change_size(${num(b, 'DELTA', '10')})\n`;
  g['sc_switch_costume'] = (b) =>
    `await stage.switch_costume(${pythonGenerator.quote_(String(b.getFieldValue('COSTUME') ?? 'cat'))})\n`;
  g['sc_next_costume'] = () => `await stage.next_costume()\n`;
  g['sc_set_effect'] = (b) =>
    `await stage.set_effect(${pythonGenerator.quote_(String(b.getFieldValue('EFFECT') ?? 'ghost'))}, ${num(b, 'VALUE')})\n`;
  g['sc_change_effect'] = (b) =>
    `await stage.change_effect(${pythonGenerator.quote_(String(b.getFieldValue('EFFECT') ?? 'ghost'))}, ${num(b, 'DELTA', '10')})\n`;
  g['sc_clear_effects'] = () => `await stage.clear_effects()\n`;
  // 图层四操作（R12）
  g['sc_layer_front'] = () => `await stage.layer_front()\n`;
  g['sc_layer_back'] = () => `await stage.layer_back()\n`;
  g['sc_layer_forward'] = () => `await stage.layer_forward()\n`;
  g['sc_layer_backward'] = () => `await stage.layer_backward()\n`;

  // ---------- 声音（R6） ----------
  g['sc_play_sound'] = (b) =>
    `await stage.play_sound(${pythonGenerator.quote_(String(b.getFieldValue('SOUND') ?? 'pop'))})\n`;
  g['sc_play_sound_until_done'] = (b) =>
    `await stage.play_sound_until_done(${pythonGenerator.quote_(String(b.getFieldValue('SOUND') ?? 'pop'))})\n`;
  g['sc_stop_sounds'] = () => `await stage.stop_sounds()\n`;
  g['sc_set_volume'] = (b) => `await stage.set_volume(${num(b, 'VOL', '100')})\n`;
  g['sc_change_volume'] = (b) => `await stage.change_volume(${num(b, 'DELTA', '-10')})\n`;
  g['sc_volume'] = () => ['stage.volume()', Order.ATOMIC];

  // ---------- 侦测（R6：同步表达式） ----------
  g['sc_touching_edge'] = () => ['stage.touching_edge()', Order.ATOMIC];
  g['sc_touching_sprite'] = (b) => [
    `stage.touching_sprite(${pythonGenerator.quote_(String(b.getFieldValue('TARGET') ?? ''))})`,
    Order.ATOMIC,
  ];
  g['sc_touching_mouse'] = () => ['stage.touching_mouse()', Order.ATOMIC];
  // R11 颜色侦测：HEX 以字符串传桥接，容差匹配在 sensing 模块（同步表达式）
  g['sc_touching_color'] = (b) => [`stage.touching_color(${text(b, 'COLOR')})`, Order.ATOMIC];
  g['sc_color_touching_color'] = (b) => [
    `stage.color_touching_color(${text(b, 'C1')}, ${text(b, 'C2')})`,
    Order.ATOMIC,
  ];
  g['sc_key_pressed'] = (b) => [
    `stage.key_pressed(${pythonGenerator.quote_(String(b.getFieldValue('KEY') ?? 'space'))})`,
    Order.ATOMIC,
  ];
  g['sc_mouse_down'] = () => ['stage.mouse_down()', Order.ATOMIC];
  g['sc_mouse_x'] = () => ['stage.mouse_x()', Order.ATOMIC];
  g['sc_mouse_y'] = () => ['stage.mouse_y()', Order.ATOMIC];
  g['sc_distance_to'] = (b) => [
    `stage.distance_to(${pythonGenerator.quote_(String(b.getFieldValue('TARGET') ?? 'mouse'))})`,
    Order.ATOMIC,
  ];
  g['sc_timer'] = () => ['stage.timer()', Order.ATOMIC];
  g['sc_reset_timer'] = () => `await stage.reset_timer()\n`;

  // ---------- 事件 ----------
  // 帽积木本身不生成语句，由 generatePython 装配为 async 函数并注册
  g['sc_when_flag'] = () => '';
  g['sc_when_key'] = () => '';
  g['sc_when_receive'] = () => '';
  g['sc_broadcast'] = (b) =>
    `await stage.broadcast(${pythonGenerator.quote_(String(b.getFieldValue('MSG') ?? '消息1'))})\n`;

  // ---------- 控制 ----------
  // R8 运行保护：每轮循环体开头插入同步看门狗 stage.loop_guard()，
  // 连续执行超预算未让出控制权即抛超时异常，防止死循环冻结编辑器；
  // 循环末尾的 tick() 节流保留（正常循环不会触发看门狗）。
  g['sc_wait'] = (b) => `await stage.wait(${num(b, 'SECS', '1')})\n`;
  g['sc_repeat'] = (b) => {
    const times = num(b, 'TIMES', '10');
    const body = branch(b, 'DO');
    return `for _i in range(int(${times})):\n${pythonGenerator.INDENT}stage.loop_guard()\n${body}${pythonGenerator.INDENT}await stage.tick()\n`;
  };
  g['sc_forever'] = (b) => {
    const body = branch(b, 'DO');
    return `while True:\n${pythonGenerator.INDENT}stage.loop_guard()\n${body}${pythonGenerator.INDENT}await stage.tick()\n`;
  };
  // stop_all 在桥接层抛出停止异常，终止全部脚本
  g['sc_stop'] = () => `stage.stop_all()\n`;
  g['sc_wait_until'] = (b) => {
    const cond = pythonGenerator.valueToCode(b, 'COND', Order.NONE) || 'False';
    return `while not (${cond}):\n${pythonGenerator.INDENT}stage.loop_guard()\n${pythonGenerator.INDENT}await stage.tick()\n`;
  };
  g['sc_repeat_until'] = (b) => {
    const cond = pythonGenerator.valueToCode(b, 'COND', Order.NONE) || 'False';
    const body = branch(b, 'DO');
    return `while not (${cond}):\n${pythonGenerator.INDENT}stage.loop_guard()\n${body}${pythonGenerator.INDENT}await stage.tick()\n`;
  };
  g['sc_stop_menu'] = (b) =>
    String(b.getFieldValue('SCOPE')) === 'this' ? `return\n` : `stage.stop_all()\n`;

  // ---------- 运算扩充（R6） ----------
  // 连接文本：Scratch 数字显示不带多余 .0、布尔为 true/false（Python str 默认 3.0/True）
  g['text_join'] = (b) => {
    const count = (b as unknown as { itemCount_?: number }).itemCount_ ?? 2;
    const items: string[] = [];
    for (let i = 0; i < count; i++) {
      items.push(pythonGenerator.valueToCode(b, `ADD${i}`, Order.NONE) || "''");
    }
    genDefs.definitions_['sc_str'] =
      'def _scratch_str(x):\n  if isinstance(x, bool):\n    return "true" if x else "false"\n  if isinstance(x, float) and x.is_integer():\n    return str(int(x))\n  return str(x)\n';
    return [`''.join([_scratch_str(x) for x in [${items.join(', ')}]])`, Order.ATOMIC];
  };
  g['sc_letter_of'] = (b) => {
    genDefs.definitions_['sc_letter_of'] =
      'def _letter_of(s, i):\n  s = str(s)\n  i = int(i)\n  return s[i - 1] if 1 <= i <= len(s) else ""\n';
    return [`_letter_of(${text(b, 'TEXT')}, ${num(b, 'INDEX', '1')})`, Order.ATOMIC];
  };
  g['sc_length'] = (b) => [`len(str(${text(b, 'TEXT')}))`, Order.ATOMIC];
  g['sc_round'] = (b) => {
    genDefs.definitions_['import_math'] = 'import math';
    genDefs.definitions_['sc_round'] = 'def _round(n):\n  return math.floor(float(n) + 0.5)\n';
    return [`_round(${num(b, 'NUM')})`, Order.ATOMIC];
  };
  g['sc_math_op'] = (b) => {
    const op = String(b.getFieldValue('OP') ?? 'abs');
    const x = num(b, 'NUM');
    const trig = (fn: string): [string, number] => {
      genDefs.definitions_['import_math'] = 'import math';
      return [`math.${fn}(math.radians(${x}))`, Order.ATOMIC];
    };
    switch (op) {
      case 'floor':
      case 'ceil':
      case 'sqrt':
      case 'exp':
        genDefs.definitions_['import_math'] = 'import math';
        return [`math.${op}(${x})`, Order.ATOMIC];
      case 'ln':
        genDefs.definitions_['import_math'] = 'import math';
        return [`math.log(${x})`, Order.ATOMIC];
      case 'log':
        genDefs.definitions_['import_math'] = 'import math';
        return [`math.log10(${x})`, Order.ATOMIC];
      case 'sin':
        return trig('sin');
      case 'cos':
        return trig('cos');
      case 'tan':
        return trig('tan');
      case 'pow10':
        return [`(10 ** (${x}))`, Order.ATOMIC];
      case 'abs':
      default:
        return [`abs(${x})`, Order.ATOMIC];
    }
  };

  // ---------- 变量监视器（R6） ----------
  const varName = (b: Blockly.Block): string =>
    pythonGenerator.quote_(
      nameDB().getName(String(b.getFieldValue('VAR')), Blockly.Names.NameType.VARIABLE),
    );
  g['sc_show_var'] = (b) => `stage.monitor_on(${varName(b)})\n`;
  g['sc_hide_var'] = (b) => `stage.monitor_off(${varName(b)})\n`;

  // ---------- 自制积木（R6：Blockly 内置 procedures，覆写为 async） ----------
  const procName = (b: Blockly.Block): string =>
    nameDB().getName(String(b.getFieldValue('NAME')), Blockly.Names.NameType.PROCEDURE);
  const procArgs = (b: Blockly.Block): string[] =>
    procArgIds(b).map((v) => nameDB().getName(v, Blockly.Names.NameType.VARIABLE));
  /** 参数 id 列表：Blockly v13 过程积木经 getVarModels() 暴露参数变量模型 */
  const procArgIds = (b: Blockly.Block): string[] =>
    (b as unknown as { getVarModels?: () => Array<{ getId(): string }> })
      .getVarModels?.()
      .map((v) => v.getId()) ?? [];
  /** 函数体内的 global 声明：Scratch 变量为精灵级全局，Python 需显式声明；
   *  排除本函数参数（参数是局部名，声明 global 会语法冲突） */
  const globalDecl = (b: Blockly.Block, excludeIds: string[]): string => {
    const exclude = new Set(excludeIds);
    const names = [
      ...new Set(
        allVariables(b.workspace)
          .filter((v) => !exclude.has(v.getId()))
          .map((v) => nameDB().getName(v.getId(), Blockly.Names.NameType.VARIABLE)),
      ),
    ];
    return names.length ? `${pythonGenerator.INDENT}global ${names.join(', ')}\n` : '';
  };
  g['procedures_defnoreturn'] = (b) => {
    const body = pythonGenerator.statementToCode(b, 'STACK') || `${pythonGenerator.INDENT}pass\n`;
    return `async def ${procName(b)}(${procArgs(b).join(', ')}):\n${globalDecl(b, procArgIds(b))}${body}\n`;
  };
  g['procedures_defreturn'] = (b) => {
    const body = pythonGenerator.statementToCode(b, 'STACK') || '';
    const ret = pythonGenerator.valueToCode(b, 'RETURN', Order.NONE) || 'None';
    return `async def ${procName(b)}(${procArgs(b).join(', ')}):\n${globalDecl(b, procArgIds(b))}${body}${pythonGenerator.INDENT}return ${ret}\n\n`;
  };
  g['procedures_callnoreturn'] = (b) => {
    const args = procArgIds(b).map((_, i) => pythonGenerator.valueToCode(b, `ARG${i}`, Order.NONE) || 'None');
    return `await ${procName(b)}(${args.join(', ')})\n`;
  };
  g['procedures_callreturn'] = (b) => {
    const args = procArgIds(b).map((_, i) => pythonGenerator.valueToCode(b, `ARG${i}`, Order.NONE) || 'None');
    return [`(await ${procName(b)}(${args.join(', ')}))`, Order.ATOMIC];
  };
}

/** 给整段代码增加一级缩进（用于装配 async 函数体） */
function indent(code: string): string {
  return code
    .split('\n')
    .map((line) => (line.trim() ? pythonGenerator.INDENT + line : line))
    .join('\n');
}

/** 事件帽类型 → 注册语句模板（按函数名注册，派发时从 globals 取函数，
 *  避免 Python 函数跨语言传递时的代理生命周期问题） */
function registrationFor(hat: Blockly.Block, fnName: string): string | null {
  const quoted = pythonGenerator.quote_(fnName);
  switch (hat.type) {
    case 'sc_when_flag':
      return `stage.on_flag(${quoted})`;
    case 'sc_when_key':
      return `stage.on_key(${pythonGenerator.quote_(String(hat.getFieldValue('KEY') ?? 'space'))}, ${quoted})`;
    case 'sc_when_receive':
      return `stage.on_message(${pythonGenerator.quote_(String(hat.getFieldValue('MSG') ?? '消息1'))}, ${quoted})`;
    case 'sc_when_touching':
      // R15：碰撞事件注册——运行时监视器判定上升沿后按目标名派发
      return `stage.on_touching(${pythonGenerator.quote_(String(hat.getFieldValue('TARGET') ?? ''))}, ${quoted})`;
    default:
      return null;
  }
}

/**
 * 把工作区全部积木装配为一份可执行的 Python 程序文本。
 * 积木是唯一事实来源；本函数纯函数式输出，不修改工作区。
 */
export function generatePython(workspace: Blockly.Workspace): string {
  // 初始化变量名数据库等生成器状态
  pythonGenerator.init(workspace);
  // 中文变量/过程名保持可读（重名单由 getName 自动加后缀，保留字仍被避开）
  const db = pythonGenerator.nameDB_ as unknown as { safeName?: (n: string) => string };
  if (db) db.safeName = readableName;

  const lines: string[] = [
    '# 由积木自动生成的 Python 代码（只读，切回"积木"视图继续编辑）',
    '# stage 是舞台桥接对象：每条指令都会驱动右侧舞台上的精灵',
    '',
  ];

  const topBlocks = workspace.getTopBlocks(true);
  let scriptIndex = 0;
  let looseCount = 0;

  // 变量全局化（R6）：顶层先置 0（Scratch 变量默认值），脚本函数内声明 global，
  // 使"显示变量"挂牌与跨脚本读写拿到同一份精灵级变量
  const varNames = [
    ...new Set(
      allVariables(workspace).map((v) => nameDB().getName(v.getId(), Blockly.Names.NameType.VARIABLE)),
    ),
  ];
  for (const name of varNames) lines.push(`${name} = 0`);
  if (varNames.length) lines.push('');
  const scriptGlobal = varNames.length ? `global ${varNames.join(', ')}\n` : '';

  // 自制积木定义（R6）：先于事件脚本输出 async def，供脚本内 await 调用
  for (const top of topBlocks) {
    if (top.type === 'procedures_defnoreturn' || top.type === 'procedures_defreturn') {
      lines.push(String(pythonGenerator.blockToCode(top)));
    }
  }

  for (const top of topBlocks) {
    if (top.type === 'procedures_defnoreturn' || top.type === 'procedures_defreturn') continue;
    const fnName = `_script_${scriptIndex}`;
    const registration = registrationFor(top, fnName);
    if (registration === null) {
      looseCount++;
      continue; // 散块不运行，最后统一提示
    }
    // 帽积木之后的整条积木链 → 函数体（首行 global 声明保证变量精灵级共享）
    const bodyCode = pythonGenerator.blockToCode(top.getNextBlock()) as string;
    const body = indent(scriptGlobal + bodyCode) || `${pythonGenerator.INDENT}pass\n`;
    lines.push(`async def ${fnName}():`, body.trimEnd(), registration, '');
    scriptIndex++;
  }

  if (scriptIndex === 0) {
    lines.push('# 还没有可运行的脚本：从"事件"类拖一个"当 ⚑ 被点击"积木开始吧');
  }
  if (looseCount > 0) {
    lines.push(`# 提示：有 ${looseCount} 组积木未连接事件帽，不会被运行`);
  }
  // 内置积木（math_arithmetic 幂运算 / math_modulo / math_random_int 等）会在
  // 生成期声明 import 依赖（definitions_）；统一收集置顶，避免运行时 NameError。
  // 类型声明为 protected，但运行时为公开属性，这里按结构类型读取。
  // 过滤两类噪声：内置变量声明"xx = None"（上面已按 Scratch 语义统一置 0，避免重复初始化）；
  // 以及 Blockly 无变量时留下的空占位 definitions_['variables'] = ''（否则代码顶部多出空行）。
  const defs = (pythonGenerator as unknown as { definitions_?: Record<string, string> }).definitions_;
  const imports = Object.values(defs || {}).filter((d) => d.trim() !== '' && !/= None$/.test(d.trim()));
  if (imports.length > 0) lines.splice(3, 0, ...imports, '');
  return lines.join('\n');
}