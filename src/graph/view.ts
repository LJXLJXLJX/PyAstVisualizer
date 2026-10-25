import type { Node } from '@xyflow/react';
import { layoutNodes, placeMissing, type XY } from './layout';
import { computeVisible, type GraphModel, type GraphNode } from './model';

/**
 * 视图状态：坐标、折叠、选择。与 AST/图模型分开管理，
 * 图模型只读，视图状态的任何变化都不会写回 AST。
 */

export type AstNodeData = {
  node: GraphNode;
  collapsed: boolean;
};

export type AstFlowNode = Node<AstNodeData, 'ast'>;

/** 不可见节点的坐标缓存：记录相对最近可见祖先的偏移，展开时跟随祖先当前位置恢复 */
export type PositionCache = Map<string, { anchor: string; dx: number; dy: number }>;

export interface ViewState {
  model: GraphModel;
  collapsed: ReadonlySet<string>;
  nodes: AstFlowNode[];
}

function makeNode(node: GraphNode, position: XY, collapsed: boolean, selected: boolean): AstFlowNode {
  return {
    id: node.id,
    type: 'ast',
    position,
    data: { node, collapsed },
    selected,
    deletable: false,
    connectable: false,
  };
}

/** 导入时的初始视图：自动布局一次 */
export function initialView(model: GraphModel, collapsed: ReadonlySet<string>, showHidden: boolean): ViewState {
  const visible = computeVisible(model, collapsed);
  const positions = layoutNodes(model, visible, (id) => collapsed.has(id), showHidden);
  const nodes = visible.map((id) => makeNode(model.nodes.get(id)!, positions.get(id)!, collapsed.has(id), false));
  return { model, collapsed, nodes };
}

/**
 * 在模型或折叠状态变化后更新节点列表：
 * 仍可见的节点保留坐标和选择；被隐藏的节点把坐标存入缓存；
 * 重新出现的节点优先从缓存恢复，否则做局部布局。
 */
export function reconcile(
  prev: ViewState,
  model: GraphModel,
  collapsed: ReadonlySet<string>,
  cache: PositionCache,
  showHidden: boolean,
): ViewState {
  const visible = computeVisible(model, collapsed);
  const visibleSet = new Set(visible);
  const prevById = new Map(prev.nodes.map((n) => [n.id, n]));

  for (const n of prev.nodes) {
    if (visibleSet.has(n.id)) continue;
    // 节点可能已不在新模型中（如被内联），沿旧模型的父链寻找可见祖先
    let anchor = (model.nodes.get(n.id) ?? prev.model.nodes.get(n.id))?.parentId ?? null;
    while (anchor && !(visibleSet.has(anchor) && prevById.has(anchor))) {
      anchor = (model.nodes.get(anchor) ?? prev.model.nodes.get(anchor))?.parentId ?? null;
    }
    if (!anchor) continue;
    const a = prevById.get(anchor)!.position;
    cache.set(n.id, { anchor, dx: n.position.x - a.x, dy: n.position.y - a.y });
  }

  const positions = new Map<string, XY>();
  for (const id of visible) {
    const p = prevById.get(id);
    if (p) {
      positions.set(id, p.position);
      continue;
    }
    const c = cache.get(id);
    const anchorPos = c ? positions.get(c.anchor) : undefined;
    if (c && anchorPos) positions.set(id, { x: anchorPos.x + c.dx, y: anchorPos.y + c.dy });
  }
  placeMissing(model, visible, positions, (id) => collapsed.has(id), showHidden);

  const nodes = visible.map((id) => {
    const graphNode = model.nodes.get(id)!;
    const isCollapsed = collapsed.has(id);
    const p = prevById.get(id);
    if (p && p.data.node === graphNode && p.data.collapsed === isCollapsed) return p;
    return makeNode(graphNode, positions.get(id)!, isCollapsed, p?.selected ?? false);
  });
  return { model, collapsed, nodes };
}

/** "重新排列"：对当前可见节点重新布局，丢弃坐标缓存 */
export function relayout(state: ViewState, cache: PositionCache, showHidden: boolean): ViewState {
  cache.clear();
  const ids = state.nodes.map((n) => n.id);
  const positions = layoutNodes(state.model, ids, (id) => state.collapsed.has(id), showHidden);
  return { ...state, nodes: state.nodes.map((n) => ({ ...n, position: positions.get(n.id)! })) };
}

/** 让某个节点可见：展开它所有的祖先 */
export function revealCollapsed(model: GraphModel, collapsed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(collapsed);
  let cur = model.nodes.get(id)?.parentId ?? null;
  while (cur) {
    next.delete(cur);
    cur = model.nodes.get(cur)!.parentId;
  }
  return next;
}
