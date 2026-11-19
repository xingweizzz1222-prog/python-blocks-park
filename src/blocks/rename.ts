/**
 * 角色改名同步（R14）：遍历 Blockly 序列化状态，把引用旧角色名的下拉字段改为新名。
 *
 * 设计说明：内部精灵 ID 稳定不变，只有显示名同步——脚本里存的是名字字符串
 * （field_dropdown 的 value），因此改名必须遍历全部精灵的工作区状态改写 TARGET 字段，
 * 否则已有脚本的"碰到/面向/距离"引用会指向不存在的名字。
 *
 * 纯函数：不触碰 Blockly 实例，直接改 JSON 状态（含嵌套 inputs/next/shadow），
 * 供 main.ts 在保存设置时对每个工作区调用；当前激活工作区改完后重新载入。
 */

/** 引用角色名的积木类型 → 字段名（R15："当碰到角色"事件帽同用 TARGET 字段） */
const TARGET_FIELDS: Record<string, string> = {
  sc_touching_sprite: 'TARGET',
  sc_when_touching: 'TARGET',
  sc_point_towards: 'TARGET',
  sc_distance_to: 'TARGET',
};

/** 递归遍历序列化积木节点（block 结构：inputs/next/extraState 均可能嵌套） */
function walkBlock(node: unknown, visit: (b: Record<string, unknown>) => void): void {
  if (typeof node !== 'object' || node === null) return;
  const b = node as Record<string, unknown>;
  if (typeof b.type === 'string') visit(b);
  // inputs：每个输入口可能挂 shadow 与 block
  if (typeof b.inputs === 'object' && b.inputs !== null) {
    for (const input of Object.values(b.inputs as Record<string, unknown>)) {
      if (typeof input !== 'object' || input === null) continue;
      const slot = input as Record<string, unknown>;
      walkBlock(slot.shadow, visit);
      walkBlock(slot.block, visit);
    }
  }
  // next：后续积木链
  if (typeof b.next === 'object' && b.next !== null) {
    walkBlock((b.next as Record<string, unknown>).block, visit);
  }
}

/**
 * 把工作区状态中所有引用 oldName 的角色名字段改为 newName。
 * @returns 是否有修改（无修改时调用方可跳过重载，保留编辑状态）
 */
export function renameSpriteInState(
  state: Record<string, unknown>,
  oldName: string,
  newName: string,
): boolean {
  if (oldName === newName) return false;
  let changed = false;
  const container = state.blocks;
  if (typeof container !== 'object' || container === null) return false;
  const top = (container as Record<string, unknown>).blocks;
  if (!Array.isArray(top)) return false;
  for (const node of top) {
    walkBlock(node, (b) => {
      const field = TARGET_FIELDS[b.type as string];
      if (!field) return;
      const fields = b.fields;
      if (typeof fields !== 'object' || fields === null) return;
      const f = fields as Record<string, unknown>;
      if (f[field] === oldName) {
        f[field] = newName;
        changed = true;
      }
    });
  }
  return changed;
}