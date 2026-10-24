import 'dotenv/config';
import { db } from '../src/lib/db';
import { runContentJobsCli } from './content_jobs';
import { readRuntimeConfig } from '../src/lib/config';
// Imports use the persisted, audited administrator workflow; never direct writes.
const args = process.argv.slice(2);
if (!args.some(argument => argument.startsWith('--actor-email') || argument.startsWith('--actor-id')) && !process.env.CONTENT_ACTOR_ID) args.push('--actor-email', process.env.SLOVO_CONTENT_ACTOR_EMAIL || (readRuntimeConfig().production ? 'admin@slovo.zhaoyang.fr' : 'admin@ruslearn.test'));
runContentJobsCli(['import', ...args])
  .catch(error => { console.error(error instanceof Error ? error.message : 'Annotation import failed'); process.exitCode = 1; })
  .finally(() => db.$disconnect());
