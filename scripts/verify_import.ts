import 'dotenv/config';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {db} from '../src/lib/db';
import {importBundle} from './import_vocab';
async function snapshot(){
  const demo=await db.user.findUniqueOrThrow({where:{email:'demo@ruslearn.test'}});
  const counts={sourceEntries:await db.sourceEntry.count(),books:await db.book.count(),lessons:await db.lesson.count(),associations:await db.sourceEntryLesson.count(),sourceAssets:await db.sourceAsset.count(),learningItems:await db.learningItem.count({where:{ownerId:null}}),cards:await db.learningCard.count({where:{item:{ownerId:null}}})};
  const rows=await db.sourceEntry.findMany({orderBy:{id:'asc'}});
  const items=await db.learningItem.findMany({where:{ownerId:null},orderBy:{id:'asc'}});
  const states=await db.userCardState.findMany({where:{userId:demo.id},orderBy:{cardId:'asc'}});
  const history=await db.reviewEvent.findMany({where:{userId:demo.id},orderBy:{id:'asc'}});
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return{counts,sourceHash:hash(rows),teachingHash:hash(items),demoStatesHash:hash(states),demoHistoryHash:hash(history),demoEventCount:history.length};
}
async function main(){const before=await snapshot();const imported=await importBundle();assert.equal(imported.status,'unchanged');const after=await snapshot();assert.deepEqual(after,before);await mkdir('artifacts/import',{recursive:true});await writeFile('artifacts/import/idempotency.json',JSON.stringify({verifiedAt:new Date().toISOString(),passed:true,before,after},null,2));console.log('Real database reimport is idempotent: counts, source/teaching data and demo progress unchanged.');}
main().catch(error=>{console.error(error instanceof Error?error.message:'Import verification failed');process.exitCode=1}).finally(()=>db.$disconnect());
