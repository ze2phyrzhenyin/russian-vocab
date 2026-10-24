import 'dotenv/config';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {db} from '../src/lib/db';
async function main(){
  const items=await db.learningItem.findMany({where:{ownerId:null},select:{annotations:true,missingMeaning:true,meaningDisputed:true,disputed:true,kind:true}});
  const fieldCoverage:Record<string,Record<string,number>>={};
  for(const item of items)for(const [key,value] of Object.entries((item.annotations??{}) as Record<string,{status:string}>)){fieldCoverage[key]??={};fieldCoverage[key][value.status]=(fieldCoverage[key][value.status]??0)+1}
  let annotationDetail:unknown=null;try{annotationDetail=JSON.parse(await readFile('artifacts/import/content-coverage.json','utf8'))}catch{}
  const report={generatedAt:new Date().toISOString(),sourceEntries:await db.sourceEntry.count(),books:await db.book.count(),lessons:await db.lesson.count(),lessonAssociations:await db.sourceEntryLesson.count(),sourceAssets:await db.sourceAsset.count(),learningItems:items.length,
    lexicalIdentity:{lexemesEstablished:0,sensesIndependentlyEstablished:0,note:'每个源词条暂为一个学习项目；未进行词元、义项的跨源归并。'},
    cards:await db.learningCard.count({where:{item:{ownerId:null}}}),meaningPracticeEligible:items.filter(i=>!i.missingMeaning&&!i.meaningDisputed).length,
    missingMeaning:items.filter(i=>i.missingMeaning).length,disputed:items.filter(i=>i.disputed).length,representativeAnnotatedItems:items.filter(i=>i.annotations!==null).length,
    fieldCoverage,annotationDetail,humanReviewedFieldCount:Object.values(fieldCoverage).reduce((n,v)=>n+(v.reviewed??0),0)};
  await mkdir('artifacts/content',{recursive:true});await writeFile('artifacts/content/database-coverage.json',JSON.stringify(report,null,2));console.log(JSON.stringify({sourceEntries:report.sourceEntries,books:report.books,lessons:report.lessons,lessonAssociations:report.lessonAssociations,sourceAssets:report.sourceAssets,learningItems:report.learningItems,cards:report.cards,meaningPracticeEligible:report.meaningPracticeEligible,missingMeaning:report.missingMeaning,disputed:report.disputed,representativeAnnotatedItems:report.representativeAnnotatedItems,humanReviewedFieldCount:report.humanReviewedFieldCount,report:'artifacts/content/database-coverage.json'},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
