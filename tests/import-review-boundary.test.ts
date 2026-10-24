import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

// Both real application modules resolve to this client. No source/review query is mocked.
const isolated = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined, reportPath: '' }));
vi.mock('../src/lib/db', () => ({ get db() {
  if (!isolated.client) throw new Error('Isolated schema client has not been initialized.');
  return isolated.client;
} }));
// These tests exercise the actual administrator check in reviewAnnotation, without an HTTP session.
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: () => { throw new Error('Unexpected HTTP authentication in importer regression.'); } } } }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => args[0] === 'artifacts/import' ? Promise.resolve(undefined) : actual.mkdir(...args),
    writeFile: (...args: Parameters<typeof actual.writeFile>) => actual.writeFile(
      args[0] === 'artifacts/import/database-import.json' ? isolated.reportPath : args[0], args[1], args[2]),
  };
});

config({ path: '.env', quiet: true });
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (!databaseUrl || databaseUrl.pathname !== '/ruslearn_dev' || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('Import/review regression requires the dedicated local ruslearn_dev database.');
}
const connectionString = databaseUrl.toString();
const schemaPattern = /^slovo_import_review_[a-f0-9]{32}$/;
const createdSchemas = new Set<string>();
const actorId = randomUUID();
const fixturePrefix = `synthetic-import-review:${randomUUID()}:`;
const sourceKey = `${fixturePrefix}1`;
let control: pg.Pool;
let schema = '';
let scratch = '';
let migrations: string[];
let publicTextbookSnapshot: { count: number; hash: string };
let importBundle: typeof import('../scripts/import_vocab').importBundle;
let reviewAnnotation: typeof import('../src/server/content-workflow').reviewAnnotation;
const client = () => {
  if (!isolated.client) throw new Error('No isolated client.');
  return isolated.client;
};

function bundle(version: number) {
  return {
    workbook: { sha256: createHash('sha256').update(`${sourceKey}:${version}`).digest('hex'), fileName: 'synthetic-review-boundary.xlsx', byteSize: version, coverageNotes: ['Synthetic fixture, no textbook content.'] },
    entries: [{ sourceKey, rowNumber: 2, serial: 'synthetic-1', book: 1, lessons: [1], russian: 'море', chinese: `合成释义 ${version}`, morphology: '', notes: `synthetic source version ${version}`, documentId: 'synthetic-document', missingMeaning: false, disputed: false }],
    assets: [], report: { sourceDocuments: [{ id: 'synthetic-document', fileName: 'synthetic-source.pdf' }], issues: [] },
  };
}
async function fixtureFile(version: number) {
  const file = path.join(scratch, `${version}.json`);
  await writeFile(file, JSON.stringify(bundle(version)));
  return file;
}
async function initialItem() {
  expect(await importBundle(await fixtureFile(1))).toMatchObject({ added: 1, changed: 0, sourceEntries: 1, learningItems: 1, cards: 3 });
  const item = await client().learningItem.findFirstOrThrow();
  expect(item.kind).toBe('word');
  return client().learningItem.update({ where: { id: item.id }, data: { annotations: {
    entryType: { value: 'word', status: 'generated', source: 'synthetic fixture', method: 'test fixture', version: 'test/1' },
    meaning: { value: '保留字段', status: 'source', source: 'synthetic fixture' },
  } } });
}
async function approvePhrase(itemId: string, baseVersion: number) {
  return reviewAnnotation(actorId, itemId, 'entryType', { requestKey: randomUUID(), baseVersion, action: 'approve', value: 'phrase', acknowledge: true, source: 'Synthetic reviewer evidence', reason: '合成类型审核回归' });
}
async function waitForItemLockWaiters(itemId: string, expected: number) {
  // Observe actual PostgreSQL lock waits, rather than relying on sleep ordering.
  await expect.poll(async () => {
    const result = await control.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE a.application_name=$1 AND l.locktype='advisory' AND NOT l.granted
        AND l.objsubid=1 AND l.objid=(hashtext($2)::bigint & 4294967295)::oid
        AND l.classid=(CASE WHEN hashtext($2)<0 THEN 4294967295 ELSE 0 END)::oid`, [schema, itemId]);
    return result.rows[0].count;
  }, { timeout: 4000, interval: 20 }).toBe(expected);
}
async function dropOwnedSchema(name: string) {
  if (!schemaPattern.test(name) || !createdSchemas.has(name)) throw new Error('Refusing to drop a schema not created by this test run.');
  await control.query(`DROP SCHEMA "${name}" CASCADE`);
  createdSchemas.delete(name);
  expect((await control.query('SELECT to_regnamespace($1) AS namespace', [name])).rows[0].namespace).toBeNull();
}
async function textbookSnapshot() {
  // Other workers legitimately add/remove their own public synthetic fixtures.
  // Compare all columns of the real textbook rows, in stable source-key order.
  const result = await control.query<{ count: number; hash: string }>(`
    SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(md5(to_jsonb(s)::text), '' ORDER BY s."sourceKey"), '')) AS hash
    FROM public."SourceEntry" s WHERE s."sourceKey" LIKE 'dongfang:%'`);
  return result.rows[0];
}

beforeAll(async () => {
  const dirs = await readdir('prisma/migrations', { withFileTypes: true });
  migrations = await Promise.all(dirs.filter(dir => dir.isDirectory()).map(dir => dir.name).sort().map(name => readFile(path.join('prisma/migrations', name, 'migration.sql'), 'utf8')));
  // Fail closed if a future migration escapes search_path or performs non-schema-local work.
  for (const sql of migrations) {
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim()).filter(Boolean);
    if (!statements.length || statements.some(statement => !/^(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE)\s/i.test(statement)) || /\bpublic\b|\bsearch_path\b|"[^"\n]+"\s*\.\s*"/i.test(sql)) {
      throw new Error('Migration requires a fresh isolation review before this temporary-schema test may run.');
    }
  }
  control = new pg.Pool({ connectionString, max: 3, options: '-c search_path=pg_catalog', application_name: 'slovo-import-review-control' });
  publicTextbookSnapshot = await textbookSnapshot();
}, 20_000);

beforeEach(async () => {
  schema = `slovo_import_review_${randomUUID().replaceAll('-', '')}`;
  if (!schemaPattern.test(schema)) throw new Error('Invalid generated schema identifier.');
  scratch = await mkdtemp(path.join(tmpdir(), 'slovo-import-review-'));
  isolated.reportPath = path.join(scratch, 'database-import.json');
  await control.query(`CREATE SCHEMA "${schema}"`);
  createdSchemas.add(schema);
  const setup = await control.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(`SET LOCAL search_path TO "${schema}"`);
    expect((await setup.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
    for (const sql of migrations) await setup.query(sql);
    await setup.query('COMMIT');
  } catch (error) { await setup.query('ROLLBACK'); throw error; }
  finally { setup.release(); }
  isolated.client = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 5, options: `-c search_path=${schema}`, application_name: schema }, { schema }),
    transactionOptions: { maxWait: 15_000, timeout: 15_000 },
  });
  expect(await client().$queryRaw`SELECT current_schema() AS name`).toEqual([{ name: schema }]);
  expect(await client().sourceEntry.count()).toBe(0);
  await client().user.create({ data: { id: actorId, name: 'Synthetic content administrator', email: `${actorId}@synthetic.test`, role: 'admin' } });
  ({ importBundle } = await import('../scripts/import_vocab'));
  ({ reviewAnnotation } = await import('../src/server/content-workflow'));
}, 20_000);

afterEach(async () => {
  await isolated.client?.$disconnect();
  isolated.client = undefined;
  if (createdSchemas.has(schema)) await dropOwnedSchema(schema);
  if (scratch) await rm(scratch, { recursive: true, force: true });
}, 20_000);

afterAll(async () => {
  if (!control) return;
  try {
    for (const name of [...createdSchemas]) await dropOwnedSchema(name);
    expect(await textbookSnapshot()).toEqual(publicTextbookSnapshot);
    expect((await control.query('SELECT count(*)::int AS count FROM public."SourceEntry" WHERE "sourceKey" LIKE $1', [`${fixturePrefix}%`])).rows[0].count).toBe(0);
  } finally { await control.end(); }
}, 20_000);

describe('real source import and field review boundary in isolated PostgreSQL schemas', () => {
  it('keeps an approved type and all annotations while recording changed source history', async () => {
    const original = await initialItem();
    const approved = await approvePhrase(original.id, original.contentVersion);
    const reviewed = await client().learningItem.findUniqueOrThrow({ where: { id: original.id } });
    expect(reviewed.kind).toBe('phrase');
    expect(await client().contentRevision.count()).toBe(0); // Annotation review must protect kind on its own.
    const file = await fixtureFile(2);
    expect(await importBundle(file)).toMatchObject({ added: 0, changed: 1, preservedRevisions: 0, sourceEntries: 1, learningItems: 1, cards: 3 });
    const updated = await client().learningItem.findUniqueOrThrow({ where: { id: original.id }, include: { sourceEntry: true } });
    expect(updated).toMatchObject({ kind: 'phrase', annotations: reviewed.annotations, chinese: '合成释义 2', contentVersion: reviewed.contentVersion + 1 });
    expect(updated.sourceEntry).toMatchObject({ id: original.sourceEntryId, sourceVersion: 2, raw: bundle(2).entries[0] });
    expect(await client().sourceVersion.findMany({ orderBy: { importId: 'asc' }, select: { raw: true } })).toEqual(expect.arrayContaining([{ raw: bundle(1).entries[0] }, { raw: bundle(2).entries[0] }]));
    expect(await client().sourceVersion.count()).toBe(2);
    expect(await client().annotationRevision.findUnique({ where: { id: approved.revision.id } })).toMatchObject({ action: 'approve', fieldKey: 'entryType', version: reviewed.contentVersion });
    await expect(approvePhrase(original.id, reviewed.contentVersion)).rejects.toMatchObject({ status: 409 });
    expect(await client().annotationRevision.count()).toBe(1);
    expect(await importBundle(file)).toMatchObject({ status: 'unchanged', sourceEntries: 1, learningItems: 1 });
    expect((await client().learningItem.findUniqueOrThrow({ where: { id: original.id } })).contentVersion).toBe(updated.contentVersion);
    expect(JSON.parse(await readFile(isolated.reportPath, 'utf8'))).toMatchObject({ status: 'unchanged' });
  });

  it('preserves a rejected entry type instead of resetting the current display kind', async () => {
    const original = await initialItem();
    await approvePhrase(original.id, original.contentVersion);
    const approved = await client().learningItem.findUniqueOrThrow({ where: { id: original.id } });
    await reviewAnnotation(actorId, original.id, 'entryType', { requestKey: randomUUID(), baseVersion: approved.contentVersion, action: 'reject', reason: '合成驳回保留当前展示类型' });
    const rejected = await client().learningItem.findUniqueOrThrow({ where: { id: original.id } });
    expect(rejected.annotations).toMatchObject({ entryType: { status: 'rejected' } });
    await importBundle(await fixtureFile(2));
    expect(await client().learningItem.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ kind: 'phrase', annotations: rejected.annotations, contentVersion: rejected.contentVersion + 1 });
    expect(await client().annotationRevision.count()).toBe(2);
  });

  it('retains existing teaching text revisions and records the new raw source separately', async () => {
    const original = await initialItem();
    const revised = await client().$transaction(async tx => {
      const saved = await tx.learningItem.update({ where: { id: original.id }, data: { chinese: '合成已审核正文', notes: '合成人工修订说明', contentVersion: { increment: 1 } } });
      await tx.contentRevision.create({ data: { itemId: original.id, actorId, reason: '合成正文修订保护回归', before: { chinese: original.chinese }, after: { chinese: saved.chinese }, version: saved.contentVersion } });
      return saved;
    });
    expect(await importBundle(await fixtureFile(2))).toMatchObject({ changed: 1, preservedRevisions: 1 });
    expect(await client().learningItem.findUniqueOrThrow({ where: { id: original.id } })).toEqual(revised);
    expect(await client().sourceEntry.findUniqueOrThrow({ where: { id: original.sourceEntryId! } })).toMatchObject({ sourceVersion: 2, raw: bundle(2).entries[0] });
    expect(await client().sourceVersion.count()).toBe(2);
    expect(await client().contentRevision.count()).toBe(1);
  });

  it('re-reads after the real item lock so a concurrent review cannot be overwritten by an old snapshot', async () => {
    const original = await initialItem();
    const file = await fixtureFile(2);
    const holder = await control.connect();
    let pendingReview: ReturnType<typeof approvePhrase> | undefined;
    let pendingImport: ReturnType<typeof importBundle> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [original.id]);
      pendingReview = approvePhrase(original.id, original.contentVersion);
      // Attach handlers immediately even if a later lock observation fails.
      void pendingReview.catch(() => undefined);
      await waitForItemLockWaiters(original.id, 1);
      pendingImport = importBundle(file);
      void pendingImport.catch(() => undefined);
      await waitForItemLockWaiters(original.id, 2);
      await holder.query('COMMIT');
      const [approval, imported] = await Promise.all([pendingReview, pendingImport]);
      expect(imported).toMatchObject({ changed: 1, preservedRevisions: 0 });
      const final = await client().learningItem.findUniqueOrThrow({ where: { id: original.id } });
      expect(final).toMatchObject({ kind: 'phrase', chinese: '合成释义 2', contentVersion: original.contentVersion + 2, annotations: { entryType: { status: 'reviewed', value: 'phrase' }, meaning: { value: '保留字段', status: 'source' } } });
      expect(final.annotations as Prisma.JsonObject).toEqual({ ...(original.annotations as Prisma.JsonObject), entryType: approval.revision.after });
      expect(await client().annotationRevision.count()).toBe(1);
      expect(await client().sourceVersion.count()).toBe(2);
      await expect(approvePhrase(original.id, approval.item.contentVersion)).rejects.toMatchObject({ status: 409 });
      expect(await client().learningItem.findUniqueOrThrow({ where: { id: original.id } })).toEqual(final);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await Promise.allSettled([pendingReview, pendingImport].filter(Boolean));
    }
  }, 20_000);
});
