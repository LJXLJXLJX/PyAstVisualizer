import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, initialCollapse, type NodeCategory } from '../graph/model';
import { filterNodeChanges } from '../graph/readonly';
import { initialView, reconcile, relayout, revealCollapsed, type AstFlowNode, type PositionCache, type ViewState } from '../graph/view';
import type { ParseResult } from '../parser';
import { AstNodeCard } from './AstNodeCard';
import { CanvasActionsContext } from './canvasContext';
import { DetailPanel } from './DetailPanel';
import { downloadDataUrl, exportPng } from './exportImage';

/** 初始可见节点数预算：超过时自动折叠较深层级 */
const INITIAL_VISIBLE_BUDGET = 600;
const CANVAS_BG = '#18191c';
/** 展开全部超过该数量时先确认（实测数千张卡片时布局和渲染需要数秒） */
const EXPAND_CONFIRM_THRESHOLD = 2000;
const VIRTUALIZE_THRESHOLD = 1500;
/** 导出上限：html-to-image 需要克隆全部卡片，实测约 2000 张需 20 秒以上，3500 张会失败 */
const EXPORT_MAX_CARDS = 1500;

const NODE_TYPES = { ast: AstNodeCard };

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  module: '#9aa0a6',
  definition: '#b98ce6',
  control: '#e0a43c',
  statement: '#4f8cff',
  access: '#3fbfbf',
  name: '#5fbf7a',
  literal: '#e6c84f',
  operator: '#e06c75',
  other: '#8c8c8c',
};

interface Props {
  result: ParseResult;
  onNotice: (msg: string | null) => void;
}

export function AstCanvas({ result, onNotice }: Props) {
  const flow = useReactFlow<AstFlowNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const [inlineEmpty, setInlineEmpty] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  // 窄屏上详情面板会覆盖画布，默认收起，选中节点时再打开
  const [showDetail, setShowDetail] = useState(() => window.innerWidth > 900);
  const [exporting, setExporting] = useState(false);
  const cache = useRef<PositionCache>(new Map());

  const [view, setView] = useState<ViewState>(() => {
    const model = buildGraph(result, { inlineEmptyNodes: true });
    return initialView(model, initialCollapse(model, INITIAL_VISIBLE_BUDGET), false);
  });
  const { model, nodes } = view;

  useEffect(() => {
    const total = view.model.nodes.size;
    if (view.collapsed.size > 0 && total > INITIAL_VISIBLE_BUDGET) {
      onNotice(`共 ${total.toLocaleString()} 张卡片，已自动折叠较深层级，当前显示 ${view.nodes.length} 张。可点击卡片右上角 ▸ 逐步展开。`);
    } else {
      onNotice(null);
    }
    // 仅在导入时提示一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<AstFlowNode>[]) => {
    const allowed = filterNodeChanges(changes);
    if (allowed.length === 0) return;
    setView((v) => ({ ...v, nodes: applyNodeChanges(allowed, v.nodes) }));
  }, []);

  const toggleCollapse = useCallback(
    (id: string) => {
      setView((v) => {
        const next = new Set(v.collapsed);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return reconcile(v, v.model, next, cache.current, showHidden);
      });
    },
    [showHidden],
  );

  const setCollapsedAll = useCallback(
    (mode: 'expand' | 'collapse') => {
      const total = view.model.nodes.size;
      if (
        mode === 'expand' &&
        total > EXPAND_CONFIRM_THRESHOLD &&
        !window.confirm(`将显示全部 ${total.toLocaleString()} 张卡片，布局和渲染可能需要数秒并使交互变慢。继续？`)
      ) {
        return;
      }
      setView((v) => {
        const next = new Set<string>();
        if (mode === 'collapse') {
          const root = v.model.nodes.get(v.model.rootId)!;
          for (const c of root.childIds) if (v.model.nodes.get(c)!.childIds.length > 0) next.add(c);
        }
        return reconcile(v, v.model, next, cache.current, showHidden);
      });
      window.setTimeout(() => flow.fitView({ duration: 300 }), 50);
    },
    [flow, showHidden, view.model],
  );

  const rearrange = useCallback(() => {
    setView((v) => relayout(v, cache.current, showHidden));
    window.setTimeout(() => flow.fitView({ duration: 300 }), 30);
  }, [flow, showHidden]);

  const changeInline = useCallback(
    (value: boolean) => {
      setInlineEmpty(value);
      setView((v) => {
        const nextModel = buildGraph(result, { inlineEmptyNodes: value });
        // 折叠的节点若被内联则不再存在，从折叠集合中移除
        const nextCollapsed = new Set([...v.collapsed].filter((id) => nextModel.nodes.has(id)));
        return reconcile(v, nextModel, nextCollapsed, cache.current, showHidden);
      });
    },
    [result, showHidden],
  );

  const changeShowHidden = useCallback(
    (value: boolean) => {
      setShowHidden(value);
      // 行数变化后重新测量端口位置
      window.setTimeout(() => updateNodeInternals(view.nodes.map((n) => n.id)), 0);
    },
    [updateNodeInternals, view.nodes],
  );

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedIds = useMemo(() => new Set(selectedNodes.map((n) => n.id)), [selectedNodes]);
  const detailNode = selectedNodes.length === 1 ? selectedNodes[0]!.data.node : null;

  const focusNode = useCallback(
    (id: string) => {
      setView((v) => {
        const nextCollapsed = revealCollapsed(v.model, v.collapsed, id);
        const next =
          nextCollapsed.size === v.collapsed.size ? v : reconcile(v, v.model, nextCollapsed, cache.current, showHidden);
        return { ...next, nodes: next.nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })) };
      });
      setShowDetail(true);
      window.setTimeout(() => {
        const n = flow.getInternalNode(id);
        if (!n) return;
        const w = n.measured.width ?? 240;
        const h = n.measured.height ?? 60;
        flow.setCenter(n.internals.positionAbsolute.x + w / 2, n.internals.positionAbsolute.y + h / 2, {
          zoom: Math.max(flow.getZoom(), 0.9),
          duration: 300,
        });
      }, 50);
    },
    [flow, showHidden],
  );

  const edges = useMemo<Edge[]>(() => {
    const visible = new Set(nodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const e of model.edges) {
      if (!visible.has(e.source) || !visible.has(e.target)) continue;
      const active = selectedIds.has(e.source) || selectedIds.has(e.target);
      const color = CATEGORY_COLORS[model.nodes.get(e.target)!.category];
      out.push({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: 'in',
        selectable: false,
        deletable: false,
        focusable: false,
        reconnectable: false,
        className: active ? 'is-active' : undefined,
        style: { stroke: color },
        data: { label: e.label },
        ariaLabel: `${e.source} 的 ${e.label} → ${model.nodes.get(e.target)!.type}`,
      });
    }
    return out;
  }, [model, nodes, selectedIds]);

  const doExport = useCallback(async () => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) return;
    const count = flow.getNodes().length;
    if (count > EXPORT_MAX_CARDS) {
      onNotice(`当前显示 ${count.toLocaleString()} 张卡片，超过导出上限 ${EXPORT_MAX_CARDS.toLocaleString()} 张。请先折叠部分子树后再导出。`);
      return;
    }
    setExporting(true);
    try {
      // 大图开启了视口虚拟化，导出前等待所有卡片渲染并测量完成
      await new Promise((r) => window.setTimeout(r, 0));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const bounds = flow.getNodesBounds(flow.getNodes());
      const { dataUrl, info } = await exportPng(viewport, bounds, CANVAS_BG);
      downloadDataUrl(dataUrl, 'python-ast.png');
      onNotice(
        info.scale < 1
          ? `已导出 PNG（${info.width}×${info.height}，图过大已缩小到 ${Math.round(info.scale * 100)}%）`
          : `已导出 PNG（${info.width}×${info.height}）`,
      );
    } catch (err) {
      onNotice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [flow, onNotice]);

  // 调试接口：仅在 URL 带 ?debug 时暴露，供端到端测试核对 AST 未被修改
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__PYAST_DEBUG__ = {
      astJson: () => JSON.stringify(result.root),
      nodeIds: () => flow.getNodes().map((n) => n.id),
      positions: () => Object.fromEntries(flow.getNodes().map((n) => [n.id, n.position])),
      edgeIds: () => flow.getEdges().map((e) => e.id),
      totalNodes: () => view.model.nodes.size,
    };
  }, [flow, result, view.model]);

  const actions = useMemo(() => ({ showHidden, toggleCollapse }), [showHidden, toggleCollapse]);
  const large = nodes.length > 400;
  // 卡片很多时只渲染视口内的节点；导出期间关闭，保证图片完整
  const virtualize = nodes.length > VIRTUALIZE_THRESHOLD && !exporting;

  return (
    <CanvasActionsContext.Provider value={actions}>
      <div className="canvas-wrap">
        <ReactFlow<AstFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={() => setShowDetail(true)}
          nodesConnectable={false}
          nodesFocusable={!large}
          edgesFocusable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control']}
          onlyRenderVisibleElements={virtualize}
          minZoom={0.05}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
          colorMode="dark"
        >
          <Background id="minor" variant={BackgroundVariant.Lines} gap={20} color="#25272b" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={100} color="#2e3035" />
          <MiniMap
            pannable
            zoomable
            bgColor="#141518"
            maskColor="rgba(10,10,12,0.6)"
            nodeColor={(n) => CATEGORY_COLORS[(n as AstFlowNode).data.node.category]}
            nodeStrokeWidth={0}
          />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="toolbar">
            <button type="button" className="btn" onClick={rearrange} title="对当前可见节点重新自动布局">
              重新排列
            </button>
            <button type="button" className="btn" onClick={() => flow.fitView({ duration: 300, padding: 0.1 })}>
              适应屏幕
            </button>
            <button type="button" className="btn" onClick={() => setCollapsedAll('expand')}>
              全部展开
            </button>
            <button type="button" className="btn" onClick={() => setCollapsedAll('collapse')}>
              全部折叠
            </button>
            <label className="check">
              <input type="checkbox" checked={showHidden} onChange={(e) => changeShowHidden(e.target.checked)} />
              显示收纳字段
            </label>
            <label className="check" title="Load()/Store()/Add() 等没有字段的节点显示为父卡片上的属性">
              <input type="checkbox" checked={inlineEmpty} onChange={(e) => changeInline(e.target.checked)} />
              内联无字段节点
            </label>
            <button type="button" className="btn btn-primary" onClick={doExport} disabled={exporting}>
              {exporting ? '导出中…' : '导出 PNG'}
            </button>
            {!showDetail && (
              <button type="button" className="btn" onClick={() => setShowDetail(true)}>
                详情
              </button>
            )}
          </Panel>
          <Panel position="bottom-left" className="stats">
            显示 {nodes.length} / {model.nodes.size} 张卡片 · {edges.length} 条连线 · 拖动空白处平移，Shift+拖动框选，⌘/Ctrl+点击多选
          </Panel>
        </ReactFlow>
        {showDetail && (
          <DetailPanel
            model={model}
            node={detailNode}
            selectedCount={selectedNodes.length}
            onFocus={focusNode}
            onClose={() => setShowDetail(false)}
          />
        )}
      </div>
    </CanvasActionsContext.Provider>
  );
}

