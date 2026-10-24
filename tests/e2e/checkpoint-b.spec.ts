import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { BootstrapDTO, DeckDTO, ItemsResponse } from '../../src/domain/types';
import type { DraftEntry, OcrResult } from '../../src/lib/ocr';

const artifactDirectory = 'artifacts/ocr/browser';

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({ path: `${artifactDirectory}/B-failure.png`, fullPage: true });
    await writeFile(`${artifactDirectory}/B-failure.txt`, `${testInfo.error?.message || ''}\n\n${await page.locator('body').innerText()}`);
  }
});

async function json<T>(page: Page, route: string): Promise<T> {
  const response = await page.request.get(route);
  expect(response.ok(), `${route}: ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}

async function createDeck(page: Page, name: string, category: string): Promise<DeckDTO> {
  await page.getByRole('button', { name: '新建词库', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建个人词库', exact: true });
  await dialog.getByLabel('词库名称', { exact: true }).fill(name);
  await dialog.getByLabel('分类', { exact: true }).fill(category);
  await dialog.getByRole('button', { name: '保存词库', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const deck = (await json<{ decks: DeckDTO[] }>(page, '/api/decks')).decks.find(entry => entry.name === name);
  expect(deck).toBeDefined();
  return deck!;
}

async function screenshot(page: Page, fileName: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifactDirectory}/${fileName}`, fullPage: false });
}

async function completeRecallRound(page: Page, expectedAnswers: number) {
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  for (let index = 0; index < expectedAnswers; index++) {
    await expect(page.locator('.answer-option')).toHaveCount(0);
    await page.getByRole('button', { name: '查看答案', exact: true }).click();
    await expect(page.locator('.recall-answer')).not.toBeEmpty();
    await page.getByRole('button', { name: '记住了', exact: true }).click();
    await page.getByRole('button', { name: '保存并继续', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存并继续', exact: true })).toBeHidden();
  }
  await expect(page.getByRole('heading', { name: '这一轮，完成了。', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回今日', exact: true }).click();
}

test('B: private decks, real Russian/Chinese OCR, explicit confirmation, learning and authenticated source images', async ({ page, request }) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(20_000);
  await mkdir(artifactDirectory, { recursive: true });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const errors: string[] = [];
  const ocrRequests: { url: string; status: number }[] = [];
  const itemMutations: { path: string; method: string; body: unknown }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/ocr/')) ocrRequests.push({ url: response.url(), status: response.status() });
  });
  page.on('request', observed => {
    const pathname = new URL(observed.url()).pathname;
    if (/^\/api\/decks\/[^/]+\/items(?:\/[^/]+)?$/.test(pathname) && ['POST', 'PATCH', 'DELETE'].includes(observed.method())) {
      itemMutations.push({ path: pathname, method: observed.method(), body: observed.postDataJSON() });
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '第一次来？创建账号', exact: true }).click();
  await page.getByLabel('怎么称呼你', { exact: true }).fill(`验收 B ${unique}`);
  await page.getByLabel('邮箱', { exact: true }).fill(`checkpoint-b-${unique}@ruslearn.test`);
  await page.getByLabel('密码', { exact: true }).fill(`B-Private-${unique}!`);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天，让几个词更熟悉。' })).toBeVisible();
  const account = await json<BootstrapDTO>(page, '/api/bootstrap');
  expect(account.user.email).toBe(`checkpoint-b-${unique}@ruslearn.test`);
  expect(account.stats.today).toBe(0);

  // Explicit recall makes both manual and OCR learning deterministic without changing data.
  await page.getByRole('button', { name: '学习设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '按你的节奏学习' });
  await settings.getByLabel(/^练习方向/).selectOption('recall');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(settings).toBeHidden();

  await page.getByRole('button', { name: '我的词库', exact: true }).click();
  const originalName = `手动验收 ${unique}`;
  const manualDeck = await createDeck(page, originalName, '验收·私人');
  await page.getByRole('button', { name: '重命名词库', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '编辑词库信息' });
  const renamed = `学习积累 ${unique}`;
  await rename.getByLabel('词库名称', { exact: true }).fill(renamed);
  await rename.getByRole('button', { name: '保存词库', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  const manual = page.getByRole('dialog', { name: '添加到个人词库' });
  await manual.getByText('粘贴多行内容', { exact: true }).click();
  await manual.getByLabel('每行一条，用 Tab 或 | 分开俄文和中文', { exact: true }).fill('ёж | 刺猬\nдоброе утро | 早上好\nЯ читаю книгу. | 我在读书。');
  await manual.getByRole('button', { name: '生成入库预览', exact: true }).click();
  await expect(manual.locator('fieldset')).toHaveCount(3);
  await manual.locator('fieldset').nth(1).getByLabel(/^内容类型/).selectOption('phrase');
  await manual.locator('fieldset').nth(2).getByLabel(/^内容类型/).selectOption('sentence');
  await manual.locator('fieldset').first().getByText('备注、例句与标签', { exact: true }).click();
  await manual.locator('fieldset').first().getByLabel('备注', { exact: true }).fill('保留 ё，个人核对备注');
  await manual.locator('fieldset').first().getByLabel('例句', { exact: true }).fill('Это ёж.');
  await manual.locator('fieldset').first().getByLabel('标签（用逗号分隔）', { exact: true }).fill('动物,验收');
  await screenshot(page, 'B-manual-preview-390.png');
  await manual.getByRole('button', { name: '确认保存 3 条', exact: true }).click();
  await expect(manual).toBeHidden();
  await expect(page.locator('.deck-word-row')).toHaveCount(3);
  await page.getByRole('button', { name: '编辑 ёж', exact: true }).click();
  const editing = page.getByRole('dialog', { name: '编辑内容', exact: true });
  await editing.getByLabel('中文释义', { exact: true }).fill('刺猬（动物）');
  await editing.getByRole('button', { name: '确认保存 1 条', exact: true }).click();
  await expect(editing).toBeHidden();
  const manualItems = await json<ItemsResponse>(page, `/api/items?deckId=${manualDeck.id}`);
  expect(manualItems.items.map(item => item.kind).sort()).toEqual(['phrase', 'sentence', 'word']);
  const hedgehog = manualItems.items.find(item => item.russian === 'ёж')!;
  expect(hedgehog.chinese).toBe('刺猬（动物）');
  expect(hedgehog.contentVersion).toBeGreaterThan(1);
  expect(hedgehog.example).toBe('Это ёж.');
  expect(hedgehog.tags).toEqual(['动物', '验收']);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出词库', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(`${artifactDirectory}/manual-deck-export.json`);
  const exported = JSON.parse(await readFile(`${artifactDirectory}/manual-deck-export.json`, 'utf8')) as { name: string; items: ItemsResponse['items'] };
  expect(exported.name).toBe(renamed);
  expect(exported.items).toHaveLength(3);
  expect(exported.items.find(item => item.russian === 'ёж')?.chinese).toBe('刺猬（动物）');

  for (const russian of ['доброе утро', 'Я читаю книгу.']) {
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: `移除 ${russian}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `移除 ${russian}`, exact: true })).toBeHidden();
  }
  await expect(page.locator('.deck-word-row')).toHaveCount(1);
  await screenshot(page, 'B-single-word-deck-390.png');
  await completeRecallRound(page, 1);
  await expect.poll(async () => (await json<BootstrapDTO>(page, '/api/bootstrap')).stats.today).toBe(1);
  const manualHistory = await json<{ events: { itemId: string; direction: string; correct: boolean }[] }>(page, '/api/history');
  expect(manualHistory.events).toContainEqual(expect.objectContaining({ itemId: hedgehog.id, direction: 'recall', correct: true }));

  // Start from a separate empty collection so saving before confirmation is observable.
  await page.getByRole('button', { name: '我的词库', exact: true }).click();
  const allDecks = page.getByRole('button', { name: '全部词库', exact: true });
  if (await allDecks.isVisible()) await allDecks.click();
  const ocrDeck = await createDeck(page, `照片拾词 ${unique}`, '真实 OCR');
  await page.getByRole('button', { name: '从照片拾词', exact: true }).click();
  let ocr = page.getByRole('dialog', { name: '从照片拾词', exact: true });
  await ocr.getByLabel('从相册选择', { exact: true }).setInputFiles('tests/fixtures/ru-zh-sample.png');
  await expect(ocr.getByRole('img', { name: '待识别图片，可与下方文字对照' })).toBeVisible();
  await screenshot(page, 'B-ocr-photo-390.png');
  const mutationsBeforeRecognition = itemMutations.length;
  await ocr.getByRole('button', { name: '开始识别', exact: true }).click();
  await expect(ocr.getByRole('heading', { name: '对照原图，修正文字', exact: true })).toBeVisible({ timeout: 180_000 });
  const rawText = await ocr.getByLabel(/^识别文本（每行一条/).inputValue();
  await writeFile(`${artifactDirectory}/raw-ocr-text.txt`, rawText);
  expect(rawText).toMatch(/книга/i);
  expect(rawText).toMatch(/мама/i);
  expect(rawText).toMatch(/город/i);
  expect(rawText).toMatch(/[书妈城]/);
  await expect(ocr.getByText(/引擎置信度 \d+%/)).toBeVisible();
  const coordinates = ocr.locator('.ocr-coordinates');
  await coordinates.locator('summary').click();
  await expect.poll(() => coordinates.locator('p').count()).toBeGreaterThan(3);
  await ocr.getByRole('heading', { name: '对照原图，修正文字', exact: true }).scrollIntoViewIfNeeded();
  await screenshot(page, 'B-ocr-actual-result-390.png');
  expect(itemMutations).toHaveLength(mutationsBeforeRecognition);
  expect((await json<ItemsResponse>(page, `/api/items?deckId=${ocrDeck.id}`)).total).toBe(0);
  await expect(ocr.getByRole('button', { name: '确认加入词库', exact: true })).toBeDisabled();

  // Check the editable pairings and preserved draft; corrected text is not substituted for OCR evidence.
  await ocr.getByLabel(/^识别文本（每行一条/).fill('книга | 书\nмама | 妈妈\nгород | 城市\nЯ читаю. | 我在读书。');
  await ocr.getByRole('button', { name: '根据编辑文字重新分行', exact: true }).click();
  await expect(ocr.locator('fieldset')).toHaveCount(4);
  await ocr.locator('fieldset').nth(3).getByLabel(/^内容类型/).selectOption('sentence');
  await ocr.locator('fieldset').first().getByLabel('中文释义', { exact: true }).fill('书（已核对配对）');
  await ocr.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '从照片拾词', exact: true }).click();
  ocr = page.getByRole('dialog', { name: '从照片拾词', exact: true });
  await expect(ocr.locator('fieldset')).toHaveCount(4);
  await expect(ocr.locator('fieldset').first().getByLabel('中文释义', { exact: true })).toHaveValue('书（已核对配对）');
  await expect(ocr.locator('fieldset').nth(3).getByLabel(/^内容类型/)).toHaveValue('sentence');
  const confirm = ocr.getByRole('checkbox', { name: '我已核对条目与中俄配对，确认保存这 4 条。', exact: true });
  await expect(confirm).not.toBeChecked();
  await expect(ocr.getByRole('button', { name: '确认加入词库', exact: true })).toBeDisabled();
  expect(itemMutations).toHaveLength(mutationsBeforeRecognition);
  await confirm.check();
  await ocr.locator('fieldset').first().getByLabel('中文释义', { exact: true }).fill('书（人工核对配对）');
  await expect(confirm).not.toBeChecked();
  await expect(ocr.getByRole('button', { name: '确认加入词库', exact: true })).toBeDisabled();
  await confirm.check();
  await screenshot(page, 'B-ocr-confirmation-390.png');
  const saveResponse = page.waitForResponse(response => response.url().endsWith(`/api/decks/${ocrDeck.id}/items`) && response.request().method() === 'POST');
  await ocr.getByRole('button', { name: '确认加入词库', exact: true }).click();
  expect((await saveResponse).status()).toBe(201);
  await expect(ocr).toBeHidden();
  const ocrItems = await json<ItemsResponse>(page, `/api/items?deckId=${ocrDeck.id}`);
  expect(ocrItems.total).toBe(4);
  expect(ocrItems.items.find(item => item.russian === 'Я читаю.')?.kind).toBe('sentence');
  expect(ocrItems.items.find(item => item.russian === 'книга')?.chinese).toBe('书（人工核对配对）');
  const ocrMutation = itemMutations.at(-1)!.body as { items: DraftEntry[]; ocr: OcrResult };
  expect(ocrMutation.ocr.engine).toBe('tesseract.js@7.0.0/rus+chi_sim');
  expect(ocrMutation.ocr.text).toBe(rawText);
  expect(ocrMutation.ocr.confidence).toBeGreaterThan(0);
  expect(ocrMutation.ocr.confidence).toBeLessThanOrEqual(100);
  expect(ocrMutation.ocr.boxes.length).toBeGreaterThan(3);
  for (const box of ocrMutation.ocr.boxes) {
    expect(box.text.trim()).not.toBe('');
    expect(box.confidence).toBeGreaterThanOrEqual(0);
    expect(box.confidence).toBeLessThanOrEqual(100);
    expect(box.bbox.x1).toBeGreaterThan(box.bbox.x0);
    expect(box.bbox.y1).toBeGreaterThan(box.bbox.y0);
  }
  expect(ocrRequests.some(entry => entry.url.includes('/ocr/worker.min.js') && entry.status === 200)).toBe(true);
  expect(ocrRequests.filter(entry => entry.status >= 400)).toEqual([]);
  await writeFile(`${artifactDirectory}/actual-ocr-evidence.json`, JSON.stringify({ fixture: 'tests/fixtures/ru-zh-sample.png', accountId: account.user.id, deckId: ocrDeck.id, requests: ocrRequests, rawResult: ocrMutation.ocr, correctedEntries: ocrMutation.items, savedItemIds: ocrItems.items.map(item => item.id) }, null, 2));
  await screenshot(page, 'B-ocr-saved-deck-390.png');
  await completeRecallRound(page, 4);
  await expect.poll(async () => (await json<BootstrapDTO>(page, '/api/bootstrap')).stats.today).toBe(5);
  const history = await json<{ events: { itemId: string; direction: string }[] }>(page, '/api/history');
  for (const item of ocrItems.items) expect(history.events).toContainEqual(expect.objectContaining({ itemId: item.id, direction: 'recall' }));

  // Search actual source rows, preserving ё/й and workbook stress marks in display.
  await page.getByRole('button', { name: '教材', exact: true }).click();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  const search = page.getByRole('textbox', { name: '搜索俄语、中文或词形', exact: true });
  async function searchSource(query: string) {
    const received = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/items' && url.searchParams.get('q') === query;
    });
    await search.fill(query);
    const response = await received;
    expect(response.ok()).toBe(true);
    const data = await response.json() as ItemsResponse;
    await expect(page.locator('.word-list .word-row')).toHaveCount(data.items.length);
    return data;
  }
  expect((await searchSource('весе́лый')).items.some(item => item.russian === 'весёлый')).toBe(true);
  const cheerful = page.locator('.word-row').filter({ has: page.getByText('весёлый', { exact: true }) });
  await expect(cheerful).toBeVisible();
  expect((await searchSource('весёлый')).items.some(item => item.russian === 'весёлый')).toBe(true);
  await expect(cheerful).toBeVisible();
  await cheerful.click();
  const detail = page.getByRole('dialog', { name: '词条详情', exact: true });
  await expect(detail.getByRole('heading', { name: 'весёлый', exact: true })).toBeVisible();
  await screenshot(page, 'B-source-detail-390.png');
  await detail.getByRole('button', { name: '查看原页', exact: true }).click();
  const sourceImage = detail.getByRole('img', { name: 'весёлый 的原词表页', exact: true });
  await expect(sourceImage).toBeVisible();
  await expect.poll(() => sourceImage.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await sourceImage.scrollIntoViewIfNeeded();
  await screenshot(page, 'B-source-thumbnail-390.png');
  const originalLink = detail.getByRole('link', { name: /打开原图/ }).first();
  const originalPath = await originalLink.getAttribute('href');
  expect(originalPath).toMatch(/^\/api\/assets\//);
  const unauthenticated = await request.get(originalPath!);
  expect(unauthenticated.status()).toBe(401);
  const authenticated = await page.request.get(originalPath!);
  expect(authenticated.status()).toBe(200);
  expect(authenticated.headers()['content-type']).toMatch(/^image\//);
  expect(authenticated.headers()['cache-control']).toContain('private');
  const popupEvent = page.waitForEvent('popup');
  await originalLink.click();
  const originalPage = await popupEvent;
  await originalPage.setViewportSize({ width: 390, height: 844 });
  await originalPage.waitForLoadState('domcontentloaded');
  await expect.poll(() => originalPage.locator('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
  await originalPage.screenshot({ path: `${artifactDirectory}/B-source-original-390.png`, fullPage: false });
  await originalPage.close();
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  expect((await searchSource('ру́сский')).items.some(item => item.russian === 'русский')).toBe(true);
  await expect(page.locator('.word-row').filter({ has: page.getByText('русский', { exact: true }) })).toBeVisible();
  expect((await searchSource('русскии')).items).toHaveLength(0);
  await expect(page.getByText('这里还没有词条', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /东方俄语 02/ }).click();
  expect((await searchSource('пообещать')).items.some(item => item.russian === 'пообеща́ть')).toBe(true);
  await expect(page.locator('.word-row').filter({ has: page.getByText('пообеща́ть', { exact: true }) })).toBeVisible();
  await screenshot(page, 'B-source-stress-search-390.png');

  // Delete just this QA account's manual collection; the OCR evidence remains inspectable.
  await page.getByRole('button', { name: '我的词库', exact: true }).click();
  await page.locator('.deck-tile').filter({ has: page.getByRole('heading', { name: renamed, exact: true }) }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除词库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把遇见的词，留下来。', exact: true })).toBeVisible();
  const remainingDecks = await json<{ decks: DeckDTO[] }>(page, '/api/decks');
  expect(remainingDecks.decks.some(deck => deck.id === manualDeck.id)).toBe(false);
  expect(remainingDecks.decks.some(deck => deck.id === ocrDeck.id)).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(`${artifactDirectory}/acceptance-summary.json`, JSON.stringify({ checkpoint: 'B', completedAt: new Date().toISOString(), accountId: account.user.id, manualDeckId: manualDeck.id, ocrDeckId: ocrDeck.id, manualKinds: ['word', 'phrase', 'sentence'], exportedCount: exported.items.length, rawOcrConfidence: ocrMutation.ocr.confidence, rawOcrBoxCount: ocrMutation.ocr.boxes.length, ocrItems: ocrItems.total, acceptedReviewEvents: history.events.length, originalImage: { path: originalPath, authenticatedStatus: authenticated.status(), unauthenticatedStatus: unauthenticated.status() }, pageErrors: errors }, null, 2));
});
