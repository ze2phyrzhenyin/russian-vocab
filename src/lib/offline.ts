import Dexie, { type DexieOptions, type Table } from 'dexie';
import type { BootstrapDTO, CardStateDTO, ItemsResponse, ReviewEventInput, SyncResponse } from '../domain/types';
import { applyRating, cardId, dailyStatsFor, isMistake, localDateKey, type StudySession } from '../domain/learning';

interface MetaRow { key: string; value: unknown }
interface PrincipalRow { userId: string; bootstrap: BootstrapDTO; expiresAt: number }
interface DownloadRow { userId: string; key: string; data: ItemsResponse; bytes: number; updatedAt: string }
interface SessionRow { userId: string; value: StudySession }
interface DraftRow { userId: string; key: string; value: unknown }
interface OutboxRow { userId: string; id: string; event: ReviewEventInput; conflict?: string; introducedNew?: boolean }
interface StateRow { userId: string; cardId: string; value: CardStateDTO | null }

const OFFLINE_GRANT_MS = 7 * 24 * 60 * 60 * 1000;

/** Every public data method requires the currently authenticated account id.
 * Sign-out revokes the offline grant but retains unacknowledged account-scoped data.
 * This protects app account switches, not against scripts controlling this browser origin.
 */
export class OfflineStore {
  private db: Dexie;
  private meta: Table<MetaRow, string>;
  private principals: Table<PrincipalRow, string>;
  private downloads: Table<DownloadRow, [string, string]>;
  private sessions: Table<SessionRow, string>;
  private drafts: Table<DraftRow, [string, string]>;
  private outbox: Table<OutboxRow, [string, string]>;
  private states: Table<StateRow, [string, string]>;

  constructor(name = 'slovo-offline-v1', options?: DexieOptions) {
    this.db = new Dexie(name, options);
    this.db.version(1).stores({
      meta: 'key', principals: 'userId', downloads: '[userId+key],userId', sessions: 'userId',
      drafts: '[userId+key],userId', outbox: '[userId+id],userId', states: '[userId+cardId],userId',
    });
    this.meta = this.db.table('meta'); this.principals = this.db.table('principals');
    this.downloads = this.db.table('downloads'); this.sessions = this.db.table('sessions');
    this.drafts = this.db.table('drafts'); this.outbox = this.db.table('outbox'); this.states = this.db.table('states');
  }

  private async requireUser(userId: string): Promise<void> {
    if (!userId || (await this.meta.get('activeUser'))?.value !== userId) throw new Error('此缓存不属于当前登录账号');
    const principal = await this.principals.get(userId);
    if (!principal || principal.expiresAt <= Date.now()) throw new Error('离线授权已过期，请联网登录');
  }

  async saveBootstrap(bootstrap: BootstrapDTO): Promise<void> {
    if (!bootstrap.user.id) throw new Error('Missing authenticated user');
    await this.db.transaction('rw', this.meta, this.principals, async () => {
      const stamped = { ...bootstrap, stats: { ...bootstrap.stats, day: bootstrap.stats.day || localDateKey(new Date(), bootstrap.user.timeZone) } };
      await this.principals.put({ userId: bootstrap.user.id, bootstrap: stamped, expiresAt: Date.now() + OFFLINE_GRANT_MS });
      await this.meta.put({ key: 'activeUser', value: bootstrap.user.id });
    });
  }

  async getOfflineBootstrap(): Promise<BootstrapDTO | null> {
    const userId = (await this.meta.get('activeUser'))?.value;
    if (typeof userId !== 'string') return null;
    const principal = await this.principals.get(userId);
    if (!principal || principal.expiresAt <= Date.now()) return null;
    const bootstrap = principal.bootstrap;
    // Old version-1 rows have no day marker; their grant creation time is the
    // closest valid snapshot timestamp and avoids charging yesterday's quota.
    const stats = { ...bootstrap.stats, day: bootstrap.stats.day || localDateKey(new Date(principal.expiresAt - OFFLINE_GRANT_MS), bootstrap.user.timeZone) };
    return { ...bootstrap, stats: dailyStatsFor(stats, bootstrap.user.timeZone) };
  }

  async deactivateAccount(): Promise<void> { await this.meta.delete('activeUser'); }

  async cacheSelection(userId: string, key: string, data: ItemsResponse): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction('rw', this.downloads, this.states, this.outbox, async () => {
      const pending = await this.outbox.where('userId').equals(userId).toArray();
      const pendingCards = new Set(pending.map((row) => row.event.cardId));
      for (const [cardId, value] of Object.entries(data.states)) {
        if (!pendingCards.has(cardId)) await this.states.put({ userId, cardId, value });
      }
      await this.downloads.put({ userId, key, data, bytes: new TextEncoder().encode(JSON.stringify(data)).byteLength, updatedAt: new Date().toISOString() });
    });
  }

  /** Cache scheduling baselines without implying an explicit lesson download. */
  async primeStates(userId: string, states: Record<string, CardStateDTO>): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction('rw', this.states, this.outbox, async () => {
      const pendingCards = new Set((await this.outbox.where('userId').equals(userId).toArray()).filter((row) => !row.conflict).map((row) => row.event.cardId));
      for (const [cardId, value] of Object.entries(states)) {
        if (!pendingCards.has(cardId)) await this.states.put({ userId, cardId, value });
      }
    });
  }

  async getStates(userId: string, itemIds: string[]): Promise<Record<string, CardStateDTO>> {
    await this.requireUser(userId);
    const ids = new Set(itemIds);
    const rows = await this.states.where('userId').equals(userId).toArray();
    return Object.fromEntries(rows.filter((row) => row.value && ids.has(row.cardId.slice(0, row.cardId.lastIndexOf(':')))).map((row) => [row.cardId, row.value! ]));
  }

  async getResetCardIds(userId: string, itemIds: string[]): Promise<string[]> {
    await this.requireUser(userId); const ids = new Set(itemIds);
    return (await this.states.where('userId').equals(userId).toArray()).filter((row) => row.value === null && ids.has(row.cardId.slice(0, row.cardId.lastIndexOf(':')))).map((row) => row.cardId);
  }

  async getCachedSelection(userId: string, key: string): Promise<ItemsResponse | null> {
    await this.requireUser(userId);
    const cached = await this.downloads.get([userId, key]);
    if (!cached) return null;
    const states = { ...cached.data.states };
    const allowed = new Set(cached.data.items.map((item) => item.id));
    for (const row of await this.states.where('userId').equals(userId).toArray()) {
      if (allowed.has(row.cardId.slice(0, row.cardId.lastIndexOf(':')))) {
        if (row.value) states[row.cardId] = row.value;
        else delete states[row.cardId];
      }
    }
    return { ...cached.data, states };
  }

  async listDownloads(userId: string): Promise<{ key: string; bytes: number; updatedAt: string }[]> {
    await this.requireUser(userId);
    return (await this.downloads.where('userId').equals(userId).toArray()).map(({ key, bytes, updatedAt }) => ({ key, bytes, updatedAt }));
  }

  async removeDownload(userId: string, key: string): Promise<void> {
    await this.requireUser(userId); await this.downloads.delete([userId, key]);
    // Outbox and session are intentionally independent of download removal.
  }

  async saveSession(userId: string, session: StudySession): Promise<void> {
    await this.requireUser(userId); await this.sessions.put({ userId, value: session });
  }
  async loadSession(userId: string): Promise<StudySession | null> {
    await this.requireUser(userId); return (await this.sessions.get(userId))?.value ?? null;
  }
  async clearSession(userId: string): Promise<void> {
    await this.requireUser(userId); await this.sessions.delete(userId);
  }
  async saveDraft(userId: string, key: string, value: unknown): Promise<void> {
    await this.requireUser(userId); await this.drafts.put({ userId, key, value });
  }
  async getDraft<T>(userId: string, key: string): Promise<T | null> {
    await this.requireUser(userId); return ((await this.drafts.get([userId, key]))?.value as T | undefined) ?? null;
  }
  async deleteDraft(userId: string, key: string): Promise<void> {
    await this.requireUser(userId); await this.drafts.delete([userId, key]);
  }

  async nextIdentity(userId: string): Promise<{ deviceId: string; clientSequence: number }> {
    await this.requireUser(userId);
    return this.db.transaction('rw', this.meta, async () => {
      const savedDevice = (await this.meta.get('deviceId'))?.value;
      const deviceId = typeof savedDevice === 'string' ? savedDevice : crypto.randomUUID();
      const sequenceKey = `sequence:${userId}`;
      const previous = (await this.meta.get(sequenceKey))?.value;
      const clientSequence = (typeof previous === 'number' ? previous : 0) + 1;
      await this.meta.put({ key: 'deviceId', value: deviceId });
      await this.meta.put({ key: sequenceKey, value: clientSequence });
      return { deviceId, clientSequence };
    });
  }

  private async putEvent(userId: string, event: ReviewEventInput): Promise<void> {
    if (!event.id || !event.deviceId || !Number.isSafeInteger(event.clientSequence) || event.clientSequence < 1) throw new Error('Invalid local event identity');
    const existing = await this.outbox.get([userId, event.id]);
    if (existing) {
      if (JSON.stringify(existing.event) !== JSON.stringify(event)) throw new Error('同一答题事件不能用不同内容重复保存');
      return;
    }
    const directions = ['ru-zh', 'zh-ru', 'recall'] as const;
    const priorStates = await this.states.bulkGet(directions.map((direction) => [userId, cardId(event.itemId, direction)]));
    const priorPending = await this.outbox.where('userId').equals(userId).toArray();
    const introducedNew = !event.practice && !priorStates.some((row) => row?.value)
      && !priorPending.some((row) => row.event.itemId === event.itemId && row.introducedNew);
    await this.outbox.add({ userId, id: event.id, event, introducedNew });
    const before = (await this.states.get([userId, event.cardId]))?.value;
    if (!event.practice) {
      // Apply only against the known baseline. Server version conflicts stay visible.
      if ((before?.version ?? 0) === event.baseVersion) {
        await this.states.put({ userId, cardId: event.cardId, value: {
          version: event.baseVersion + 1, card: applyRating(before?.card, event.rating, event.occurredAt), flag: isMistake(event) ? 'mistake' : undefined,
        } });
      }
    } else if (before) {
      await this.states.put({ userId, cardId: event.cardId, value: { ...before, flag: isMistake(event) ? 'mistake' : undefined } });
    }
  }

  async enqueueEvent(userId: string, event: ReviewEventInput): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction('rw', this.outbox, this.states, () => this.putEvent(userId, event));
  }

  /** One IndexedDB commit before feedback; refresh cannot retain a new cursor but lose its answer. */
  async commitAttempt(userId: string, session: StudySession, event: ReviewEventInput): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction('rw', this.outbox, this.states, this.sessions, async () => {
      await this.putEvent(userId, event); await this.sessions.put({ userId, value: session });
    });
  }

  async getPendingEvents(userId: string): Promise<ReviewEventInput[]> {
    await this.requireUser(userId);
    return (await this.outbox.where('userId').equals(userId).toArray()).filter((row) => !row.conflict)
      .map((row) => row.event).sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.clientSequence - b.clientSequence);
  }

  async applySyncResult(userId: string, result: SyncResponse): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction('rw', this.outbox, this.states, async () => {
      for (const id of result.acceptedIds) await this.outbox.delete([userId, id]);
      for (const conflict of result.conflicts) {
        const row = await this.outbox.get([userId, conflict.id]);
        if (row) await this.outbox.put({ ...row, conflict: conflict.reason });
      }
      // A tombstone also overrides a stale card embedded in a downloaded snapshot.
      for (const cardId of result.resetCardIds ?? []) await this.states.put({ userId, cardId, value: null });
      const pending = await this.outbox.where('userId').equals(userId).toArray();
      const pendingCards = new Set(pending.filter((row) => !row.conflict).map((row) => row.event.cardId));
      for (const [cardId, value] of Object.entries(result.states)) {
        if (!pendingCards.has(cardId)) await this.states.put({ userId, cardId, value });
      }
    });
  }

  async getConflicts(userId: string): Promise<{ event: ReviewEventInput; reason: string }[]> {
    await this.requireUser(userId);
    return (await this.outbox.where('userId').equals(userId).toArray()).filter((row) => row.conflict).map((row) => ({ event: row.event, reason: row.conflict! }));
  }
  async getCounts(userId: string): Promise<{ pending: number; conflicts: number }> {
    await this.requireUser(userId);
    const rows = await this.outbox.where('userId').equals(userId).toArray();
    return { pending: rows.filter((row) => !row.conflict).length, conflicts: rows.filter((row) => row.conflict).length };
  }

  async countPendingNewItems(userId: string, dayKey: string, timeZone: string): Promise<number> {
    await this.requireUser(userId);
    const rows = await this.outbox.where('userId').equals(userId).toArray();
    return new Set(rows.filter((row) => row.introducedNew && localDateKey(row.event.occurredAt, timeZone) === dayKey).map((row) => row.event.itemId)).size;
  }

  /** Only use after an explicit discard action. Never called by ordinary sign-out. */
  async clearAccount(userId: string, discardUnsynced = false): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction('rw', [this.outbox, this.states, this.sessions, this.downloads, this.drafts, this.principals, this.meta], async () => {
      if (!discardUnsynced && await this.outbox.where('userId').equals(userId).count()) throw new Error('还有未同步的答题记录，请先同步或明确放弃');
      await this.outbox.where('userId').equals(userId).delete(); await this.states.where('userId').equals(userId).delete();
      await this.downloads.where('userId').equals(userId).delete(); await this.drafts.where('userId').equals(userId).delete();
      await this.sessions.delete(userId); await this.principals.delete(userId); await this.meta.delete('activeUser');
    });
  }

  close(): void { this.db.close(); }
  async deleteDatabase(): Promise<void> { await this.db.delete(); }
}

export function createOfflineStore(name?: string, options?: DexieOptions): OfflineStore { return new OfflineStore(name, options); }
export const offlineStore = createOfflineStore();
