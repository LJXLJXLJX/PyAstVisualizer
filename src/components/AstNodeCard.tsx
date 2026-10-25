import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useContext } from 'react';
import { HEADER_HEIGHT, NODE_WIDTH } from '../graph/layout';
import type { AstFlowNode } from '../graph/view';
import { useI18n } from '../i18n/context';
import { CanvasActionsContext } from './canvasContext';

const HIDDEN_HINT: Record<string, { en: string; zh: string }> = {
  none: { en: 'None', zh: 'None' },
  empty: { en: 'empty list', zh: '空列表' },
  position: { en: 'position', zh: '位置' },
};

function AstNodeCardImpl({ data, selected }: NodeProps<AstFlowNode>) {
  const { node, collapsed } = data;
  const { showHidden, toggleCollapse } = useContext(CanvasActionsContext);
  const { tr, pick } = useI18n();
  const hiddenRows = node.rows.filter((r) => r.kind === 'prop' && r.hidden);
  const hiddenKinds = [...new Set(hiddenRows.map((r) => (r.kind === 'prop' ? pick(HIDDEN_HINT[r.hidden!]!) : '')))];

  return (
    <div
      className={`ast-node cat-${node.category}${selected ? ' is-selected' : ''}${collapsed ? ' is-collapsed' : ''}`}
      style={{ width: NODE_WIDTH }}
      data-node-id={node.id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        isConnectable={false}
        className="port port-in"
        style={{ top: HEADER_HEIGHT / 2 }}
      />
      <div className="ast-node__header" style={{ height: HEADER_HEIGHT }}>
        <span className="ast-node__dot" />
        <span className="ast-node__title" title={node.type}>
          {node.type}
        </span>
        {node.parentLabel && (
          <span className="ast-node__from" title={tr(`Field in parent: ${node.parentLabel}`, `父节点字段：${node.parentLabel}`)}>
            {node.parentLabel}
          </span>
        )}
        {node.childIds.length > 0 && (
          <button
            type="button"
            className="ast-node__toggle nodrag"
            title={collapsed ? tr('Expand subtree', '展开子树') : tr('Collapse subtree', '折叠子树')}
            aria-label={collapsed ? tr('Expand subtree', '展开子树') : tr('Collapse subtree', '折叠子树')}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(node.id);
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
      </div>
      <div className="ast-node__body">
        {node.rows.map((r) => {
          if (r.kind === 'port') {
            return (
              <div className="row row-port" key={r.label}>
                <span className="row__key" title={r.label}>
                  {r.label}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={r.label}
                  isConnectable={false}
                  className="port port-out"
                />
              </div>
            );
          }
          if (r.hidden && !showHidden) return null;
          return (
            <div className={`row row-prop${r.hidden ? ' is-hidden-field' : ''}`} key={r.label}>
              <span className="row__key" title={r.label}>
                {r.label}
              </span>
              <span className={`row__val val-${r.valueKind}`}>{r.summary}</span>
            </div>
          );
        })}
        {!showHidden && hiddenRows.length > 0 && (
          <div className="row row-more" title={tr('Click the card to see every field in the details panel', '点击节点在详情面板查看全部字段')}>
            {tr(`+${hiddenRows.length} hidden (${hiddenKinds.join(' / ')})`, `+${hiddenRows.length} 项已收纳（${hiddenKinds.join(' / ')}）`)}
          </div>
        )}
        {collapsed && (
          <div className="row row-collapsed">
            {tr(`${node.descendantCount} descendants collapsed`, `已折叠 ${node.descendantCount} 个子节点`)}
          </div>
        )}
      </div>
    </div>
  );
}

export const AstNodeCard = memo(AstNodeCardImpl);
