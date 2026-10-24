import 'dotenv/config';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {db} from '../src/lib/db';
const requiredFields=['entryType','headword','meaning','stress','sourceMorphology','partOfSpeech','morphologyCandidates','declension','conjugation','aspect','aspectPairs','government','phraseUsage','sentenceAnalysis','examples','relatedWords','usageNotes','provenance','lemma','pronunciation','register','gender','animacy','number','conjugationType','reflexive','transitivity','collocations','commonErrors','rootRelations','synonyms','antonyms'];
type Field={status:string;value:unknown};
type Content=Record<string,Field>;
const posLabels:Record<string,string>={'名词':'noun','形容词':'adjective','短尾形容词':'adjective','比较级':'adjective','动词':'verb','动词不定式':'verb','副词':'adverb','代词':'pronoun','数词':'numeral','介词':'preposition','连词':'conjunction','语气词':'particle','感叹词':'interjection','长尾形动词':'participle','短尾形动词':'participle','副动词':'gerund','述谓词':'predicative'};
function categories(content:Content,kind:string){
  if(kind==='phrase'||kind==='sentence')return [kind];
  const value=content.partOfSpeech?.value;
  const parts=Array.isArray(value)?[...new Set(value.flatMap(item=>typeof item==='string'&&posLabels[item]?[posLabels[item]]:[]))]:[];
  return parts.length?parts:['unknown'];
}
async function main(){
  const rows=await db.learningItem.findMany({where:{ownerId:null,archived:false,sourceEntry:{active:true}},select:{annotations:true,missingMeaning:true,meaningDisputed:true,disputed:true,kind:true,sourceEntry:{select:{sourceKey:true,bookId:true,lessons:{select:{lessonId:true}}}}}});
  const items=rows.map(item=>({...item,content:(item.annotations??{}) as Content}));
  function summarize(subset:typeof items){
    return Object.fromEntries(requiredFields.map(name=>{
      const statusCounts:Record<string,number>={};
      for(const item of subset){const status=item.content[name]?.status??'not-generated';statusCounts[status]=(statusCounts[status]??0)+1;}
      const applicableCount=subset.length-(statusCounts['not-applicable']??0);
      const rate=(status:string)=>applicableCount?(statusCounts[status]??0)/applicableCount:null;
      return [name,{itemCount:subset.length,stateDefinedItemCount:subset.length-(statusCounts['not-generated']??0),applicableCount,statusCounts,sourceRate:rate('source'),generatedCandidateRate:rate('generated'),unknownRate:rate('unknown'),humanReviewedRate:rate('reviewed')}];
    }));
  }
  const perBook:Record<string,typeof items>={},perLesson:Record<string,typeof items>={},perPartOfSpeech:Record<string,typeof items>={},perCategory:Record<string,typeof items>={};
  for(const item of items){
    if(item.sourceEntry){(perBook[item.sourceEntry.bookId]??=[]).push(item);for(const join of item.sourceEntry.lessons)(perLesson[join.lessonId]??=[]).push(item);}
    const parts=categories(item.content,item.kind);for(const part of parts)(perPartOfSpeech[part]??=[]).push(item);
    (perCategory[parts.length>1?'ambiguous':parts[0]]??=[]).push(item);
  }
  const group=(values:Record<string,typeof items>)=>Object.fromEntries(Object.entries(values).map(([name,subset])=>[name,{itemCount:subset.length,perField:summarize(subset)}]));
  const perField=summarize(items);
  const fieldCoverage=Object.fromEntries(Object.entries(perField).map(([name,value])=>[name,value.statusCounts]));
  let annotationDetail:unknown=null;try{annotationDetail=JSON.parse(await readFile('artifacts/import/content-coverage.json','utf8'))}catch{}
  const report={generatedAt:new Date().toISOString(),scope:'active source learning items; database published projection separate from generated artifact',sourceEntries:await db.sourceEntry.count(),books:await db.book.count(),lessons:await db.lesson.count(),lessonAssociations:await db.sourceEntryLesson.count(),sourceAssets:await db.sourceAsset.count(),learningItems:items.length,
    lexicalIdentity:{lexemesEstablished:0,sensesIndependentlyEstablished:0,note:'每个源词条为一个学习项目；词典候选不建立跨源词元或义项归并。'},
    cards:await db.learningCard.count({where:{item:{ownerId:null}}}),meaningPracticeEligible:items.filter(i=>!i.missingMeaning&&!i.meaningDisputed).length,
    missingMeaning:items.filter(i=>i.missingMeaning).length,disputedSourceItems:items.filter(i=>i.disputed).length,
    annotatedItems:items.filter(i=>Object.keys(i.content).length>0).length,completeFieldStatusItems:items.filter(i=>requiredFields.every(key=>i.content[key])).length,
    requiredFieldCount:requiredFields.length,fieldCoverage,perField,perBook:group(perBook),perLesson:group(perLesson),perCategory:group(perCategory),perPartOfSpeech:group(perPartOfSpeech),
    partOfSpeechDenominatorNote:'真实歧义项目可计入多个候选词性；perCategory 互斥。not-generated 表示数据库尚无该字段，不冒充 unknown 或已完成。',
    annotationDetail,humanReviewedFieldCount:Object.values(fieldCoverage).reduce((n,v)=>n+(v.reviewed??0),0),completionNote:'字段状态覆盖不等于知识齐备或人工审核；源材料、生成候选、待补项和已审核字段分别报告。'};
  await mkdir('artifacts/content',{recursive:true});await writeFile('artifacts/content/database-coverage.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({sourceEntries:report.sourceEntries,books:report.books,lessons:report.lessons,lessonAssociations:report.lessonAssociations,sourceAssets:report.sourceAssets,learningItems:report.learningItems,cards:report.cards,meaningPracticeEligible:report.meaningPracticeEligible,missingMeaning:report.missingMeaning,disputedSourceItems:report.disputedSourceItems,annotatedItems:report.annotatedItems,completeFieldStatusItems:report.completeFieldStatusItems,requiredFieldCount:report.requiredFieldCount,humanReviewedFieldCount:report.humanReviewedFieldCount,report:'artifacts/content/database-coverage.json'},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
