import { createContext, useContext } from 'react';
import type { Bilingual, Lang } from '../parser';

export type { Bilingual, Lang };

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** 按当前语言选择文本：tr('Re-arrange', '重新排列') */
  tr: (en: string, zh: string) => string;
  /** 选择 Bilingual 对象中当前语言的文本 */
  pick: (text: Bilingual) => string;
  /** 千分位数字 */
  num: (n: number) => string;
}

export const STORAGE_KEY = 'pyast.lang';

export function makeI18n(lang: Lang, setLang: (lang: Lang) => void): I18n {
  return {
    lang,
    setLang,
    tr: (en, zh) => (lang === 'zh' ? zh : en),
    pick: (text) => text[lang],
    num: (n) => n.toLocaleString('en-US'),
  };
}

export const I18nContext = createContext<I18n>(makeI18n('en', () => {}));

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** 读取上次选择的语言；存储不可用（隐私模式等）时回退到英文 */
export function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // 忽略
  }
  return 'en';
}
