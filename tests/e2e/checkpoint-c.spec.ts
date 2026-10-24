import { test, expect, type Page, type APIResponse } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { PARAMETERS_VERSION, SCHEDULER_VERSION, cardId } from '../../src/domain/learning';
import type { BootstrapDTO, DeckDTO, ItemsResponse, ReviewEventInput, SyncResponse } from '../../src/domain/types';

// Run this checkpoint only after A/B, against a built production server so the
// public service-worker shell references immutable production asset URLs.
const artifacts = 'artifacts/checkpoint-c';
test.use({ actionTimeout: 15_000 });
type History = { events: { id: string; practice: boolean }[]; conflicts: { id: string; conflictReason: string }[] };
type Outbox = { userId: string; id: string; event: ReviewEventInput; conflict?: string };

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `HTTP status ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}
async function get<T>(page: Page, route: string): Promise<T> { return json<T>(await page.request.get(route)); }
function headers(page: Page, userId: string) { return { Origin: new URL(page.url()).origin, 'X-Slovo-User': userId }; }
async function post<T>(page: Page, route: string, userId: string, data: unknown): Promise<T> {
  return json<T>(await page.request.post(route, { data, headers: headers(page, userId) }));
}
async function signup(page: Page, suffix: string): Promise<BootstrapDTO> {
  const unique = `${Date.now()}-${randomUUID().slice(0, 8)}-${suffix}`;
  await page.goto('/');
  await page.getByRole('button', { name: '第一次来？创建账号', exact: true }).click();
  await page.getByLabel('怎么称呼你', { exact: true }).fill(`验收 C ${suffix}`);
  await page.getByLabel('邮箱', { exact: true }).fill(`checkpoint-c-${unique}@ruslearn.test`);
  await page.getByLabel('密码', { exact: true }).fill(`C-Private-${unique}!`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/auth/sign-up/email' && value.request().method() === 'POST');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    const result = await response;
    if (result.status() !== 429) { expect(result.ok(), `Signup HTTP ${result.status()}`).toBe(true); break; }
    if (attempt === 2) throw new Error('QA signup remains rate-limited after bounded backoff');
    const retryAfter = Number(result.headers()['retry-after'] || result.headers()['x-retry-after']);
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 11_000;
    if (delay > 60_000) throw new Error('QA signup needs a longer server rate-limit window before retry');
    // Exercise the real limiter without disabling or bypassing it. The browser
    // remains idle until the server's retry window expires.
    await new Promise(resolve => setTimeout(resolve, delay + 250));
  }
  await expect(page.getByRole('heading', { name: '今天，让几个词更熟悉。' })).toBeVisible();
  const bootstrap = await get<BootstrapDTO>(page, '/api/bootstrap');
  expect(bootstrap.stats.today).toBe(0);
  expect(bootstrap.user.role).not.toBe('admin');
  return bootstrap;
}
async function rows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (storeName) => {
    const opening = indexedDB.open('slovo-offline-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    try {
      const reading = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      return await new Promise<unknown[]>((resolve, reject) => {
        reading.onsuccess = () => resolve(reading.result); reading.onerror = () => reject(reading.error);
      });
    } finally { database.close(); }
  }, store) as Promise<T[]>;
}
async function createDraft(page: Page, title: string, russian: string): Promise<DeckDTO> {
  await page.getByRole('button', { name: '我的词库', exact: true }).click();
  await page.getByRole('button', { name: '新建词库', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建个人词库' });
  await create.getByLabel('词库名称', { exact: true }).fill(title);
  await create.getByRole('button', { name: '保存词库', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const deck = (await get<{ decks: DeckDTO[] }>(page, '/api/decks')).decks.find(entry => entry.name === title)!;
  expect(deck).toBeDefined();
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加到个人词库' });
  await expect(dialog.getByRole('textbox', { name: '俄语', exact: true })).toHaveValue('');
  await dialog.getByRole('textbox', { name: '俄语', exact: true }).fill(russian);
  await expect.poll(async () => (await rows<{ key: string; value: { entries?: { russian: string }[] } }>(page, 'drafts'))
    .find(row => row.key === `manual:${deck.id}`)?.value.entries?.[0]?.russian).toBe(russian);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '手动添加', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '俄语', exact: true })).toHaveValue(russian);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  return deck;
}
async function recall(page: Page, save = true) {
  await page.getByRole('button', { name: '查看答案', exact: true }).click();
  await page.getByRole('button', { name: '记住了', exact: true }).click();
  if (save) {
    await page.getByRole('button', { name: '保存并继续', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存并继续', exact: true })).toBeHidden();
  }
}

test('C: ten offline UI attempts survive reload, sync once, and remain isolated across accounts', async ({ page, context }) => {
  test.setTimeout(180_000);
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const accountA = await signup(page, 'offline-A');
  await page.getByRole('button', { name: '学习设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '按你的节奏学习' });
  await settings.getByLabel(/^练习方向/).selectOption('recall');
  await settings.getByLabel(/^每轮题数/).selectOption('10');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: '教材', exact: true }).click();
  // Lesson 1 contains only eight source rows. Select lesson 2 as well so the
  // ten-event acceptance uses ten distinct real items, without synthetic data.
  await page.getByRole('button', { name: /^第 2 课/ }).click();
  await page.getByRole('button', { name: '下载离线', exact: true }).click();
  await expect(page.getByText(/已下载 \d+ 条内容，可在本机离线练习。/)).toBeVisible();
  await expect.poll(async () => (await rows<{ userId: string }>(page, 'downloads')).filter(row => row.userId === accountA.user.id).length).toBe(1);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  for (let index = 0; index < 4; index++) await recall(page);
  await recall(page, false);
  await expect.poll(async () => (await rows<Outbox>(page, 'outbox')).length).toBe(4);
  // Feedback is durable too: refresh must not turn an already revealed answer
  // into an unrevealed question or append an event before Save/Continue.
  await expect.poll(async () => (await rows<{ key: string }>(page, 'drafts')).some(row => row.key.startsWith('answer:'))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '继续上次学习', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存并继续', exact: true })).toBeVisible();
  expect(await rows<Outbox>(page, 'outbox')).toHaveLength(4);
  await page.screenshot({ path: `${artifacts}/C-offline-restored-feedback-390.png`, fullPage: true });
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存并继续', exact: true })).toBeHidden();
  for (let index = 5; index < 10; index++) await recall(page);
  await expect(page.getByRole('heading', { name: '这一轮，完成了。' })).toBeVisible();
  const pending = (await rows<Outbox>(page, 'outbox')).filter(row => row.userId === accountA.user.id);
  expect(pending).toHaveLength(10);
  expect(new Set(pending.map(row => row.id)).size).toBe(10);
  expect(pending.every(row => !row.event.practice)).toBe(true);
  await page.getByRole('button', { name: '返回今日', exact: true }).click();
  // A second offline round may review introduced items/directions, but cannot
  // allocate ten additional new items from a stale server daily count.
  await page.getByRole('button', { name: '教材', exact: true }).click();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停学习，保存位置' })).toBeVisible();
  const introduced = new Set(pending.map(row => row.event.itemId));
  await expect.poll(async () => (await rows<{ userId: string; value: { cursor: number; queue: { question: { itemId: string } }[] } }>(page, 'sessions'))
    .find(row => row.userId === accountA.user.id)?.value.cursor).toBe(0);
  const nextRound = (await rows<{ userId: string; value: { queue: { question: { itemId: string } }[] } }>(page, 'sessions')).find(row => row.userId === accountA.user.id)!;
  expect(nextRound.value.queue.length).toBeGreaterThan(0);
  expect(nextRound.value.queue.every(entry => introduced.has(entry.question.itemId))).toBe(true);
  expect(await rows<Outbox>(page, 'outbox')).toHaveLength(10);
  await page.getByRole('button', { name: '暂停学习，保存位置' }).click();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByText('10 条记录等待同步', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/C-offline-outbox-390.png`, fullPage: true });
  await context.setOffline(false);
  await expect.poll(async () => (await get<History>(page, '/api/history')).events.length).toBe(10);
  await expect.poll(async () => (await rows<Outbox>(page, 'outbox')).length).toBe(0);
  const replay = await post<SyncResponse>(page, '/api/reviews', accountA.user.id, { events: pending.map(row => row.event) });
  expect(replay.acceptedIds.sort()).toEqual(pending.map(row => row.id).sort());
  expect(replay.conflicts).toEqual([]);
  expect((await get<History>(page, '/api/history')).events).toHaveLength(10);
  const deckA = await createDraft(page, 'C 账号 A 私人草稿', 'только для А');
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  const accountB = await signup(page, 'offline-B');
  expect(accountB.user.id).not.toBe(accountA.user.id);
  await expect(page.getByRole('button', { name: '继续上次学习', exact: true })).toHaveCount(0);
  expect((await get<{ decks: DeckDTO[] }>(page, '/api/decks')).decks).toEqual([]);
  expect((await page.request.get(`/api/decks/${deckA.id}`)).status()).toBe(404);
  const deckB = await createDraft(page, 'C 账号 B 私人草稿', 'только для Б');
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.locator('.download-list')).toHaveCount(0);
  await expect(page.getByText(accountB.user.email, { exact: true })).toBeVisible();
  await context.setOffline(true); await page.reload();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByText(accountB.user.email, { exact: true })).toBeVisible();
  await expect(page.getByText(accountA.user.email, { exact: true })).toHaveCount(0);
  await expect(page.locator('.download-list')).toHaveCount(0);
  await page.getByRole('button', { name: '教材', exact: true }).click();
  await page.getByRole('button', { name: /^第 2 课/ }).click();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page.getByText('请先联网下载这个学习范围。', { exact: true })).toBeVisible();
  expect((await rows<{ userId: string }>(page, 'downloads')).map(row => row.userId)).toEqual([accountA.user.id]);
  const draftRows = await rows<{ userId: string; key: string }>(page, 'drafts');
  expect(draftRows.find(row => row.key === `manual:${deckA.id}`)?.userId).toBe(accountA.user.id);
  expect(draftRows.find(row => row.key === `manual:${deckB.id}`)?.userId).toBe(accountB.user.id);
  await context.setOffline(false);
  expect(errors).toEqual([]);
  await writeFile(`${artifacts}/offline-acceptance.json`, JSON.stringify({ completedAt: new Date().toISOString(), accountA: accountA.user.id, accountB: accountB.user.id, eventIds: pending.map(row => row.id), persistedCount: 10, replayCount: 10, reloadFeedbackPreserved: true, secondOfflineRoundRespectsNewBudget: true, isolatedDraftDecks: [deckA.id, deckB.id], pageErrors: errors }, null, 2));
});

test('C: conflicts remain visible and authenticated resolution preserves scheduling', async ({ page, request }) => {
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const account = await signup(page, 'conflicts');
  const data = await get<ItemsResponse>(page, '/api/items?lessons=1-1&limit=1000');
  const [item, second] = data.items.filter(entry => !entry.missingMeaning && !entry.meaningDisputed);
  expect(second).toBeDefined();
  const deviceId = randomUUID(); const sessionId = randomUUID();
  const event: ReviewEventInput = { id: randomUUID(), deviceId, sessionId, clientSequence: 1, cardId: cardId(item.id, 'recall'), itemId: item.id, direction: 'recall', rating: 'good', correct: true, practice: false, occurredAt: new Date().toISOString(), baseVersion: 0, contentVersion: item.contentVersion, schedulerVersion: SCHEDULER_VERSION, parametersVersion: PARAMETERS_VERSION, mode: 'recall' };
  const first = await post<SyncResponse>(page, '/api/reviews', account.user.id, { events: [event] });
  expect(first.acceptedIds).toEqual([event.id]);
  const stale = { ...event, id: randomUUID(), clientSequence: 2 };
  const future = { ...event, id: randomUUID(), clientSequence: 3, itemId: second.id, cardId: cardId(second.id, 'recall'), contentVersion: second.contentVersion, occurredAt: new Date(Date.now() + 86400_000).toISOString() };
  const conflicts = await post<SyncResponse>(page, '/api/reviews', account.user.id, { events: [stale, future] });
  expect(conflicts.acceptedIds).toEqual([]);
  expect(conflicts.conflicts.map(entry => entry.id).sort()).toEqual([stale.id, future.id].sort());
  expect(conflicts.states[event.cardId].version).toBe(1);
  expect(conflicts.resetCardIds).toContain(future.cardId);
  const duplicate = await post<SyncResponse>(page, '/api/reviews', account.user.id, { events: [stale, future] });
  expect(duplicate.conflicts).toEqual(conflicts.conflicts);
  expect((await get<History>(page, '/api/history')).conflicts).toHaveLength(2);
  await page.reload();
  expect((await get<History>(page, '/api/history')).conflicts).toHaveLength(2);
  const resolution = `/api/reviews/conflicts/${encodeURIComponent(stale.id)}`;
  expect((await request.post(resolution, { data: { action: 'keep-practice' }, headers: headers(page, account.user.id) })).status()).toBe(401);
  expect((await page.request.post(resolution, { data: { action: 'keep-practice' }, headers: headers(page, 'different-account') })).status()).toBe(409);
  expect((await post<SyncResponse>(page, resolution, account.user.id, { action: 'keep-practice' })).acceptedIds).toEqual([stale.id]);
  expect((await post<SyncResponse>(page, resolution, account.user.id, { action: 'keep-practice' })).acceptedIds).toEqual([stale.id]);
  expect((await page.request.post(resolution, { data: { action: 'discard' }, headers: headers(page, account.user.id) })).status()).toBe(409);
  expect((await post<SyncResponse>(page, `/api/reviews/conflicts/${future.id}`, account.user.id, { action: 'discard' })).acceptedIds).toEqual([future.id]);
  expect((await post<SyncResponse>(page, `/api/reviews/conflicts/${future.id}`, account.user.id, { action: 'discard' })).acceptedIds).toEqual([future.id]);
  const after = await get<History>(page, '/api/history');
  expect(after.conflicts).toEqual([]);
  expect(after.events).toHaveLength(2);
  expect(after.events.find(entry => entry.id === stale.id)?.practice).toBe(true);
  expect(after.events.some(entry => entry.id === future.id)).toBe(false);
  const finalStates = (await get<ItemsResponse>(page, '/api/items?lessons=1-1&limit=1000')).states;
  expect(finalStates[event.cardId].version).toBe(1);
  expect(finalStates[future.cardId]).toBeUndefined();
  await writeFile(`${artifacts}/conflicts-acceptance.json`, JSON.stringify({ completedAt: new Date().toISOString(), userId: account.user.id, accepted: event.id, keptPractice: stale.id, discarded: future.id, stateVersion: finalStates[event.cardId].version }, null, 2));
});

test('C: administrator revision is audited, source raw is unchanged, and original teaching text is restored', async ({ page, browser, request, baseURL }) => {
  test.setTimeout(120_000);
  await mkdir(artifacts, { recursive: true });
  expect((await request.get('/api/admin/issues')).status()).toBe(401);
  const account = await signup(page, 'normal-role');
  expect((await page.request.get('/api/admin/issues')).status()).toBe(403);
  expect((await page.request.post('/api/admin/revisions', { data: { itemId: 'forbidden', notes: 'never written', reason: 'automated acceptance role check' }, headers: headers(page, account.user.id) })).status()).toBe(403);

  // The existing administrator password stays in-process. Native fetch avoids
  // recording this real credential in a Playwright request trace or attachment.
  const access = await readFile('.local/demo-access.md', 'utf8');
  const adminLine = access.split('\n').find(line => line.includes('admin@ruslearn.test'));
  if (!adminLine) throw new Error('Local administrator access record is unavailable');
  const email = adminLine.match(/admin@ruslearn\.test/)![0];
  const password = adminLine.trim().split(/\s+/).at(-1)!.replace(/^`|`$/g, '');
  const origin = baseURL || 'http://localhost:4186';
  const signed = await fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email, password }) });
  if (!signed.ok) throw new Error(`Administrator login failed (${signed.status})`);
  const adminContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const cookies = signed.headers.getSetCookie().map(header => {
    const pair = header.split(';')[0]; const separator = pair.indexOf('=');
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin, httpOnly: /;\s*HttpOnly/i.test(header), secure: origin.startsWith('https:'), sameSite: 'Lax' as const };
  });
  await adminContext.addCookies(cookies);
  const adminPage = await adminContext.newPage();
  config({ path: '.env', quiet: true });
  const databaseUrl = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (databaseUrl.pathname !== '/ruslearn_dev' || !['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) throw new Error('C source audit requires the isolated local ruslearn_dev database');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let changed: { id: string; notes: string; userId: string } | null = null;
  try {
    await adminPage.goto('/');
    const admin = await get<BootstrapDTO>(adminPage, '/api/bootstrap');
    expect(admin.user.role).toBe('admin');
    const issues = await get<{ issues: ItemsResponse['items'] }>(adminPage, '/api/admin/issues');
    const selected = issues.issues.find(item => item.sourceEntryId && !item.missingMeaning && !item.meaningDisputed);
    expect(selected).toBeDefined();
    const beforeRaw = await pool.query('SELECT raw, "sourceVersion" FROM "SourceEntry" WHERE id=$1', [selected!.sourceEntryId]);
    expect(beforeRaw.rowCount).toBe(1);
    const beforeHash = createHash('sha256').update(JSON.stringify(beforeRaw.rows[0])).digest('hex');
    await adminPage.getByRole('button', { name: '我的', exact: true }).click();
    await adminPage.getByRole('button', { name: '内容维护', exact: true }).click();
    const dialog = adminPage.getByRole('dialog', { name: '内容维护' });
    await dialog.locator('.word-row').filter({ has: adminPage.getByText(selected!.russian, { exact: true }) }).first().click();
    await dialog.getByRole('textbox', { name: '说明与备注', exact: true }).fill(`${selected!.notes}\nautomated acceptance ${Date.now()}`);
    const reason = `automated acceptance checkpoint C ${randomUUID()}`;
    await dialog.getByLabel('修订原因', { exact: true }).fill(reason);
    changed = { id: selected!.id, notes: selected!.notes, userId: admin.user.id };
    const revisionResponse = adminPage.waitForResponse(response => response.url().endsWith('/api/admin/revisions') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存修订版本', exact: true }).click();
    expect((await revisionResponse).ok()).toBe(true);
    const revised = await get<{ item: ItemsResponse['items'][number]; revisions: { reason: string; version: number }[] }>(adminPage, `/api/items/${selected!.id}`);
    expect(revised.item.contentVersion).toBe(selected!.contentVersion + 1);
    expect(revised.revisions.find(entry => entry.version === revised.item.contentVersion)?.reason).toBe(reason);
    const audit = await pool.query('SELECT "actorId", before, after FROM "ContentRevision" WHERE "itemId"=$1 AND version=$2', [selected!.id, revised.item.contentVersion]);
    expect(audit.rows[0].actorId).toBe(admin.user.id);
    expect(audit.rows[0].before.notes).toBe(selected!.notes);
    expect(audit.rows[0].after.notes).toBe(revised.item.notes);
    const afterRaw = await pool.query('SELECT raw, "sourceVersion" FROM "SourceEntry" WHERE id=$1', [selected!.sourceEntryId]);
    expect(afterRaw.rows).toEqual(beforeRaw.rows);
    await post(adminPage, '/api/admin/revisions', admin.user.id, { itemId: selected!.id, notes: selected!.notes, reason: `${reason} restore original teaching notes` });
    changed = null;
    const restored = await get<{ item: ItemsResponse['items'][number]; revisions: { reason: string; version: number }[] }>(adminPage, `/api/items/${selected!.id}`);
    expect(restored.item.notes).toBe(selected!.notes);
    expect(restored.item.chinese).toBe(selected!.chinese);
    expect(restored.item.contentVersion).toBe(selected!.contentVersion + 2);
    expect(restored.revisions.filter(entry => entry.reason.startsWith(reason))).toHaveLength(2);
    await writeFile(`${artifacts}/admin-audit-acceptance.json`, JSON.stringify({ completedAt: new Date().toISOString(), itemId: selected!.id, sourceEntryId: selected!.sourceEntryId, rawSha256: beforeHash, originalVersion: selected!.contentVersion, finalVersion: restored.item.contentVersion, auditRevisions: 2, originalTeachingTextRestored: true }, null, 2));
  } finally {
    if (changed) await post(adminPage, '/api/admin/revisions', changed.userId, { itemId: changed.id, notes: changed.notes, reason: 'automated acceptance checkpoint C failure cleanup restore original teaching notes' });
    await pool.end(); await adminContext.close();
  }
});

test('C: dark, reduced-motion mobile layouts have no serious accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await signup(page, 'accessibility');
  await page.getByRole('button', { name: '我的', exact: true }).click();
  const dark = page.getByRole('button', { name: '切换深色', exact: true });
  if (await dark.isVisible()) await dark.click();
  const results: { width: number; page: string; violations: unknown[] }[] = [];
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ['今日', '教材', '我的']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      await expect(page.getByRole('heading', { name: view === '今日' ? '今天，让几个词更熟悉。' : view === '教材' ? '这一页，从哪里开始？' : '我的学习', exact: true })).toBeVisible();
      if (view === '教材') await expect(page.locator('.word-row').first()).toBeVisible();
      await expect(page.locator('#main > div').last()).toHaveCSS('opacity', '1');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      results.push({ width, page: view, violations: report.violations });
      await page.screenshot({ path: `${artifacts}/C-dark-reduced-${view}-${width}.png`, fullPage: true });
    }
  }
  await writeFile(`${artifacts}/accessibility.json`, JSON.stringify(results, null, 2));
  const serious = results.flatMap(result => (result.violations as { impact: string; id: string; nodes: { target: string[] }[] }[])
    .filter(violation => ['serious', 'critical'].includes(violation.impact))
    .map(violation => ({ width: result.width, page: result.page, id: violation.id, targets: violation.nodes.map(node => node.target.join(' ')) })));
  expect(serious).toEqual([]);
});
