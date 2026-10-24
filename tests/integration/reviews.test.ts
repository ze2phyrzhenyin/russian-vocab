import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import type { LearningItem, PrismaClient } from '../../src/generated/prisma/client';
import type { Direction, ReviewEventInput, SerializedCard } from '../../src/domain/types';
import { cardId, PARAMETERS_VERSION, SCHEDULER_VERSION } from '../../src/domain/learning';

config({ path: '.env', quiet: true });
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
// Fail closed before loading database code; these tests never target shared/demo users.
if (!databaseUrl || databaseUrl.pathname !== '/ruslearn_dev' || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('Integration tests require the dedicated local ruslearn_dev database.');
}

let db: PrismaClient;
let submitReviews: typeof import('../../src/server/reviews').submitReviews;
let reviewSchema: typeof import('../../src/server/reviews').reviewSchema;
let resolveReviewConflict: typeof import('../../src/server/api').resolveReviewConflict;
let activity: typeof import('../../src/server/api').activity;
let stateDTOs: typeof import('../../src/server/items').stateDTOs;
const alice = randomUUID(); const bob = randomUUID(); const users = [alice, bob];
const deviceId = `integration-${randomUUID()}`;
const clock = new Date();
let sequence = 0;

async function makeItem(ownerId = alice, overrides: Partial<Pick<LearningItem, 'missingMeaning' | 'meaningDisputed' | 'contentVersion'>> = {}) {
  return db.learningItem.create({ data: { id: randomUUID(), ownerId, russian: 'море', chinese: '海', searchKey: 'море', ...overrides } });
}
function answer(item: LearningItem, overrides: Partial<ReviewEventInput> = {}): ReviewEventInput {
  const direction: Direction = overrides.direction ?? 'ru-zh';
  return { id: randomUUID(), deviceId, sessionId: randomUUID(), clientSequence: ++sequence,
    cardId: cardId(item.id, direction), itemId: item.id, direction, rating: 'good', correct: true,
    practice: false, occurredAt: clock.toISOString(), baseVersion: 0, contentVersion: item.contentVersion,
    schedulerVersion: SCHEDULER_VERSION, parametersVersion: PARAMETERS_VERSION, mode: 'choice', answer: direction === 'zh-ru' ? 'море' : '海', ...overrides };
}
async function state(userId: string, item: LearningItem, direction: Direction = 'ru-zh') {
  return db.userCardState.findUnique({ where: { userId_cardId: { userId, cardId: cardId(item.id, direction) } } });
}

beforeAll(async () => {
  db = (await import('../../src/lib/db')).db;
  ({ submitReviews, reviewSchema } = await import('../../src/server/reviews'));
  ({ resolveReviewConflict, activity } = await import('../../src/server/api'));
  ({ stateDTOs } = await import('../../src/server/items'));
  await db.user.createMany({ data: users.map((id) => ({ id, name: 'Integration fixture', email: `integration-${id}@slovo.test` })) });
}, 30_000);

afterAll(async () => {
  if (!db) return;
  await db.$transaction(async (tx) => {
    // Delete only this test run's UUID-owned fixtures, never truncate/reset.
    await tx.reviewEvent.deleteMany({ where: { userId: { in: users } } });
    await tx.userCardState.deleteMany({ where: { userId: { in: users } } });
    await tx.itemFlag.deleteMany({ where: { userId: { in: users } } });
    await tx.studySession.deleteMany({ where: { userId: { in: users } } });
    await tx.learningCard.deleteMany({ where: { item: { ownerId: { in: users } } } });
    await tx.learningItem.deleteMany({ where: { ownerId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
  });
  await db.$disconnect();
}, 30_000);

describe('actual PostgreSQL event transactions', () => {
  it('resolves conflicts idempotently, rejects changing decisions and preserves the original payload and reason', async () => {
    const item = await makeItem();
    const original = answer(item); await submitReviews(alice, [original], clock);
    const before = await state(alice, item);
    const stale = answer(item); const future = answer(item, { occurredAt: new Date(clock.getTime() + 86400_000).toISOString() });
    await submitReviews(alice, [stale, future], clock);
    const stored = await db.reviewEvent.findUniqueOrThrow({ where: { id: stale.id } });
    await expect(resolveReviewConflict(bob, stale.id, 'keep-practice')).rejects.toMatchObject({ status: 404 });
    const kept = await Promise.all([resolveReviewConflict(alice, stale.id, 'keep-practice'), resolveReviewConflict(alice, stale.id, 'keep-practice')]);
    expect(kept.map(result => result.acceptedIds)).toEqual([[stale.id], [stale.id]]);
    await expect(resolveReviewConflict(alice, stale.id, 'discard')).rejects.toMatchObject({ status: 409 });
    const after = await db.reviewEvent.findUniqueOrThrow({ where: { id: stale.id } });
    expect(after.status).toBe('accepted'); expect(after.practice).toBe(true);
    expect(after.conflictReason).toBe(stored.conflictReason); expect(after.payload).toEqual(stored.payload);
    expect(after.effectiveAt).not.toBeNull();
    await resolveReviewConflict(alice, future.id, 'discard');
    expect((await resolveReviewConflict(alice, future.id, 'discard')).acceptedIds).toEqual([future.id]);
    await expect(resolveReviewConflict(alice, future.id, 'keep-practice')).rejects.toMatchObject({ status: 409 });
    await expect(resolveReviewConflict(alice, original.id, 'keep-practice')).rejects.toMatchObject({ status: 409 });
    expect((await db.reviewEvent.findUniqueOrThrow({ where: { id: future.id } })).effectiveAt).toBeNull();
    expect(await state(alice, item)).toEqual(before);
  });

  it('counts Again or hinted correct choices as mistakes without changing actual answer correctness', async () => {
    const item = await makeItem();
    const hinted = answer(item, { correct: true, hinted: true, rating: 'good' });
    const sync = await submitReviews(alice, [hinted], clock);
    const user = await db.user.findUniqueOrThrow({ where: { id: alice } });
    expect((await activity(user)).mistakeIds).toContain(item.id);
    expect(await db.reviewEvent.findUnique({ where: { id: hinted.id } })).toMatchObject({ correct: true, rating: 'again' });
    expect(sync.states[hinted.cardId].flag).toBe('mistake');
    expect((await stateDTOs(alice, [item.id]))[hinted.cardId].flag).toBe('mistake');
    expect((await submitReviews(alice, [hinted], clock)).states[hinted.cardId].flag).toBe('mistake');
    const recovery = answer(item, { practice: true, baseVersion: 1, correct: true, rating: 'good' });
    const recovered = await submitReviews(alice, [recovery], new Date(clock.getTime() + 1));
    expect((await activity(user)).mistakeIds).not.toContain(item.id);
    expect(recovered.states[hinted.cardId].flag).toBeUndefined();
    expect((await stateDTOs(alice, [item.id]))[hinted.cardId].flag).toBeUndefined();
    expect(recovered.states[hinted.cardId].version).toBe(1);
    const forgotten = answer(item, { practice: true, baseVersion: 1, correct: true, rating: 'again' });
    await submitReviews(alice, [forgotten], new Date(clock.getTime() + 2));
    expect((await activity(user)).mistakeIds).toContain(item.id);
  });

  it('accepts ten answers exactly once across replay and concurrent retry', async () => {
    const items = await Promise.all(Array.from({ length: 10 }, () => makeItem()));
    const events = items.map((item) => answer(item));
    const initial = await submitReviews(alice, events, clock);
    expect(initial.acceptedIds).toHaveLength(10); expect(initial.conflicts).toEqual([]);
    const [retryA, retryB] = await Promise.all([submitReviews(alice, events, clock), submitReviews(alice, events, clock)]);
    expect(retryA.acceptedIds).toHaveLength(10); expect(retryB.acceptedIds).toHaveLength(10);
    expect(await db.reviewEvent.count({ where: { id: { in: events.map((e) => e.id) } } })).toBe(10);
    const states = await db.userCardState.findMany({ where: { userId: alice, card: { itemId: { in: items.map((i) => i.id) } } } });
    expect(states).toHaveLength(10);
    expect(states.every((s) => s.version === 1 && (s.memory as unknown as SerializedCard).reps === 1)).toBe(true);
  });

  it('keeps opposite-direction memory independent', async () => {
    const item = await makeItem();
    const forward = answer(item, { rating: 'again', correct: false, answer: '错误' });
    const reverse = answer(item, { direction: 'zh-ru' });
    await submitReviews(alice, [forward, reverse], clock);
    const a = await state(alice, item); const b = await state(alice, item, 'zh-ru');
    expect(a?.version).toBe(1); expect(b?.version).toBe(1);
    expect(a?.due.getTime()).toBeLessThan(b!.due.getTime());
  });

  it('does not grow FSRS for correction practice, including forged early formal exposure', async () => {
    const item = await makeItem();
    await submitReviews(alice, [answer(item)], clock);
    const before = await state(alice, item);
    const shortTime = new Date(clock.getTime() + 30_000);
    const practice = answer(item, { practice: true, baseVersion: 1, occurredAt: shortTime.toISOString() });
    const earlyFormal = answer(item, { practice: false, baseVersion: 1, occurredAt: shortTime.toISOString() });
    const response = await submitReviews(alice, [practice, earlyFormal], shortTime);
    expect(response.acceptedIds).toHaveLength(2); expect(await state(alice, item)).toEqual(before);
    expect((await db.reviewEvent.findUnique({ where: { id: earlyFormal.id } }))?.practice).toBe(true);
  });

  it('rejects foreign private items and rolls back earlier events in the same batch', async () => {
    const own = await makeItem(); const foreign = await makeItem(bob);
    const first = answer(own); const forbidden = answer(foreign);
    await expect(submitReviews(alice, [first, forbidden], clock)).rejects.toMatchObject({ status: 404 });
    expect(await db.reviewEvent.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await state(alice, own)).toBeNull();
  });

  it('rejects event or study-session identities belonging to another user', async () => {
    const itemA = await makeItem(); const itemB = await makeItem(bob);
    const original = answer(itemA); await submitReviews(alice, [original], clock);
    await expect(submitReviews(bob, [{ ...original, itemId: itemB.id, cardId: cardId(itemB.id, 'ru-zh') }], clock)).rejects.toMatchObject({ status: 409 });
    await expect(submitReviews(bob, [answer(itemB, { sessionId: original.sessionId })], clock)).rejects.toMatchObject({ status: 403 });
  });

  it('retains stale-baseline conflict without overwriting authoritative state', async () => {
    const item = await makeItem(); await submitReviews(alice, [answer(item)], clock);
    const before = await state(alice, item);
    const stale = answer(item, { baseVersion: 0 });
    const result = await submitReviews(alice, [stale], clock);
    expect(result.acceptedIds).toEqual([]); expect(result.conflicts).toHaveLength(1);
    expect(result.states[cardId(item.id, 'ru-zh')]).toEqual({ version: before!.version, card: before!.memory });
    expect((await db.reviewEvent.findUnique({ where: { id: stale.id } }))?.status).toBe('conflict');
    expect(await state(alice, item)).toEqual(before);
    expect((await submitReviews(alice, [stale], clock)).conflicts).toHaveLength(1);
  });

  it('retains clock and content conflicts and does not let client time reorder history', async () => {
    const item = await makeItem();
    const future = answer(item, { occurredAt: new Date(clock.getTime() + 6 * 60_000).toISOString() });
    const changedContent = answer(item, { contentVersion: 99 });
    const conflicts = await submitReviews(alice, [future, changedContent], clock);
    expect(conflicts.conflicts).toHaveLength(2);
    expect(conflicts.resetCardIds).toContain(cardId(item.id, 'ru-zh'));
    expect(await state(alice, item)).toBeNull();
    await submitReviews(alice, [answer(item)], clock);
    const backdated = answer(item, { baseVersion: 1, occurredAt: new Date(clock.getTime() - 1_000).toISOString() });
    expect((await submitReviews(alice, [backdated], clock)).conflicts).toHaveLength(1);
    const due = (await state(alice, item))!.due;
    const genuineDue = answer(item, { baseVersion: 1, occurredAt: due.toISOString() });
    expect((await submitReviews(alice, [genuineDue], due)).acceptedIds).toEqual([genuineDue.id]);
    expect((await state(alice, item))?.version).toBe(2);
  });

  it('checks actual choice answer instead of trusting claimed correctness or grade', async () => {
    const item = await makeItem();
    const forged = answer(item, { correct: true, rating: 'easy', answer: '错误选项' });
    await submitReviews(alice, [forged], clock);
    const saved = await db.reviewEvent.findUnique({ where: { id: forged.id } });
    expect(saved?.correct).toBe(false); expect(saved?.rating).toBe('again');
    const other = await makeItem(); const choiceEasy = answer(other, { rating: 'easy' });
    await submitReviews(alice, [choiceEasy], clock);
    expect((await db.reviewEvent.findUnique({ where: { id: choiceEasy.id } }))?.rating).toBe('good');
  });

  it('rejects missing meanings and unrelated card identities', async () => {
    const missing = await makeItem(alice, { missingMeaning: true });
    await expect(submitReviews(alice, [answer(missing)], clock)).rejects.toMatchObject({ status: 422 });
    const item = await makeItem();
    await expect(submitReviews(alice, [answer(item, { cardId: 'different:ru-zh' })], clock)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects reused ids when any payload field changes or disappears', async () => {
    const item = await makeItem(); const initial = answer(item);
    await submitReviews(alice, [initial], clock);
    await expect(submitReviews(alice, [{ ...initial, rating: 'again' }], clock)).rejects.toMatchObject({ status: 409 });
    const omitted = { ...initial }; delete omitted.answer;
    await expect(submitReviews(alice, [omitted], clock)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects unrecognized scheduler versions instead of mislabeling actual computation', async () => {
    const item = await makeItem();
    const result = submitReviews(alice, [answer(item, { schedulerVersion: 'unknown-scheduler' })], clock);
    // Either a validation rejection or durable conflict is acceptable; silent acceptance is not.
    let response;
    try { response = await result; } catch (error) { expect(error).toHaveProperty('status'); return; }
    expect(response.acceptedIds).toEqual([]); expect(response.conflicts).toHaveLength(1);
  });

  it('accepts the stable composite attempt id used by the persistent client queue', async () => {
    const item = await makeItem();
    const composite = answer(item, { id: `${randomUUID()}:${cardId(item.id, 'ru-zh')}:first:0` });
    expect(reviewSchema.safeParse({ events: [composite] }).success).toBe(true);
  });
});
