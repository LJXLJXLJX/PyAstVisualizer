**在线使用：https://ljxljxljx.github.io/PyAstVisualizer/**

# Python AST 可视化

[English](README.md) | 简体中文

把 Python `ast.dump()` 的输出文本粘贴进来，就能看到类似 ComfyUI 的节点画布：每个 AST 节点是一张卡片，子节点通过字段端口（如 `body[0]`、`value`）用曲线相连。AST 内容和结构只读，节点可以自由拖动、框选、折叠、重新排列，并导出 PNG。

- 纯前端：TypeScript + React + Vite，画布用 [React Flow](https://reactflow.dev/)（`@xyflow/react`），初始布局用 Dagre。
- 解析和渲染都在浏览器本地完成，不上传数据，构建产物可直接部署到 GitHub Pages。
- 直接解析 `ast.dump` 文本：自写 tokenizer + 递归下降 parser，**不使用** `eval`、`Function`，也不执行输入内容。

## 快速开始

需要 Node.js 22.12+ 或 24+（Vitest 5 的要求；开发时用的是 Node 26 / npm 11）。

```bash
npm install
npm run dev        # 开发服务器，默认 http://localhost:5173
```

在 Python 中生成输入：

```python
import ast
print(ast.dump(ast.parse(source), indent=2))
# 也支持单行输出、include_attributes=True、annotate_fields=False
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查并构建到 `dist/` |
| `npm run preview` | 本地预览构建产物 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试（parser、图模型、视图状态） |
| `npm run test:e2e` | Playwright 端到端测试（首次需 `npx playwright install chromium`） |
| `npm run fixtures` | 用本机 Python 重新生成测试夹具和应用内示例 |

`test:e2e` 会先以 `BASE_PATH=/PyAstVisualizer/` 构建到 `dist-e2e/` 并用 `vite preview` 启动，因此同时验证了 GitHub Pages 子路径下的资源加载。

## 功能

**输入**：粘贴文本、打开或拖入本地文本文件、5 个内置示例（函数、循环与分支、表达式、AST 改写后的 Builder 调用、带位置字段）。示例由 `scripts/gen_fixtures.py` 调用真实的 Python `ast.dump` 生成。⌘/Ctrl+Enter 解析。

**画布**

- 深色网格背景，卡片标题为节点类型，标题颜色按类别区分（定义、控制流、语句、访问/调用、名称、字面量、运算符……）。
- `name`、`id`、`value` 等简单属性显示在卡片内；子节点通过右侧字段端口连出，列表项保留顺序和索引（`body[0]`、`body[1]`…）。卡片标题右侧还会显示该节点在父节点中的字段名，因此连线两端都能看清。
- 默认把 `None`、空列表和位置信息（`lineno` 等）收纳为一行"+N 项已收纳"；勾选“显示收纳字段”可在卡片上展开，详情面板始终显示全部字段。
- 长文本在卡片上只显示摘要；点击节点，在右侧详情面板查看完整 repr、解码后的字符串，并可复制单个属性、节点路径或该节点的原始 dump 文本。
- **内联无字段节点**（默认开启）：`Load()`、`Store()`、`Add()` 这类没有字段的节点显示为父卡片上的属性，不单独成卡，避免每个 `Name` 都多挂一张 `Load` 卡片。取消勾选后，每个 AST 节点都有自己的卡片。

**交互**

- 拖动节点；Shift+拖动框选，⌘/Ctrl+点击多选，选中的多个节点一起移动。
- 拖动空白处平移，滚轮缩放，小地图，适应屏幕。
- 卡片右上角 ▾/▸ 折叠和展开子树；“全部展开”“全部折叠”。
- 导入时自动布局一次。之后拖动、选择、折叠/展开都**不会**重排已有节点：折叠时记住子节点相对父节点的偏移，展开时跟随父节点当前位置恢复；新出现的节点只在局部布局。需要时点“重新排列”。
- 导出 PNG（包含全部可见卡片和连线，按内容包围盒裁剪）。

**只读保证**

- 解析结果整体 `Object.freeze`，任何修改都会抛错。
- 画布只接收位置、选择、尺寸测量这三类变更，删除/新增/替换节点的变更被丢弃；删除键已禁用；端口 `isConnectable=false`，连线不可重连、不可删除。
- AST/图模型（`src/parser`、`src/graph/model.ts`）与视图状态（坐标、折叠、选择，`src/graph/view.ts`）分开管理。

**界面语言**：默认英文。画布左上角的全局 EN / 中文 按钮可切换全部按钮、提示和解析错误（包括已显示的错误），无需重新解析；选择会保存在浏览器中。本文中的按钮名称对应中文界面。

## 支持的输入格式

文法（详见 `src/parser/parser.ts`）：

```
value    := node | list | tuple | set | dict | STRING | BYTES | NUMBER | complex
          | None | True | False | Ellipsis | inf | nan
node     := NAME ('.' NAME)* '(' [arg (',' arg)* [',']] ')'
arg      := NAME '=' value | value
list     := '[' [value (',' value)* [',']] ']'
tuple    := '(' ')' | '(' value ',' ')' | '(' value (',' value)+ [','] ')'
set      := '{' value (',' value)* [','] '}'
dict     := '{' '}' | '{' value ':' value (',' value ':' value)* [','] '}'
complex  := '(' NUMBER SIGNED_IMAG ')'          例如 (1+2j)
```

- 任意节点名（包括非 ASCII 标识符）和限定名 `ast.Name(...)`；命名字段，以及 `annotate_fields=False` 产生的位置参数（显示为 `#0`、`#1`…）。
- 单行与任意 `indent`（空格、制表符、字符串缩进）格式；`\r\n` 换行。
- 字符串：单/双引号，全部 Python 转义（`\\ \' \" \n \r \t \a \b \f \v`、八进制、`\xhh`、`\uXXXX`、`\UXXXXXXXX`、行续接），未知转义按 Python 规则保留反斜杠；字符串内的括号、逗号、中文和 emoji 都按数据处理。前缀 `b` `u` `r` 及组合。
- 字节串：解码为字节，非 ASCII 字符必须转义。
- 数字：整数（含大整数、`0x/0o/0b`、下划线）、浮点（科学计数法、`inf`、`-inf`、`nan`）、复数（`2j`、`(1-2j)`），保留原文，不丢精度。
- `include_attributes=True` 带来的 `lineno`、`col_offset`、`end_lineno`、`end_col_offset`。
- 顶层必须是一个节点；结尾后的多余内容会报错。

**明确不支持（报错，不会静默丢弃）**：三引号字符串、`\N{...}` 命名转义（Python repr 都不会产生）、注释、`<object at 0x…>` 这类不可解析的 repr、一次输入多个 dump。`frozenset({1})` 这样的调用会被当作名为 `frozenset` 的节点显示。

错误信息包含行号、列号（按 Unicode 字符计数，中文算 1 列）和原因，例如 `第 2 行，第 21 列：节点 Name 的字段之间期望 ',' 或 ')'，实际是 'ctx'`，面板中会高亮出错字符。

## 限制与性能

保护上限（`src/parser/parser.ts` 中的 `LIMITS`）：

| 项目 | 上限 | 超出时 |
| --- | --- | --- |
| 输入长度 | 5,000,000 字符 | 报错“输入过大” |
| 嵌套深度 | 400 层（节点、列表各算一层） | 报错“嵌套过深”，不会栈溢出 |
| AST 节点数 | 50,000 | 报错“节点过多” |
| 初始显示 | 600 张卡片 | 自动折叠较深层级并提示 |
| “全部展开” | 超过 2,000 张卡片时先确认 | — |
| 导出 PNG | 1,500 张可见卡片；输出边长 ≤ 8192 px、面积 ≤ 4000 万像素 | 超过卡片数时提示先折叠；尺寸超限时自动缩小 |

在 Apple Silicon Mac、headless Chromium 中实测（生产构建）：

| 输入 | 结果 |
| --- | --- |
| 内置示例（约 50 张卡片） | 即时渲染，导出约 1 秒 |
| 标准库 `textwrap.py`，带位置字段，173 KB，1,002 张卡片 | 导入 + 初始渲染约 0.25 秒（自动折叠到 551 张）；全部展开约 0.25 秒；重新排列约 0.4 秒；拖动流畅；导出 PNG 约 13 秒 |
| 标准库 `argparse.py`，567 KB，11,925 个 AST 节点 / 7,687 张卡片 | 解析 17 ms；全部展开约 4.5 秒（Dagre 约 0.9 秒，其余为 DOM 渲染）；缩放约 7–10 fps，明显卡顿；超出导出上限（未导出） |

结论：**几百到一千张卡片可流畅浏览**；数千张卡片可以打开，但展开和缩放明显变慢，建议保持部分子树折叠。超过 1,500 张可见卡片时启用视口虚拟化（只渲染视口内的卡片），但整图视图下帮助有限。

其他已知限制：

- Dagre 的初始布局关闭了交叉最小化以保持字段顺序；局部展开出的新节点可能与已有卡片重叠，点“重新排列”即可。
- 切换“显示收纳字段”会改变卡片高度，但不会自动重排（按设计，普通交互不重排）。
- 导出依赖 `html-to-image` 克隆 DOM，只导出 PNG，未提供 SVG。
- 仅支持深色主题；界面以桌面浏览器为主，窄屏可用但不舒适。

## 测试

- `tests/parser.test.ts`：嵌套、列表顺序、引号/转义/中文/emoji/孤立代理项、字节串、数字与常量、位置字段、18 类非法输入的行列与原因、深度/大小保护、深度冻结、不执行输入。
- 真实样例核对：`scripts/gen_fixtures.py` 用 Python `ast.dump` 生成 12 份夹具（单行、indent、制表符缩进、include_attributes、annotate_fields=False、注入的特殊常量、标准库 `textwrap.py`），并按 `ast.dump` 的字段取舍规则导出同构 JSON；测试逐字段比对解析结果。夹具由 Python 3.12 生成。
- `tests/graph.test.ts`：端口与索引、收纳规则、内联切换时 id 稳定、子树统计、大图初始折叠、布局保持兄弟顺序、拖动只改坐标并丢弃删除/新增、折叠后展开跟随父节点、重新排列。
- `e2e/app.spec.ts`（Playwright，Chromium）：子路径加载无 404、粘贴导入、错误行列、打开文件、HTML 不被执行、拖动只改坐标、删除键/框选删除/端口拖拽不改变 AST、框选多节点移动、缩放/平移/小地图/适应屏幕、折叠展开、重新排列、详情复制、收纳开关、导出 PNG（校验 PNG 文件头和尺寸）、导出上限提示、千节点性能。

## 部署到 GitHub Pages

`.github/workflows/deploy.yml` 在推送到 `main` 时运行：类型检查、lint、单元测试，然后以 `BASE_PATH=/<仓库名>/` 构建并用官方 Pages Action 发布。使用前在仓库 Settings → Pages 中把 Source 设为 “GitHub Actions”。

`vite.config.ts` 中 `base` 默认是 `./`（相对路径），因此不设置 `BASE_PATH` 构建出的 `dist/` 也能放在任意子目录下使用。应用没有前端路由，不需要 404 回退。

## 目录结构

```
src/
  parser/       tokenizer.ts、parser.ts、types.ts —— ast.dump 文本 → 只读 AST
  graph/        model.ts（AST → 卡片/端口/连线）、layout.ts（Dagre）、view.ts（坐标/折叠/选择）、readonly.ts
  components/   AstCanvas、AstNodeCard、DetailPanel、InputPanel、导出与剪贴板
  examples/     由 Python 生成的示例
scripts/gen_fixtures.py
tests/          单元测试与夹具
e2e/            Playwright 测试
```
