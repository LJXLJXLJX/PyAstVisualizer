import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { layoutNodes } from '../src/graph/layout';
import { buildGraph, computeVisible, initialCollapse, type PortRow, type PropRow } from '../src/graph/model';
import { filterNodeChanges } from '../src/graph/readonly';
import { initialView, reconcile, relayout, type AstFlowNode, type PositionCache } from '../src/graph/view';
import { parseAstDump } from '../src/parser';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const load = (name: string) => parseAstDump(readFileSync(join(FIXTURES, `${name}.dump.txt`), 'utf8'));

const SAMPLE =
  "Module(body=[Assign(targets=[Name(id='x', ctx=Store())], value=BinOp(left=Constant(value=1), op=Add(), right=Constant(value='很长的字符串')), type_comment=None), Expr(value=Call(func=Name(id='f', ctx=Load()), args=[], keywords=[]))], type_ignores=[])";

describe('图模型', () => {
  const r = parseAstDump(SAMPLE);

  it('字段端口保留列表索引与顺序', () => {
    const g = buildGraph(r, { inlineEmptyNodes: true });
    const root = g.nodes.get('$')!;
    const ports = root.rows.filter((x): x is PortRow => x.kind === 'port').map((x) => x.label);
    expect(ports).toEqual(['body[0]', 'body[1]']);
    expect(g.nodes.get('$.body[0]')!.type).toBe('Assign');
    expect(g.nodes.get('$.body[1].value')!.type).toBe('Call');
    expect(g.edges.map((e) => e.sourceHandle)).toContain('targets[0]');
  });

  it('None、空列表、位置字段被收纳；简单属性直接显示', () => {
    const g = buildGraph(r, { inlineEmptyNodes: true });
    const assign = g.nodes.get('$.body[0]')!;
    const tc = assign.rows.find((x) => x.label === 'type_comment') as PropRow;
    expect(tc.hidden).toBe('none');
    const call = g.nodes.get('$.body[1].value')!;
    expect((call.rows.find((x) => x.label === 'args') as PropRow).hidden).toBe('empty');
    const name = g.nodes.get('$.body[0].targets[0]')!;
    expect(name.rows.find((x) => x.label === 'id')).toMatchObject({ kind: 'prop', full: "'x'", copyText: 'x', hidden: null });

    const attrs = buildGraph(load('loop_attributes'), { inlineEmptyNodes: true });
    const lineno = attrs.nodes.get('$.body[0]')!.rows.find((x) => x.label === 'lineno') as PropRow;
    expect(lineno.hidden).toBe('position');
  });

  it('内联无字段节点可切换，节点 id 保持稳定', () => {
    const inline = buildGraph(r, { inlineEmptyNodes: true });
    const full = buildGraph(r, { inlineEmptyNodes: false });
    expect(inline.nodes.has('$.body[0].targets[0].ctx')).toBe(false);
    expect(full.nodes.get('$.body[0].targets[0].ctx')!.type).toBe('Store');
    for (const id of inline.nodes.keys()) expect(full.nodes.has(id)).toBe(true);
    expect(full.nodes.size - inline.nodes.size).toBe(3);
  });

  it('子树规模与折叠可见性', () => {
    const g = buildGraph(r, { inlineEmptyNodes: true });
    expect(g.nodes.get('$')!.descendantCount).toBe(g.nodes.size - 1);
    const visible = computeVisible(g, new Set(['$.body[0]']));
    expect(visible).not.toContain('$.body[0].value');
    expect(visible).toContain('$.body[1].value');
  });

  it('长文本卡片只显示摘要，详情保留全文', () => {
    const long = 'x'.repeat(500);
    const g = buildGraph(parseAstDump(`Constant(value='${long}')`), { inlineEmptyNodes: true });
    const row = g.nodes.get('$')!.rows[0] as PropRow;
    expect(Array.from(row.summary).length).toBeLessThanOrEqual(60);
    expect(row.copyText).toBe(long);
  });

  it('大图初始折叠控制在预算内', () => {
    const g = buildGraph(load('stdlib_textwrap'), { inlineEmptyNodes: true });
    expect(g.nodes.size).toBeGreaterThan(900);
    const collapsed = initialCollapse(g, 600);
    const visible = computeVisible(g, collapsed);
    expect(visible.length).toBeLessThanOrEqual(600);
    expect(visible.length).toBeGreaterThan(10);
  });
});

describe('布局与视图状态', () => {
  const g = buildGraph(load('function_indent'), { inlineEmptyNodes: true });

  it('Dagre 布局从左到右，子节点在父节点右侧', () => {
    const ids = computeVisible(g, new Set());
    const pos = layoutNodes(g, ids, () => false, false);
    for (const id of ids) {
      const n = g.nodes.get(id)!;
      if (n.parentId) expect(pos.get(id)!.x).toBeGreaterThan(pos.get(n.parentId)!.x);
    }
  });

  it('同一父节点的子节点按字段顺序从上到下排列', () => {
    for (const name of ['function_indent', 'loop_indent', 'stdlib_textwrap']) {
      const model = buildGraph(load(name), { inlineEmptyNodes: true });
      const ids = computeVisible(model, new Set());
      const pos = layoutNodes(model, ids, () => false, false);
      for (const id of ids) {
        const ys = model.nodes.get(id)!.childIds.map((c) => pos.get(c)!.y);
        for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
      }
    }
  });

  it('拖动只改变坐标，删除/新增变更被丢弃', () => {
    const v = initialView(g, new Set(), false);
    const target = v.nodes[3]!;
    const changes: NodeChange<AstFlowNode>[] = [
      { type: 'position', id: target.id, position: { x: 999, y: -5 } },
      { type: 'remove', id: v.nodes[1]!.id },
      { type: 'add', item: { ...target, id: 'injected' } },
      { type: 'replace', id: v.nodes[2]!.id, item: { ...v.nodes[2]!, data: { ...v.nodes[2]!.data } } },
    ];
    const next = applyNodeChanges(filterNodeChanges(changes), v.nodes);
    expect(next.map((n) => n.id)).toEqual(v.nodes.map((n) => n.id));
    expect(next.find((n) => n.id === target.id)!.position).toEqual({ x: 999, y: -5 });
    // 未被拖动的节点对象原样保留，AST 数据引用不变
    expect(next[2]).toBe(v.nodes[2]);
    expect(next.find((n) => n.id === target.id)!.data.node).toBe(target.data.node);
  });

  it('折叠再展开后，子节点跟随父节点的新位置恢复相对坐标', () => {
    const cache: PositionCache = new Map();
    const v0 = initialView(g, new Set(), false);
    const parentId = '$.body[0]';
    const childId = '$.body[0].args';
    const p0 = v0.nodes.find((n) => n.id === parentId)!.position;
    const c0 = v0.nodes.find((n) => n.id === childId)!.position;

    const v1 = reconcile(v0, g, new Set([parentId]), cache, false);
    expect(v1.nodes.some((n) => n.id === childId)).toBe(false);
    // 拖动父节点
    const moved = { ...v1, nodes: v1.nodes.map((n) => (n.id === parentId ? { ...n, position: { x: p0.x + 100, y: p0.y + 50 } } : n)) };
    const v2 = reconcile(moved, g, new Set(), cache, false);
    const c2 = v2.nodes.find((n) => n.id === childId)!.position;
    expect(c2).toEqual({ x: c0.x + 100, y: c0.y + 50 });
    // 其它节点坐标未被重排
    const other = v0.nodes.find((n) => n.id === '$.body[1]')!;
    expect(v2.nodes.find((n) => n.id === other.id)!.position).toEqual(other.position);
  });

  it('切换内联后新出现的节点获得坐标，已有节点不动', () => {
    const cache: PositionCache = new Map();
    const v0 = initialView(g, new Set(), false);
    const full = buildGraph(load('function_indent'), { inlineEmptyNodes: false });
    const v1 = reconcile(v0, full, new Set(), cache, false);
    expect(v1.nodes.length).toBe(full.nodes.size);
    for (const n of v1.nodes) {
      expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(true);
      const before = v0.nodes.find((m) => m.id === n.id);
      if (before) expect(n.position).toEqual(before.position);
    }
  });

  it('重新排列恢复自动布局', () => {
    const cache: PositionCache = new Map();
    const v0 = initialView(g, new Set(), false);
    const dragged = { ...v0, nodes: v0.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })) };
    const v1 = relayout(dragged, cache, false);
    expect(v1.nodes.map((n) => n.position)).toEqual(v0.nodes.map((n) => n.position));
  });
});
