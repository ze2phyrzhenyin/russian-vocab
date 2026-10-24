import 'dotenv/config';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {db} from '../src/lib/db';
import type {EvidenceField} from '../src/domain/types';
import type {Prisma} from '../src/generated/prisma/client';
async function main(){
  const annotations=JSON.parse(await readFile('data/processed/annotations.json','utf8')) as Record<string,Record<string,EvidenceField>>;
  const report={entries:Object.keys(annotations).length,updated:0,unchanged:0,preservedReviewedFields:0,missingSourceKeys:[] as string[]};
  for(const [sourceKey,fields] of Object.entries(annotations)){
    const item=await db.learningItem.findFirst({where:{sourceEntry:{sourceKey},ownerId:null}});
    if(!item){report.missingSourceKeys.push(sourceKey);continue}
    const existing=(item.annotations??{}) as unknown as Record<string,EvidenceField>;
    for(const [key,field] of Object.entries(existing))if(field.status==='reviewed'){fields[key]=field;report.preservedReviewedFields++}
    if(isDeepStrictEqual(existing,fields)){report.unchanged++;continue}
    const type=fields.entryType?.value;
    await db.learningItem.update({where:{id:item.id},data:{annotations:fields as unknown as Prisma.InputJsonValue,...(typeof type==='string'&&['word','phrase','sentence'].includes(type)?{kind:type}:{}),contentVersion:{increment:1}}});report.updated++;
  }
  await mkdir('artifacts/content',{recursive:true});await writeFile('artifacts/content/database-annotations.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(report.missingSourceKeys.length)throw new Error('Annotation source keys are missing; inspect report.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
