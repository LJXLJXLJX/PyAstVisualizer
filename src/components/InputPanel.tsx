import { useRef, useState, type DragEvent } from 'react';
import { EXAMPLES } from '../examples';
import { LIMITS, type AstParseError } from '../parser';

interface Props {
  text: string;
  onTextChange: (text: string) => void;
  onParse: (text: string) => void;
  error: AstParseError | null;
  fileError: string | null;
  onFileError: (msg: string | null) => void;
  stats: { nodeCount: number; maxDepth: number; ms: number } | null;
}

function ErrorView({ error, text }: { error: AstParseError; text: string }) {
  const lines = text.split('\n');
  const lineText = (lines[error.line - 1] ?? '').replace(/\r$/, '');
  // 截取错误列附近的片段并高亮出错字符（中文等宽度不一，不用 ^ 对齐）
  const chars = Array.from(lineText);
  const at = error.column - 1;
  const from = Math.max(0, at - 40);
  const before = (from > 0 ? '…' : '') + chars.slice(from, at).join('');
  const target = chars[at] ?? ' ';
  const after = chars.slice(at + 1, at + 40).join('') + (chars.length > at + 40 ? '…' : '');
  return (
    <div className="parse-error" role="alert">
      <div className="parse-error__title">
        解析失败：第 {error.line} 行，第 {error.column} 列
      </div>
      <div className="parse-error__reason">{error.reason}</div>
      {lineText.length > 0 && (
        <pre className="parse-error__snippet">
          {before}
          <mark>{target}</mark>
          {after}
        </pre>
      )}
    </div>
  );
}

export function InputPanel({ text, onTextChange, onParse, error, fileError, onFileError, stats }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = async (file: File) => {
    // UTF-8 下每个字符至少 1 字节，按字节数先粗略拦截超大文件
    if (file.size > LIMITS.maxInputChars * 4) {
      onFileError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），超过输入上限`);
      return;
    }
    try {
      const content = await file.text();
      onFileError(null);
      onTextChange(content);
      onParse(content);
    } catch (e) {
      onFileError(`读取文件失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  return (
    <section className="input-panel">
      <div className="input-panel__head">
        <h1>Python AST 可视化</h1>
        <p className="muted">粘贴 <code>ast.dump()</code> 的输出（单行或 indent 格式），解析和渲染全部在本地完成。</p>
      </div>

      <div className="examples">
        <span className="muted">示例：</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="btn btn-small"
            onClick={() => {
              onTextChange(ex.text);
              onParse(ex.text);
            }}
          >
            {ex.title}
          </button>
        ))}
      </div>

      <textarea
        className={`input-text${dragOver ? ' is-drag' : ''}`}
        value={text}
        spellCheck={false}
        placeholder={"Module(body=[Expr(value=Call(func=Name(id='print', ctx=Load()), args=[Constant(value='你好')], keywords=[]))], type_ignores=[])"}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onParse(text);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-label="ast.dump 文本"
      />

      <div className="input-actions">
        <button type="button" className="btn btn-primary" onClick={() => onParse(text)}>
          解析并绘图
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          打开文件…
        </button>
        <button type="button" className="btn" onClick={() => onTextChange('')} disabled={!text}>
          清空
        </button>
        <span className="muted hint">⌘/Ctrl+Enter 解析 · 可拖入文本文件</span>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.dump,.ast,.py,text/plain"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {fileError && (
        <div className="parse-error" role="alert">
          <div className="parse-error__reason">{fileError}</div>
        </div>
      )}
      {error && <ErrorView error={error} text={text} />}
      {!error && stats && (
        <div className="parse-ok">
          解析成功：{stats.nodeCount.toLocaleString()} 个 AST 节点，最大嵌套深度 {stats.maxDepth}，耗时 {stats.ms.toFixed(0)} ms
        </div>
      )}
      <details className="help">
        <summary>支持的输入格式</summary>
        <ul>
          <li>任意节点名 <code>Name(...)</code>、限定名 <code>ast.Name(...)</code>，命名字段与位置参数（annotate_fields=False）</li>
          <li>列表、元组、集合、字典；字符串、字节串（含全部 repr 转义）、整数、浮点、复数、inf/nan</li>
          <li>None / True / False / Ellipsis；include_attributes=True 的位置字段</li>
          <li>
            上限：{(LIMITS.maxInputChars / 1_000_000).toFixed(0)} M 字符、{LIMITS.maxNodes.toLocaleString()} 个节点、嵌套深度 {LIMITS.maxDepth}
          </li>
        </ul>
      </details>
    </section>
  );
}
