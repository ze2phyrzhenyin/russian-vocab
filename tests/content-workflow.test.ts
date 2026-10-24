import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaClient, Prisma } from '../src/generated/prisma/client';
import type { EvidenceField } from '../src/domain/types';
import type { CreateContentJobInput } from '../src/domain/content';

config({ path: '.env', quiet: true });
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (url.pathname !== '/ruslearn_dev' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Content workflow tests require the isolated local ruslearn_dev database.');
let db: PrismaClient;
let workflow: typeof import('../src/server/content-workflow');
let directory: string;
const previousRoot = process.env.SLOVO_ANNOTATIONS_ROOT;
const admin = randomUUID(); const ordinary = randomUUID(); const documentId = randomUUID();
const fixtureIds: string[] = []; const sourceIds: string[] = [];
const snapshots = new Map<string, { itemId: string; raw: Record<string, unknown>; fields: Record<string, EvidenceField> }>();
let artifactVersion = 0;
let createdBook = false; let createdLesson = false;
const generated = (value: unknown): EvidenceField => ({ value, status: 'generated', source: 'OpenCorpora test fixture; no real textbook review', method: 'fixture-dictionary-candidate', version: 'fixture-v1', updatedAt: '2026-10-24T00:00:00.000Z' });
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

async function fixture() {
  const id = randomUUID(); const sourceId = randomUUID(); const sourceKey = `workflow-fixture-${id}`;
  const raw = { sourceKey, book: 1, lessons: [1], russian: 'море', chinese: '海', notes: '只用于测试，不修改真实教材' };
  await db.sourceEntry.create({ data: { id: sourceId, sourceKey, bookId: 1, documentId, rowNumber: 900_000 + fixtureIds.length, serial: `fixture-${fixtureIds.length}`, raw: asJson(raw), lessons: { create: { lessonId: '1-1' } } } });
  await db.learningItem.create({ data: { id, sourceEntryId: sourceId, russian: 'море', chinese: '海', searchKey: 'море' } });
  fixtureIds.push(id); sourceIds.push(sourceId);
  snapshots.set(sourceKey, { itemId: id, raw, fields: { headword: { ...generated('море'), status: 'source' }, lemma: generated('море'), stress: { value: null, status: 'unknown', version: 'fixture-v1' }, partOfSpeech: generated(['名词']) } });
  await writeDataset(); return { id, sourceId, sourceKey, raw };
}
async function writeDataset(tamper?: (fields: Record<string, Record<string, EvidenceField>>, manifest: Record<string, unknown>) => void) {
  const fields = Object.fromEntries([...snapshots].map(([key, value]) => [key, value.fields]));
  const manifest: Record<string, unknown> = { schemaVersion: 2, generatorVersion: `fixture-generator-${++artifactVersion}`, entries: Object.fromEntries([...snapshots].map(([key, value]) => [key, { sourceRowFingerprint: workflow.contentFingerprint(value.raw), inputFingerprint: workflow.contentFingerprint(value.raw), outputFingerprint: workflow.contentFingerprint(value.fields), category: 'noun', partsOfSpeech: ['noun'] }])) };
  tamper?.(fields, manifest);
  await writeFile(path.join(directory, 'annotations.json'), JSON.stringify(fields)); await writeFile(path.join(directory, 'annotations.manifest.json'), JSON.stringify(manifest));
}
function input(itemIds: string[], extra: Partial<CreateContentJobInput> = {}): CreateContentJobInput { return { requestKey: randomUUID(), provider: 'local-dictionary', costLimitCents: 0, itemIds, ...extra }; }
async function version(id: string) { return (await db.learningItem.findUniqueOrThrow({ where: { id } })).contentVersion; }
async function seedCandidates(id: string) { const job = await workflow.createContentJob(admin, input([id])); return workflow.runContentBatch(admin, job.id, 10); }

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'slovo-content-workflow-')); process.env.SLOVO_ANNOTATIONS_ROOT = directory;
  db = (await import('../src/lib/db')).db; workflow = await import('../src/server/content-workflow');
  const fixtureBookTitle = `Workflow fixture book ${documentId}`;
  const book = await db.book.upsert({ where: { id: 1 }, create: { id: 1, title: fixtureBookTitle }, update: {} });
  createdBook = book.title === fixtureBookTitle;
  createdLesson = !(await db.lesson.findUnique({ where: { id: '1-1' } }));
  await db.lesson.upsert({ where: { id: '1-1' }, create: { id: '1-1', bookId: 1, number: 1 }, update: {} });
  await db.user.createMany({ data: [{ id: admin, email: `${admin}@workflow.test`, name: 'Workflow QA administrator', role: 'admin' }, { id: ordinary, email: `${ordinary}@workflow.test`, name: 'Workflow QA ordinary user', role: 'user' }] });
  await db.sourceDocument.create({ data: { id: documentId, label: 'Workflow fixture document', coverage: 'Test-owned rows only' } });
}, 30_000);
afterAll(async () => {
  if (db) {
    await db.$transaction(async tx => {
      await tx.annotationRevision.deleteMany({ where: { actorId: { in: [admin, ordinary] } } });
      await tx.contentJobItem.deleteMany({ where: { job: { actorId: { in: [admin, ordinary] } } } });
      await tx.contentJob.deleteMany({ where: { actorId: { in: [admin, ordinary] } } });
      await tx.learningItem.deleteMany({ where: { id: { in: fixtureIds } } });
      await tx.sourceEntryLesson.deleteMany({ where: { sourceEntryId: { in: sourceIds } } });
      await tx.sourceEntry.deleteMany({ where: { id: { in: sourceIds } } });
      await tx.sourceDocument.deleteMany({ where: { id: documentId } });
      await tx.user.deleteMany({ where: { id: { in: [admin, ordinary] } } });
      if (createdLesson) await tx.lesson.deleteMany({ where: { id: '1-1', entries: { none: {} } } });
      if (createdBook) await tx.book.deleteMany({ where: { id: 1, title: `Workflow fixture book ${documentId}`, entries: { none: {} }, lessons: { none: {} } } });
    }, { timeout: 30_000 }); await db.$disconnect();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.SLOVO_ANNOTATIONS_ROOT; else process.env.SLOVO_ANNOTATIONS_ROOT = previousRoot;
}, 30_000);

describe('persistent annotation workflow on PostgreSQL', () => {
  it('uses canonical Unicode JSON and rejects non-admin operations inside services', async () => {
    expect(workflow.canonicalJson({ z: ['ёж', '中文'], a: { b: null, a: true } })).toBe('{"a":{"a":true,"b":null},"z":["ёж","中文"]}');
    await expect(workflow.getContentCoverage(ordinary)).rejects.toMatchObject({ status: 403 });
    await expect(workflow.listContentJobs(ordinary)).rejects.toMatchObject({ status: 403 });
    await expect(workflow.createContentJob(ordinary, input(['irrelevant']))).rejects.toMatchObject({ status: 403 });
    await expect(workflow.reviewAnnotation(ordinary, 'irrelevant', 'lemma', {})).rejects.toMatchObject({ status: 403 });
    await expect(workflow.rollbackAnnotation(ordinary, 'irrelevant', {})).rejects.toMatchObject({ status: 403 });
  });

  it('persists bounded batches, audit per changed field, zero cost, and request/result replay without duplicates', async () => {
    const a = await fixture(); const b = await fixture(); const request = input([a.id, b.id]);
    const job = await workflow.createContentJob(admin, request);
    expect(job).toMatchObject({ status: 'queued', total: 2, completed: 0, costSpentCents: 0, remaining: 2 });
    expect((await workflow.createContentJob(admin, request)).id).toBe(job.id);
    await expect(workflow.createContentJob(admin, { ...request, costLimitCents: 1 })).rejects.toMatchObject({ status: 409 });
    const first = await workflow.runContentBatch(admin, job.id, 1);
    expect(first).toMatchObject({ status: 'queued', completed: 1, remaining: 1, busy: false });
    const final = await workflow.runContentBatch(admin, job.id, 1);
    expect(final).toMatchObject({ status: 'completed', completed: 2, remaining: 0, costSpentCents: 0 });
    expect(await db.annotationRevision.count({ where: { jobId: job.id } })).toBe(8);
    expect((await workflow.runContentBatch(admin, job.id, 1)).completed).toBe(2);
    const second = await workflow.createContentJob(admin, input([a.id, b.id]));
    expect(await workflow.runContentBatch(admin, second.id, 10)).toMatchObject({ status: 'completed', skipped: 2, completed: 0 });
    expect(await db.annotationRevision.count({ where: { jobId: second.id } })).toBe(0);
    expect((await db.sourceEntry.findUniqueOrThrow({ where: { id: a.sourceId } })).raw).toEqual(a.raw);
    expect(await db.reviewEvent.count({ where: { card: { itemId: a.id } } })).toBe(0);
    expect((await db.learningItem.findUniqueOrThrow({ where: { id: a.id } })).chinese).toBe('海');
  });

  it('claims concurrent batches once and recovers only expired process leases', async () => {
    const a = await fixture(); const b = await fixture(); const job = await workflow.createContentJob(admin, input([a.id, b.id]));
    await Promise.all([workflow.runContentBatch(admin, job.id, 10), workflow.runContentBatch(admin, job.id, 10)]);
    expect(await workflow.getContentJob(admin, job.id)).toMatchObject({ completed: 2, skipped: 0, failed: 0 });
    expect(await db.annotationRevision.count({ where: { jobId: job.id } })).toBe(8);
    const recovering = await workflow.createContentJob(admin, input([a.id]));
    await db.contentJob.update({ where: { id: recovering.id }, data: { status: 'running', leaseToken: 'dead-process', leaseExpiresAt: new Date(Date.now() - 1000) } });
    expect(await workflow.runContentBatch(admin, recovering.id, 1)).toMatchObject({ status: 'completed', skipped: 1, busy: false });
  });

  it('cancels between atomic items and explicitly resumes remaining work', async () => {
    const a = await fixture(); const b = await fixture(); const job = await workflow.createContentJob(admin, input([a.id, b.id]));
    await workflow.runContentBatch(admin, job.id, 1); await workflow.cancelContentJob(admin, job.id);
    expect(await workflow.runContentBatch(admin, job.id, 10)).toMatchObject({ status: 'cancelled', completed: 1, remaining: 1 });
    expect(await workflow.retryContentJob(admin, job.id)).toMatchObject({ status: 'queued', remaining: 1 });
    expect(await workflow.runContentBatch(admin, job.id, 10)).toMatchObject({ status: 'completed', completed: 2 });
  });

  it('fails on stale content, retries with explicit rebase, and preserves human-reviewed values', async () => {
    const a = await fixture(); await seedCandidates(a.id);
    snapshots.get(a.sourceKey)!.fields.lemma = generated('новый кандидат'); snapshots.get(a.sourceKey)!.fields.usageNotes = generated('Новый текст'); await writeDataset();
    const job = await workflow.createContentJob(admin, input([a.id]));
    await workflow.reviewAnnotation(admin, a.id, 'lemma', { requestKey: randomUUID(), baseVersion: await version(a.id), action: 'approve', acknowledge: true, reason: 'Fixture administrator explicitly checked a single field', value: 'проверено', source: 'QA evidence only' });
    expect(await workflow.runContentBatch(admin, job.id, 1)).toMatchObject({ status: 'completed-with-errors', failed: 1 });
    await workflow.retryContentJob(admin, job.id);
    expect(await workflow.runContentBatch(admin, job.id, 1)).toMatchObject({ status: 'completed', completed: 1, failed: 0 });
    const detail = await workflow.getContentItem(admin, a.id);
    expect(detail.fields.find(field => field.key === 'lemma')?.evidence).toMatchObject({ value: 'проверено', status: 'reviewed' });
    expect(detail.fields.find(field => field.key === 'usageNotes')?.evidence?.value).toBe('Новый текст');
  });

  it('requires nonempty value/source/acknowledgement, audits review/reject, and restores a historical after snapshot without deleting history', async () => {
    const a = await fixture(); await seedCandidates(a.id);
    const baseline = (await workflow.getContentItem(admin, a.id, 'lemma')).revisions[0];
    const request = { requestKey: randomUUID(), baseVersion: await version(a.id), action: 'approve', acknowledge: true, reason: 'Explicit fixture review for transactional test', value: 'море', source: 'QA source' };
    await expect(workflow.reviewAnnotation(admin, a.id, 'lemma', { ...request, acknowledge: false })).rejects.toMatchObject({ status: 422 });
    await expect(workflow.reviewAnnotation(admin, a.id, 'stress', { ...request, value: null })).rejects.toMatchObject({ status: 422 });
    await expect(workflow.reviewAnnotation(admin, a.id, 'lemma', { ...request, source: '' })).rejects.toMatchObject({ status: 422 });
    const approved = await workflow.reviewAnnotation(admin, a.id, 'lemma', request);
    expect(approved.revision).toMatchObject({ action: 'approve', actor: { id: admin }, after: { status: 'reviewed' } });
    expect((await workflow.reviewAnnotation(admin, a.id, 'lemma', request)).replayed).toBe(true);
    await expect(workflow.reviewAnnotation(admin, a.id, 'lemma', { ...request, reason: 'A changed replay reason' })).rejects.toMatchObject({ status: 409 });
    await expect(workflow.reviewAnnotation(admin, a.id, 'lemma', { ...request, requestKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const rejected = await workflow.reviewAnnotation(admin, a.id, 'lemma', { requestKey: randomUUID(), baseVersion: approved.item.contentVersion, action: 'reject', reason: 'Fixture rejection preserves prior wording and provenance' });
    expect(rejected.revision.after).toMatchObject({ value: 'море', status: 'rejected', source: 'QA source' });
    snapshots.get(a.sourceKey)!.fields.lemma = generated('do not overwrite rejection'); await writeDataset();
    const protect = await workflow.createContentJob(admin, input([a.id])); await workflow.runContentBatch(admin, protect.id, 1);
    expect((await workflow.getContentItem(admin, a.id)).fields.find(field => field.key === 'lemma')?.evidence?.status).toBe('rejected');
    const rollbackInput = { requestKey: randomUUID(), baseVersion: await version(a.id), reason: 'Restore the baseline candidate after testing review actions' };
    const rolled = await workflow.rollbackAnnotation(admin, baseline.id, rollbackInput);
    expect(rolled.revision.after).toEqual(baseline.after); expect(rolled.revision.rollbackOfId).toBe(baseline.id);
    expect(rolled.item.contentVersion).toBe(rollbackInput.baseVersion + 1);
    expect((await workflow.rollbackAnnotation(admin, baseline.id, rollbackInput)).replayed).toBe(true);
    expect(await db.annotationRevision.count({ where: { itemId: a.id, fieldKey: 'lemma' } })).toBe(4);
    expect((await db.sourceEntry.findUniqueOrThrow({ where: { id: a.sourceId } })).raw).toEqual(a.raw);
  });

  it('retains source fingerprint failures and never applies a stale source snapshot', async () => {
    const a = await fixture(); const job = await workflow.createContentJob(admin, input([a.id]));
    await db.sourceEntry.update({ where: { id: a.sourceId }, data: { raw: asJson({ ...a.raw, revised: true }) } });
    expect(await workflow.runContentBatch(admin, job.id, 1)).toMatchObject({ failed: 1, completed: 0, status: 'completed-with-errors' });
    expect((await workflow.getContentJob(admin, job.id)).failures[0].error).toMatch(/来源版本/);
    expect((await db.learningItem.findUniqueOrThrow({ where: { id: a.id } })).annotations).toBeNull();
    await db.sourceEntry.update({ where: { id: a.sourceId }, data: { raw: asJson(a.raw) } }); await workflow.retryContentJob(admin, job.id);
    expect(await workflow.runContentBatch(admin, job.id, 1)).toMatchObject({ completed: 1, failed: 0 });
  });

  it('rejects an uncoordinated row writer racing review or rollback after their baseline read', async () => {
    const a = await fixture(); await seedCandidates(a.id);
    const baseline = (await workflow.getContentItem(admin, a.id, 'lemma')).revisions[0];
    const auditCount = await db.annotationRevision.count({ where: { itemId: a.id } });
    async function race(operation: (baseVersion: number) => Promise<unknown>) {
      const before = await db.learningItem.findUniqueOrThrow({ where: { id: a.id } });
      let ready!: (pid: number) => void; let release!: () => void;
      const readyPromise = new Promise<number>(resolve => { ready = resolve; });
      const releasePromise = new Promise<void>(resolve => { release = resolve; });
      const writer = db.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM "LearningItem" WHERE id=${a.id} FOR UPDATE`;
        ready(pid); await releasePromise;
        await tx.learningItem.update({ where: { id: a.id }, data: { contentVersion: { increment: 1 } } });
      }, { timeout: 20_000 });
      const pid = await readyPromise;
      const action = operation(before.contentVersion).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      try {
        await expect.poll(async () => {
          const [{ waiting }] = await db.$queryRaw<{ waiting: number }[]>`SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`;
          return waiting;
        }, { timeout: 10_000 }).toBeGreaterThan(0);
      } finally { release(); }
      await writer;
      expect((await action).error).toMatchObject({ status: 409 });
      const after = await db.learningItem.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.annotations).toEqual(before.annotations); expect(after.contentVersion).toBe(before.contentVersion + 1);
      expect(await db.annotationRevision.count({ where: { itemId: a.id } })).toBe(auditCount);
    }
    await race(baseVersion => workflow.reviewAnnotation(admin, a.id, 'lemma', { requestKey: randomUUID(), baseVersion, action: 'approve', acknowledge: true, reason: 'Concurrent fixture review must not overwrite another writer', source: 'QA evidence' }));
    await race(baseVersion => workflow.rollbackAnnotation(admin, baseline.id, { requestKey: randomUUID(), baseVersion, reason: 'Concurrent fixture rollback must not overwrite another writer' }));
  }, 30_000);

  it('rejects generated reviewed claims, tampered caches, unavailable providers and invalid budgets', async () => {
    const a = await fixture();
    await expect(workflow.createContentJob(admin, input([a.id], { provider: 'cloud' }))).rejects.toMatchObject({ status: 503 });
    await expect(workflow.createContentJob(admin, input([a.id], { costLimitCents: -1 }))).rejects.toThrow();
    await writeDataset(fields => { fields[a.sourceKey] = { ...fields[a.sourceKey], lemma: { ...generated('false claim'), status: 'reviewed' } }; });
    await expect(workflow.createContentJob(admin, input([a.id]))).rejects.toMatchObject({ status: 422 });
    await writeDataset(fields => { fields[a.sourceKey] = { ...fields[a.sourceKey], lemma: generated('changed after manifest hash') }; });
    await expect(workflow.createContentJob(admin, input([a.id]))).rejects.toMatchObject({ status: 422 });
    await writeDataset();
  });

  it('filters real statuses by book, lesson and part of speech and reports explicit applicable denominators', async () => {
    const a = await fixture(); await seedCandidates(a.id);
    const result = await workflow.listContentItems(admin, { book: 1, lesson: '1-1', partOfSpeech: 'noun', field: 'stress', status: 'unknown', q: a.sourceKey, limit: 5 });
    expect(result.total).toBe(1); expect(result.items[0].id).toBe(a.id);
    const coverage = await workflow.getContentCoverage(admin);
    expect(coverage.totalFields).toBe(coverage.totalItems * 32);
    expect(coverage.applicableFields).toBe(coverage.totalFields - coverage.statuses['not-applicable']);
    expect(coverage.lessons.some(row => row.lesson === '1-1')).toBe(true);
    expect(coverage.partsOfSpeech.some(row => row.partOfSpeech === 'noun')).toBe(true);
    expect(coverage.providers.find(provider => provider.id === 'cloud')?.available).toBe(false);
  });
});
