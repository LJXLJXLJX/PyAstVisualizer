/**
 * ast.dump 文本解析后的只读数据模型。
 *
 * 所有值都保留在源文本中的区间 [start, end)，便于显示原文和定位错误。
 * 解析结果会被深度冻结（Object.freeze），视图层无法修改 AST 内容。
 */

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface AstNode extends Span {
  readonly kind: 'node';
  /** 节点类型名，如 FunctionDef、Call；允许带点号的限定名，如 ast.Name */
  readonly type: string;
  readonly fields: readonly AstField[];
}

export interface AstField {
  /** 命名字段的字段名；位置参数（annotate_fields=False）为 null */
  readonly name: string | null;
  /** 在参数列表中的序号（从 0 开始） */
  readonly index: number;
  readonly value: AstValue;
}

export interface AstSequence extends Span {
  readonly kind: 'list' | 'tuple' | 'set';
  readonly items: readonly AstValue[];
}

export interface AstDict extends Span {
  readonly kind: 'dict';
  readonly entries: readonly { readonly key: AstValue; readonly value: AstValue }[];
}

export interface AstString extends Span {
  readonly kind: 'str';
  /** 解码后的字符串内容 */
  readonly value: string;
  /** 源文本中的字面量，包括引号和转义 */
  readonly raw: string;
}

export interface AstBytes extends Span {
  readonly kind: 'bytes';
  /** 解码后的字节值（0-255） */
  readonly bytes: readonly number[];
  readonly raw: string;
}

export interface AstNumber extends Span {
  readonly kind: 'number';
  readonly numberType: 'int' | 'float' | 'complex';
  /** 保留原始文本，避免大整数和浮点数精度丢失 */
  readonly raw: string;
}

export interface AstConstant extends Span {
  readonly kind: 'constant';
  readonly value: 'None' | 'True' | 'False' | 'Ellipsis';
}

export type AstScalar = AstString | AstBytes | AstNumber | AstConstant;
export type AstValue = AstNode | AstSequence | AstDict | AstScalar;

export interface ParseStats {
  /** AST 节点（Name(...) 这类调用）的数量 */
  readonly nodeCount: number;
  /** 最大嵌套深度 */
  readonly maxDepth: number;
}

export interface ParseResult {
  readonly root: AstNode;
  readonly source: string;
  readonly stats: ParseStats;
}

export type Lang = 'en' | 'zh';

/** 同时携带英文和中文的文本，界面切换语言时无需重新解析 */
export interface Bilingual {
  readonly en: string;
  readonly zh: string;
}

export class AstParseError extends Error {
  readonly offset: number;
  /** 1 起始的行号 */
  readonly line: number;
  /** 1 起始的列号（按 Unicode 码点计数） */
  readonly column: number;
  /** 两种语言的错误原因 */
  readonly reasons: Bilingual;

  constructor(reasons: Bilingual, source: string, offset: number) {
    const { line, column } = offsetToLineColumn(source, offset);
    super(`Line ${line}, column ${column}: ${reasons.en}`);
    this.name = 'AstParseError';
    this.reasons = reasons;
    this.offset = offset;
    this.line = line;
    this.column = column;
  }

  /** 英文错误原因 */
  get reason(): string {
    return this.reasons.en;
  }

  format(lang: Lang): string {
    return lang === 'zh'
      ? `第 ${this.line} 行，第 ${this.column} 列：${this.reasons.zh}`
      : `Line ${this.line}, column ${this.column}: ${this.reasons.en}`;
  }
}

export function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(offset, source.length);
  for (let i = 0; i < limit; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  const column = Array.from(source.slice(lineStart, limit)).length + 1;
  return { line, column };
}
