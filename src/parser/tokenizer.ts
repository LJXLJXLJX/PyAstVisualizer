import { AstParseError } from './types';

export type TokenType =
  | 'ident'
  | 'string'
  | 'bytes'
  | 'number'
  | '('
  | ')'
  | '['
  | ']'
  | '{'
  | '}'
  | ','
  | '='
  | ':'
  | '.'
  | 'eof';

export interface Token {
  readonly type: TokenType;
  /** 源文本片段（字符串类为原始字面量） */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** 字符串：解码后的内容 */
  readonly str?: string;
  /** 字节串：解码后的字节 */
  readonly bytes?: number[];
}

const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', '=', ':', '.']);
const ID_START = /[\p{ID_Start}_]/u;
const ID_CONTINUE = /\p{ID_Continue}/u;
// Python 数字字面量：十进制整数/浮点/科学计数法，可带虚数后缀 j；以及 0x/0o/0b 整数。
const NUMBER_RE = /^(?:0[xX](?:_?[0-9a-fA-F])+|0[oO](?:_?[0-7])+|0[bB](?:_?[01])+|(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?[jJ]?)/;
const SIMPLE_ESCAPES: Record<string, string> = {
  '\\': '\\',
  "'": "'",
  '"': '"',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * 将 ast.dump 文本切分为 token。
 * 只做词法分析，不执行任何输入内容。
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;

  const fail = (reason: string, at: number): never => {
    throw new AstParseError(reason, source, at);
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '﻿') {
      i++;
      continue;
    }

    if (PUNCT.has(ch)) {
      // ".5" 这样的数字以点号开头
      if (ch === '.' && isDigit(source[i + 1])) {
        i = readNumber(i, i);
        continue;
      }
      tokens.push({ type: ch as TokenType, text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    if (ch === '+' || ch === '-') {
      const next = source[i + 1];
      if (isDigit(next) || (next === '.' && isDigit(source[i + 2]))) {
        i = readNumber(i, i + 1);
        continue;
      }
      const word = /^(inf|nan)j?/.exec(source.slice(i + 1, i + 6));
      if (word && !ID_CONTINUE.test(source[i + 1 + word[0].length] ?? '')) {
        const end = i + 1 + word[0].length;
        tokens.push({ type: 'number', text: source.slice(i, end), start: i, end });
        i = end;
        continue;
      }
      fail(`意外的字符 '${ch}'：符号只能出现在数字字面量前`, i);
    }

    if (isDigit(ch)) {
      i = readNumber(i, i);
      continue;
    }

    if (ch === "'" || ch === '"') {
      i = readString(i, i, '');
      continue;
    }

    const cp = source.codePointAt(i)!;
    const chFull = String.fromCodePoint(cp);
    if (ID_START.test(chFull)) {
      let j = i + chFull.length;
      while (j < n) {
        const c = String.fromCodePoint(source.codePointAt(j)!);
        if (!ID_CONTINUE.test(c)) break;
        j += c.length;
      }
      const word = source.slice(i, j);
      const quote = source[j];
      if ((quote === "'" || quote === '"') && /^(?:[bBuUrR]|[bB][rR]|[rR][bB])$/.test(word)) {
        i = readString(i, j, word.toLowerCase());
        continue;
      }
      tokens.push({ type: 'ident', text: word, start: i, end: j });
      i = j;
      continue;
    }

    if (ch === '<') {
      fail("遇到 '<'：ast.dump 中出现了无法解析的对象表示（如 <object at 0x...>），请确认字段值是 AST 节点或 Python 字面量", i);
    }
    if (ch === '#') {
      fail("不支持注释：'#' 不属于 ast.dump 输出格式", i);
    }
    fail(`意外的字符 '${chFull}' (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`, i);
  }

  tokens.push({ type: 'eof', text: '', start: n, end: n });
  return tokens;

  function readNumber(start: number, digitsStart: number): number {
    const m = NUMBER_RE.exec(source.slice(digitsStart, digitsStart + 400));
    if (!m || m[0].length === 0) return fail('无效的数字字面量', start);
    const end = digitsStart + m[0].length;
    // 数字后紧跟标识符字符，如 "12abc"
    const after = source[end];
    if (after !== undefined && ID_CONTINUE.test(after)) {
      fail('无效的数字字面量', start);
    }
    tokens.push({ type: 'number', text: source.slice(start, end), start, end });
    return end;
  }

  function readString(start: number, quotePos: number, prefix: string): number {
    const quote = source[quotePos]!;
    const isBytes = prefix.includes('b');
    const isRaw = prefix.includes('r');
    if (source[quotePos + 1] === quote && source[quotePos + 2] === quote) {
      fail('不支持三引号字符串（ast.dump 使用 repr，不会产生三引号）', start);
    }
    let j = quotePos + 1;
    let out = '';
    const bytes: number[] = [];

    const pushChar = (s: string, at: number) => {
      if (isBytes) {
        for (const c of s) {
          const code = c.codePointAt(0)!;
          if (code > 0x7f) fail('字节串中只能包含 ASCII 字符，非 ASCII 字节需用 \\x 转义', at);
          bytes.push(code);
        }
      } else {
        out += s;
      }
    };
    const pushByte = (b: number) => {
      if (isBytes) bytes.push(b);
      else out += String.fromCharCode(b);
    };

    while (true) {
      if (j >= n) fail('字符串没有结束引号', start);
      const c = source[j]!;
      if (c === quote) {
        j++;
        break;
      }
      if (c === '\n' || c === '\r') {
        fail('字符串内出现未转义的换行（repr 中的换行应写作 \\n）', start);
      }
      if (c !== '\\') {
        const cp = source.codePointAt(j)!;
        const s = String.fromCodePoint(cp);
        pushChar(s, j);
        j += s.length;
        continue;
      }
      // 反斜杠转义
      const escAt = j;
      const e = source[j + 1];
      if (e === undefined) fail('字符串没有结束引号', start);
      if (isRaw) {
        // 原始字符串：反斜杠保留，但仍可以转义引号
        pushChar('\\' + e, escAt);
        j += 2;
        continue;
      }
      if (e === '\n') {
        j += 2;
        continue;
      }
      if (e === '\r') {
        j += source[j + 2] === '\n' ? 3 : 2;
        continue;
      }
      const simple = SIMPLE_ESCAPES[e!];
      if (simple !== undefined) {
        pushChar(simple, escAt);
        j += 2;
        continue;
      }
      if (e! >= '0' && e! <= '7') {
        let k = j + 1;
        let digits = '';
        while (k < n && digits.length < 3 && source[k]! >= '0' && source[k]! <= '7') digits += source[k++];
        const v = parseInt(digits, 8);
        if (isBytes) bytes.push(v & 0xff);
        else out += String.fromCharCode(v);
        j = k;
        continue;
      }
      if (e === 'x') {
        const hex = source.slice(j + 2, j + 4);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail('\\x 转义需要 2 位十六进制数字', escAt);
        pushByte(parseInt(hex, 16));
        j += 4;
        continue;
      }
      if (!isBytes && (e === 'u' || e === 'U')) {
        const len = e === 'u' ? 4 : 8;
        const hex = source.slice(j + 2, j + 2 + len);
        if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) fail(`\\${e} 转义需要 ${len} 位十六进制数字`, escAt);
        const v = parseInt(hex, 16);
        if (v > 0x10ffff) fail(`\\${e} 转义超出 Unicode 范围`, escAt);
        out += v <= 0xffff ? String.fromCharCode(v) : String.fromCodePoint(v);
        j += 2 + len;
        continue;
      }
      if (!isBytes && e === 'N') {
        fail('不支持 \\N{...} 命名转义（Python repr 不会生成该形式）', escAt);
      }
      // 未知转义：与 Python 一致，保留反斜杠
      pushChar('\\', escAt);
      j += 1;
    }

    const raw = source.slice(start, j);
    if (isBytes) tokens.push({ type: 'bytes', text: raw, start, end: j, bytes });
    else tokens.push({ type: 'string', text: raw, start, end: j, str: out });
    return j;
  }
}
