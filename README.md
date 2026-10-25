**Live demo: https://ljxljxljx.github.io/PyAstVisualizer/**

# Python AST Visualizer

English | [简体中文](README.zh-CN.md)

Paste the output of Python's `ast.dump()` and get a ComfyUI-style node canvas: every AST node is a card, and child nodes hang off named field ports (such as `body[0]` or `value`) via curved edges. The AST content and structure are read-only; cards can be freely dragged, box-selected, collapsed, re-arranged, and exported as PNG.

- Front-end only: TypeScript + React + Vite, canvas by [React Flow](https://reactflow.dev/) (`@xyflow/react`), initial layout by Dagre.
- Parsing and rendering happen entirely in your browser. Nothing is uploaded, and the build output deploys straight to GitHub Pages.
- Parses `ast.dump` text directly with a hand-written tokenizer and recursive-descent parser. It does **not** use `eval` or `Function` and never executes the input.

## Quick start

Requires Node.js 22.12+ or 24+ (required by Vitest 5; developed on Node 26 / npm 11).

```bash
npm install
npm run dev        # dev server, http://localhost:5173 by default
```

Generate input in Python:

```python
import ast
print(ast.dump(ast.parse(source), indent=2))
# single-line output, include_attributes=True and annotate_fields=False also work
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (parser, graph model, view state) |
| `npm run test:e2e` | Playwright end-to-end tests (first run needs `npx playwright install chromium`) |
| `npm run fixtures` | Regenerate test fixtures and in-app examples with your local Python |

`test:e2e` first builds with `BASE_PATH=/PyAstVisualizer/` into `dist-e2e/` and serves it with `vite preview`, so it also verifies asset loading under a GitHub Pages sub-path.

## Features

**Input**: paste text, open or drag in a local text file, or load one of 5 built-in examples (function, loops and branches, expressions, Builder calls after an AST rewrite, and position fields). The examples are produced by real Python `ast.dump` via `scripts/gen_fixtures.py`. ⌘/Ctrl+Enter parses.

**Canvas**

- Dark grid background. Card titles are node types, colour-coded by category (definitions, control flow, statements, access/calls, names, literals, operators, …).
- Simple attributes such as `name`, `id` and `value` appear inside the card. Child nodes connect from field ports on the right, and list items keep their order and index (`body[0]`, `body[1]`, …). Each card header also shows the field name it occupies in its parent, so both ends of an edge are labelled.
- `None`, empty lists and position info (`lineno` etc.) are folded into a single "+N hidden" row by default. Tick "Show hidden fields" to show them on the cards; the details panel always lists every field.
- Long text is summarised on the card. Click a card to see the full repr and the decoded string in the details panel, and to copy a single attribute, the node path, or the node's original dump text.
- **Inline field-less nodes** (on by default): nodes without fields such as `Load()`, `Store()` and `Add()` are shown as attributes on the parent card instead of separate cards, so every `Name` doesn't sprout an extra `Load` card. Untick "Inline field-less nodes" to give every AST node its own card.

**Interaction**

- Drag cards. Shift+drag to box-select and ⌘/Ctrl+click to multi-select; selected cards move together.
- Drag empty space to pan, scroll to zoom, use the minimap, or fit to screen.
- Collapse and expand subtrees with ▾/▸ in the card's top-right corner; "Expand all" and "Collapse all" are also available.
- The graph is auto-laid out once on import. After that, dragging, selecting and collapsing/expanding **never** rearrange existing cards. Collapsing remembers each child's offset from its parent, and expanding restores it relative to the parent's current position. Newly revealed cards are laid out locally. Click "Re-arrange" whenever you want a fresh layout.
- PNG export includes every visible card and edge, cropped to the content bounds.

**Read-only guarantees**

- The parse result is deep-frozen with `Object.freeze`, so any mutation throws.
- The canvas only accepts position, selection and dimension-measurement changes; changes that remove, add or replace nodes are dropped. The Delete key is disabled, ports have `isConnectable=false`, and edges can't be reconnected or deleted.
- The AST / graph model (`src/parser`, `src/graph/model.ts`) is kept separate from the view state (positions, collapse, selection — `src/graph/view.ts`).

**Language**: the UI is in English by default. The global EN / 中文 switch in the top-left corner of the canvas changes every label, notice and parse error (including an error already on screen) without re-parsing; the choice is remembered in the browser.

## Supported input

Grammar (see `src/parser/parser.ts`):

```
value    := node | list | tuple | set | dict | STRING | BYTES | NUMBER | complex
          | None | True | False | Ellipsis | inf | nan
node     := NAME ('.' NAME)* '(' [arg (',' arg)* [',']] ')'
arg      := NAME '=' value | value
list     := '[' [value (',' value)* [',']] ']'
tuple    := '(' ')' | '(' value ',' ')' | '(' value (',' value)+ [','] ')'
set      := '{' value (',' value)* [','] '}'
dict     := '{' '}' | '{' value ':' value (',' value ':' value)* [','] '}'
complex  := '(' NUMBER SIGNED_IMAG ')'          e.g. (1+2j)
```

- Any node name (including non-ASCII identifiers) and qualified names like `ast.Name(...)`. Named fields, plus the positional arguments produced by `annotate_fields=False` (shown as `#0`, `#1`, …).
- Single-line and any `indent` style (spaces, tabs, string indents); `\r\n` line endings.
- Strings: single or double quotes and every Python escape (`\\ \' \" \n \r \t \a \b \f \v`, octal, `\xhh`, `\uXXXX`, `\UXXXXXXXX`, line continuation). Unknown escapes keep the backslash, as in Python. Brackets, commas, CJK characters and emoji inside strings are treated as data. Prefixes `b`, `u`, `r` and combinations are accepted.
- Bytes are decoded to byte values; non-ASCII characters must be escaped.
- Numbers: integers (including big integers, `0x/0o/0b` and underscores), floats (scientific notation, `inf`, `-inf`, `nan`) and complex numbers (`2j`, `(1-2j)`). The original text is kept, so no precision is lost.
- The `lineno`, `col_offset`, `end_lineno` and `end_col_offset` fields added by `include_attributes=True`.
- The top level must be a single node; trailing content is an error.

**Explicitly unsupported (reported as errors, never silently dropped)**: triple-quoted strings, `\N{...}` named escapes (Python's repr never produces either), comments, unparseable reprs like `<object at 0x…>`, and several dumps in one input. A call like `frozenset({1})` is shown as a node named `frozenset`.

Error messages give the line, the column (counted in Unicode characters, so a CJK character is one column) and the reason, for example `Line 2, column 21: Expected ',' or ')' between fields of node Name, got 'ctx'`. Every error message exists in both English and Chinese. The input panel highlights the offending character.

## Limits and performance

Safety limits (`LIMITS` in `src/parser/parser.ts` and constants in `src/components/AstCanvas.tsx`):

| Item | Limit | When exceeded |
| --- | --- | --- |
| Input length | 5,000,000 characters | "Input too large" error |
| Nesting depth | 400 levels (each node or list counts as one) | "Nesting too deep" error, no stack overflow |
| AST nodes | 50,000 | "Too many nodes" error |
| Initially shown | 600 cards | Deeper levels are auto-collapsed, with a notice |
| Expand all | Asks for confirmation above 2,000 cards | — |
| PNG export | 1,500 visible cards; output side ≤ 8192 px and area ≤ 40 MP | Asks you to collapse first when over the card limit; scales the image down when over the size limit |

Measured on an Apple Silicon Mac in headless Chromium (production build):

| Input | Result |
| --- | --- |
| Built-in examples (~50 cards) | Instant render; export takes ~1 s |
| stdlib `textwrap.py` with position fields, 173 KB, 1,002 cards | Import + first render ~0.25 s (auto-collapsed to 551 cards); expand all ~0.25 s; re-arrange ~0.4 s; dragging is smooth; PNG export ~13 s |
| stdlib `argparse.py`, 567 KB, 11,925 AST nodes / 7,687 cards | Parse 17 ms; expand all ~4.5 s (Dagre ~0.9 s, the rest is DOM rendering); zoom at ~7–10 fps, clearly laggy; over the export limit (not exported) |

In short, **a few hundred to about a thousand cards browse smoothly**. Several thousand cards open, but expanding and zooming get noticeably slow, so keep some subtrees collapsed. Above 1,500 visible cards, viewport virtualisation renders only on-screen cards, though it helps little in a whole-graph view.

Other known limitations:

- The initial Dagre layout turns off crossing minimisation to keep field order. Cards revealed by expanding may overlap existing ones; click "Re-arrange" to fix that.
- Toggling hidden fields changes card heights but doesn't re-lay out automatically (by design, ordinary interaction never re-lays out).
- Export relies on `html-to-image` cloning the DOM; PNG only, no SVG.
- Dark theme only. The UI targets desktop browsers; narrow screens work but aren't comfortable.

## Tests

- `tests/parser.test.ts`: nesting, list order, quotes/escapes/CJK/emoji/lone surrogates, bytes, numbers and constants, position fields, line/column and reason for 18 kinds of invalid input, depth and size limits, deep freezing, and never executing input.
- Checked against real Python output: `scripts/gen_fixtures.py` uses Python `ast.dump` to produce 12 fixtures (single-line, indent, tab indent, include_attributes, annotate_fields=False, injected special constants, stdlib `textwrap.py`) and exports an equivalent JSON structure following `ast.dump`'s field-selection rules. The tests compare the parse result field by field. Fixtures were generated with Python 3.12.
- `tests/graph.test.ts`: ports and indices, hiding rules, stable ids when toggling inlining, subtree counts, initial collapse of large graphs, layout keeping sibling order, dragging changing only positions while remove/add changes are dropped, expanding after collapse following the parent, and re-arranging.
- `e2e/app.spec.ts` (Playwright, Chromium): sub-path loading with no 404s, paste import, error line/column, opening files, HTML not being executed, dragging changing only positions, the Delete key / delete after box-select / port dragging not changing the AST, moving multiple selected cards, zoom/pan/minimap/fit, collapse and expand, re-arrange, copying from details, the hidden-field toggle, PNG export (checks PNG header and size), the export-limit notice, and thousand-card performance.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` runs on every push to `main`: type check, lint and unit tests, then a build with `BASE_PATH=/<repository>/`, published with the official Pages actions. Under Settings → Pages, set Source to "GitHub Actions" before using it.

`base` in `vite.config.ts` defaults to `./` (relative paths), so a `dist/` built without `BASE_PATH` also works from any sub-directory. The app has no client-side routing, so no 404 fallback is needed.

## Project layout

```
src/
  parser/       tokenizer.ts, parser.ts, types.ts — ast.dump text → read-only AST
  graph/        model.ts (AST → cards/ports/edges), layout.ts (Dagre), view.ts (positions/collapse/selection), readonly.ts
  components/   AstCanvas, AstNodeCard, DetailPanel, InputPanel, export and clipboard helpers
  examples/     examples generated by Python
scripts/gen_fixtures.py
tests/          unit tests and fixtures
e2e/            Playwright tests
```
