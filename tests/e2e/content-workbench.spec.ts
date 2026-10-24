import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { BootstrapDTO, EvidenceField } from '../../src/domain/types';
import type { AnnotationMutationResult, AnnotationRevisionDTO, ContentCoverageDTO, ContentItemDetail, ContentJobDetail, ContentListResponse } from '../../src/domain/content';

const artifacts = 'artifacts/content-workbench';
const base = '/api/admin/content';
test.use({ actionTimeout: 15_000 });

async function json<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path); expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}
async function post<T>(page: Page, path: string, userId: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, { headers: { Origin: new URL(page.url()).origin, 'X-Slovo-User': userId }, data });
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true); return response.json() as Promise<T>;
}
async function authenticated(browser: Browser, baseURL: string | undefined, email: string): Promise<{ context: BrowserContext; page: Page; account: BootstrapDTO }> {
  const origin = baseURL || 'http://localhost:4186';
  if (!['http://localhost:4186', 'http://127.0.0.1:4186'].includes(origin)) throw new Error('Content mutation acceptance runs only on the isolated local 4186 application, never the public service or SSH forward.');
  const access = await readFile('.local/demo-access.md', 'utf8');
  const line = access.split('\n').find(candidate => candidate.includes(email));
  if (!line) throw new Error('Local acceptance account record is unavailable');
  const tokens = line.trim().split(/\s+/); const accountIndex = tokens.findIndex(token => token.includes(email));
  const password = tokens[accountIndex + 2]?.split('（')[0].replace(/^`|`$/g, '');
  if (!password || tokens[accountIndex + 1] !== '/') throw new Error('Local acceptance credential record format is unsupported');
  // Real credentials remain in native fetch memory, outside Playwright traces.
  const response = await fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`Acceptance login HTTP ${response.status}`);
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addCookies(response.headers.getSetCookie().map(header => {
    const pair = header.split(';')[0]; const separator = pair.indexOf('=');
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin, httpOnly: /;\s*HttpOnly/i.test(header), sameSite: 'Lax' as const };
  }));
  const page = await context.newPage(); page.setDefaultTimeout(15_000); await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，让几个词更熟悉。' })).toBeVisible();
  return { context, page, account: await json<BootstrapDTO>(page, '/api/bootstrap') };
}
async function openWorkbench(page: Page) {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '注解工作台', exact: true }).click();
  return page.getByRole('dialog', { name: '注解工作台', exact: true });
}
async function snapshot(page: Page, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.getByRole('dialog', { name: '注解工作台' }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const tooSmall = await page.locator('.content-workbench').evaluate(root => [...root.querySelectorAll<HTMLElement>('button,input,select,textarea,summary')].flatMap(element => {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return [];
    const target = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.closest('label') || element : element;
    const box = target.getBoundingClientRect();
    return box.width < 43.5 || box.height < 43.5 ? [{ name: element.getAttribute('aria-label') || target.textContent?.trim().slice(0, 60), width: box.width, height: box.height }] : [];
  }));
  expect(tooSmall, 'Visible workbench controls provide at least 44 × 44 CSS px targets').toEqual([]);
  await page.screenshot({ path: `${artifacts}/${name}.png` });
}
async function baseline(page: Page, userId: string): Promise<{ detail: ContentItemDetail; evidence: EvidenceField; revision: AnnotationRevisionDTO }> {
  // An actual generation revision supplies a restorable baseline. If the full
  // job has not run yet, prepare one currently missing field through that API.
  const missing = await json<ContentListResponse>(page, `${base}/items?field=headword&status=missing&limit=1`);
  if (missing.items.length) {
    const job = await post<ContentJobDetail>(page, `${base}/jobs`, userId, { requestKey: randomUUID(), provider: 'local-dictionary', itemIds: [missing.items[0].id], fields: ['headword'], costLimitCents: 0 });
    const result = await post<ContentJobDetail>(page, `${base}/jobs/${job.id}/run-batch`, userId, { limit: 1 });
    expect(result.failed).toBe(0);
  }
  const list = await json<ContentListResponse>(page, `${base}/items?field=headword&status=source&limit=100`);
  const candidates = [...missing.items, ...list.items.filter(item => !missing.items.some(prepared => prepared.id === item.id))];
  for (const item of candidates) {
    const detail = await json<ContentItemDetail>(page, `${base}/items/${item.id}?field=headword`);
    const evidence = detail.fields.find(field => field.key === 'headword')?.evidence;
    const revision = detail.revisions.find(entry => entry.fieldKey === 'headword' && isDeepStrictEqual(entry.after, evidence));
    if (evidence && typeof evidence.value === 'string' && revision) return { detail, evidence, revision };
  }
  throw new Error('No restorable generated headword baseline exists. Apply the prepared full-corpus generation job before browser acceptance.');
}

test('content workbench: role guard, evidence edit, field approval/rejection, and audited baseline restore', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000); await mkdir(artifacts, { recursive: true });
  expect((await request.get(`${base}/coverage`)).status()).toBe(401);
  const ordinary = await authenticated(browser, baseURL, 'demo@ruslearn.test');
  try {
    expect((await ordinary.page.request.get(`${base}/coverage`)).status()).toBe(403);
    await ordinary.page.getByRole('button', { name: '我的', exact: true }).click();
    await expect(ordinary.page.getByRole('button', { name: '注解工作台', exact: true })).toHaveCount(0);
  } finally { await ordinary.context.close(); }
  const admin = await authenticated(browser, baseURL, 'admin@ruslearn.test');
  let target: Awaited<ReturnType<typeof baseline>> | null = null; let restoreNeeded = false;
  try {
    expect(admin.account.user.role).toBe('admin'); target = await baseline(admin.page, admin.account.user.id);
    const original = target.detail; const originalHash = createHash('sha256').update(JSON.stringify(original.source)).digest('hex');
    const dialog = await openWorkbench(admin.page);
    await dialog.getByRole('button', { name: '逐字段审核', exact: true }).click();
    await dialog.getByRole('combobox', { name: /^册数/ }).selectOption(String(original.item.book));
    await dialog.getByRole('combobox', { name: /^课次/ }).selectOption(`${original.item.book}-${original.item.lessons[0]}`);
    await dialog.getByRole('combobox', { name: /^注解字段/ }).selectOption('headword');
    await dialog.getByRole('textbox', { name: /^搜索俄语或中文/ }).fill(original.item.russian);
    await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
    await dialog.locator(`[data-item-id="${original.item.id}"]`).click();
    const editor = dialog.locator('.workbench-review-form').first();
    await expect(editor.getByRole('textbox', { name: '字段内容', exact: true })).toHaveValue(String(target.evidence.value));
    for (const width of [360, 390, 430]) {
      await admin.page.setViewportSize({ width, height: 844 }); await snapshot(admin.page, `field-detail-${width}`);
    }
    await admin.page.setViewportSize({ width: 390, height: 844 });
    await expect(editor.getByRole('button', { name: '确认此字段', exact: true })).toBeDisabled();
    const reason = `自动化界面验收 ${randomUUID()}；仅验证流程，随后恢复来源版本，不代表人工语言学核验`;
    const temporaryValue = `${target.evidence.value} [临时界面验收]`;
    await editor.getByRole('textbox', { name: '字段内容', exact: true }).fill(temporaryValue);
    await editor.getByRole('textbox', { name: '审核原因', exact: true }).fill(reason);
    await editor.getByRole('checkbox', { name: /我已核对来源与适用义项/ }).check();
    restoreNeeded = true;
    const approveResponse = admin.page.waitForResponse(response => response.url().endsWith(`/items/${original.item.id}/fields/headword/review`) && response.request().method() === 'POST');
    await editor.getByRole('button', { name: '确认此字段', exact: true }).click();
    const approval = await approveResponse; expect(approval.ok()).toBe(true);
    const approved = await approval.json() as AnnotationMutationResult;
    expect(approved.revision.after?.status).toBe('reviewed'); expect(approved.revision.after?.value).toBe(temporaryValue);
    expect(approved.revision.actor.id).toBe(admin.account.user.id); expect(approved.revision.before).toEqual(target.evidence);
    await expect(editor.getByRole('textbox', { name: '审核原因', exact: true })).toHaveValue('');
    await snapshot(admin.page, 'field-approved-390');
    await editor.getByRole('textbox', { name: '审核原因', exact: true }).fill(`${reason}；拒绝临时候选`);
    const rejectResponse = admin.page.waitForResponse(response => response.url().endsWith(`/items/${original.item.id}/fields/headword/review`) && response.request().method() === 'POST');
    await editor.getByRole('button', { name: '拒绝当前候选', exact: true }).click();
    const rejection = await rejectResponse; expect(rejection.ok()).toBe(true);
    const rejected = await rejection.json() as AnnotationMutationResult;
    expect(rejected.revision.after?.status).toBe('rejected'); expect(rejected.revision.after?.value).toBe(temporaryValue);
    await expect(editor.getByRole('textbox', { name: '审核原因', exact: true })).toHaveValue('');
    const history = dialog.locator('.workbench-history');
    await history.locator(':scope > summary').click();
    const historical = history.locator(`[data-revision-id="${target.revision.id}"]`);
    await historical.getByRole('button', { name: '恢复到此版本', exact: true }).click();
    await historical.getByRole('textbox', { name: '回滚原因', exact: true }).fill(`${reason}；恢复验收前的来源状态`);
    const rollbackResponse = admin.page.waitForResponse(response => response.url().endsWith(`/revisions/${target!.revision.id}/rollback`) && response.request().method() === 'POST');
    await historical.getByRole('button', { name: '确认恢复此版本', exact: true }).click();
    const rolledBack = await rollbackResponse; expect(rolledBack.ok()).toBe(true);
    const restored = await json<ContentItemDetail>(admin.page, `${base}/items/${original.item.id}?field=headword`);
    expect(restored.fields.find(field => field.key === 'headword')?.evidence).toEqual(target.evidence);
    expect(restored.item.contentVersion).toBe(original.item.contentVersion + 3);
    expect(createHash('sha256').update(JSON.stringify(restored.source)).digest('hex')).toBe(originalHash);
    expect(restored.revisions.filter(revision => revision.reason.startsWith(reason)).map(revision => revision.action).sort()).toEqual(['approve', 'reject', 'rollback']);
    const restoredCoverage = await json<ContentCoverageDTO>(admin.page, `${base}/coverage`);
    expect(restoredCoverage.reviewedFields).toBe(0);
    restoreNeeded = false;
    await writeFile(`${artifacts}/field-review-acceptance.json`, JSON.stringify({ completedAt: new Date().toISOString(), itemId: original.item.id, field: 'headword', baselineRevision: target.revision.id, originalVersion: original.item.contentVersion, restoredVersion: restored.item.contentVersion, sourceHash: originalHash, baselineRestored: true, reviewedFieldsAfterRestore: restoredCoverage.reviewedFields, approvalAndRejectionAudited: true }, null, 2));
  } finally {
    if (restoreNeeded && target) {
      const current = await json<ContentItemDetail>(admin.page, `${base}/items/${target.detail.item.id}?field=headword`);
      await post(admin.page, `${base}/revisions/${target.revision.id}/rollback`, admin.account.user.id, { requestKey: randomUUID(), baseVersion: current.item.contentVersion, reason: '自动化验收异常清理：恢复原有字段与来源状态' });
    }
    await admin.context.close();
  }
});

test('content workbench: real coverage, book/field task creation, batch progress, cancellation and mobile access', async ({ browser, baseURL }) => {
  test.setTimeout(180_000); await mkdir(artifacts, { recursive: true });
  const admin = await authenticated(browser, baseURL, 'admin@ruslearn.test'); let jobId: string | null = null;
  try {
    const coverage = await json<ContentCoverageDTO>(admin.page, `${base}/coverage`);
    expect(coverage.totalItems).toBe(4835); expect(coverage.fields).toHaveLength(32);
    expect(coverage.reviewedFields).toBe(coverage.statuses.reviewed);
    expect(coverage.applicableFields).toBe(coverage.totalFields - coverage.statuses['not-applicable']);
    const dialog = await openWorkbench(admin.page);
    await expect(dialog.getByText('有来源的字段', { exact: true })).toBeVisible();
    const reports: unknown[] = [];
    for (const width of [360, 390, 430]) {
      await admin.page.setViewportSize({ width, height: 844 }); await snapshot(admin.page, `coverage-${width}`);
      const report = await new AxeBuilder({ page: admin.page }).include('.content-workbench').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      reports.push({ width, violations: report.violations }); expect(report.violations.filter(entry => ['critical', 'serious'].includes(entry.impact || ''))).toEqual([]);
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await admin.page.getByRole('button', { name: '切换深色', exact: true }).click();
    await openWorkbench(admin.page); await expect(dialog.getByText('有来源的字段', { exact: true })).toBeVisible();
    await admin.page.setViewportSize({ width: 390, height: 844 }); await snapshot(admin.page, 'coverage-dark-390');
    const darkReport = await new AxeBuilder({ page: admin.page }).include('.content-workbench').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    reports.push({ width: 390, theme: 'dark', violations: darkReport.violations }); expect(darkReport.violations.filter(entry => ['critical', 'serious'].includes(entry.impact || ''))).toEqual([]);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await admin.page.getByRole('button', { name: '切换浅色', exact: true }).click();
    await openWorkbench(admin.page); await expect(dialog.getByText('有来源的字段', { exact: true })).toBeVisible();
    await admin.page.setViewportSize({ width: 430, height: 844 });
    await dialog.getByRole('button', { name: '补全任务', exact: true }).click();
    const create = dialog.locator('details.workbench-card').first();
    if (!await create.evaluate(element => (element as HTMLDetailsElement).open)) await create.locator(':scope > summary').click();
    await expect(create.getByRole('combobox', { name: /^补全方式/ })).toHaveValue('local-dictionary');
    for (const book of [1, 2, 3, 4, 5]) await create.getByRole('checkbox', { name: `第 ${book} 册`, exact: true }).uncheck();
    await create.locator('.workbench-field-choices > summary').click();
    await create.getByRole('button', { name: '清空字段', exact: true }).click();
    await create.getByRole('checkbox', { name: '规范词头', exact: true }).check();
    const creationResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === `${base}/jobs` && response.request().method() === 'POST');
    await create.getByRole('button', { name: '创建任务', exact: true }).click();
    const creation = await creationResponse; expect(creation.status()).toBe(201);
    const job = await creation.json() as ContentJobDetail; jobId = job.id;
    expect(job.selection.books).toEqual([6]); expect(job.selection.fields).toEqual(['headword']); expect(job.total).toBe(557); expect(job.processed).toBe(0);
    const card = dialog.locator(`[data-job-id="${job.id}"]`);
    await expect(card).toBeVisible();
    const batchResponse = admin.page.waitForResponse(response => response.url().endsWith(`/jobs/${job.id}/run-batch`) && response.request().method() === 'POST');
    await card.getByRole('button', { name: '处理下一批', exact: true }).click();
    const batch = await batchResponse; expect(batch.ok()).toBe(true);
    const processed = await batch.json() as ContentJobDetail;
    expect(processed.processed).toBe(25); expect(processed.remaining).toBe(532);
    await snapshot(admin.page, 'task-progress-430');
    const cancelResponse = admin.page.waitForResponse(response => response.url().endsWith(`/jobs/${job.id}/cancel`) && response.request().method() === 'POST');
    await card.getByRole('button', { name: '取消任务', exact: true }).click();
    const cancellation = await cancelResponse; expect(cancellation.ok()).toBe(true);
    const cancelled = await cancellation.json() as ContentJobDetail;
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.processed).toBe(25);
    await expect(card.getByText('已取消', { exact: true })).toBeVisible();
    const retryResponse = admin.page.waitForResponse(response => response.url().endsWith(`/jobs/${job.id}/retry`) && response.request().method() === 'POST');
    await card.getByRole('button', { name: '恢复未完成任务', exact: true }).click();
    const retry = await retryResponse; expect(retry.ok()).toBe(true);
    const resumed = await retry.json() as ContentJobDetail;
    expect(resumed.status).toBe('queued'); expect(resumed.processed).toBe(25); expect(resumed.remaining).toBe(532);
    await expect(card.getByRole('button', { name: '处理下一批', exact: true })).toBeEnabled();
    const finalCancelResponse = admin.page.waitForResponse(response => response.url().endsWith(`/jobs/${job.id}/cancel`) && response.request().method() === 'POST');
    await card.getByRole('button', { name: '取消任务', exact: true }).click();
    expect((await finalCancelResponse).ok()).toBe(true);
    jobId = null;
    await writeFile(`${artifacts}/task-coverage-acceptance.json`, JSON.stringify({ completedAt: new Date().toISOString(), totalItems: coverage.totalItems, reviewedFields: coverage.reviewedFields, applicableFields: coverage.applicableFields, jobId: job.id, processed: cancelled.processed, remaining: cancelled.remaining, cancellationAndResumePreservedProgress: true, accessibility: reports, physicalDevice: false }, null, 2));
  } finally {
    if (jobId) await post(admin.page, `${base}/jobs/${jobId}/cancel`, admin.account.user.id, {});
    await admin.context.close();
  }
});
