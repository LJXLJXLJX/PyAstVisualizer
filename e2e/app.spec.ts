import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '..', 'tests', 'fixtures');

type Debug = {
  astJson: () => string;
  nodeIds: () => string[];
  positions: () => Record<string, { x: number; y: number }>;
  edgeIds: () => string[];
  totalNodes: () => number;
};

async function dbg<T>(page: Page, fn: (d: Debug) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__PYAST_DEBUG__)`) as Promise<T>;
}

async function snapshot(page: Page) {
  return {
    ast: await dbg(page, (d) => d.astJson()),
    nodes: await dbg(page, (d) => d.nodeIds()),
    edges: await dbg(page, (d) => d.edgeIds()),
    positions: await dbg(page, (d) => d.positions()),
  };
}

function node(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

async function dragBy(page: Page, id: string, dx: number, dy: number) {
  const header = node(page, id).locator('.ast-node__title');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 5 + dx / 2, box.y + box.height / 2 + dy / 2, { steps: 5 });
  await page.mouse.move(box.x + 5 + dx, box.y + box.height / 2 + dy, { steps: 5 });
  await page.mouse.up();
}

async function loadText(page: Page, text: string) {
  await page.getByLabel('ast.dump text').fill(text);
  await page.getByRole('button', { name: 'Parse & draw' }).click();
}

const SAMPLE =
  "Module(body=[Assign(targets=[Name(id='x', ctx=Store())], value=BinOp(left=Constant(value=1), op=Add(), right=Call(func=Name(id='f', ctx=Load()), args=[Constant(value='中文 \"引号\" \\n')], keywords=[]))), Expr(value=Name(id='x', ctx=Load()))], type_ignores=[])";

test.beforeEach(async ({ page }) => {
  await page.goto('./?debug');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test('在 GitHub Pages 子路径下加载，静态资源无 404', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on('pageerror', (e) => failures.push(e.message));
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  expect(page.url()).toContain('/PyAstVisualizer/');
  expect(failures).toEqual([]);
});

test('默认英文界面，EN/中文 全局切换并在刷新后保持', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Parse & draw' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-arrange' })).toBeVisible();
  // 先制造一个解析错误，切换语言后错误信息跟着切换
  await loadText(page, 'Name(id=foo)');
  await expect(page.getByRole('alert')).toContainText("Unknown name 'foo'");

  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '解析并绘图' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新排列' })).toBeVisible();
  await expect(page.getByLabel('显示收纳字段')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('第 1 行，第 9 列');
  await expect(page.getByRole('alert')).toContainText("无法识别的名称 'foo'");
  await expect(page.locator('.stats')).toContainText('张卡片');

  await page.reload();
  await expect(page.getByRole('button', { name: '解析并绘图' })).toBeVisible();
  await page.getByRole('button', { name: 'EN' }).click();
  await expect(page.getByRole('button', { name: 'Parse & draw' })).toBeVisible();
  await expect(page.locator('.stats')).toContainText('cards');
});

test('粘贴导入并绘图：节点数与连线数和 AST 对应', async ({ page }) => {
  await loadText(page, SAMPLE);
  await expect(page.locator('.parse-ok')).toContainText('Parsed:');
  // 内联无字段节点后：Module, Assign, Name, BinOp, Constant, Call, Name, Constant, Expr, Name = 10
  await expect(page.locator('.react-flow__node')).toHaveCount(10);
  await expect(page.locator('.react-flow__edge')).toHaveCount(9);
  await expect(node(page, '$').locator('.row-port')).toHaveText(['body[0]', 'body[1]']);
  await expect(node(page, '$.body[0].value.right.args[0]')).toContainText(`'中文 "引号" \\n'`);
});

test('解析错误显示行列和原因，不改变当前画布', async ({ page }) => {
  const before = await page.locator('.react-flow__node').count();
  await loadText(page, "Module(\n  body=[Name(id='a' ctx=Load())],\n)");
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('line 2, column 21');
  await expect(alert).toContainText("Expected ',' or ')'");
  await expect(page.locator('.react-flow__node')).toHaveCount(before);
});

test('打开本地文本文件', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'loop_indent.dump.txt'));
  await expect(page.locator('.parse-ok')).toContainText('Parsed:');
  await expect(node(page, '$.body[1]')).toContainText('For');
});

test('输入按数据显示，HTML 不会被执行', async ({ page }) => {
  await loadText(page, `Constant(value='<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>')`);
  await expect(node(page, '$')).toContainText('<img src=x');
  expect(await page.locator('.react-flow__node img, .react-flow__node script').count()).toBe(0);
  expect(await page.evaluate('window.__xss')).toBeUndefined();
});

test('拖动只改变坐标，AST 与连线不变', async ({ page }) => {
  const before = await snapshot(page);
  const id = '$.body[0]';
  await dragBy(page, id, 120, 60);
  const after = await snapshot(page);
  expect(after.ast).toBe(before.ast);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
  expect(after.positions[id]!.x).toBeGreaterThan(before.positions[id]!.x + 50);
  for (const other of before.nodes.filter((n) => n !== id)) {
    expect(after.positions[other]).toEqual(before.positions[other]);
  }
});

test('删除键与端口拖拽不能改变 AST', async ({ page }) => {
  const before = await snapshot(page);
  await node(page, '$.body[0]').locator('.ast-node__title').click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  // 框选全部后再按删除
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.waitForTimeout(400);
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.keyboard.down('Shift');
  const bar = (await page.locator('.toolbar').boundingBox())!;
  await page.mouse.move(pane.x + 5, bar.y + bar.height + 10);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 5, pane.y + pane.height - 5, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await page.locator('.react-flow__node.selected').count()).toBeGreaterThan(5);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');

  // 从输出端口拖到另一个节点的输入端口
  const out = (await node(page, '$').locator('.port-out').first().boundingBox())!;
  const target = (await node(page, '$.body[1]').locator('.port-in').boundingBox())!;
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = await snapshot(page);
  expect(after.ast).toBe(before.ast);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.edges).toEqual(before.edges);
  await expect(page.locator('.react-flow__node')).toHaveCount(before.nodes.length);
});

test('框选后多个节点一起移动', async ({ page }) => {
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.waitForTimeout(400);
  const before = await snapshot(page);
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.keyboard.down('Shift');
  const bar = (await page.locator('.toolbar').boundingBox())!;
  await page.mouse.move(pane.x + pane.width * 0.45, bar.y + bar.height + 10);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width * 0.8, pane.y + pane.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const selected = await page.locator('.react-flow__node.selected').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
  expect(selected.length).toBeGreaterThan(1);
  await dragBy(page, selected[0]!, 80, 40);
  const after = await snapshot(page);
  const deltas = selected.map((id) => [
    Math.round(after.positions[id]!.x - before.positions[id]!.x),
    Math.round(after.positions[id]!.y - before.positions[id]!.y),
  ]);
  expect(new Set(deltas.map((d) => d.join(','))).size).toBe(1);
  expect(deltas[0]![0]).not.toBe(0);
  expect(after.ast).toBe(before.ast);
});

test('滚轮缩放、拖动平移、小地图与适应屏幕', async ({ page }) => {
  const viewport = page.locator('.react-flow__viewport');
  const t0 = await viewport.getAttribute('style');
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  const t1 = await viewport.getAttribute('style');
  expect(t1).not.toBe(t0);
  // 在空白处拖动平移：找一个落在画布背景上的点
  const empty = await page.evaluate(() => {
    const r = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
    for (let y = r.top + r.height * 0.3; y < r.bottom - 40; y += 17) {
      for (let x = r.left + 80; x < r.right - 300; x += 23) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    return null;
  });
  expect(empty).not.toBeNull();
  await page.mouse.move(empty!.x, empty!.y);
  await page.mouse.down();
  await page.mouse.move(empty!.x + 150, empty!.y - 80, { steps: 5 });
  await page.mouse.up();
  const t2 = await viewport.getAttribute('style');
  expect(t2).not.toBe(t1);
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.waitForTimeout(400);
  expect(await viewport.getAttribute('style')).not.toBe(t2);
});

test('折叠与展开子树，展开后子节点相对位置保留', async ({ page }) => {
  const before = await snapshot(page);
  const id = '$.body[0]';
  await node(page, id).getByRole('button', { name: 'Collapse subtree' }).click();
  await expect(node(page, id)).toContainText('descendants collapsed');
  const collapsed = await snapshot(page);
  expect(collapsed.nodes.length).toBeLessThan(before.nodes.length);
  expect(collapsed.nodes.some((n) => n.startsWith(`${id}.`))).toBe(false);
  expect(collapsed.ast).toBe(before.ast);

  await node(page, id).getByRole('button', { name: 'Expand subtree' }).click();
  const expanded = await snapshot(page);
  expect([...expanded.nodes].sort()).toEqual([...before.nodes].sort());
  for (const n of before.nodes) expect(expanded.positions[n]).toEqual(before.positions[n]);
});

test('重新排列恢复自动布局，普通交互不触发重排', async ({ page }) => {
  const before = await snapshot(page);
  await dragBy(page, '$.body[0]', 150, 90);
  await node(page, '$.body[1]').locator('.ast-node__title').click();
  const moved = await snapshot(page);
  expect(moved.positions['$.body[0]']).not.toEqual(before.positions['$.body[0]']);
  expect(moved.positions['$.body[1]']).toEqual(before.positions['$.body[1]']);
  await page.getByRole('button', { name: 'Re-arrange' }).click();
  await page.waitForTimeout(400);
  const after = await snapshot(page);
  expect(after.positions).toEqual(before.positions);
});

test('点击节点查看并复制完整属性', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const long = '很长的文本'.repeat(40);
  await loadText(page, `Module(body=[Expr(value=Constant(value='${long}'))], type_ignores=[])`);
  const constant = node(page, '$.body[0].value');
  const summary = await constant.locator('.row__val').first().textContent();
  expect(summary!.endsWith('…')).toBe(true);
  await constant.locator('.ast-node__title').click();
  const panel = page.getByLabel('Node details');
  await expect(panel).toContainText('Constant');
  await expect(panel.locator('pre.decoded')).toHaveText(long);
  await panel.locator('.detail-value').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(long);
});

test('收纳字段可通过开关显示', async ({ page }) => {
  const fn = node(page, '$.body[0]');
  await expect(fn.locator('.row-more')).toBeVisible();
  await expect(fn.locator('.row', { hasText: 'type_params' })).toHaveCount(0);
  await page.getByLabel('Show hidden fields').check();
  await expect(fn.locator('.row', { hasText: 'type_params' })).toHaveCount(1);
  await page.getByLabel('Inline field-less nodes').uncheck();
  await expect(node(page, '$.body[0].body[0].value.ctx')).toHaveCount(0);
  expect(await dbg(page, (d) => d.nodeIds().some((n) => n.endsWith('.ctx')))).toBe(true);
});

test('导出 PNG 图片', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('python-ast.png');
  const path = await download.path();
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(width).toBeGreaterThan(500);
  expect(height).toBeGreaterThan(300);
  expect(buf.length).toBeGreaterThan(20_000);
  await expect(page.getByRole('status')).toContainText('PNG exported');
});

test('超过导出上限时给出明确提示而不是卡死', async ({ page }) => {
  await loadText(page, `Module(body=[${"Global(names=['x']), ".repeat(1600)}], type_ignores=[])`);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('.stats')).toContainText('Showing 1,601 / 1,601');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  await expect(page.getByRole('status')).toContainText('over the export limit of 1,500');
});

test('大输入：自动折叠并在展开约千节点时仍可交互', async ({ page }) => {
  const file = join(FIXTURES, 'stdlib_textwrap_attributes.dump.txt');
  const t0 = Date.now();
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByRole('status')).toContainText('collapsed automatically');
  const importMs = Date.now() - t0;
  const total = await dbg(page, (d) => d.totalNodes());
  const visible = await page.locator('.react-flow__node').count();
  expect(visible).toBeLessThanOrEqual(600);

  const t1 = Date.now();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(total, { timeout: 30_000 });
  const expandMs = Date.now() - t1;

  const t2 = Date.now();
  await page.getByRole('button', { name: 'Re-arrange' }).click();
  await page.waitForTimeout(50);
  const relayoutMs = Date.now() - t2;

  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.waitForTimeout(400);
  const id = (await dbg(page, (d) => d.nodeIds()))[1]!;
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  const t3 = Date.now();
  const n = node(page, id);
  await n.scrollIntoViewIfNeeded();
  const box = (await n.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 8);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(box.x + 10 + i * 5, box.y + 8 + i * 2);
  await page.mouse.up();
  const dragMs = Date.now() - t3;

  const t4 = Date.now();
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export PNG' }).click();
  await downloadPromise;
  const exportMs = Date.now() - t4;
  console.log(
    `[perf] ${file.split('/').pop()} 共 ${total} 张卡片；导入+初始渲染 ${importMs}ms（显示 ${visible}），全部展开 ${expandMs}ms，重新排列 ${relayoutMs}ms，20 步拖动 ${dragMs}ms，导出 PNG ${exportMs}ms`,
  );
  expect(expandMs).toBeLessThan(20_000);
});
