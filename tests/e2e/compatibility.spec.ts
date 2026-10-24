import { test, expect, webkit, devices, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BootstrapDTO, DeckDTO, ItemsResponse, ReviewEventInput } from '../../src/domain/types';
import type { StudySession } from '../../src/domain/learning';

const artifacts = 'artifacts/compatibility';
type FeedbackTiming = { domMs: number; nextFrameMs: number };
type ProbeWindow = Window & { slovoFeedbackTimings?: FeedbackTiming[] };

test.beforeEach(async ({ page }) => { page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(15_000); });

async function signup(page: Page): Promise<BootstrapDTO> {
  const unique = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  await page.goto('/');
  await page.getByRole('button', { name: '第一次来？创建账号', exact: true }).click();
  await page.getByLabel('怎么称呼你', { exact: true }).fill('兼容性验收');
  await page.getByLabel('邮箱', { exact: true }).fill(`compatibility-${unique}@ruslearn.test`);
  await page.getByLabel('密码', { exact: true }).fill(`Compatibility-${unique}!`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/sign-up/email');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    const response = await responsePromise;
    if (response.status() !== 429) { expect(response.ok(), `Signup HTTP ${response.status()}`).toBe(true); break; }
    if (attempt === 3) throw new Error('Signup remained rate limited after respecting Retry-After.');
    const retry = response.headers()['retry-after'] || response.headers()['x-retry-after'];
    const duration = retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 11_000;
    if (duration > 60_000) throw new Error('Signup rate-limit retry exceeds this browser test window.');
    // Registration security stays enabled; this isolated QA account waits its
    // turn instead of weakening the endpoint rate limit for automated tests.
    await page.waitForTimeout(Math.max(1_000, Number.isFinite(duration) ? duration + 250 : 11_000));
  }
  await expect(page.getByRole('heading', { name: '今天，让几个词更熟悉。' })).toBeVisible();
  const response = await page.request.get('/api/bootstrap');
  expect(response.ok()).toBe(true);
  return response.json() as Promise<BootstrapDTO>;
}

async function rows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async storeName => {
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

async function session(page: Page, userId: string): Promise<StudySession> {
  const saved = (await rows<{ userId: string; value: StudySession }>(page, 'sessions')).find(row => row.userId === userId);
  expect(saved).toBeDefined(); return saved!.value;
}

async function configure(page: Page, direction: 'ru-zh' | 'zh-ru' | 'recall') {
  await page.getByRole('button', { name: '学习设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '按你的节奏学习' });
  await settings.getByLabel(/^练习方向/).selectOption(direction);
  await settings.getByLabel(/^每日新词目标/).selectOption('50');
  await settings.getByLabel(/^每轮题数/).selectOption('10');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(settings).toBeHidden();
}

async function installFeedbackProbe(page: Page) {
  await page.evaluate(() => {
    (window as ProbeWindow).slovoFeedbackTimings = [];
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element) || !event.target.closest('.answer-option')) return;
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.answer-feedback')) return;
        observer.disconnect();
        const domMs = performance.now() - started;
        requestAnimationFrame(() => {
          (window as ProbeWindow).slovoFeedbackTimings!.push({ domMs, nextFrameMs: performance.now() - started });
        });
      });
      observer.observe(document.querySelector('main')!, { childList: true, subtree: true });
    }, true);
  });
}

async function touchTargets(page: Page) {
  return page.evaluate(() => {
    const modal = document.querySelector('dialog[open]');
    const root = modal || document;
    return [...root.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, summary')]
      .filter(node => node.getClientRects().length && !node.matches(':disabled') && getComputedStyle(node).visibility !== 'hidden' && !node.classList.contains('sr-only'))
      .map(node => {
        const target = node.matches('input[type="checkbox"]') ? node.closest('label') || node : node;
        const bounds = target.getBoundingClientRect();
        return { label: (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 80), width: bounds.width, height: bounds.height };
      })
      .filter(box => box.width < 43.5 || box.height < 43.5);
  });
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const direction of ['ru-zh', 'zh-ru'] as const) {
  test(`compatibility: real ${direction} answers, spaced correction, offline feedback at 4x CPU`, async ({ page, context }) => {
    test.setTimeout(180_000);
    await mkdir(artifacts, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const account = await signup(page);
    await configure(page, direction);
    await page.getByRole('button', { name: '教材', exact: true }).click();
    await page.getByRole('button', { name: /^第 2 课/ }).click();
    const sourceResponse = await page.request.get('/api/items?lessons=1-1,1-2&limit=1000');
    expect(sourceResponse.ok()).toBe(true);
    const source = await sourceResponse.json() as ItemsResponse;
    const canonical = new Map(source.items.map(item => [item.id, item]));
    await page.getByRole('button', { name: '下载离线', exact: true }).click();
    await expect(page.getByText(/已下载 \d+ 条内容，可在本机离线练习。/)).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await installFeedbackProbe(page);
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停学习，保存位置' })).toBeVisible();
    await expect.poll(async () => (await rows<{ userId: string }>(page, 'sessions')).some(row => row.userId === account.user.id)).toBe(true);
    let wrongId = ''; let wrongCursor = -1; let repeatedCursor = -1; let choices = 0; let total = 0;
    while (total < 15 && !await page.getByRole('heading', { name: '这一轮，完成了。' }).isVisible()) {
      const current = await session(page, account.user.id);
      const entry = current.queue[current.cursor]; const question = entry.question;
      expect(question.direction).toBe(direction);
      const item = canonical.get(question.itemId)!;
      expect(item).toBeDefined();
      expect(question.prompt).toBe(direction === 'ru-zh' ? item.russian : item.chinese);
      expect(question.answer).toBe(direction === 'ru-zh' ? item.chinese : item.russian);
      const intentionallyWrong = question.mode === 'choice' && wrongCursor < 0;
      if (intentionallyWrong) { wrongId = question.itemId; wrongCursor = current.cursor; }
      else if (question.itemId === wrongId && entry.attempt > 0) {
        repeatedCursor = current.cursor; expect(entry.practice).toBe(true);
        expect(repeatedCursor - wrongCursor - 1).toBeGreaterThanOrEqual(3);
        expect(repeatedCursor - wrongCursor - 1).toBeLessThanOrEqual(7);
      }
      if (question.mode === 'choice') {
        const chosen = question.options.find(option => intentionallyWrong ? option.id !== question.correctOptionId : option.id === question.correctOptionId)!;
        await page.locator('.answer-option').filter({ has: page.getByText(chosen.text, { exact: true }) }).click(); choices++;
        await expect.poll(() => page.evaluate(() => (window as ProbeWindow).slovoFeedbackTimings?.length || 0)).toBe(choices);
      } else {
        await page.getByRole('button', { name: '查看答案', exact: true }).click();
        await page.getByRole('button', { name: '记住了', exact: true }).click();
      }
      await expect(page.getByText(intentionallyWrong ? '再认识它一次' : '答对了', { exact: true })).toBeVisible();
      // Feedback cannot auto-advance or save a formal attempt before Continue.
      expect((await session(page, account.user.id)).cursor).toBe(current.cursor);
      expect((await rows<{ userId: string }>(page, 'outbox')).filter(row => row.userId === account.user.id)).toHaveLength(total);
      await page.getByRole('button', { name: '保存并继续', exact: true }).click();
      await expect(page.getByRole('button', { name: '保存并继续', exact: true })).toBeHidden(); total++;
    }
    await expect(page.getByRole('heading', { name: '这一轮，完成了。' })).toBeVisible();
    expect(wrongCursor).toBeGreaterThanOrEqual(0); expect(repeatedCursor).toBeGreaterThan(wrongCursor);
    expect(total).toBe(11); expect(choices).toBeGreaterThanOrEqual(5);
    const events = (await rows<{ userId: string; event: ReviewEventInput }>(page, 'outbox')).filter(row => row.userId === account.user.id).map(row => row.event);
    expect(events).toHaveLength(total);
    expect(events.every(event => event.direction === direction)).toBe(true);
    expect(events.filter(event => event.itemId === wrongId).map(event => event.practice)).toEqual([false, true]);
    const timings = await page.evaluate(() => (window as ProbeWindow).slovoFeedbackTimings!);
    const sorted = timings.map(sample => sample.domMs).sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * .95) - 1];
    await writeFile(`${artifacts}/${direction}-feedback.json`, JSON.stringify({ measuredAt: new Date().toISOString(), browser: 'Chromium desktop engine, mobile viewport; not a physical-device claim', cpuSlowdown: 4, offline: true, metric: 'capture click event to feedback DOM mutation; nextFrameMs is first animation-frame opportunity, not measured screen paint', targetMs: 100, p50DomMs: sorted[Math.floor(sorted.length / 2)], p95DomMs: p95, maxDomMs: Math.max(...sorted), targetMet: p95 < 100, timings, attempts: total, choices, wrongCursor, repeatedCursor }, null, 2));
    await page.screenshot({ path: `${artifacts}/${direction}-completed-390.png`, fullPage: true });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await context.setOffline(false);
    await expect.poll(async () => {
      const response = await page.request.get('/api/history'); return (await response.json()).events.length as number;
    }).toBe(total);
    expect(p95, `Measured p95 ${p95.toFixed(1)} ms; full samples in ${artifacts}/${direction}-feedback.json`).toBeLessThan(100);
  });
}

test('compatibility: 44px controls, long Russian/Chinese content, dark theme and 200% text', async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(artifacts, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  const account = await signup(page);
  const audits: { screen: string; width: number; smallTargets: Awaited<ReturnType<typeof touchTargets>> }[] = [];
  async function audit(screen: string, width: number) {
    await page.setViewportSize({ width, height: 844 }); await noHorizontalOverflow(page);
    const smallTargets = await touchTargets(page); audits.push({ screen, width, smallTargets });
  }
  for (const width of [360, 390, 430]) await audit('today', width);
  await page.getByRole('button', { name: '教材', exact: true }).click();
  for (const width of [360, 390, 430]) await audit('textbooks', width);
  await page.getByRole('button', { name: '学习设置', exact: true }).click();
  for (const width of [360, 390, 430]) await audit('settings', width);
  await page.getByRole('dialog', { name: '按你的节奏学习' }).getByRole('button', { name: '关闭', exact: true }).click();
  const headers = { Origin: new URL(page.url()).origin, 'X-Slovo-User': account.user.id };
  const created = await page.request.post('/api/decks', { headers, data: { name: '长句与中文多义说明兼容性', category: '布局验收' } });
  expect(created.status()).toBe(201); const deck = await created.json() as DeckDTO;
  const russian = 'Всё будет хорошо: мой друг ещё раз внимательно читает длинное предложение, чтобы сохранить буквы ё, й и уда́рение в каждом слове.';
  const chinese = '一切都会好起来：我的朋友再次认真阅读这个长句，以保留俄语字母 ё、й 与重音；这段较长的中文说明用于确认手机窄屏上能完整阅读和换行，不裁切真实释义。';
  const added = await page.request.post(`/api/decks/${deck.id}/items`, { headers, data: { items: [{ russian, chinese, kind: 'sentence', notes: '用于真实保存后的窄屏与大字测试。', example: russian, tags: ['长句'] }] } });
  expect(added.status()).toBe(201);
  await page.getByRole('button', { name: '我的词库', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(deck.name) }).click();
  await expect(page.getByText(russian, { exact: true })).toBeVisible();
  for (const width of [360, 390, 430]) await audit('long-sentence-deck', width);
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await expect(page.locator('.question-area h1')).toHaveText(russian);
  await page.getByRole('button', { name: '查看答案', exact: true }).click();
  await expect(page.locator('.recall-answer')).toHaveText(chinese);
  for (const width of [360, 390, 430]) {
    await audit('long-sentence-study', width);
    await page.screenshot({ path: `${artifacts}/long-sentence-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '暂停学习，保存位置' }).click();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '切换深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 360, height: 844 }); await noHorizontalOverflow(page);
  await page.screenshot({ path: `${artifacts}/profile-dark-360.png`, fullPage: true });
  // Explicitly double computed text sizes. Browser default-font settings alone
  // would not exercise px-based typography; this is a reproducible stress test.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].filter(element => !(element instanceof SVGElement)).map(element => [element, getComputedStyle(element).fontSize] as const);
    for (const [element, size] of sizes) element.style.fontSize = `${parseFloat(size) * 2}px`;
  });
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${artifacts}/profile-dark-text200-360.png`, fullPage: true });
  await writeFile(`${artifacts}/layout-touch-audit.json`, JSON.stringify({ measuredAt: new Date().toISOString(), reducedMotion: true, textStress: '200% computed text at360px', physicalDevice: false, audits }, null, 2));
  expect(audits.flatMap(audit => audit.smallTargets.map(target => ({ screen: audit.screen, viewportWidth: audit.width, ...target }))), 'Interactive target dimensions, accounting for clickable checkbox labels').toEqual([]);
});

test('compatibility: actual WebKit engine supports login, local storage, offline reload and sync', async ({ baseURL }) => {
  test.setTimeout(120_000);
  await mkdir(artifacts, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], baseURL });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(15_000);
  let phase = 'signup';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const account = await signup(page);
    phase = 'configure';
    await configure(page, 'recall');
    await page.getByRole('button', { name: '教材', exact: true }).click();
    await page.getByRole('button', { name: /^第 2 课/ }).click();
    await page.getByRole('button', { name: '下载离线', exact: true }).click();
    await expect(page.getByText(/已下载 \d+ 条内容，可在本机离线练习。/)).toBeVisible();
    phase = 'service-worker-ready';
    await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const cachedPaths = await page.evaluate(async () => {
      const cache = await caches.open('slovo-public-shell-v2');
      return (await cache.keys()).map(request => new URL(request.url).pathname);
    });
    expect(cachedPaths.some(path => path.startsWith('/_next/static/') && path.endsWith('.css'))).toBe(true);
    expect(cachedPaths.some(path => path.startsWith('/_next/static/') && path.endsWith('.js'))).toBe(true);
    expect(cachedPaths.some(path => path.startsWith('/api/') || path.startsWith('/ocr/'))).toBe(false);
    await context.setOffline(true);
    phase = 'offline-study';
    await page.getByRole('button', { name: '开始学习', exact: true }).click();
    for (let index = 0; index < 3; index++) {
      if (index === 2) {
        phase = 'offline-reload';
        await page.reload();
        await page.getByRole('button', { name: '继续上次学习', exact: true }).click();
      }
      await page.getByRole('button', { name: '查看答案', exact: true }).click();
      await page.getByRole('button', { name: '记住了', exact: true }).click();
      await page.getByRole('button', { name: '保存并继续', exact: true }).click();
      await expect(page.getByRole('button', { name: '保存并继续', exact: true })).toBeHidden();
    }
    const pending = (await rows<{ userId: string }>(page, 'outbox')).filter(row => row.userId === account.user.id);
    expect(pending).toHaveLength(3);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${artifacts}/webkit-offline-study-390.png`, fullPage: true });
    await context.setOffline(false);
    phase = 'sync';
    await expect.poll(async () => {
      const response = await page.request.get('/api/history'); return (await response.json()).events.length as number;
    }).toBe(3);
    await expect.poll(async () => (await rows<{ userId: string }>(page, 'outbox')).filter(row => row.userId === account.user.id).length).toBe(0);
    expect(errors).toEqual([]);
    await writeFile(`${artifacts}/webkit-acceptance.json`, JSON.stringify({ measuredAt: new Date().toISOString(), engine: 'WebKit', version: browser.version(), executable: webkit.executablePath(), emulation: 'iPhone 13 viewport/device parameters on macOS', physicalDevice: false, offlineAttempts: 3, offlineReload: true, synchronizedEvents: 3, publicCachedPaths: cachedPaths, pageErrors: errors }, null, 2));
  } catch (caught) {
    await page.screenshot({ path: `${artifacts}/webkit-failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${artifacts}/webkit-failure.txt`, `Phase: ${phase}\n${String(caught)}\n\n${await page.locator('body').innerText().catch(() => '')}`);
    throw caught;
  } finally { await context.close(); await browser.close(); }
});
