import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createOfflineStore, type OfflineStore } from '../../src/lib/offline';
import { applyRating, buildQuestions, localDateKey, makeSession } from '../../src/domain/learning';
import { bootstrap, event, now, wordSet } from './fixtures';

let store: OfflineStore;
beforeEach(async () => { store = createOfflineStore(`test-${crypto.randomUUID()}`, { indexedDB, IDBKeyRange }); await store.saveBootstrap(bootstrap()); });
afterEach(async () => { vi.useRealTimers(); await store.deleteDatabase(); });

describe('durable account-isolated outbox', () => {
  it('expires cached daily totals on offline local midnight without losing history or pending prior-day events', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T15:59:00Z'));
    const data = bootstrap(); data.stats = { ...data.stats, today: 12, newToday: 10, learned: 30, day: '2026-10-24' };
    await store.saveBootstrap(data);
    await store.enqueueEvent('alice', event(1, { occurredAt: '2026-10-24T15:59:00Z' }));
    expect((await store.getOfflineBootstrap())?.stats.newToday).toBe(10);
    vi.setSystemTime(new Date('2026-10-24T16:01:00Z'));
    expect((await store.getOfflineBootstrap())?.stats).toMatchObject({ day: '2026-10-25', today: 0, newToday: 0, learned: 30 });
    expect(await store.countPendingNewItems('alice', '2026-10-25', 'Asia/Shanghai')).toBe(0);
    expect(await store.getCounts('alice')).toEqual({ pending: 1, conflicts: 0 });
  });

  it('retains Again as an offline mistake and clears it through successful practice without advancing memory', async () => {
    await store.enqueueEvent('alice', event(1, { correct: true, rating: 'again' }));
    const failed = (await store.getStates('alice', ['item-1']))['item-1:ru-zh'];
    expect(failed.flag).toBe('mistake');
    await store.enqueueEvent('alice', event(2, { itemId: 'item-1', cardId: 'item-1:ru-zh', practice: true, correct: true, rating: 'good', baseVersion: 1 }));
    const corrected = (await store.getStates('alice', ['item-1']))['item-1:ru-zh'];
    expect(corrected.flag).toBeUndefined();
    expect(corrected.version).toBe(failed.version);
    expect(corrected.card).toEqual(failed.card);
  });

  it('retains exactly 10 offline answers until explicit acknowledgements, including after a retry', async () => {
    const events = Array.from({ length: 10 }, (_, i) => event(i + 1, { practice: i > 5 }));
    for (const entry of events) await store.enqueueEvent('alice', entry);
    await store.enqueueEvent('alice', events[0]);
    expect(await store.getCounts('alice')).toEqual({ pending: 10, conflicts: 0 });
    expect((await store.getPendingEvents('alice')).map((row) => row.id)).toEqual(events.map((row) => row.id));
    await store.applySyncResult('alice', { acceptedIds: events.slice(0, 4).map((row) => row.id), conflicts: [], states: {} });
    expect(await store.getCounts('alice')).toEqual({ pending: 6, conflicts: 0 });
    // A repeated server acknowledgement must not delete unrelated answers.
    await store.applySyncResult('alice', { acceptedIds: events.slice(0, 4).map((row) => row.id), conflicts: [], states: {} });
    expect((await store.getPendingEvents('alice'))).toHaveLength(6);
    await store.applySyncResult('alice', { acceptedIds: events.slice(4).map((row) => row.id), conflicts: [], states: {} });
    expect(await store.getCounts('alice')).toEqual({ pending: 0, conflicts: 0 });
  });
  it('retains conflict records separately and refuses changed-payload replay', async () => {
    await store.enqueueEvent('alice', event(1));
    await expect(store.enqueueEvent('alice', event(1, { rating: 'again' }))).rejects.toThrow(/不同内容/);
    await store.applySyncResult('alice', { acceptedIds: [], conflicts: [{ id: 'event-1', reason: 'base_version_conflict' }], states: {} });
    expect(await store.getCounts('alice')).toEqual({ pending: 0, conflicts: 1 });
    expect(await store.getPendingEvents('alice')).toEqual([]);
    expect((await store.getConflicts('alice'))[0].event.id).toBe('event-1');
    await expect(store.clearAccount('alice')).rejects.toThrow(/未同步/);
  });
  it('writes session cursor and event atomically and rolls back on invalid event', async () => {
    const session = makeSession(buildQuestions(wordSet, 'ru-zh', { now }), 's1');
    await store.commitAttempt('alice', session, event(1));
    expect((await store.loadSession('alice'))?.id).toBe('s1');
    await expect(store.commitAttempt('alice', { ...session, id: 'should-not-save' }, event(1, { correct: false }))).rejects.toThrow();
    expect((await store.loadSession('alice'))?.id).toBe('s1');
    expect(await store.getCounts('alice')).toEqual({ pending: 1, conflicts: 0 });
  });
  it('isolates personal data, drafts and saved sessions after account switch', async () => {
    await store.cacheSelection('alice', 'deck:private', { items: [wordSet[0]], states: {}, total: 1 });
    await store.saveDraft('alice', 'ocr', { image: 'data:image/png;base64,private', text: 'личное' });
    await store.saveSession('alice', makeSession([], 'alice-session'));
    await store.enqueueEvent('alice', event(1));
    await store.saveBootstrap(bootstrap('bob'));
    expect((await store.getOfflineBootstrap())?.user.id).toBe('bob');
    expect(await store.getCachedSelection('bob', 'deck:private')).toBeNull();
    expect(await store.getDraft('bob', 'ocr')).toBeNull();
    expect(await store.loadSession('bob')).toBeNull();
    await expect(store.getCachedSelection('alice', 'deck:private')).rejects.toThrow(/当前登录账号/);
    await expect(store.getPendingEvents('alice')).rejects.toThrow(/当前登录账号/);
    await store.enqueueEvent('bob', event(1));
    await store.applySyncResult('bob', { acceptedIds: ['event-1'], conflicts: [], states: {} });
    await store.saveBootstrap(bootstrap('alice'));
    expect((await store.getPendingEvents('alice'))).toHaveLength(1);
    expect(await store.getDraft('alice', 'ocr')).toEqual({ image: 'data:image/png;base64,private', text: 'личное' });
  });
  it('revokes offline login on logout but preserves unsynced work for reauthentication', async () => {
    await store.enqueueEvent('alice', event(1));
    await store.deactivateAccount();
    expect(await store.getOfflineBootstrap()).toBeNull();
    await expect(store.getPendingEvents('alice')).rejects.toThrow();
    await store.saveBootstrap(bootstrap());
    expect((await store.getPendingEvents('alice'))).toHaveLength(1);
  });
  it('allocates monotonically increasing per-account sequences under concurrency', async () => {
    const identities = await Promise.all(Array.from({ length: 10 }, () => store.nextIdentity('alice')));
    expect(new Set(identities.map((row) => row.deviceId)).size).toBe(1);
    expect(identities.map((row) => row.clientSequence).sort((a, b) => a - b)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  });
  it('preserves local provisional schedule through cache refresh then accepts server authority', async () => {
    const data = { items: [{ ...wordSet[0], id: 'item-1' }], states: {}, total: 1 };
    await store.cacheSelection('alice', '1-1', data);
    await store.enqueueEvent('alice', event(1));
    await store.cacheSelection('alice', '1-1', data);
    const pendingCard = (await store.getCachedSelection('alice', '1-1'))!.states['item-1:ru-zh'];
    expect(pendingCard.version).toBe(1);
    const authoritative = { version: 1, card: applyRating(null, 'again', now) };
    await store.applySyncResult('alice', { acceptedIds: ['event-1'], conflicts: [], states: { 'item-1:ru-zh': authoritative } });
    expect((await store.getCachedSelection('alice', '1-1'))!.states['item-1:ru-zh']).toEqual(authoritative);
    await store.removeDownload('alice', '1-1');
    expect(await store.listDownloads('alice')).toEqual([]);
  });
  it('removes rejected provisional state even when it is embedded in a cached snapshot', async () => {
    const data = { items: [{ ...wordSet[0], id: 'item-1' }], states: { 'item-1:ru-zh': { version: 1, card: applyRating(null, 'good', now) } }, total: 1 };
    await store.cacheSelection('alice', '1-1', data);
    await store.enqueueEvent('alice', event(1));
    await store.applySyncResult('alice', { acceptedIds: [], conflicts: [{ id: 'event-1', reason: 'content changed' }], states: {}, resetCardIds: ['item-1:ru-zh'] });
    expect((await store.getCachedSelection('alice', '1-1'))?.states['item-1:ru-zh']).toBeUndefined();
    expect(await store.getCounts('alice')).toEqual({ pending: 0, conflicts: 1 });
  });
  it('primes review states independently of downloads and protects pending state on refresh', async () => {
    const card = applyRating(null, 'good', now);
    await store.primeStates('alice', { 'item-1:ru-zh': { card, version: 1 } });
    expect(await store.listDownloads('alice')).toEqual([]);
    const dueEvent = event(1, { baseVersion: 1, occurredAt: card.due });
    await store.enqueueEvent('alice', dueEvent);
    await store.primeStates('alice', { 'item-1:ru-zh': { card, version: 1 } });
    expect((await store.getStates('alice', ['item-1']))['item-1:ru-zh'].version).toBe(2);
  });
  it('counts distinct pending introductions once across directions and excludes established reviews', async () => {
    const day = localDateKey(now, 'Asia/Shanghai');
    await store.enqueueEvent('alice', event(1));
    await store.enqueueEvent('alice', event(2, { itemId: 'item-1', cardId: 'item-1:zh-ru', direction: 'zh-ru' }));
    await store.primeStates('alice', { 'item-3:ru-zh': { card: applyRating(null, 'good', now), version: 1 } });
    await store.enqueueEvent('alice', event(3, { direction: 'zh-ru', cardId: 'item-3:zh-ru' }));
    expect(await store.countPendingNewItems('alice', day, 'Asia/Shanghai')).toBe(1);
    expect(await store.countPendingNewItems('alice', '2026-10-25', 'Asia/Shanghai')).toBe(0);
    await store.applySyncResult('alice', { acceptedIds: ['event-1'], conflicts: [], states: {} });
    expect(await store.countPendingNewItems('alice', day, 'Asia/Shanghai')).toBe(0);
  });
});
