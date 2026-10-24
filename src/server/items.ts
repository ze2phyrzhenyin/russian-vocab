import {db} from '@/lib/db';
import type {Prisma} from '@/generated/prisma/client';
import type {LearningItemDTO,CardStateDTO,SerializedCard,EvidenceField} from '@/domain/types';
import {HttpError} from './http';
import {isMistake} from '@/domain/learning';

export const itemInclude={sourceEntry:{include:{lessons:true}},flags:true} satisfies Prisma.LearningItemInclude;
type FullItem=Prisma.LearningItemGetPayload<{include:typeof itemInclude}>;
type RawSource={bookPage?:string;pdfPage?:string;assetIds?:string[];book?:number;lessons?:number[]};
export function itemDTO(item:FullItem,userId:string):LearningItemDTO{
  const raw=(item.sourceEntry?.raw||{}) as RawSource;
  const flag=item.flags.find(f=>f.userId===userId);
  return {id:item.id,russian:item.russian,chinese:item.chinese,searchKey:item.searchKey,kind:item.kind as LearningItemDTO['kind'],
    morphology:item.morphology,notes:item.notes,book:item.sourceEntry?.bookId??null,
    lessons:item.sourceEntry?.lessons.map(x=>Number(x.lessonId.split('-')[1]))??[],sourceEntryId:item.sourceEntryId,
    documentId:item.sourceEntry?.documentId??null,bookPage:raw.bookPage||'',pdfPage:raw.pdfPage||'',assetIds:raw.assetIds||[],
    missingMeaning:item.missingMeaning,disputed:item.disputed,meaningDisputed:item.meaningDisputed,contentVersion:item.contentVersion,
    annotations:item.annotations as Record<string,EvidenceField>|null,favorite:flag?.favorite??false,suspended:flag?.suspended??false,
    example:item.example,tags:item.tags};
}
export function accessibleItems(userId:string):Prisma.LearningItemWhereInput{return {archived:false,OR:[{ownerId:userId},{ownerId:null,sourceEntry:{active:true}}]}}
export async function getItem(id:string,userId:string){
  const item=await db.learningItem.findFirst({where:{id,...accessibleItems(userId)},include:itemInclude});
  if(!item)throw new HttpError(404,'没有找到这个词条。');
  return item;
}
export async function stateDTOs(userId:string,itemIds:string[],client:Prisma.TransactionClient=db){
  const states=await client.userCardState.findMany({where:{userId,card:{itemId:{in:itemIds}}}});
  if(!states.length)return {} as Record<string,CardStateDTO>;
  const latest=await client.reviewEvent.findMany({where:{userId,status:'accepted',cardId:{in:states.map(s=>s.cardId)}},
    orderBy:[{receivedAt:'desc'},{deviceId:'desc'},{clientSequence:'desc'},{id:'desc'}],distinct:['cardId'],select:{cardId:true,correct:true,rating:true}});
  const mistakes=new Set(latest.filter(isMistake).map(event=>event.cardId));
  return Object.fromEntries(states.map(s=>[s.cardId,{version:s.version,card:s.memory as unknown as SerializedCard,...(mistakes.has(s.cardId)?{flag:'mistake'}:{})}])) as Record<string,CardStateDTO>;
}
export function searchKey(value:string){return value.normalize('NFD').replace(/[\u0300\u0301]/g,'').normalize('NFC').toLocaleLowerCase('ru').trim()}
