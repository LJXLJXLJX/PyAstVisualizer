import dagre from '@dagrejs/dagre';
import type { GraphModel, GraphNode } from './model';

export interface XY {
  x: number;
  y: number;
}

/** 卡片尺寸常量，需与 styles.css 中 .ast-node 的尺寸保持一致 */
export const NODE_WIDTH = 240;
export const HEADER_HEIGHT = 34;
export const ROW_HEIGHT = 22;
export const BODY_PADDING = 8;

export interface SizeOptions {
  showHidden: boolean;
  collapsed: boolean;
}

/** 可见行：默认不显示收纳的属性；有收纳属性时增加一行"+N 项"提示 */
export function visibleRowCount(node: GraphNode, showHidden: boolean): number {
  let rows = 0;
  let hidden = 0;
  for (const r of node.rows) {
    if (r.kind === 'prop' && r.hidden && !showHidden) hidden++;
    else rows++;
  }
  return rows + (hidden > 0 ? 1 : 0);
}

export function nodeHeight(node: GraphNode, opts: SizeOptions): number {
  const rows = visibleRowCount(node, opts.showHidden) + (opts.collapsed ? 1 : 0);
  return HEADER_HEIGHT + BODY_PADDING + rows * ROW_HEIGHT;
}

/**
 * 用 Dagre 对给定的可见节点做从左到右的分层布局，返回左上角坐标。
 */
export function layoutNodes(
  model: GraphModel,
  ids: readonly string[],
  isCollapsed: (id: string) => boolean,
  showHidden: boolean,
): Map<string, XY> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const included = new Set(ids);
  const heights = new Map<string, number>();
  for (const id of ids) {
    const node = model.nodes.get(id)!;
    const h = nodeHeight(node, { showHidden, collapsed: isCollapsed(id) });
    heights.set(id, h);
    g.setNode(id, { width: NODE_WIDTH, height: h });
  }
  for (const id of ids) {
    const node = model.nodes.get(id)!;
    for (const c of node.childIds) if (included.has(c)) g.setEdge(id, c);
  }
  // 节点按先序插入；关闭交叉最小化启发式后 Dagre 沿用初始 DFS 顺序，兄弟节点保持字段顺序，大图布局也更快
  dagre.layout(g, { disableOptimalOrderHeuristic: true });
  const out = new Map<string, XY>();
  for (const id of ids) {
    const n = g.node(id);
    out.set(id, { x: n.x - NODE_WIDTH / 2, y: n.y - heights.get(id)! / 2 });
  }
  return out;
}

/**
 * 给缺少坐标的节点安排位置（展开子树、切换显示选项后出现的新节点）。
 * 以最近的已有坐标的祖先为锚点，对锚点的可见子树做局部布局并平移到锚点当前位置，
 * 只为缺失坐标的节点赋值，已有节点的坐标保持不变。
 */
export function placeMissing(
  model: GraphModel,
  visible: readonly string[],
  positions: Map<string, XY>,
  isCollapsed: (id: string) => boolean,
  showHidden: boolean,
): void {
  const visibleSet = new Set(visible);
  const anchors = new Map<string, string[]>();
  for (const id of visible) {
    if (positions.has(id)) continue;
    let anchor = model.nodes.get(id)!.parentId;
    while (anchor && !positions.has(anchor)) anchor = model.nodes.get(anchor)!.parentId;
    const key = anchor ?? model.rootId;
    if (!anchors.has(key)) anchors.set(key, []);
    anchors.get(key)!.push(id);
  }
  for (const [anchor, missing] of anchors) {
    const subtree: string[] = [];
    const stack = [anchor];
    while (stack.length) {
      const id = stack.pop()!;
      subtree.push(id);
      if (isCollapsed(id)) continue;
      for (const c of model.nodes.get(id)!.childIds) if (visibleSet.has(c)) stack.push(c);
    }
    const local = layoutNodes(model, subtree, isCollapsed, showHidden);
    const base = positions.get(anchor);
    const localAnchor = local.get(anchor)!;
    const dx = base ? base.x - localAnchor.x : 0;
    const dy = base ? base.y - localAnchor.y : 0;
    for (const id of missing) {
      const p = local.get(id);
      if (p) positions.set(id, { x: p.x + dx, y: p.y + dy });
    }
  }
}
