import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nContext, STORAGE_KEY, initialLang, makeI18n, type Lang } from './context';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? 'Python AST 可视化' : 'Python AST Visualizer';
  }, [lang]);

  const value = useMemo(
    () =>
      makeI18n(lang, (next) => {
        setLangState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // 存储不可用时只在本次会话生效
        }
      }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
