import 'dotenv/config';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { cancelContentJob, createContentJob, getContentJob, listContentJobs, retryContentJob, runContentBatch } from '../src/server/content-workflow';
import type { ContentJobDetail } from '../src/domain/content';

function report(job: ContentJobDetail) {
  console.log(JSON.stringify({ id: job.id, status: job.status, total: job.total, completed: job.completed, skipped: job.skipped, failed: job.failed, remaining: job.remaining, costSpentCents: job.costSpentCents, datasetHash: job.datasetHash, busy: job.busy }));
}
export async function runContentJobsCli(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    'actor-email': { type: 'string' }, 'actor-id': { type: 'string' }, 'request-key': { type: 'string' }, books: { type: 'string' }, fields: { type: 'string' }, items: { type: 'string' }, provider: { type: 'string', default: 'local-dictionary' }, 'budget-cents': { type: 'string', default: '0' }, 'batch-size': { type: 'string', default: '25' }, run: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log('content_jobs.ts create|import|list|show ID|run ID|cancel ID|retry ID --actor-email EMAIL [--books 1,2] [--fields lemma,declension] [--items ID,ID] [--request-key UUID] [--budget-cents 0] [--batch-size 25] [--run]'); return; }
  const email = values['actor-email'] || process.env.SLOVO_CONTENT_ACTOR_EMAIL || process.env.CONTENT_ACTOR_EMAIL; const actorId = values['actor-id'] || process.env.CONTENT_ACTOR_ID;
  if (!email && !actorId) throw new Error('Specify --actor-email or --actor-id for the actual administrator initiating this task.');
  const actor = await db.user.findUnique({ where: actorId ? { id: actorId } : { email: email! }, select: { id: true, role: true } });
  if (!actor || actor.role !== 'admin') throw new Error('Content job CLI requires an existing administrator identity.');
  const command = positionals[0] || 'list'; let job: ContentJobDetail;
  const ids = (value?: string) => value?.split(',').map(part => part.trim()).filter(Boolean);
  if (command === 'list') { console.log(JSON.stringify(await listContentJobs(actor.id), null, 2)); return; }
  if (command === 'create' || command === 'import') {
    job = await createContentJob(actor.id, { requestKey: values['request-key'] || randomUUID(), provider: values.provider, costLimitCents: Number(values['budget-cents']), ...(values.books ? { books: ids(values.books)!.map(Number) } : {}), ...(values.fields ? { fields: ids(values.fields) } : {}), ...(values.items ? { itemIds: ids(values.items) } : {}) });
  } else {
    const id = positionals[1]; if (!id) throw new Error('A persisted job ID is required.');
    job = command === 'cancel' ? await cancelContentJob(actor.id, id) : command === 'retry' ? await retryContentJob(actor.id, id) : await getContentJob(actor.id, id);
    if (!['show', 'run', 'cancel', 'retry'].includes(command)) throw new Error('Unknown content job command.');
  }
  report(job);
  if (command === 'import' || command === 'run' || values.run) {
    const size = Number(values['batch-size']);
    while (['queued', 'running'].includes(job.status)) {
      if (job.busy) throw new Error(`Job ${job.id} is already running a batch. Retry after its lease expires or the other worker finishes.`);
      job = await runContentBatch(actor.id, job.id, size); report(job);
    }
    if (job.failed) { console.error(JSON.stringify({ id: job.id, failures: job.failures }, null, 2)); process.exitCode = 1; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runContentJobsCli().catch(error => { console.error(error instanceof Error ? error.message : 'Content job failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
}
