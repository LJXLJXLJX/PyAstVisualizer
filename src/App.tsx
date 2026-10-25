import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { AstCanvas } from './components/AstCanvas';
import { InputPanel } from './components/InputPanel';
import { EXAMPLES } from './examples';
import { useI18n, type Bilingual } from './i18n/context';
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
    const msg = e instanceof Error ? e.message : String(e);
    return { error: new AstParseError({ en: `Internal error: ${msg}`, zh: `内部错误：${msg}` }, text, 0) };
  }
}

let nextDocId = 1;

export default function App() {
  const { lang, setLang, tr, pick } = useI18n();
  const [text, setText] = useState(EXAMPLES[0]!.text);
  const [doc, setDoc] = useState<Doc | null>(() => {
    const r = tryParse(EXAMPLES[0]!.text);
    return 'result' in r ? { id: nextDocId++, result: r.result } : null;
  });
  const [error, setError] = useState<AstParseError | null>(null);
  const [fileError, setFileError] = useState<Bilingual | null>(null);
  const [stats, setStats] = useState<{ nodeCount: number; maxDepth: number; ms: number } | null>(null);
  const [notice, setNotice] = useState<Bilingual | null>(null);
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
        <div className="corner-controls">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? tr('Hide input panel', '隐藏输入面板') : tr('Show input panel', '显示输入面板')}
          >
            {sidebarOpen ? '◀' : tr('▶ Input', '▶ 输入')}
          </button>
          <div className="lang-switch" role="group" aria-label="Language / 语言">
            <button type="button" className={lang === 'en' ? 'is-active' : undefined} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              EN
            </button>
            <button type="button" className={lang === 'zh' ? 'is-active' : undefined} aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>
              中文
            </button>
          </div>
        </div>
        {notice && (
          <div className="notice" role="status">
            {pick(notice)}
            <button type="button" className="btn btn-small" onClick={() => setNotice(null)} aria-label={tr('Dismiss', '关闭提示')}>
              ✕
            </button>
          </div>
        )}
        {doc ? (
          <ReactFlowProvider key={doc.id}>
            <AstCanvas result={doc.result} onNotice={setNotice} />
          </ReactFlowProvider>
        ) : (
          <div className="empty">{tr('Paste ast.dump text, then click “Parse & draw”.', '粘贴 ast.dump 文本后点击“解析并绘图”。')}</div>
        )}
      </main>
    </div>
  );
}
