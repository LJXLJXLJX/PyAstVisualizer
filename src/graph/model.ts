import type { AstNode, AstValue, ParseResult } from '../parser';

/**
 * 由只读 AST 派生的图模型。仅依赖 AST 和构建选项，不包含坐标、折叠、选择等视图状态。
 *
 * 节点 id 是从根开始的字段路径（如 `$.body[0].value`），与构建选项无关，
 * 因此切换"内联无字段节点"等选项后，已有节点的坐标仍能对应。
 */

export type HiddenReason = 'none' | 'empty' | 'position';

export interface PropRow {
  readonly kind: 'prop';
  readonly label: string;
  /** 卡片上显示的摘要 */
  readonly summary: string;
  /** 完整的 repr 文本 */
  readonly full: string;
  /** 复制时的内容：字符串字段为解码后的值，其余为 repr */
  readonly copyText: string;
  readonly valueKind: string;
  /** 默认收纳到详情中的原因；null 表示直接显示 */
  readonly hidden: HiddenReason | null;
}

export interface PortRow {
  readonly kind: 'port';
  readonly label: string;
  readonly childId: string;
}

export type Row = PropRow | PortRow;

export type NodeCategory =
  | 'module'
  | 'definition'
  | 'control'
  | 'statement'
  | 'access'
  | 'name'
  | 'literal'
  | 'operator'
  | 'other';

export interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly category: NodeCategory;
  readonly ast: AstNode;
  readonly parentId: string | null;
  /** 在父节点中的字段标签，如 body[0] */
  readonly parentLabel: string | null;
  readonly depth: number;
  readonly rows: readonly Row[];
  readonly childIds: readonly string[];
  /** 子树中（不含自身）的图节点数量 */
  readonly descendantCount: number;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly label: string;
}

export interface GraphModel {
  readonly rootId: string;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** 先序遍历顺序 */
  readonly order: readonly string[];
  readonly edges: readonly GraphEdge[];
  readonly source: string;
}

export interface BuildOptions {
  /** 把没有字段的节点（Load()、Store()、Add() 等）显示为父卡片上的属性，而不是单独的卡片 */
  inlineEmptyNodes: boolean;
}

export const POSITION_FIELDS = new Set(['lineno', 'col_offset', 'end_lineno', 'end_col_offset']);
export const ROOT_ID = '$';
const SUMMARY_MAX = 60;

const CATEGORY_OF: Record<string, NodeCategory> = {};
const CATEGORY_LISTS: [NodeCategory, string][] = [
  ['module', 'Module Interactive Expression FunctionType'],
  ['definition', 'FunctionDef AsyncFunctionDef ClassDef Lambda arguments arg keyword TypeVar ParamSpec TypeVarTuple TypeAlias'],
  [
    'control',
    'If For AsyncFor While Try TryStar With AsyncWith Match Return Break Continue Raise Yield YieldFrom Await IfExp ExceptHandler match_case withitem comprehension MatchValue MatchSingleton MatchSequence MatchMapping MatchClass MatchStar MatchAs MatchOr',
  ],
  ['statement', 'Assign AugAssign AnnAssign Expr Import ImportFrom alias Global Nonlocal Pass Delete Assert'],
  ['access', 'Call Attribute Subscript Starred Slice'],
  ['name', 'Name'],
  ['literal', 'Constant JoinedStr FormattedValue List Tuple Set Dict ListComp SetComp DictComp GeneratorExp'],
  [
    'operator',
    'BinOp UnaryOp BoolOp Compare NamedExpr Add Sub Mult MatMult Div Mod Pow LShift RShift BitOr BitXor BitAnd FloorDiv And Or Invert Not UAdd USub Eq NotEq Lt LtE Gt GtE Is IsNot In NotIn Load Store Del',
  ],
];
for (const [cat, names] of CATEGORY_LISTS) for (const n of names.split(' ')) CATEGORY_OF[n] = cat;

export function categoryOf(type: string): NodeCategory {
  const short = type.slice(type.lastIndexOf('.') + 1);
  return CATEGORY_OF[short] ?? 'other';
}

/** 生成 Python repr 风格的紧凑文本（标量使用源文本中的原始字面量） */
export function reprValue(v: AstValue): string {
  switch (v.kind) {
    case 'str':
    case 'bytes':
      return v.raw;
    case 'number':
      return v.raw;
    case 'constant':
      return v.value;
    case 'list':
      return `[${v.items.map(reprValue).join(', ')}]`;
    case 'tuple':
      return v.items.length === 1 ? `(${reprValue(v.items[0]!)},)` : `(${v.items.map(reprValue).join(', ')})`;
    case 'set':
      return `{${v.items.map(reprValue).join(', ')}}`;
    case 'dict':
      return `{${v.entries.map((e) => `${reprValue(e.key)}: ${reprValue(e.value)}`).join(', ')}}`;
    case 'node': {
      const args = v.fields.map((f) => (f.name === null ? reprValue(f.value) : `${f.name}=${reprValue(f.value)}`));
      return `${v.type}(${args.join(', ')})`;
    }
  }
}

export function summarize(text: string, max = SUMMARY_MAX): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}

function containsNode(v: AstValue): boolean {
  switch (v.kind) {
    case 'node':
      return true;
    case 'list':
    case 'tuple':
    case 'set':
      return v.items.some(containsNode);
    case 'dict':
      return v.entries.some((e) => containsNode(e.key) || containsNode(e.value));
    default:
      return false;
  }
}

function isEmptyNode(v: AstValue): boolean {
  return v.kind === 'node' && v.fields.length === 0;
}

export function buildGraph(result: ParseResult, options: BuildOptions): GraphModel {
  const nodes = new Map<string, GraphNode>();
  const order: string[] = [];
  const edges: GraphEdge[] = [];

  // 迭代地构建，避免依赖 JS 调用栈深度；先分配 id 再在后序阶段统计子树规模
  interface Pending {
    ast: AstNode;
    id: string;
    parentId: string | null;
    parentLabel: string | null;
    depth: number;
  }
  const stack: Pending[] = [{ ast: result.root, id: ROOT_ID, parentId: null, parentLabel: null, depth: 0 }];
  const built: { id: string; rows: Row[]; childIds: string[]; p: Pending }[] = [];

  while (stack.length) {
    const p = stack.pop()!;
    const rows: Row[] = [];
    const childIds: string[] = [];
    const children: Pending[] = [];

    const addPort = (label: string, child: AstNode) => {
      const childId = `${p.id}.${label}`;
      rows.push({ kind: 'port', label, childId });
      childIds.push(childId);
      edges.push({ id: `${p.id}->${childId}`, source: p.id, sourceHandle: label, target: childId, label });
      children.push({ ast: child, id: childId, parentId: p.id, parentLabel: label, depth: p.depth + 1 });
    };

    const addProp = (label: string, value: AstValue, fieldName: string | null) => {
      const full = reprValue(value);
      let hidden: HiddenReason | null = null;
      // 只收纳字段本身的值；列表中的 None（如 Dict.keys 里的 None）有语义，保持显示
      if (fieldName !== null && POSITION_FIELDS.has(fieldName)) hidden = 'position';
      else if (fieldName !== null && value.kind === 'constant' && value.value === 'None') hidden = 'none';
      else if (fieldName !== null && value.kind === 'list' && value.items.length === 0) hidden = 'empty';
      rows.push({
        kind: 'prop',
        label,
        summary: summarize(full),
        full,
        copyText: value.kind === 'str' ? value.value : full,
        valueKind: value.kind === 'node' ? 'node' : value.kind,
        hidden,
      });
    };

    const walk = (value: AstValue, label: string, fieldName: string | null) => {
      if (value.kind === 'node') {
        if (options.inlineEmptyNodes && isEmptyNode(value)) addProp(label, value, fieldName);
        else addPort(label, value);
        return;
      }
      if ((value.kind === 'list' || value.kind === 'tuple' || value.kind === 'set') && containsNode(value)) {
        value.items.forEach((it, i) => walk(it, `${label}[${i}]`, null));
        return;
      }
      if (value.kind === 'dict' && containsNode(value)) {
        value.entries.forEach((e, i) => {
          walk(e.key, `${label}.keys[${i}]`, null);
          walk(e.value, `${label}.values[${i}]`, null);
        });
        return;
      }
      addProp(label, value, fieldName);
    };

    for (const f of p.ast.fields) {
      const label = f.name ?? `#${f.index}`;
      walk(f.value, label, f.name);
    }

    built.push({ id: p.id, rows, childIds, p });
    order.push(p.id);
    // 逆序入栈以保持先序遍历中的字段顺序
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }

  const descendants = new Map<string, number>();
  for (let i = built.length - 1; i >= 0; i--) {
    const b = built[i]!;
    let count = 0;
    for (const c of b.childIds) count += 1 + (descendants.get(c) ?? 0);
    descendants.set(b.id, count);
  }
  for (const b of built) {
    nodes.set(b.id, {
      id: b.id,
      type: b.p.ast.type,
      category: categoryOf(b.p.ast.type),
      ast: b.p.ast,
      parentId: b.p.parentId,
      parentLabel: b.p.parentLabel,
      depth: b.p.depth,
      rows: b.rows,
      childIds: b.childIds,
      descendantCount: descendants.get(b.id) ?? 0,
    });
  }

  return { rootId: ROOT_ID, nodes, order, edges, source: result.source };
}

/** 折叠状态下当前可见的节点（先序） */
export function computeVisible(model: GraphModel, collapsed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const stack = [model.rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    if (collapsed.has(id)) continue;
    const node = model.nodes.get(id)!;
    for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i]!);
  }
  return out;
}

/**
 * 节点过多时的初始折叠：找到最深的层级 d，使深度 ≤ d 的节点数不超过 budget，
 * 并折叠第 d 层上所有带子节点的节点。返回空集合表示不需要折叠。
 */
export function initialCollapse(model: GraphModel, budget: number): Set<string> {
  if (model.nodes.size <= budget) return new Set();
  const perDepth: number[] = [];
  for (const n of model.nodes.values()) perDepth[n.depth] = (perDepth[n.depth] ?? 0) + 1;
  let total = 0;
  let depth = 0;
  for (let d = 0; d < perDepth.length; d++) {
    total += perDepth[d] ?? 0;
    if (total > budget) break;
    depth = d;
  }
  const collapsed = new Set<string>();
  for (const n of model.nodes.values()) {
    if (n.depth === depth && n.childIds.length > 0) collapsed.add(n.id);
  }
  return collapsed;
}

/** 把 `$.body[0].value` 转为便于阅读的路径 */
export function readablePath(model: GraphModel, id: string): string {
  const parts: string[] = [];
  let cur = model.nodes.get(id);
  while (cur) {
    parts.push(cur.parentLabel ? `${cur.parentLabel}: ${cur.type}` : cur.type);
    cur = cur.parentId ? model.nodes.get(cur.parentId) : undefined;
  }
  return parts.reverse().join(' › ');
}
