import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { AstCanvas } from './components/AstCanvas';
import { InputPanel } from './components/InputPanel';
import { EXAMPLES } from './examples';
import { AstParseError, parseAstDump, type ParseResult } from './parser';

interface Doc {
  id: number;
  result: ParseResult;
}

function tryParse(text: string): { result: ParseResult; ms: number } | { error: AstParseError } {
  const t0 = performance.now();
  try {
    const result = parseAstDump(text);
    return { result, ms: performance.now() - t0 };
  } catch (e) {
    if (e instanceof AstParseError) return { error: e };
    // 理论上不会发生；仍转换为带位置的错误，避免静默失败
    return { error: new AstParseError(`内部错误：${e instanceof Error ? e.message : String(e)}`, text, 0) };
  }
}

let nextDocId = 1;

export default function App() {
  const [text, setText] = useState(EXAMPLES[0]!.text);
  const [doc, setDoc] = useState<Doc | null>(() => {
    const r = tryParse(EXAMPLES[0]!.text);
    return 'result' in r ? { id: nextDocId++, result: r.result } : null;
  });
  const [error, setError] = useState<AstParseError | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ nodeCount: number; maxDepth: number; ms: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const onParse = useCallback((input: string) => {
    const r = tryParse(input);
    if ('error' in r) {
      setError(r.error);
      setStats(null);
      return;
    }
    setError(null);
    setStats({ ...r.result.stats, ms: r.ms });
    setDoc({ id: nextDocId++, result: r.result });
  }, []);

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-closed'}`}>
      {sidebarOpen && (
        <InputPanel
          text={text}
          onTextChange={setText}
          onParse={onParse}
          error={error}
          fileError={fileError}
          onFileError={setFileError}
          stats={stats}
        />
      )}
      <main className="main">
        <button
          type="button"
          className="sidebar-toggle btn btn-small"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? '隐藏输入面板' : '显示输入面板'}
        >
          {sidebarOpen ? '◀' : '▶ 输入'}
        </button>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button type="button" className="btn btn-small" onClick={() => setNotice(null)} aria-label="关闭提示">
              ✕
            </button>
          </div>
        )}
        {doc ? (
          <ReactFlowProvider key={doc.id}>
            <AstCanvas result={doc.result} onNotice={setNotice} />
          </ReactFlowProvider>
        ) : (
          <div className="empty">粘贴 ast.dump 文本后点击“解析并绘图”。</div>
        )}
      </main>
    </div>
  );
}
