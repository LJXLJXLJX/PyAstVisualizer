import { useState } from 'react';
import { readablePath, type GraphModel, type GraphNode } from '../graph/model';
import { copyText } from './clipboard';

interface Props {
  model: GraphModel;
  node: GraphNode | null;
  selectedCount: number;
  onFocus: (id: string) => void;
  onClose: () => void;
}

const HIDDEN_LABEL: Record<string, string> = { none: 'None', empty: '空列表', position: '位置' };

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'ok' : 'fail');
        window.setTimeout(() => setState('idle'), 1200);
      }}
    >
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : label}
    </button>
  );
}

export function DetailPanel({ model, node, selectedCount, onFocus, onClose }: Props) {
  if (!node) {
    return (
      <aside className="detail-panel">
        <div className="detail-panel__head">
          <h2>详情</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </div>
        <p className="muted">
          {selectedCount > 1 ? `已选择 ${selectedCount} 个节点，可一起拖动。点击单个节点查看详情。` : '点击节点查看完整字段。'}
        </p>
      </aside>
    );
  }

  const raw = model.source.slice(node.ast.start, node.ast.end);
  const path = readablePath(model, node.id);
  const parent = node.parentId ? model.nodes.get(node.parentId) : undefined;

  return (
    <aside className="detail-panel" aria-label="节点详情">
      <div className="detail-panel__head">
        <h2 className={`cat-text-${node.category}`}>{node.type}</h2>
        <button type="button" className="btn btn-small" onClick={onClose} aria-label="关闭详情">
          ✕
        </button>
      </div>
      <div className="detail-path" title={path}>
        {path}
      </div>
      <div className="detail-actions">
        <CopyButton text={raw} label="复制原始 dump" />
        <CopyButton text={node.id} label="复制节点路径" />
        {parent && (
          <button type="button" className="btn btn-small" onClick={() => onFocus(parent.id)}>
            ← 父节点 {parent.type}
          </button>
        )}
      </div>
      <div className="detail-meta muted">
        子树节点 {node.descendantCount} 个 · 字段 {node.ast.fields.length} 个 · 源文本 {raw.length.toLocaleString()} 字符
      </div>
      <table className="detail-fields">
        <tbody>
          {node.rows.map((r) => (
            <tr key={r.label} className={r.kind === 'prop' && r.hidden ? 'is-hidden-field' : undefined}>
              <th scope="row">
                {r.label}
                {r.kind === 'prop' && r.hidden && <span className="tag">{HIDDEN_LABEL[r.hidden]}</span>}
              </th>
              <td>
                {r.kind === 'port' ? (
                  <button type="button" className="link" onClick={() => onFocus(r.childId)}>
                    → {model.nodes.get(r.childId)?.type}
                  </button>
                ) : (
                  <div className="detail-value">
                    <pre>{r.full}</pre>
                    {r.valueKind === 'str' && r.copyText !== r.full && (
                      <pre className="decoded" title="解码后的字符串内容">
                        {r.copyText}
                      </pre>
                    )}
                    <CopyButton text={r.copyText} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {node.rows.length === 0 && <p className="muted">该节点没有字段。</p>}
    </aside>
  );
}
