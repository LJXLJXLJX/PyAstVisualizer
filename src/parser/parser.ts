import { tokenize, type Token, type TokenType } from './tokenizer';
import {
  AstParseError,
  type AstConstant,
  type AstField,
  type AstNode,
  type AstNumber,
  type AstValue,
  type ParseResult,
} from './types';

export const LIMITS = {
  /** 输入文本最大字符数 */
  maxInputChars: 5_000_000,
  /** 最大嵌套深度（节点、列表、元组等每层计 1） */
  maxDepth: 400,
  /** 最大 AST 节点数量 */
  maxNodes: 50_000,
} as const;

export interface ParseOptions {
  maxInputChars?: number;
  maxDepth?: number;
  maxNodes?: number;
}

const CONSTANT_NAMES = new Set(['None', 'True', 'False', 'Ellipsis']);
const FLOAT_WORDS = new Set(['inf', 'nan']);

/**
 * 解析 ast.dump() 的输出文本。
 *
 * 文法（递归下降）：
 *   value    := node | list | tuple | set | dict | STRING | BYTES | NUMBER | complex
 *             | None | True | False | Ellipsis | inf | nan
 *   node     := NAME ('.' NAME)* '(' [arg (',' arg)* [',']] ')'
 *   arg      := NAME '=' value | value
 *   list     := '[' [value (',' value)* [',']] ']'
 *   tuple    := '(' ')' | '(' value ',' ')' | '(' value (',' value)+ [','] ')'
 *   set      := '{' value (',' value)* [','] '}'
 *   dict     := '{' '}' | '{' value ':' value (',' value ':' value)* [','] '}'
 *   complex  := '(' NUMBER SIGNED_IMAG ')'          例如 (1+2j)
 *
 * 输入只作为数据处理，不使用 eval / Function。
 */
export function parseAstDump(source: string, options: ParseOptions = {}): ParseResult {
  const maxInputChars = options.maxInputChars ?? LIMITS.maxInputChars;
  const maxDepth = options.maxDepth ?? LIMITS.maxDepth;
  const maxNodes = options.maxNodes ?? LIMITS.maxNodes;

  if (source.length > maxInputChars) {
    throw new AstParseError(
      `输入过大：${source.length.toLocaleString()} 个字符，超过上限 ${maxInputChars.toLocaleString()}`,
      source,
      0,
    );
  }

  const tokens = tokenize(source);
  let pos = 0;
  let nodeCount = 0;
  let maxSeenDepth = 0;

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)]!;
  const next = (): Token => tokens[pos++]!;
  const fail = (reason: string, tok: Token = peek()): never => {
    throw new AstParseError(reason, source, tok.start);
  };
  const describe = (tok: Token): string => (tok.type === 'eof' ? '输入结尾' : `'${truncate(tok.text)}'`);
  const expect = (type: TokenType, what: string): Token => {
    const tok = peek();
    if (tok.type !== type) fail(`期望 ${what}，实际是 ${describe(tok)}`);
    return next();
  };

  const first = peek();
  if (first.type === 'eof') fail('输入为空');
  if (first.type !== 'ident' || !isNodeStart()) {
    fail('顶层必须是 AST 节点，例如 Module(body=[...])');
  }
  const root = parseValue(1) as AstNode;
  if (peek().type !== 'eof') {
    fail(`节点结束后存在多余内容 ${describe(peek())}（一次只能解析一个 ast.dump 结果）`);
  }

  deepFreeze(root);
  return Object.freeze({ root, source, stats: Object.freeze({ nodeCount, maxDepth: maxSeenDepth }) });

  function isNodeStart(): boolean {
    let k = 0;
    if (peek(k).type !== 'ident') return false;
    k++;
    while (peek(k).type === '.' && peek(k + 1).type === 'ident') k += 2;
    return peek(k).type === '(';
  }

  function enter(depth: number, tok: Token) {
    if (depth > maxDepth) fail(`嵌套过深：超过最大深度 ${maxDepth}`, tok);
    if (depth > maxSeenDepth) maxSeenDepth = depth;
  }

  function parseValue(depth: number): AstValue {
    const tok = peek();
    switch (tok.type) {
      case 'ident':
        if (isNodeStart()) return parseNode(depth);
        return parseWord();
      case 'string':
        next();
        return { kind: 'str', value: tok.str!, raw: tok.text, start: tok.start, end: tok.end };
      case 'bytes':
        next();
        return { kind: 'bytes', bytes: tok.bytes!, raw: tok.text, start: tok.start, end: tok.end };
      case 'number':
        next();
        return makeNumber(tok);
      case '[':
        return parseList(depth);
      case '(':
        return parseParen(depth);
      case '{':
        return parseBrace(depth);
      default:
        return fail(`期望一个值，实际是 ${describe(tok)}`);
    }
  }

  function parseWord(): AstValue {
    const tok = next();
    if (CONSTANT_NAMES.has(tok.text)) {
      return { kind: 'constant', value: tok.text as AstConstant['value'], start: tok.start, end: tok.end };
    }
    if (FLOAT_WORDS.has(tok.text) || tok.text === 'infj' || tok.text === 'nanj') {
      return makeNumber(tok);
    }
    if (peek().type === '=') {
      return fail(`字段 '${tok.text}=' 只能出现在节点的括号内`, tok);
    }
    return fail(`无法识别的名称 '${truncate(tok.text)}'：后面应跟 '(' 构成节点，或使用 None/True/False/Ellipsis 等字面量`, tok);
  }

  function parseNode(depth: number): AstNode {
    const startTok = peek();
    enter(depth, startTok);
    let type = next().text;
    while (peek().type === '.') {
      next();
      type += '.' + expect('ident', '名称').text;
    }
    expect('(', "'('");
    nodeCount++;
    if (nodeCount > maxNodes) fail(`节点过多：超过上限 ${maxNodes.toLocaleString()} 个`, startTok);

    const fields: AstField[] = [];
    const seen = new Set<string>();
    let sawKeyword = false;
    while (peek().type !== ')') {
      const argTok = peek();
      if (argTok.type === 'eof') fail(`节点 ${type} 缺少右括号 ')'`, startTok);
      if (argTok.type === 'ident' && peek(1).type === '=') {
        next();
        next();
        const name = argTok.text;
        if (seen.has(name)) fail(`节点 ${type} 中字段 '${name}' 重复`, argTok);
        seen.add(name);
        sawKeyword = true;
        fields.push({ name, index: fields.length, value: parseValue(depth + 1) });
      } else {
        if (sawKeyword) fail(`节点 ${type} 中位置参数不能出现在命名字段之后`, argTok);
        fields.push({ name: null, index: fields.length, value: parseValue(depth + 1) });
      }
      if (peek().type === ',') {
        next();
      } else if (peek().type === 'eof') {
        fail(`节点 ${type} 缺少右括号 ')'`, startTok);
      } else if (peek().type !== ')') {
        fail(`节点 ${type} 的字段之间期望 ',' 或 ')'，实际是 ${describe(peek())}`);
      }
    }
    const endTok = next();
    return { kind: 'node', type, fields, start: startTok.start, end: endTok.end };
  }

  function parseList(depth: number): AstValue {
    const open = next();
    enter(depth, open);
    const items = parseItems(depth, ']', '列表', open);
    const close = next();
    return { kind: 'list', items, start: open.start, end: close.end };
  }

  function parseItems(depth: number, close: TokenType, what: string, open: Token): AstValue[] {
    const items: AstValue[] = [];
    while (peek().type !== close) {
      if (peek().type === 'eof') fail(`${what}缺少结束符 '${close}'`, open);
      items.push(parseValue(depth + 1));
      if (peek().type === ',') next();
      else if (peek().type === 'eof') fail(`${what}缺少结束符 '${close}'`, open);
      else if (peek().type !== close) fail(`${what}元素之间期望 ',' 或 '${close}'，实际是 ${describe(peek())}`);
    }
    return items;
  }

  function parseParen(depth: number): AstValue {
    const open = next();
    enter(depth, open);
    // 复数 repr：(1+2j)、(-0-1j)、(nan+infj)
    const a = peek();
    const b = peek(1);
    if (
      (a.type === 'number' || (a.type === 'ident' && FLOAT_WORDS.has(a.text))) &&
      b.type === 'number' &&
      /^[+-]/.test(b.text) &&
      /[jJ]$/.test(b.text) &&
      peek(2).type === ')'
    ) {
      next();
      next();
      const close = next();
      return { kind: 'number', numberType: 'complex', raw: source.slice(open.start, close.end), start: open.start, end: close.end };
    }

    const items: AstValue[] = [];
    let sawComma = false;
    while (peek().type !== ')') {
      if (peek().type === 'eof') fail("元组缺少结束符 ')'", open);
      items.push(parseValue(depth + 1));
      if (peek().type === ',') {
        next();
        sawComma = true;
      } else if (peek().type === 'eof') {
        fail("元组缺少结束符 ')'", open);
      } else if (peek().type !== ')') {
        fail(`元组元素之间期望 ',' 或 ')'，实际是 ${describe(peek())}`);
      }
    }
    const close = next();
    if (items.length === 1 && !sawComma) {
      // 括号仅用于分组，例如 (1)，按内部值处理
      return items[0]!;
    }
    return { kind: 'tuple', items, start: open.start, end: close.end };
  }

  function parseBrace(depth: number): AstValue {
    const open = next();
    enter(depth, open);
    if (peek().type === '}') {
      const close = next();
      return { kind: 'dict', entries: [], start: open.start, end: close.end };
    }
    const firstVal = parseValue(depth + 1);
    if (peek().type === ':') {
      next();
      const entries = [{ key: firstVal, value: parseValue(depth + 1) }];
      while (peek().type === ',') {
        next();
        if (peek().type === '}') break;
        const key = parseValue(depth + 1);
        expect(':', "字典中的 ':'");
        entries.push({ key, value: parseValue(depth + 1) });
      }
      if (peek().type === 'eof') fail("字典缺少结束符 '}'", open);
      if (peek().type !== '}') fail(`字典元素之间期望 ',' 或 '}'，实际是 ${describe(peek())}`);
      const close = next();
      return { kind: 'dict', entries, start: open.start, end: close.end };
    }
    const items = [firstVal];
    if (peek().type === ',') {
      next();
      items.push(...parseItems(depth, '}', '集合', open));
    } else if (peek().type === 'eof') {
      fail("集合缺少结束符 '}'", open);
    } else if (peek().type !== '}') {
      fail(`集合元素之间期望 ',' 或 '}'，实际是 ${describe(peek())}`);
    }
    const close = next();
    return { kind: 'set', items, start: open.start, end: close.end };
  }

  function makeNumber(tok: Token): AstNumber {
    const t = tok.text;
    let numberType: AstNumber['numberType'];
    if (/[jJ]$/.test(t)) numberType = 'complex';
    else if (/^[+-]?0[xXoObB]/.test(t)) numberType = 'int';
    else if (/[.eE]|inf|nan/.test(t)) numberType = 'float';
    else numberType = 'int';
    return { kind: 'number', numberType, raw: t, start: tok.start, end: tok.end };
  }
}

function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function deepFreeze(value: unknown): void {
  // 迭代实现，避免深层结构导致递归栈溢出
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const child of Object.values(v)) stack.push(child);
    }
  }
}
