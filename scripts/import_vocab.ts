import 'dotenv/config';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {db} from '../src/lib/db';
import {searchKey} from '../src/server/items';
import type {Prisma} from '../src/generated/prisma/client';
interface SourceRow {sourceKey:string;rowNumber:number;serial:string;book:number;lessons:number[];russian:string;chinese:string;morphology:string;notes:string;documentId:string;missingMeaning:boolean;disputed:boolean;[key:string]:unknown}
interface Bundle {workbook:{sha256:string;fileName:string;byteSize:number;coverageNotes:string[]};entries:SourceRow[];assets:{id:string;sha256:string;fileName:string;thumbnailFileName:string|null;[key:string]:unknown}[];report:{sourceDocuments:{id:string;fileName?:string;label?:string;[key:string]:unknown}[];issues:{sourceKey:string;code:string;affectedFields:string[]}[];[key:string]:unknown}}
const json=(value:unknown)=>value as Prisma.InputJsonValue;
async function chunks<T>(rows:T[],write:(batch:T[])=>Promise<unknown>){for(let i=0;i<rows.length;i+=300)await write(rows.slice(i,i+300))}
export async function importBundle(file='data/processed/workbook.json'){
  const bundle:Bundle=JSON.parse(await readFile(file,'utf8'));
  const output=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('slovo-source-import'))`;
    const previous=await tx.workbookImport.findUnique({where:{id:bundle.workbook.sha256}});
    if(previous)return {status:'unchanged',sourceEntries:await tx.sourceEntry.count(),learningItems:await tx.learningItem.count({where:{ownerId:null}}),preservedLearningHistory:true};
    const before=await tx.sourceEntry.findMany();
    const sourceMap=new Map(before.map(e=>[e.sourceKey,e]));
    const currentKeys=new Set(bundle.entries.map(e=>e.sourceKey));
    const removed=before.filter(e=>!currentKeys.has(e.sourceKey));
    if(removed.length)throw new Error(`Source mapping reconciliation required: ${removed.length} previous source keys are missing. No data changed.`);
    await tx.workbookImport.create({data:{id:bundle.workbook.sha256,fileName:bundle.workbook.fileName,byteSize:bundle.workbook.byteSize,report:json(bundle.report)}});
    for(let book=1;book<=6;book++)await tx.book.upsert({where:{id:book},create:{id:book,title:`东方俄语 · 第${book}册`},update:{}});
    const documentIds=[...new Set(bundle.entries.map(e=>e.documentId))];
    for(const id of documentIds){const doc=bundle.report.sourceDocuments.find(d=>d.id===id);await tx.sourceDocument.upsert({where:{id},create:{id,label:doc?.fileName??doc?.label??id,coverage:bundle.workbook.coverageNotes.join('\n')},update:{}})}
    const lessons=new Map<string,{id:string;bookId:number;number:number}>();for(const row of bundle.entries)for(const number of row.lessons)lessons.set(`${row.book}-${number}`,{id:`${row.book}-${number}`,bookId:row.book,number});
    await tx.lesson.createMany({data:[...lessons.values()],skipDuplicates:true});
    for(const asset of bundle.assets)await tx.sourceAsset.upsert({where:{id:asset.id},create:{id:asset.id,sha256:asset.sha256,fileName:asset.fileName,thumbnailFileName:asset.thumbnailFileName,metadata:json(asset)},update:{}});
    const added=bundle.entries.filter(e=>!sourceMap.has(e.sourceKey));
    const identities=new Map(bundle.entries.map(e=>[e.sourceKey,sourceMap.get(e.sourceKey)?.id??randomUUID()]));
    await chunks(added,rows=>tx.sourceEntry.createMany({data:rows.map(row=>({id:identities.get(row.sourceKey)!,sourceKey:row.sourceKey,bookId:row.book,documentId:row.documentId,rowNumber:row.rowNumber,serial:row.serial,raw:json(row)}))}));
    const changed=bundle.entries.filter(e=>sourceMap.has(e.sourceKey)&&!isDeepStrictEqual(sourceMap.get(e.sourceKey)!.raw,e));
    for(const row of changed)await tx.sourceEntry.update({where:{sourceKey:row.sourceKey},data:{rowNumber:row.rowNumber,documentId:row.documentId,raw:json(row),sourceVersion:{increment:1}}});
    await chunks(bundle.entries,rows=>tx.sourceVersion.createMany({data:rows.map(row=>({sourceEntryId:identities.get(row.sourceKey)!,importId:bundle.workbook.sha256,raw:json(row)}))}));
    for(const row of changed)await tx.sourceEntryLesson.deleteMany({where:{sourceEntryId:identities.get(row.sourceKey)!}});
    const joins=bundle.entries.flatMap(row=>row.lessons.map(number=>({sourceEntryId:identities.get(row.sourceKey)!,lessonId:`${row.book}-${number}`})));
    await chunks(joins,data=>tx.sourceEntryLesson.createMany({data,skipDuplicates:true}));
    const existingItems=await tx.learningItem.findMany({where:{ownerId:null},include:{_count:{select:{revisions:true}}}});
    const itemMap=new Map(existingItems.map(i=>[i.sourceEntryId,i]));
    const fields=(row:SourceRow)=>({russian:row.russian,chinese:row.missingMeaning?'':row.chinese,searchKey:searchKey(row.russian)+' '+searchKey(row.russian).replace(/ё/g,'е'),morphology:row.morphology,notes:row.notes,
      // Classification remains a display aid, never splits source rows or establishes lexical identity.
      kind:/[?!.？！。]$/.test(row.russian)?'sentence':/\s/.test(row.russian)&&!row.russian.includes('//')?'phrase':'word',missingMeaning:row.missingMeaning,disputed:row.disputed,
      meaningDisputed:bundle.report.issues.some(i=>i.sourceKey===row.sourceKey&&i.code!=='missing-meaning'&&i.affectedFields.some(f=>f==='russian'||f==='chinese'))});
    const newItems=bundle.entries.filter(e=>!itemMap.has(identities.get(e.sourceKey)!)).map(row=>({id:randomUUID(),sourceEntryId:identities.get(row.sourceKey)!,...fields(row)}));
    await chunks(newItems,data=>tx.learningItem.createMany({data}));
    let preservedRevisions=0;
    for(const row of changed){
      const previousItem=itemMap.get(identities.get(row.sourceKey)!);if(!previousItem)continue;
      // Serialize with annotation review and re-read after acquiring the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${previousItem.id}))`;
      const item=await tx.learningItem.findUniqueOrThrow({where:{id:previousItem.id},include:{_count:{select:{revisions:true}}}});
      if(item._count.revisions){preservedRevisions++;continue}
      const entryType=(item.annotations as unknown as {entryType?:{status?:string}}|null)?.entryType;
      const protectKind=entryType?.status==='reviewed'||entryType?.status==='rejected';
      await tx.learningItem.update({where:{id:item.id},data:{...fields(row),...(protectKind?{kind:item.kind}:{}),contentVersion:{increment:1}}});
    }
    await chunks(newItems.flatMap(item=>['ru-zh','zh-ru','recall'].map(direction=>({id:`${item.id}:${direction}`,itemId:item.id,direction}))),data=>tx.learningCard.createMany({data,skipDuplicates:true}));
    return {status:'imported',hash:bundle.workbook.sha256,sourceEntries:await tx.sourceEntry.count(),lessonAssociations:await tx.sourceEntryLesson.count(),sourceAssets:await tx.sourceAsset.count(),learningItems:await tx.learningItem.count({where:{ownerId:null}}),cards:await tx.learningCard.count(),added:added.length,changed:changed.length,preservedRevisions,preservedLearningHistory:true};
  },{timeout:120000});
  await mkdir('artifacts/import',{recursive:true});await writeFile('artifacts/import/database-import.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));return output;
}
async function main(){
  if(!process.argv.includes('--skip-extraction')){
    const index=process.argv.indexOf('--file');const file=index>=0?process.argv[index+1]:process.env.VOCAB_SOURCE_PATH??'data/source/东方俄语词汇汇总_第1至6册.xlsx';
    const python=process.env.SLOVO_PYTHON??(existsSync('.local/content-venv/bin/python')?'.local/content-venv/bin/python':'python3');
    const result=spawnSync(python,['scripts/extract_vocab.py','--file',file],{stdio:'inherit'});
    if(result.status!==0)throw new Error(`Workbook extraction failed (${result.status}).`);
  }
  await importBundle();
}
if(process.argv[1]?.endsWith('import_vocab.ts'))main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
