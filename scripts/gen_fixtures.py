"""用真实的 Python ast.dump 生成测试夹具和应用内示例。

用法：python3 scripts/gen_fixtures.py

输出：
  tests/fixtures/<name>.dump.txt       ast.dump 原始输出
  tests/fixtures/<name>.expected.json  Python 侧导出的结构（用于逐字段核对解析结果）
  src/examples/<name>.txt              应用中可直接加载的示例
"""

import ast
import json
import math
import pathlib
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
EXAMPLES = ROOT / "src" / "examples"

FUNCTION_SRC = '''
@decorator(retries=3)
async def fetch(url: str, *, timeout: float = 1.5) -> dict:
    """抓取页面并返回 JSON。"""
    async with session.get(url, timeout=timeout) as resp:
        return await resp.json()


def greet(name, times=1, *args, greeting="你好", **kwargs):
    message = f"{greeting}, {name}!"
    return message * times
'''

LOOP_SRC = '''
total = 0
for i, item in enumerate(items):
    if item is None:
        continue
    elif item > 10:
        break
    total += item * i
else:
    print("完成")

while total > 0:
    total -= 1
'''

EXPR_SRC = '''
squares = [x ** 2 for x in range(10) if x % 2 == 0]
mapping = {k: v for k, v in pairs}
value = (a + b) * -c / d if flag else (lambda y: y[1:3])
ok = 0 < x <= 10 and not done or obj.attr["键"]
'''

STRINGS_SRC = r'''
s1 = 'it\'s "quoted"'
s2 = "反斜杠 \\ 和换行\n制表\t结束"
s3 = '括号 ( [ { } ] ) 逗号, 等号= 冒号:'
s4 = '\x00\x7f \U0001F600 é'
s5 = 'Module(body=[Name(id=\'x\')])'
b1 = b'\x00\xff\'"\\ abc'
nums = [0, -1, 0x10, 1_000, 3.14, 1e-7, 2j, 123456789012345678901234567890]
dots = ...
'''


class BuilderRewriter(ast.NodeTransformer):
    """把赋值和二元运算改写成 Builder 链式调用，模拟 AST 改写后的结果。"""

    OPS = {ast.Add: "add", ast.Sub: "sub", ast.Mult: "mul", ast.Div: "div"}

    def visit_BinOp(self, node):
        self.generic_visit(node)
        op = self.OPS.get(type(node.op))
        if op is None:
            return node
        return ast.Call(
            func=ast.Attribute(value=ast.Name(id="Builder", ctx=ast.Load()), attr=op, ctx=ast.Load()),
            args=[node.left, node.right],
            keywords=[],
        )

    def visit_Assign(self, node):
        self.generic_visit(node)
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            return node
        call = ast.Call(
            func=ast.Attribute(value=ast.Name(id="builder", ctx=ast.Load()), attr="assign", ctx=ast.Load()),
            args=[ast.Constant(value=target.id), node.value],
            keywords=[ast.keyword(arg="scope", value=ast.Constant(value="局部"))],
        )
        return ast.Expr(value=call)


BUILDER_SRC = '''
price = base + tax * rate
discount = price / 2 - 1
'''


class ConstantInjector(ast.NodeTransformer):
    """注入解析器本身不会产生、但 AST 改写后可能出现的常量值。"""

    def visit_Module(self, node):
        values = [(1, "二"), (), (3,), complex(1, -2), -math.inf, math.nan, -0.0, True, None]
        node.body.append(ast.Expr(value=ast.Tuple(elts=[ast.Constant(value=v) for v in values], ctx=ast.Load())))
        return node


def py_to_expected(value, *, include_attributes=False, annotate_fields=True):
    """按 ast.dump 的字段取舍规则导出结构，供 TypeScript 测试逐项对比。"""

    def conv(v):
        if isinstance(v, ast.AST):
            cls = type(v)
            fields = []
            keywords = annotate_fields
            for name in v._fields:
                try:
                    fv = getattr(v, name)
                except AttributeError:
                    keywords = True
                    continue
                if fv is None and getattr(cls, name, ...) is None:
                    keywords = True
                    continue
                fields.append([name if keywords else None, conv(fv)])
            if include_attributes and v._attributes:
                for name in v._attributes:
                    try:
                        fv = getattr(v, name)
                    except AttributeError:
                        continue
                    if fv is None and getattr(cls, name, ...) is None:
                        continue
                    fields.append([name, conv(fv)])
            return {"_type": cls.__name__, "fields": fields}
        if isinstance(v, list):
            return {"list": [conv(x) for x in v]}
        if isinstance(v, tuple):
            return {"tuple": [conv(x) for x in v]}
        if isinstance(v, str):
            return {"str": v}
        if isinstance(v, bytes):
            return {"bytes": list(v)}
        if v is None or v is Ellipsis or isinstance(v, bool):
            return {"const": repr(v)}
        if isinstance(v, int):
            return {"int": repr(v)}
        if isinstance(v, float):
            return {"float": repr(v)}
        if isinstance(v, complex):
            return {"complex": repr(v)}
        raise TypeError(f"unsupported value {v!r}")

    return conv(value)


def write_fixture(name, tree, **dump_kwargs):
    text = ast.dump(tree, **dump_kwargs)
    (FIXTURES / f"{name}.dump.txt").write_text(text + "\n", encoding="utf-8")
    expected = py_to_expected(
        tree,
        include_attributes=dump_kwargs.get("include_attributes", False),
        annotate_fields=dump_kwargs.get("annotate_fields", True),
    )
    (FIXTURES / f"{name}.expected.json").write_text(
        json.dumps(expected, ensure_ascii=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    return text


def write_example(name, text):
    (EXAMPLES / f"{name}.txt").write_text(text + "\n", encoding="utf-8")


def main():
    FIXTURES.mkdir(parents=True, exist_ok=True)
    EXAMPLES.mkdir(parents=True, exist_ok=True)

    func = ast.parse(textwrap.dedent(FUNCTION_SRC))
    loop = ast.parse(textwrap.dedent(LOOP_SRC))
    expr = ast.parse(textwrap.dedent(EXPR_SRC))
    strings = ast.parse(textwrap.dedent(STRINGS_SRC))
    builder = ast.fix_missing_locations(BuilderRewriter().visit(ast.parse(textwrap.dedent(BUILDER_SRC))))
    consts = ast.fix_missing_locations(ConstantInjector().visit(ast.parse("x = 1")))

    write_example("function", write_fixture("function_indent", func, indent=2))
    write_fixture("function_oneline", func)
    write_example("loop", write_fixture("loop_indent", loop, indent=4))
    write_example("expression", write_fixture("expression_indent", expr, indent=2))
    write_example("builder", write_fixture("builder_indent", builder, indent=2))
    write_example("attributes", write_fixture("loop_attributes", loop, indent=2, include_attributes=True))
    write_fixture("strings_oneline", strings)
    write_fixture("strings_indent", strings, indent="\t")
    write_fixture("constants_oneline", consts)
    write_fixture("positional", func, annotate_fields=False)

    # 真实标准库源码，作为较大规模样例
    import textwrap as tw_module

    big = ast.parse(pathlib.Path(tw_module.__file__).read_text(encoding="utf-8"))
    write_fixture("stdlib_textwrap", big)
    write_fixture("stdlib_textwrap_attributes", big, indent=1, include_attributes=True)

    print(f"Python {sys.version.split()[0]}: fixtures written to {FIXTURES}")


if __name__ == "__main__":
    main()
