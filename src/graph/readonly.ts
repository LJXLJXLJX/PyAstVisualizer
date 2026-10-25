import type { NodeChange } from '@xyflow/react';

/**
 * 画布只允许改变视图状态：坐标、选择、尺寸测量。
 * 新增、删除、替换节点的变更一律丢弃；连线完全由 AST 派生，不接收任何变更。
 */
export function filterNodeChanges<T extends NodeChange>(changes: T[]): T[] {
  return changes.filter((c) => c.type === 'position' || c.type === 'select' || c.type === 'dimensions');
}

