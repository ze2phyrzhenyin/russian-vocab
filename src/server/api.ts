import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {db} from '@/lib/db';
import {readRuntimeConfig} from '@/lib/config';
import type {Prisma,User} from '@/generated/prisma/client';
import {localDateKey,studyStreak,cardId,isMistake} from '@/domain/learning';
import {HttpError,readJson,requireUser,requireMutationOrigin} from './http';
import {accessibleItems,getItem,itemDTO,itemInclude,searchKey,stateDTOs} from './items';
import {reviewSchema,submitReviews} from './reviews';

const personalSchema=z.object({russian:z.string().trim().min(1).max(1000),chinese:z.string().trim().max(2000),kind:z.enum(['word','phrase','sentence']),notes:z.string().max(4000).optional(),example:z.string().max(4000).optional(),tags:z.array(z.string().max(50)).max(20).optional()});
const asJson=(value:unknown)=>value as Prisma.InputJsonValue;
async function ownDeck(id:string,userId:string){const d=await db.deck.findFirst({where:{id,userId}});if(!d)throw new HttpError(404,'词库不存在。');return d}
export async function activity(user:User){
  const [states,events]=await Promise.all([
    db.userCardState.findMany({where:{userId:user.id},include:{card:true}}),
    db.reviewEvent.findMany({where:{userId:user.id,status:'accepted'},orderBy:[{receivedAt:'asc'},{deviceId:'asc'},{clientSequence:'asc'},{id:'asc'}],include:{card:true}}),
  ]);
  const latest=new Map<string,typeof events[number]>();for(const event of events)latest.set(event.cardId,event);
  const introduced=new Map<string,Date>();for(const event of events)if(!event.practice&&!introduced.has(event.card.itemId))introduced.set(event.card.itemId,event.effectiveAt??event.occurredAt);
  const mistakes=[...new Set([...latest.values()].filter(isMistake).map(e=>e.card.itemId))];
  const today=localDateKey(new Date(),user.timeZone);
  return {stats:{day:today,learned:new Set(states.map(s=>s.card.itemId)).size,due:new Set(states.filter(s=>s.due<=new Date()).map(s=>s.card.itemId)).size,
    mistakes:mistakes.length,today:events.filter(e=>localDateKey(e.effectiveAt??e.occurredAt,user.timeZone)===today).length,
    newToday:[...introduced.values()].filter(date=>localDateKey(date,user.timeZone)===today).length,
    streak:studyStreak(events.map(e=>e.effectiveAt??e.occurredAt),new Date(),user.timeZone)},mistakeIds:mistakes,events};
}
export async function resolveReviewConflict(userId:string,eventId:string,action:'keep-practice'|'discard'){
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const event=await tx.reviewEvent.findFirst({where:{id:eventId,userId},include:{card:{select:{itemId:true}}}});
    if(!event)throw new HttpError(404,'待处理记录不存在。');
    if(event.status!=='conflict'){
      const previous=event.status==='discarded'?'discard':event.status==='accepted'&&event.practice&&event.conflictReason?'keep-practice':null;
      if(previous!==action)throw new HttpError(409,'这条记录已经按另一种方式处理，不能再次更改。');
    }else{
      // Keep the original reason for audit and distinguish resolved conflicts
      // from ordinary practice. The immutable payload remains unchanged.
      await tx.reviewEvent.update({where:{id:event.id},data:{status:action==='keep-practice'?'accepted':'discarded',practice:true,effectiveAt:action==='keep-practice'?new Date():null}});
    }
    const states=await stateDTOs(userId,[event.card.itemId],tx);
    return {acceptedIds:[event.id],conflicts:[],states,resetCardIds:states[event.cardId]?[]:[event.cardId]};
  });
}
async function bootstrap(user:User){
  const books=await db.book.findMany({orderBy:{id:'asc'},include:{_count:{select:{entries:true}},lessons:{orderBy:{number:'asc'},include:{entries:{include:{sourceEntry:{include:{items:{select:{missingMeaning:true,meaningDisputed:true}}}}}}}}}});
  const preferences=user.preferences as {lessonIds?:string[];dailyGoal?:number};
  return {user:{id:user.id,name:user.name,email:user.email,role:user.role,timeZone:user.timeZone},demoMode:readRuntimeConfig().demoMode,
    stats:(await activity(user)).stats,selection:{lessonIds:preferences.lessonIds??['1-1'],dailyGoal:preferences.dailyGoal??10},
    books:books.map(book=>({id:book.id,title:book.title,entryCount:book._count.entries,lessons:book.lessons.map(lesson=>({id:lesson.id,number:lesson.number,count:lesson.entries.length,eligibleCount:lesson.entries.filter(e=>e.sourceEntry.items.some(i=>!i.missingMeaning&&!i.meaningDisputed)).length}))}))};
}
export async function handleApi(request:Request,parts:string[]):Promise<Response>{
  requireMutationOrigin(request);
  const route=parts.join('/');const method=request.method;const url=new URL(request.url);
  if(route==='config'&&method==='GET')return Response.json({demoMode:readRuntimeConfig().demoMode,aiProvider:'unconfigured'});
  if(route==='health'&&method==='GET'){await db.$queryRaw`SELECT 1`;return Response.json({ok:true})}
  const user=await requireUser(request);
  if(!['GET','HEAD'].includes(method)&&request.headers.get('x-slovo-user')!==user.id)throw new HttpError(409,'登录账号已改变，请刷新页面后继续。待同步记录已保留。');
  if(route==='bootstrap'&&method==='GET')return Response.json(await bootstrap(user));
  if(route==='preferences'&&method==='POST'){
    const input=z.object({lessonIds:z.array(z.string().regex(/^[1-6]-\d{1,2}$/)).max(69),dailyGoal:z.number().int().min(1).max(100),timeZone:z.string().max(80).optional()}).parse(await readJson(request));
    if(input.timeZone){try{new Intl.DateTimeFormat('en',{timeZone:input.timeZone})}catch{throw new HttpError(400,'时区不正确。')}}
    const lessonIds=[...new Set(input.lessonIds)];
    if(await db.lesson.count({where:{id:{in:lessonIds}}})!==lessonIds.length)throw new HttpError(400,'所选课次不存在。');
    await db.user.update({where:{id:user.id},data:{preferences:{lessonIds,dailyGoal:input.dailyGoal},...(input.timeZone?{timeZone:input.timeZone}:{})}});
    return Response.json({lessonIds,dailyGoal:input.dailyGoal,timeZone:input.timeZone??user.timeZone});
  }
  if(route==='items'&&method==='GET'){
    const lessonIds=(url.searchParams.get('lessons')||'').split(',').filter(Boolean);
    const query=searchKey(url.searchParams.get('q')||'');const deckId=url.searchParams.get('deckId');const filter=url.searchParams.get('filter')||'all';
    const limit=z.coerce.number().int().min(1).max(1000).parse(url.searchParams.get('limit')??100);
    const offset=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('offset')??0);
    const and:Prisma.LearningItemWhereInput[]=[accessibleItems(user.id)];
    if(lessonIds.length)and.push({sourceEntry:{lessons:{some:{lessonId:{in:lessonIds}}}}});
    if(deckId){await ownDeck(deckId,user.id);and.push({deckItems:{some:{deckId}}})}
    if(query)and.push({OR:[{searchKey:{contains:query}},{chinese:{contains:query}},{russian:{contains:query,mode:'insensitive'}},{morphology:{contains:query,mode:'insensitive'}}]});
    if(filter==='favorites')and.push({flags:{some:{userId:user.id,favorite:true}}});
    if(filter==='suspended')and.push({flags:{some:{userId:user.id,suspended:true}}});
    if(filter==='new')and.push({cards:{none:{states:{some:{userId:user.id}}}}});
    if(filter==='due')and.push({cards:{some:{states:{some:{userId:user.id,due:{lte:new Date()}}}}}});
    if(filter==='learning')and.push({cards:{some:{states:{some:{userId:user.id}}}}});
    if(filter==='mistakes')and.push({id:{in:(await activity(user)).mistakeIds}});
    const where={AND:and};
    const [items,total]=await Promise.all([db.learningItem.findMany({where,include:itemInclude,orderBy:[{sourceEntry:{bookId:'asc'}},{sourceEntry:{rowNumber:'asc'}},{createdAt:'asc'},{id:'asc'}],take:limit,skip:offset}),db.learningItem.count({where})]);
    return Response.json({items:items.map(i=>itemDTO(i,user.id)),states:await stateDTOs(user.id,items.map(i=>i.id)),total});
  }
  if(parts[0]==='items'&&parts[1]){
    const item=await getItem(parts[1],user.id);
    if(parts.length===2&&method==='GET')return Response.json({item:itemDTO(item,user.id),revisions:await db.contentRevision.findMany({where:{itemId:item.id},select:{id:true,reason:true,version:true,createdAt:true},orderBy:{version:'desc'}})});
    if(parts.length===3&&method==='POST'&&['favorite','suspend'].includes(parts[2])){
      const key=parts[2]==='favorite'?'favorite':'suspended';const existing=await db.itemFlag.findUnique({where:{userId_itemId:{userId:user.id,itemId:item.id}}});
      const value=!existing?.[key];await db.itemFlag.upsert({where:{userId_itemId:{userId:user.id,itemId:item.id}},create:{userId:user.id,itemId:item.id,[key]:value},update:{[key]:value}});return Response.json({[key]:value});
    }
  }
  if(route==='reviews'&&method==='POST')return Response.json(await submitReviews(user.id,reviewSchema.parse(await readJson(request)).events));
  if(parts[0]==='reviews'&&parts[1]==='conflicts'&&parts[2]&&method==='POST'){
    const {action}=z.object({action:z.enum(['keep-practice','discard'])}).parse(await readJson(request));
    return Response.json(await resolveReviewConflict(user.id,parts[2],action));
  }
  if(route==='history'&&method==='GET'){
    const info=await activity(user);
    return Response.json({stats:info.stats,events:info.events.slice(-200).reverse().map(e=>({id:e.id,itemId:e.card.itemId,direction:e.direction,rating:e.rating,correct:e.correct,practice:e.practice,occurredAt:e.occurredAt,receivedAt:e.receivedAt})),conflicts:await db.reviewEvent.findMany({where:{userId:user.id,status:'conflict'},select:{id:true,conflictReason:true,occurredAt:true,cardId:true}})});
  }
  if(route==='decks'&&method==='GET')return Response.json({decks:(await db.deck.findMany({where:{userId:user.id},include:{_count:{select:{items:true}}},orderBy:{createdAt:'asc'}})).map(d=>({id:d.id,name:d.name,category:d.category,count:d._count.items}))});
  if(route==='decks'&&method==='POST'){
    const input=z.object({name:z.string().trim().min(1).max(100),category:z.string().max(100).optional()}).parse(await readJson(request));
    return Response.json({...await db.deck.create({data:{...input,userId:user.id}}),count:0},{status:201});
  }
  if(parts[0]==='decks'&&parts[1]){
    const deck=await ownDeck(parts[1],user.id);
    if(parts.length===2&&method==='PATCH'){const input=z.object({name:z.string().trim().min(1).max(100),category:z.string().max(100).optional()}).parse(await readJson(request));return Response.json(await db.deck.update({where:{id:deck.id},data:input}))}
    if(parts.length===2&&method==='DELETE'){await db.deck.delete({where:{id:deck.id}});return Response.json({deleted:true})}
    if(parts[2]==='items'&&parts.length===3&&method==='POST'){
      const input=z.object({items:z.array(personalSchema).max(200).default([]),existingItemIds:z.array(z.string().max(100)).max(200).optional(),ocr:z.record(z.string(),z.unknown()).optional()}).parse(await readJson(request));
      const results=await db.$transaction(async tx=>{
        const result:string[]=[];
        for(const inputItem of input.items){
          const item=await tx.learningItem.create({data:{...inputItem,ownerId:user.id,searchKey:searchKey(inputItem.russian)+' '+searchKey(inputItem.russian).replace(/ё/g,'е'),missingMeaning:!inputItem.chinese,notes:inputItem.notes??'',example:inputItem.example??'',tags:inputItem.tags??[]}});
          await tx.deckItem.create({data:{deckId:deck.id,itemId:item.id}});
          await tx.learningCard.createMany({data:['ru-zh','zh-ru','recall'].map(direction=>({id:cardId(item.id,direction as 'recall'),itemId:item.id,direction}))});result.push(item.id);
        }
        for(const id of input.existingItemIds??[]){const exists=await tx.learningItem.findFirst({where:{id,...accessibleItems(user.id)}});if(!exists)throw new HttpError(404,'选中的词条不存在。');await tx.deckItem.upsert({where:{deckId_itemId:{deckId:deck.id,itemId:id}},create:{deckId:deck.id,itemId:id},update:{}});result.push(id)}
        if(input.ocr)await tx.ocrJob.create({data:{userId:user.id,deckId:deck.id,engine:typeof input.ocr.engine==='string'?input.ocr.engine:'tesseract.js@7.0.0',result:asJson(input.ocr)}});
        return result;
      },{timeout:20_000});
      const items=await db.learningItem.findMany({where:{id:{in:results}},include:itemInclude});return Response.json({items:items.map(i=>itemDTO(i,user.id))},{status:201});
    }
    if(parts[2]==='items'&&parts[3]){
      const membership=await db.deckItem.findUnique({where:{deckId_itemId:{deckId:deck.id,itemId:parts[3]}}});if(!membership)throw new HttpError(404,'这个词条不在词库中。');
      if(method==='DELETE'){await db.deckItem.delete({where:{deckId_itemId:{deckId:deck.id,itemId:parts[3]}}});return Response.json({deleted:true})}
      if(method==='PATCH'){
        const item=await getItem(parts[3],user.id);if(item.ownerId!==user.id)throw new HttpError(403,'教材原文需由管理员修订，不能在个人词库直接改写。');
        const input=personalSchema.partial().parse(await readJson(request));
        const changed=await db.learningItem.update({where:{id:item.id},data:{...input,...(input.russian?{searchKey:searchKey(input.russian)+' '+searchKey(input.russian).replace(/ё/g,'е')} :{}),...(input.chinese!==undefined?{missingMeaning:!input.chinese}:{}),contentVersion:{increment:1}},include:itemInclude});return Response.json({item:itemDTO(changed,user.id)});
      }
    }
  }
  if(parts[0]==='assets'&&parts[1]&&method==='GET'){
    const asset=await db.sourceAsset.findUnique({where:{id:parts[1]}});if(!asset)throw new HttpError(404,'原表图片不存在。');
    const fileName=url.searchParams.get('thumbnail')==='1'&&asset.thumbnailFileName?asset.thumbnailFileName:asset.fileName;
    const root=path.resolve(/* turbopackIgnore: true */ process.env.SLOVO_ASSET_ROOT??'data/assets');const file=path.resolve(/* turbopackIgnore: true */ root,fileName);if(!file.startsWith(root+path.sep))throw new HttpError(400,'图片路径不正确。');
    const bytes=await readFile(/* turbopackIgnore: true */ file);const ext=path.extname(file).toLowerCase();
    return new Response(bytes,{headers:{'Content-Type':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(parts[0]==='admin'){
    if(user.role!=='admin')throw new HttpError(403,'只有内容管理员可以进行此操作。');
    if(route==='admin/issues'&&method==='GET'){
      const latest=await db.workbookImport.findFirst({orderBy:{importedAt:'desc'}});
      const issues=await db.learningItem.findMany({where:{OR:[{missingMeaning:true},{disputed:true}],ownerId:null},include:itemInclude});
      return Response.json({issues:issues.map(i=>itemDTO(i,user.id)),report:latest?.report??{},aiProvider:'unconfigured'});
    }
    if(route==='admin/revisions'&&method==='POST'){
      const input=z.object({itemId:z.string(),chinese:z.string().trim().max(2000).optional(),notes:z.string().max(4000).optional(),reason:z.string().trim().min(3).max(1000)}).refine(v=>v.chinese!==undefined||v.notes!==undefined,{message:'至少修订一个字段'}).parse(await readJson(request));
      const revision=await db.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.itemId}))`;
        const item=await tx.learningItem.findFirst({where:{id:input.itemId,ownerId:null}});if(!item)throw new HttpError(404,'教材词条不存在。');
        const before={chinese:item.chinese,notes:item.notes,contentVersion:item.contentVersion};
        const after={chinese:input.chinese??item.chinese,notes:input.notes??item.notes,contentVersion:item.contentVersion+1};
        await tx.learningItem.update({where:{id:item.id},data:{...after,missingMeaning:!after.chinese,meaningDisputed:input.chinese!==undefined?false:item.meaningDisputed}});
        return tx.contentRevision.create({data:{itemId:item.id,actorId:user.id,reason:input.reason,before,after,version:after.contentVersion}});
      });return Response.json({revision});
    }
  }
  throw new HttpError(404,'接口不存在。');
}
