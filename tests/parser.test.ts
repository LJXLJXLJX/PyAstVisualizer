import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AstParseError, parseAstDump, type AstNode, type AstValue } from '../src/parser';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/** 把解析结果转换为 scripts/gen_fixtures.py 导出的同构 JSON */
function toExpected(v: AstValue): unknown {
  switch (v.kind) {
    case 'node':
      return { _type: v.type, fields: v.fields.map((f) => [f.name, toExpected(f.value)]) };
    case 'list':
      return { list: v.items.map(toExpected) };
    case 'tuple':
      return { tuple: v.items.map(toExpected) };
    case 'set':
      return { set: v.items.map(toExpected) };
    case 'dict':
      return { dict: v.entries.map((e) => [toExpected(e.key), toExpected(e.value)]) };
    case 'str':
      return { str: v.value };
    case 'bytes':
      return { bytes: [...v.bytes] };
    case 'constant':
      return { const: v.value };
    case 'number':
      return { [v.numberType]: v.raw };
  }
}

function field(node: AstValue, name: string): AstValue {
  if (node.kind !== 'node') throw new Error(`not a node: ${node.kind}`);
  const f = node.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name} on ${node.type}`);
  return f.value;
}

function item(v: AstValue, i: number): AstValue {
  if (v.kind !== 'list' && v.kind !== 'tuple') throw new Error(`not a sequence: ${v.kind}`);
  return v.items[i]!;
}

function parseError(src: string): AstParseError {
  try {
    parseAstDump(src);
  } catch (e) {
    if (e instanceof AstParseError) return e;
    throw e;
  }
  throw new Error('expected parse error');
}

describe('真实 Python ast.dump 样例', () => {
  const names = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.dump.txt'))
    .map((f) => f.replace('.dump.txt', ''));

  it('存在夹具文件', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  for (const name of names) {
    it(`${name} 与 Python 侧结构完全一致`, () => {
      const text = readFileSync(join(FIXTURES, `${name}.dump.txt`), 'utf8');
      const expected = JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), 'utf8'));
      const result = parseAstDump(text);
      expect(toExpected(result.root)).toEqual(expected);
    });
  }

  it('单行与 indent 格式得到相同结构', () => {
    const one = parseAstDump(readFileSync(join(FIXTURES, 'function_oneline.dump.txt'), 'utf8'));
    const ind = parseAstDump(readFileSync(join(FIXTURES, 'function_indent.dump.txt'), 'utf8'));
    expect(toExpected(one.root)).toEqual(toExpected(ind.root));
  });
});

describe('嵌套与列表顺序', () => {
  it('保持字段与列表元素顺序', () => {
    const r = parseAstDump(
      "Module(body=[Expr(value=Name(id='a')), Expr(value=Name(id='b')), Expr(value=Name(id='c'))], type_ignores=[])",
    );
    expect(r.root.type).toBe('Module');
    expect(r.root.fields.map((f) => f.name)).toEqual(['body', 'type_ignores']);
    const body = field(r.root, 'body');
    const ids = [0, 1, 2].map((i) => {
      const id = field(field(item(body, i), 'value'), 'id');
      return id.kind === 'str' ? id.value : null;
    });
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(r.stats.nodeCount).toBe(7);
  });

  it('解析深层嵌套', () => {
    const r = parseAstDump('A(x=B(y=C(z=[D(), [E(w=[])]])))');
    const z = field(field(field(r.root, 'x'), 'y'), 'z');
    expect(z.kind).toBe('list');
    const inner = item(item(z, 1), 0) as AstNode;
    expect(inner.type).toBe('E');
    expect(r.stats.maxDepth).toBe(7);
  });

  it('支持尾随逗号、限定名、空节点', () => {
    const r = parseAstDump('ast.Module(body=[Pass(),], type_ignores=[],)');
    expect(r.root.type).toBe('ast.Module');
    expect(item(field(r.root, 'body'), 0)).toMatchObject({ kind: 'node', type: 'Pass', fields: [] });
  });

  it('支持位置参数（annotate_fields=False）', () => {
    const r = parseAstDump("Name('x', Load())");
    expect(r.root.fields.map((f) => [f.name, f.value.kind])).toEqual([
      [null, 'str'],
      [null, 'node'],
    ]);
  });

  it('支持元组、集合、字典字面量', () => {
    const r = parseAstDump("C(a=(1, 'x'), b=(1,), c=(), d={1, 2}, e={'k': [1]}, f={}, g=(5))");
    const kinds = r.root.fields.map((f) => f.value.kind);
    expect(kinds).toEqual(['tuple', 'tuple', 'tuple', 'set', 'dict', 'dict', 'number']);
  });
});

describe('字符串与转义', () => {
  it('处理引号、反斜杠、括号与换行转义', () => {
    const r = parseAstDump(String.raw`C(a='it\'s "q"', b="it's", c='a\\b\nc\td', d='( [ { , = ) ] }', e='\x41中\U0001F600')`);
    const vals = r.root.fields.map((f) => (f.value.kind === 'str' ? f.value.value : null));
    expect(vals).toEqual([`it's "q"`, `it's`, 'a\\b\nc\td', '( [ { , = ) ] }', 'A中😀']);
  });

  it('处理中文与 emoji 直接出现在字符串中', () => {
    const r = parseAstDump("Name(id='变量_😀', ctx=Load())");
    const id = field(r.root, 'id');
    expect(id).toMatchObject({ kind: 'str', value: '变量_😀', raw: "'变量_😀'" });
  });

  it('支持非 ASCII 标识符作为节点名和字段名', () => {
    const r = parseAstDump("节点(名称='值')");
    expect(r.root.type).toBe('节点');
    expect(r.root.fields[0]!.name).toBe('名称');
  });

  it('处理孤立代理项、八进制与未知转义', () => {
    const r = parseAstDump(String.raw`C(a='\ud800', b='\101\0', c='\d')`);
    const vals = r.root.fields.map((f) => (f.value.kind === 'str' ? f.value.value : null));
    expect(vals).toEqual(['\ud800', 'A\0', '\\d']);
  });

  it('解码字节串', () => {
    const r = parseAstDump(String.raw`Constant(value=b'\x00\xffA\'\\')`);
    expect(field(r.root, 'value')).toMatchObject({ kind: 'bytes', bytes: [0, 255, 65, 39, 92] });
  });

  it('跨行字符串报错（repr 不会包含真实换行）', () => {
    const e = parseError("Constant(value='abc\ndef')");
    expect(e.line).toBe(1);
    expect(e.column).toBe(16);
    expect(e.reason).toContain('换行');
  });
});

describe('数字与常量', () => {
  it('保留数字原文和类型', () => {
    const r = parseAstDump('C(a=1, b=-2.5, c=1e-07, d=2j, e=(1-2j), f=inf, g=-inf, h=nan, i=0x1F, j=123456789012345678901234567890)');
    expect(r.root.fields.map((f) => (f.value.kind === 'number' ? [f.value.numberType, f.value.raw] : null))).toEqual([
      ['int', '1'],
      ['float', '-2.5'],
      ['float', '1e-07'],
      ['complex', '2j'],
      ['complex', '(1-2j)'],
      ['float', 'inf'],
      ['float', '-inf'],
      ['float', 'nan'],
      ['int', '0x1F'],
      ['int', '123456789012345678901234567890'],
    ]);
  });

  it('识别 None/True/False/Ellipsis', () => {
    const r = parseAstDump('C(a=None, b=True, c=False, d=Ellipsis)');
    expect(r.root.fields.map((f) => (f.value.kind === 'constant' ? f.value.value : null))).toEqual([
      'None',
      'True',
      'False',
      'Ellipsis',
    ]);
  });
});

describe('位置字段 include_attributes=True', () => {
  it('解析 lineno/col_offset/end_lineno/end_col_offset', () => {
    const text = readFileSync(join(FIXTURES, 'loop_attributes.dump.txt'), 'utf8');
    const r = parseAstDump(text);
    const assign = item(field(r.root, 'body'), 0) as AstNode;
    expect(assign.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['lineno', 'col_offset', 'end_lineno', 'end_col_offset']),
    );
    expect(field(assign, 'lineno')).toMatchObject({ kind: 'number', raw: '2' });
  });
});

describe('非法输入', () => {
  const cases: [string, string, number, number, string][] = [
    ['空输入', '   \n  ', 2, 3, '输入为空'],
    ['缺少右括号', 'Module(body=[]', 1, 1, "缺少右括号"],
    ['缺少右方括号', 'Module(body=[Pass()', 1, 13, "缺少结束符 ']'"],
    ['未结束字符串', "Name(id='x)", 1, 9, '没有结束引号'],
    ['未知名称', 'Name(id=foo)', 1, 9, "无法识别的名称 'foo'"],
    ['多余内容', 'Pass() Pass()', 1, 8, '多余内容'],
    ['顶层不是节点', '[1, 2]', 1, 1, '顶层必须是 AST 节点'],
    ['重复字段', "Name(id='a', id='b')", 1, 14, "字段 'id' 重复"],
    ['位置参数在命名字段后', "Name(id='a', Load())", 1, 14, '位置参数不能出现在命名字段之后'],
    ['缺少逗号', "Name(id='a' ctx=Load())", 1, 13, "期望 ',' 或 ')'"],
    ['对象 repr', 'Constant(value=<object at 0x10>)', 1, 16, "'<'"],
    ['注释', 'Pass() # hi', 1, 8, '不支持注释'],
    ['非法转义', String.raw`Constant(value='\x4')`, 1, 17, '\\x 转义需要'],
    ['三引号', "Constant(value='''a''')", 1, 16, '三引号'],
    ['非法数字', 'Constant(value=12abc)', 1, 16, '无效的数字'],
    ['元组未结束', 'C(a=(1, 2', 1, 5, "元组缺少结束符"],
    ['字典未结束', "C(a={'k': 1", 1, 5, "字典缺少结束符"],
    ['孤立的等号', 'Name(=1)', 1, 6, '期望一个值'],
  ];

  for (const [title, src, line, column, reason] of cases) {
    it(`${title}：报告第 ${line} 行第 ${column} 列`, () => {
      const e = parseError(src);
      expect(e.reason).toContain(reason);
      expect([e.line, e.column]).toEqual([line, column]);
      expect(e.message).toBe(`第 ${line} 行，第 ${column} 列：${e.reason}`);
    });
  }

  it('多行输入中定位到正确行列，中文按字符计数', () => {
    const e = parseError("Module(\n  body=[\n    Expr(value=Constant(value='中文'), 错误)])");
    expect([e.line, e.column]).toEqual([3, 38]);
    expect(e.reason).toContain('位置参数');
  });

  it('超过最大深度时报错', () => {
    const deep = 'A(x='.repeat(50) + 'None' + ')'.repeat(50);
    expect(() => parseAstDump(deep, { maxDepth: 40 })).toThrow(/嵌套过深/);
    expect(parseAstDump(deep, { maxDepth: 60 }).stats.maxDepth).toBe(50);
  });

  it('默认深度上限可以安全报错而不是栈溢出', () => {
    const deep = '['.repeat(100_000);
    const src = 'A(x=' + deep;
    expect(() => parseAstDump(src)).toThrow(/嵌套过深/);
  });

  it('超大输入与节点过多时报错', () => {
    expect(() => parseAstDump('Pass()' + ' '.repeat(100), { maxInputChars: 50 })).toThrow(/输入过大/);
    const many = `Module(body=[${'Pass(), '.repeat(20)}])`;
    expect(() => parseAstDump(many, { maxNodes: 10 })).toThrow(/节点过多/);
  });
});

describe('只读', () => {
  it('解析结果被深度冻结', () => {
    const r = parseAstDump("Module(body=[Expr(value=Name(id='a', ctx=Load()))], type_ignores=[])");
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.root)).toBe(true);
    const body = field(r.root, 'body');
    expect(Object.isFrozen(body)).toBe(true);
    expect(() => {
      (r.root as { type: string }).type = 'X';
    }).toThrow(TypeError);
    expect(() => {
      (body as unknown as { items: AstValue[] }).items.push(r.root);
    }).toThrow(TypeError);
  });

  it('不执行输入内容', () => {
    const marker = '__pyast_executed__';
    const g = globalThis as Record<string, unknown>;
    delete g[marker];
    expect(() => parseAstDump(`Module(body=[globalThis.${marker}=1])`)).toThrow(AstParseError);
    expect(() => parseAstDump(`Constant(value='\\'); globalThis.${marker}=1; //')`)).not.toThrow();
    expect(g[marker]).toBeUndefined();
  });
});
