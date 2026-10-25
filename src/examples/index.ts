import attributes from './attributes.txt?raw';
import builder from './builder.txt?raw';
import expression from './expression.txt?raw';
import fn from './function.txt?raw';
import loop from './loop.txt?raw';
import type { Bilingual } from '../parser';

/** 由 scripts/gen_fixtures.py 调用真实 Python ast.dump 生成 */
export const EXAMPLES: { id: string; title: Bilingual; text: string }[] = [
  { id: 'function', title: { en: 'Function', zh: '函数定义' }, text: fn },
  { id: 'loop', title: { en: 'Loops & branches', zh: '循环与分支' }, text: loop },
  { id: 'expression', title: { en: 'Expressions', zh: '表达式' }, text: expression },
  { id: 'builder', title: { en: 'AST rewrite: Builder calls', zh: 'AST 改写：Builder 调用' }, text: builder },
  { id: 'attributes', title: { en: 'Position fields (include_attributes)', zh: '带位置字段 (include_attributes)' }, text: attributes },
];
