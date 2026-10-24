import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Prisma, type ContentJob, type AnnotationRevision } from '@/generated/prisma/client';
import type { EvidenceField } from '@/domain/types';
import { ANNOTATION_KEYS, CONTENT_PARTS_OF_SPEECH, type AnnotationKey, type AnnotationMutationResult, type AnnotationRevisionDTO, type AnnotationStatus, type ContentCoverageDTO, type ContentItemDetail, type ContentItemSummary, type ContentJobDetail, type ContentJobDTO, type ContentListResponse } from '@/domain/content';
import { HttpError } from './http';

const SCHEMA_VERSION = 'annotations-manifest/2';
const LEASE_MS = 60_000;
const statuses = ['source', 'generated', 'reviewed', 'rejected', 'unknown', 'disputed', 'not-applicable', 'missing'] as const;
const keySchema = z.enum(ANNOTATION_KEYS);
const idSchema = z.string().min(1).max(200);
const requestKeySchema = z.string().uuid();
const candidateFieldSchema = z.object({ value: z.json(), status: z.enum(['source', 'generated', 'unknown', 'disputed', 'not-applicable']), source: z.string().max(8000).optional(), method: z.string().max(2000).optional(), version: z.string().max(2000).optional(), updatedAt: z.string().max(100).optional() }).strict();
const jobSchema = z.object({ requestKey: requestKeySchema, provider: z.enum(['local-dictionary', 'cloud']), books: z.array(z.number().int().min(1).max(6)).max(6).optional(), fields: z.array(keySchema).min(1).max(32).optional(), itemIds: z.array(idSchema).min(1).max(10000).optional(), costLimitCents: z.number().int().min(0).max(100_000) }).strict();
const listSchema = z.object({ book: z.coerce.number().int().min(1).max(6).optional(), lesson: z.string().regex(/^[1-6]-\d{1,2}$/).optional(), partOfSpeech: z.enum(CONTENT_PARTS_OF_SPEECH).optional(), field: keySchema.optional(), status: z.enum(statuses).optional(), q: z.string().max(200).optional(), offset: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
const reviewSchema = z.object({ requestKey: requestKeySchema, baseVersion: z.number().int().positive(), action: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(1000), value: z.json().optional(), source: z.string().trim().max(8000).optional(), method: z.string().trim().max(2000).optional(), acknowledge: z.boolean().optional() }).strict();
const rollbackSchema = z.object({ requestKey: requestKeySchema, baseVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(1000) }).strict();
type Fields = Partial<Record<AnnotationKey, EvidenceField>>;
interface ManifestEntry { sourceRowFingerprint: string; inputFingerprint: string; outputFingerprint: string; category: string; partsOfSpeech: string[]; evidenceWorkbookSha256?: string }
interface Dataset { fields: Record<string, Fields>; entries: Record<string, ManifestEntry>; datasetHash: string; generatorVersion: string }
interface Snapshot { fields: Fields; sourceRowFingerprint: string; inputFingerprint: string; outputFingerprint: string }
type ActorJob = ContentJob & { actor: { id: string; name: string } };
type ActorRevision = AnnotationRevision & { actor: { id: string; name: string } };
interface IndexRow { id: string; russian: string; chinese: string; kind: string; contentVersion: number; sourceKey: string; book: number; lessonIds: string[]; fields: Record<string, string>; pos: unknown }
let datasetCache: { identity: string; value: Dataset } | null = null;

/** Same canonical JSON algorithm as the local Python generator (Unicode preserved). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value); if (result === undefined) throw new Error('Value is not JSON'); return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function contentFingerprint(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
const jsonValue = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const nullableJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => value === null || value === undefined ? Prisma.DbNull : jsonValue(value);
function fieldsOf(value: unknown): Fields { return value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {}; }
function protectedField(field: EvidenceField | undefined): boolean { return field?.status === 'reviewed' || field?.status === 'rejected'; }
async function requireAdmin(actorId: string, client: Prisma.TransactionClient = db) {
  idSchema.parse(actorId); const actor = await client.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, role: true } });
  if (!actor || actor.role !== 'admin') throw new HttpError(403, '只有内容管理员可以操作内容任务和审核。'); return actor;
}
async function loadDataset(): Promise<Dataset> {
  const root = path.resolve(/* turbopackIgnore: true */ process.env.SLOVO_ANNOTATIONS_ROOT || 'data/processed');
  const manifestPath = path.join(root, 'annotations.manifest.json'); const fieldsPath = path.join(root, 'annotations.json');
  const [manifestStat, fieldsStat] = await Promise.all([stat(/* turbopackIgnore: true */ manifestPath), stat(/* turbopackIgnore: true */ fieldsPath)]);
  if (manifestStat.size > 12_000_000 || fieldsStat.size > 256_000_000) throw new HttpError(413, '本地候选文件超过允许大小。');
  const manifestText = await readFile(/* turbopackIgnore: true */ manifestPath, 'utf8');
  const manifest = z.object({ schemaVersion: z.literal(2), generatorVersion: z.string().min(1), entries: z.record(z.string(), z.object({ sourceRowFingerprint: z.string().regex(/^[a-f0-9]{64}$/), inputFingerprint: z.string(), outputFingerprint: z.string().regex(/^[a-f0-9]{64}$/), category: z.string(), partsOfSpeech: z.array(z.string()), evidenceWorkbookSha256: z.string().optional() }).passthrough()) }).passthrough().parse(JSON.parse(manifestText));
  const datasetHash = contentFingerprint(manifest); const identity = `${root}:${datasetHash}:${fieldsStat.mtimeMs}:${fieldsStat.size}`;
  if (datasetCache?.identity === identity) return datasetCache.value;
  const raw = JSON.parse(await readFile(/* turbopackIgnore: true */ fieldsPath, 'utf8')) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(422, '本地候选文件结构不正确。');
  const fields: Record<string, Fields> = Object.create(null) as Record<string, Fields>;
  for (const [sourceKey, rawFields] of Object.entries(raw)) {
    const parsed = z.partialRecord(keySchema, candidateFieldSchema).parse(rawFields);
    if (!manifest.entries[sourceKey] || manifest.entries[sourceKey].outputFingerprint !== contentFingerprint(parsed)) throw new HttpError(422, `候选快照校验失败：${sourceKey}`);
    fields[sourceKey] = parsed;
  }
  if (Object.keys(manifest.entries).length !== Object.keys(fields).length) throw new HttpError(422, '候选清单与内容数量不一致。');
  const value = { fields, entries: manifest.entries, datasetHash, generatorVersion: manifest.generatorVersion };
  datasetCache = { identity, value }; return value;
}
function artifactError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 1000) : '本地候选读取失败。'; }
function revisionDTO(revision: ActorRevision): AnnotationRevisionDTO {
  return { id: revision.id, itemId: revision.itemId, fieldKey: revision.fieldKey as AnnotationKey, actor: revision.actor, action: revision.action as AnnotationRevisionDTO['action'], reason: revision.reason, before: revision.before as unknown as EvidenceField | null, after: revision.after as unknown as EvidenceField | null, version: revision.version, jobId: revision.jobId, rollbackOfId: revision.rollbackOfId, createdAt: revision.createdAt.toISOString() };
}
function jobDTO(job: ActorJob): ContentJobDTO {
  const processed = job.completed + job.failed + job.skipped;
  return { id: job.id, provider: job.provider, status: job.status as ContentJobDTO['status'], total: job.total, completed: job.completed, failed: job.failed, skipped: job.skipped, processed, remaining: job.total - processed, costLimitCents: job.costLimitCents, costSpentCents: job.costSpentCents, datasetHash: job.datasetHash, schemaVersion: job.schemaVersion, generatorVersion: job.generatorVersion, selection: job.selection as unknown as ContentJobDTO['selection'], createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), finishedAt: job.finishedAt?.toISOString() || null, busy: Boolean(job.leaseToken && job.leaseExpiresAt && job.leaseExpiresAt > new Date()), actor: job.actor };
}
async function indexRows(): Promise<IndexRow[]> {
  return db.$queryRaw<IndexRow[]>`
    SELECT i.id, i.russian, i.chinese, i.kind, i."contentVersion", s."sourceKey", s."bookId" AS book,
      COALESCE((SELECT jsonb_agg(l."lessonId" ORDER BY l."lessonId") FROM "SourceEntryLesson" l WHERE l."sourceEntryId"=s.id),'[]'::jsonb) AS "lessonIds",
      COALESCE((SELECT jsonb_object_agg(a.key,a.value->>'status') FROM jsonb_each(CASE WHEN jsonb_typeof(i.annotations)='object' THEN i.annotations ELSE '{}'::jsonb END) a),'{}'::jsonb) AS fields,
      i.annotations->'partOfSpeech'->'value' AS pos
    FROM "LearningItem" i JOIN "SourceEntry" s ON i."sourceEntryId"=s.id
    WHERE i."ownerId" IS NULL AND NOT i.archived AND s.active ORDER BY s."bookId",s."rowNumber",i.id`;
}
const posMap: Record<string, string> = { 名词: 'noun', NOUN: 'noun', 形容词: 'adjective', 短尾形容词: 'adjective', ADJF: 'adjective', ADJS: 'adjective', 动词: 'verb', 动词不定式: 'verb', INFN: 'verb', VERB: 'verb', 副词: 'adverb', ADVB: 'adverb', 代词: 'pronoun', NPRO: 'pronoun', 数词: 'numeral', NUMR: 'numeral', 介词: 'preposition', PREP: 'preposition', 连词: 'conjunction', CONJ: 'conjunction', 语气词: 'particle', PRCL: 'particle', 感叹词: 'interjection', INTJ: 'interjection', 形动词: 'participle', 短尾形动词: 'participle', PRTF: 'participle', PRTS: 'participle', 副动词: 'gerund', GRND: 'gerund', 谓词: 'predicative', PRED: 'predicative' };
function rowParts(row: IndexRow): string[] {
  if (row.kind === 'phrase' || row.kind === 'sentence') return [row.kind];
  const values = (Array.isArray(row.pos) ? row.pos : [row.pos]).filter((v): v is string => typeof v === 'string');
  const mapped = [...new Set(values.map(value => posMap[value] || (CONTENT_PARTS_OF_SPEECH.includes(value as typeof CONTENT_PARTS_OF_SPEECH[number]) ? value : 'unknown')))];
  return mapped.length > 1 ? [...mapped, 'ambiguous'] : mapped.length ? mapped : ['unknown'];
}
function itemSummary(row: IndexRow): ContentItemSummary {
  return { id: row.id, sourceKey: row.sourceKey, russian: row.russian, chinese: row.chinese, book: row.book, lessons: row.lessonIds.map(id => Number(id.split('-')[1])), contentVersion: row.contentVersion, kind: row.kind, fields: Object.fromEntries(ANNOTATION_KEYS.map(key => [key, row.fields[key] || 'missing'])) as ContentItemSummary['fields'] };
}
function statusOf(row: IndexRow, key: AnnotationKey): AnnotationStatus { const value = row.fields[key]; return statuses.includes(value as AnnotationStatus) ? value as AnnotationStatus : 'missing'; }
function zeroStatuses(): Record<AnnotationStatus, number> { return Object.fromEntries(statuses.map(status => [status, 0])) as Record<AnnotationStatus, number>; }
export async function getContentCoverage(actorId: string): Promise<ContentCoverageDTO> {
  await requireAdmin(actorId); const rows = await indexRows();
  const counts = zeroStatuses();
  const fields = ANNOTATION_KEYS.map(key => ({ key, total: rows.length, applicable: 0, reviewed: 0, statuses: zeroStatuses() }));
  type Group = { totalItems: number; annotatedItems: number; applicableFields: number; reviewedFields: number };
  const books = new Map<number, Group>(); const lessons = new Map<string, Group>(); const parts = new Map<string, Group>(); let annotatedItems = 0;
  function add<K>(map: Map<K, Group>, key: K, annotated: boolean, applicable: number, reviewed: number) {
    const old = map.get(key) || { totalItems: 0, annotatedItems: 0, applicableFields: 0, reviewedFields: 0 };
    map.set(key, { totalItems: old.totalItems + 1, annotatedItems: old.annotatedItems + Number(annotated), applicableFields: old.applicableFields + applicable, reviewedFields: old.reviewedFields + reviewed });
  }
  for (const row of rows) {
    let applicable = 0; let reviewed = 0; const annotated = ANNOTATION_KEYS.some(key => statusOf(row, key) !== 'missing'); if (annotated) annotatedItems++;
    for (const field of fields) { const status = statusOf(row, field.key); counts[status]++; field.statuses[status]++; if (status !== 'not-applicable') { applicable++; field.applicable++; } if (status === 'reviewed') { reviewed++; field.reviewed++; } }
    add(books, row.book, annotated, applicable, reviewed); for (const lesson of row.lessonIds) add(lessons, lesson, annotated, applicable, reviewed); for (const pos of rowParts(row)) add(parts, pos, annotated, applicable, reviewed);
  }
  let dataset: Dataset | null = null; let reason = '本地字典候选可按批应用，调用成本为 0。';
  try { dataset = await loadDataset(); } catch (error) { reason = artifactError(error); }
  return { totalItems: rows.length, annotatedItems, totalFields: rows.length * ANNOTATION_KEYS.length, applicableFields: rows.length * ANNOTATION_KEYS.length - counts['not-applicable'], reviewedFields: counts.reviewed, statuses: counts, fields,
    books: [...books].map(([book, value]) => ({ book, ...value })), lessons: [...lessons].map(([lesson, value]) => ({ lesson, ...value })), partsOfSpeech: [...parts].map(([partOfSpeech, value]) => ({ partOfSpeech, ...value })),
    providers: [{ id: 'local-dictionary', available: Boolean(dataset), reason, costPerItemCents: 0 }, { id: 'cloud', available: false, reason: '云端 provider 尚未配置，不会创建伪任务或发起外部调用。', costPerItemCents: null }],
    artifact: { available: Boolean(dataset), schemaVersion: dataset ? SCHEMA_VERSION : null, generatorVersion: dataset?.generatorVersion || null, entries: dataset ? Object.keys(dataset.fields).length : 0, datasetHash: dataset?.datasetHash || null } };
}
export async function listContentItems(actorId: string, input: unknown = {}): Promise<ContentListResponse> {
  await requireAdmin(actorId); const query = listSchema.parse(input); let rows = await indexRows();
  rows = rows.filter(row => (!query.book || row.book === query.book) && (!query.lesson || row.lessonIds.includes(query.lesson)) && (!query.partOfSpeech || rowParts(row).includes(query.partOfSpeech))
    && (!query.status || (query.field ? statusOf(row, query.field) === query.status : ANNOTATION_KEYS.some(key => statusOf(row, key) === query.status)))
    && (!query.q || `${row.russian} ${row.chinese} ${row.sourceKey}`.toLocaleLowerCase('ru').includes(query.q.toLocaleLowerCase('ru'))));
  return { items: rows.slice(query.offset, query.offset + query.limit).map(itemSummary), total: rows.length, offset: query.offset, limit: query.limit };
}
async function findTextbookItem(itemId: string, client: Prisma.TransactionClient = db) {
  const item = await client.learningItem.findFirst({ where: { id: idSchema.parse(itemId), ownerId: null, archived: false, sourceEntry: { active: true } }, include: { sourceEntry: { include: { lessons: true } } } });
  if (!item?.sourceEntry) throw new HttpError(404, '教材词条不存在。'); return item;
}
function summaryFromItem(item: Awaited<ReturnType<typeof findTextbookItem>>): ContentItemSummary {
  const source = item.sourceEntry!; const fields = fieldsOf(item.annotations);
  return itemSummary({ id: item.id, russian: item.russian, chinese: item.chinese, kind: item.kind, contentVersion: item.contentVersion, sourceKey: source.sourceKey, book: source.bookId, lessonIds: source.lessons.map(lesson => lesson.lessonId), fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field!.status])), pos: fields.partOfSpeech?.value });
}
export async function getContentItem(actorId: string, itemId: string, field?: unknown): Promise<ContentItemDetail> {
  await requireAdmin(actorId); const fieldKey = field === undefined ? undefined : keySchema.parse(field); const item = await findTextbookItem(itemId); const values = fieldsOf(item.annotations);
  const revisions = await db.annotationRevision.findMany({ where: { itemId, ...(fieldKey ? { fieldKey } : {}) }, include: { actor: { select: { id: true, name: true } } }, orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  return { item: summaryFromItem(item), source: { raw: item.sourceEntry!.raw, rowNumber: item.sourceEntry!.rowNumber, sourceVersion: item.sourceEntry!.sourceVersion }, fields: ANNOTATION_KEYS.map(key => ({ key, evidence: values[key] || null, protected: protectedField(values[key]) })), revisions: revisions.map(revisionDTO) };
}
export async function listContentJobs(actorId: string): Promise<{ jobs: ContentJobDTO[] }> {
  await requireAdmin(actorId); const jobs = await db.contentJob.findMany({ include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }); return { jobs: jobs.map(jobDTO) };
}
export async function getContentJob(actorId: string, id: string): Promise<ContentJobDetail> {
  await requireAdmin(actorId); const job = await db.contentJob.findUnique({ where: { id: idSchema.parse(id) }, include: { actor: { select: { id: true, name: true } } } });
  if (!job) throw new HttpError(404, '内容任务不存在。');
  const failures = await db.contentJobItem.findMany({ where: { jobId: id, status: 'failed' }, select: { id: true, itemId: true, sourceKey: true, attempts: true, error: true }, orderBy: { sourceKey: 'asc' }, take: 100 });
  return { ...jobDTO(job), failures: failures.map(row => ({ ...row, error: row.error || '处理失败' })) };
}
export async function createContentJob(actorId: string, input: unknown): Promise<ContentJobDetail> {
  await requireAdmin(actorId); const parsed = jobSchema.parse(input);
  if (parsed.provider !== 'local-dictionary') throw new HttpError(503, '云端 provider 尚未配置，不能创建云端任务。');
  const selection = { books: [...new Set(parsed.books?.length ? parsed.books : [1, 2, 3, 4, 5, 6])].sort(), fields: [...new Set(parsed.fields || ANNOTATION_KEYS)].sort() as AnnotationKey[], ...(parsed.itemIds ? { itemIds: [...new Set(parsed.itemIds)].sort() } : {}) };
  let dataset: Dataset; try { dataset = await loadDataset(); } catch (error) { throw new HttpError(422, artifactError(error)); }
  const created = await db.$transaction(async tx => {
    await requireAdmin(actorId, tx); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-request:${parsed.requestKey}`}))`;
    const existing = await tx.contentJob.findUnique({ where: { requestKey: parsed.requestKey } });
    if (existing) { if (existing.actorId !== actorId || existing.provider !== parsed.provider || existing.datasetHash !== dataset.datasetHash || existing.costLimitCents !== parsed.costLimitCents || !isDeepStrictEqual(existing.selection, selection)) throw new HttpError(409, '同一任务请求标识不能用于不同内容。'); return existing.id; }
    const items = await tx.learningItem.findMany({ where: { ...(selection.itemIds ? { id: { in: selection.itemIds } } : {}), ownerId: null, archived: false, sourceEntry: { active: true, bookId: { in: selection.books } } }, select: { id: true, contentVersion: true, sourceEntry: { select: { sourceKey: true } } }, orderBy: { id: 'asc' } });
    if (!items.length) throw new HttpError(422, '选择范围中没有教材词条。');
    if (selection.itemIds && selection.itemIds.length !== items.length) throw new HttpError(422, '所选条目必须属于当前教材范围，不能包含个人词库或不存在的条目。');
    const job = await tx.contentJob.create({ data: { actorId, requestKey: parsed.requestKey, provider: parsed.provider, datasetHash: dataset.datasetHash, generatorVersion: dataset.generatorVersion, schemaVersion: SCHEMA_VERSION, selection, total: items.length, costLimitCents: parsed.costLimitCents } });
    for (let offset = 0; offset < items.length; offset += 100) {
      await tx.contentJobItem.createMany({ data: items.slice(offset, offset + 100).map(item => {
        const sourceKey = item.sourceEntry!.sourceKey; const entry = dataset.entries[sourceKey]; const fields = dataset.fields[sourceKey];
        const candidate: Snapshot = { fields: fields || {}, sourceRowFingerprint: entry?.sourceRowFingerprint || '', inputFingerprint: entry?.inputFingerprint || '', outputFingerprint: entry?.outputFingerprint || '' };
        return { jobId: job.id, itemId: item.id, sourceKey, candidate: jsonValue(candidate), candidateHash: entry?.outputFingerprint || '', baseVersion: item.contentVersion };
      }) });
    }
    return job.id;
  }, { timeout: 120_000 });
  return getContentJob(actorId, created);
}
async function finalizeJob(id: string, token: string) {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-job:${id}`}))`;
    const job = await tx.contentJob.findUnique({ where: { id } }); if (!job || job.leaseToken !== token) return;
    const queued = await tx.contentJobItem.count({ where: { jobId: id, status: 'queued' } });
    await tx.contentJob.update({ where: { id }, data: { leaseToken: null, leaseExpiresAt: null, ...(job.status === 'cancelled' ? {} : queued ? { status: 'queued' } : { status: job.failed ? 'completed-with-errors' : 'completed', finishedAt: new Date() }) } });
  });
}
export async function runContentBatch(actorId: string, id: string, input: unknown = 25): Promise<ContentJobDetail> {
  await requireAdmin(actorId); idSchema.parse(id); const limit = z.coerce.number().int().min(1).max(50).parse(input); const token = randomUUID();
  const claim = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-job:${id}`}))`;
    return tx.contentJob.updateMany({ where: { id, status: { in: ['queued', 'running'] }, OR: [{ leaseToken: null }, { leaseExpiresAt: { lte: new Date() } }] }, data: { status: 'running', leaseToken: token, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  });
  if (!claim.count) return getContentJob(actorId, id);
  try {
    const candidates = await db.contentJobItem.findMany({ where: { jobId: id, status: 'queued' }, orderBy: { id: 'asc' }, take: limit, select: { id: true, itemId: true } });
    for (const candidate of candidates) {
      try {
        const proceed = await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-job:${id}`}))`;
          const job = await tx.contentJob.findUniqueOrThrow({ where: { id } });
          if (job.status !== 'running' || job.leaseToken !== token) return false;
          await requireAdmin(actorId, tx);
          const row = await tx.contentJobItem.findUniqueOrThrow({ where: { id: candidate.id } }); if (row.status !== 'queued') return true;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.itemId}))`;
          const item = await findTextbookItem(row.itemId, tx); const snapshot = row.candidate as unknown as Snapshot;
          if (!row.candidateHash || contentFingerprint(snapshot.fields) !== row.candidateHash) throw new HttpError(422, '该词条缺少有效候选快照，请重新生成本地候选后创建任务。');
          if (contentFingerprint(item.sourceEntry!.raw) !== snapshot.sourceRowFingerprint) throw new HttpError(409, '原表来源版本已变化，旧候选不能应用，请重新生成候选任务。');
          const selected = (job.selection as unknown as ContentJobDTO['selection']).fields;
          const before = fieldsOf(item.annotations); const next = { ...before }; const changed: AnnotationKey[] = []; const preserved: AnnotationKey[] = [];
          for (const key of selected) {
            const value = snapshot.fields[key]; if (!value) continue;
            candidateFieldSchema.parse(value);
            if (protectedField(before[key])) { preserved.push(key); continue; }
            if (!isDeepStrictEqual(before[key], value)) { next[key] = value; changed.push(key); }
          }
          if (changed.length && item.contentVersion !== row.baseVersion) throw new HttpError(409, '教学版本已变化。请检查后重试；已审核和已驳回字段始终保留。');
          if (changed.length) {
            const version = item.contentVersion + 1;
            const entryType = next.entryType?.value;
            const saved = await tx.learningItem.updateMany({ where: { id: item.id, contentVersion: row.baseVersion }, data: { annotations: jsonValue(next), contentVersion: version, ...(changed.includes('entryType') && typeof entryType === 'string' && ['word', 'phrase', 'sentence'].includes(entryType) ? { kind: entryType } : {}) } });
            if (!saved.count) throw new HttpError(409, '教学版本发生并发变化，请重试。');
            await tx.annotationRevision.createMany({ data: changed.map(fieldKey => ({ itemId: item.id, actorId, jobId: job.id, fieldKey, action: 'generate', reason: `本地字典候选任务 ${job.id}`, before: nullableJson(before[fieldKey]), after: jsonValue(next[fieldKey]), version })) });
          }
          await tx.contentJobItem.update({ where: { id: row.id }, data: { status: changed.length ? 'done' : 'skipped', attempts: { increment: 1 }, error: null, result: { changedFields: changed, preservedFields: preserved, unchangedFields: selected.filter(key => !changed.includes(key) && !preserved.includes(key)) } } });
          await tx.contentJob.update({ where: { id }, data: { ...(changed.length ? { completed: { increment: 1 } } : { skipped: { increment: 1 } }), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
          return true;
        }, { timeout: 30_000 });
        if (!proceed) break;
      } catch (error) {
        if (error instanceof HttpError && error.status === 403) throw error;
        await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-job:${id}`}))`;
          const job = await tx.contentJob.findUniqueOrThrow({ where: { id } }); if (job.leaseToken !== token || job.status !== 'running') return;
          const failed = await tx.contentJobItem.updateMany({ where: { id: candidate.id, status: 'queued' }, data: { status: 'failed', attempts: { increment: 1 }, error: artifactError(error) } });
          if (failed.count) await tx.contentJob.update({ where: { id }, data: { failed: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
        });
      }
    }
  } finally { await finalizeJob(id, token); }
  return getContentJob(actorId, id);
}
export async function cancelContentJob(actorId: string, id: string): Promise<ContentJobDetail> {
  await requireAdmin(actorId); idSchema.parse(id);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-job:${id}`}))`;
    await tx.contentJob.updateMany({ where: { id, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', leaseToken: null, leaseExpiresAt: null, finishedAt: new Date() } });
  }); return getContentJob(actorId, id);
}
export async function retryContentJob(actorId: string, id: string): Promise<ContentJobDetail> {
  await requireAdmin(actorId); idSchema.parse(id);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-job:${id}`}))`;
    const job = await tx.contentJob.findUnique({ where: { id } }); if (!job) throw new HttpError(404, '内容任务不存在。');
    if (job.leaseToken && job.leaseExpiresAt && job.leaseExpiresAt > new Date()) throw new HttpError(409, '任务正在处理当前批次，请稍后再重试。');
    const failed = await tx.contentJobItem.findMany({ where: { jobId: id, status: 'failed' }, include: { item: { select: { contentVersion: true } } } });
    for (const row of failed) await tx.contentJobItem.update({ where: { id: row.id }, data: { status: 'queued', error: null, baseVersion: row.item.contentVersion } });
    const queued = await tx.contentJobItem.count({ where: { jobId: id, status: 'queued' } });
    await tx.contentJob.update({ where: { id }, data: { failed: 0, leaseToken: null, leaseExpiresAt: null, ...(queued ? { status: 'queued', finishedAt: null } : {}) } });
  }, { timeout: 30_000 }); return getContentJob(actorId, id);
}
function meaningful(value: unknown): boolean { return value !== null && value !== undefined && !(typeof value === 'string' && !value.trim()) && !(Array.isArray(value) && !value.length) && !(value && typeof value === 'object' && !Object.keys(value).length); }
async function replayMutation(tx: Prisma.TransactionClient, actorId: string, requestKey: string, hash: string): Promise<AnnotationMutationResult | null> {
  const prior = await tx.annotationRevision.findUnique({ where: { requestKey }, include: { actor: { select: { id: true, name: true } } } });
  if (!prior) return null; if (prior.actorId !== actorId || prior.requestHash !== hash) throw new HttpError(409, '审核请求标识已用于其他内容。');
  return { item: summaryFromItem(await findTextbookItem(prior.itemId, tx)), revision: revisionDTO(prior), replayed: true };
}
export async function reviewAnnotation(actorId: string, itemId: string, key: string, input: unknown): Promise<AnnotationMutationResult> {
  await requireAdmin(actorId); idSchema.parse(itemId); const fieldKey = keySchema.parse(key); const parsed = reviewSchema.parse(input);
  if (parsed.action === 'approve' && parsed.acknowledge !== true) throw new HttpError(422, '请明确确认已逐字段核查内容与来源。');
  if (parsed.action === 'reject' && (parsed.value !== undefined || parsed.source !== undefined || parsed.method !== undefined)) throw new HttpError(422, '驳回保留原候选值与来源，请只填写驳回理由。');
  const hash = contentFingerprint({ itemId, fieldKey, ...parsed });
  if (Buffer.byteLength(canonicalJson(parsed)) > 220_000) throw new HttpError(413, '单字段内容过大。');
  return db.$transaction(async tx => {
    await requireAdmin(actorId, tx); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`annotation-request:${parsed.requestKey}`}))`;
    const prior = await replayMutation(tx, actorId, parsed.requestKey, hash); if (prior) return prior;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${itemId}))`;
    const item = await findTextbookItem(itemId, tx); if (item.contentVersion !== parsed.baseVersion) throw new HttpError(409, '教学版本已改变，请刷新字段后重新核查。');
    const fields = fieldsOf(item.annotations); const before = fields[fieldKey]; if (!before) throw new HttpError(422, '该字段尚无候选，请先运行本地候选任务。');
    const value = parsed.value !== undefined ? parsed.value : before.value;
    if (parsed.action === 'approve' && !meaningful(value)) throw new HttpError(422, '空白、未知或不适用字段不能被标为已审核内容。');
    if (parsed.action === 'approve' && !(parsed.source ?? before.source)?.trim()) throw new HttpError(422, '审核通过前必须填写可核查的依据来源。');
    const after: EvidenceField = { ...before, value, status: parsed.action === 'approve' ? 'reviewed' : 'rejected', ...(parsed.source !== undefined ? { source: parsed.source } : {}), ...(parsed.method !== undefined ? { method: parsed.method } : {}), updatedAt: new Date().toISOString() };
    const version = item.contentVersion + 1; const changed = { ...fields, [fieldKey]: after };
    const saved = await tx.learningItem.updateMany({ where: { id: item.id, contentVersion: parsed.baseVersion }, data: { annotations: jsonValue(changed), contentVersion: version, ...(fieldKey === 'entryType' && parsed.action === 'approve' && typeof value === 'string' && ['word', 'phrase', 'sentence'].includes(value) ? { kind: value } : {}) } });
    if (!saved.count) throw new HttpError(409, '教学版本发生并发变化，请刷新字段后重新核查。');
    const revision = await tx.annotationRevision.create({ data: { itemId, fieldKey, actorId, action: parsed.action, reason: parsed.reason, before: nullableJson(before), after: jsonValue(after), version, requestKey: parsed.requestKey, requestHash: hash }, include: { actor: { select: { id: true, name: true } } } });
    return { item: summaryFromItem(await findTextbookItem(itemId, tx)), revision: revisionDTO(revision), replayed: false };
  });
}
export async function rollbackAnnotation(actorId: string, revisionId: string, input: unknown): Promise<AnnotationMutationResult> {
  await requireAdmin(actorId); idSchema.parse(revisionId); const parsed = rollbackSchema.parse(input); const hash = contentFingerprint({ revisionId, ...parsed });
  return db.$transaction(async tx => {
    await requireAdmin(actorId, tx); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`annotation-request:${parsed.requestKey}`}))`;
    const prior = await replayMutation(tx, actorId, parsed.requestKey, hash); if (prior) return prior;
    const target = await tx.annotationRevision.findUnique({ where: { id: revisionId } }); if (!target) throw new HttpError(404, '字段历史版本不存在。');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${target.itemId}))`;
    const item = await findTextbookItem(target.itemId, tx); if (item.contentVersion !== parsed.baseVersion) throw new HttpError(409, '教学版本已改变，请刷新后重新选择回滚版本。');
    const key = keySchema.parse(target.fieldKey); const fields = fieldsOf(item.annotations); const before = fields[key]; const after = target.after as unknown as EvidenceField | null;
    const next = { ...fields }; if (after) next[key] = after; else delete next[key];
    const version = item.contentVersion + 1;
    const saved = await tx.learningItem.updateMany({ where: { id: item.id, contentVersion: parsed.baseVersion }, data: { annotations: jsonValue(next), contentVersion: version, ...(key === 'entryType' && after && typeof after.value === 'string' && ['word', 'phrase', 'sentence'].includes(after.value) ? { kind: after.value } : {}) } });
    if (!saved.count) throw new HttpError(409, '教学版本发生并发变化，请刷新后重新选择回滚版本。');
    const revision = await tx.annotationRevision.create({ data: { itemId: item.id, fieldKey: key, actorId, action: 'rollback', reason: parsed.reason, before: nullableJson(before), after: nullableJson(after), version, requestKey: parsed.requestKey, requestHash: hash, rollbackOfId: target.id }, include: { actor: { select: { id: true, name: true } } } });
    return { item: summaryFromItem(await findTextbookItem(item.id, tx)), revision: revisionDTO(revision), replayed: false };
  });
}
