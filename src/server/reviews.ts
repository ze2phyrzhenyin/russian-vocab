import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {db} from '@/lib/db';
import type {Prisma} from '@/generated/prisma/client';
import type {ReviewEventInput,SerializedCard,SyncResponse} from '@/domain/types';
import {applyRating,cardId as makeCardId,SCHEDULER_VERSION,PARAMETERS_VERSION} from '@/domain/learning';
import {accessibleItems,searchKey,stateDTOs} from './items';
import {HttpError} from './http';

export const reviewSchema=z.object({events:z.array(z.object({
  id:z.string().min(1).max(400),deviceId:z.string().min(1).max(100),sessionId:z.string().min(1).max(100),clientSequence:z.number().int().positive(),
  cardId:z.string().min(1).max(200),itemId:z.string().min(1).max(100),direction:z.enum(['ru-zh','zh-ru','recall']),
  rating:z.enum(['again','hard','good','easy']),correct:z.boolean(),practice:z.boolean(),occurredAt:z.iso.datetime(),
  baseVersion:z.number().int().nonnegative(),contentVersion:z.number().int().positive(),schedulerVersion:z.string().min(1).max(100),parametersVersion:z.string().min(1).max(100),
  answer:z.string().max(4000).optional(),mode:z.enum(['choice','recall']).optional(),hinted:z.boolean().optional(),
})).min(1).max(100)});

// Arrival ordering + expected-version checks are authoritative. Client clocks never reorder accepted history.
export async function submitReviews(userId:string,events:ReviewEventInput[],now=new Date()):Promise<SyncResponse>{
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const result:SyncResponse={acceptedIds:[],conflicts:[],states:{},resetCardIds:[]};
    for(const event of [...events].sort((a,b)=>a.deviceId.localeCompare(b.deviceId)||a.clientSequence-b.clientSequence)){
      const existing=await tx.reviewEvent.findUnique({where:{id:event.id}});
      if(existing){
        if(existing.userId!==userId)throw new HttpError(409,'事件标识已被使用。');
        if(!isDeepStrictEqual(existing.payload,JSON.parse(JSON.stringify(event))))throw new HttpError(409,'重复事件内容不一致。');
        if(existing.status==='conflict')result.conflicts.push({id:event.id,reason:existing.conflictReason||'状态冲突'});
        else result.acceptedIds.push(event.id);
        const current=await tx.userCardState.findUnique({where:{userId_cardId:{userId,cardId:event.cardId}}});
        if(current)result.states[event.cardId]={version:current.version,card:current.memory as unknown as SerializedCard};
        else result.resetCardIds!.push(event.cardId);
        continue;
      }
      const item=await tx.learningItem.findFirst({where:{id:event.itemId,...accessibleItems(userId)}});
      if(!item)throw new HttpError(404,'词条不存在或无权访问。');
      if(item.missingMeaning)throw new HttpError(422,'该词条尚缺中文释义，暂不参与学习。');
      if(item.meaningDisputed)throw new HttpError(422,'该词条的词形或释义存在争议，暂不参与释义练习。');
      const id=makeCardId(item.id,event.direction);
      if(id!==event.cardId)throw new HttpError(400,'卡片与方向不一致。');
      const duplicateSequence=await tx.reviewEvent.findUnique({where:{userId_deviceId_clientSequence:{userId,deviceId:event.deviceId,clientSequence:event.clientSequence}}});
      if(duplicateSequence)throw new HttpError(409,'设备事件序号重复，请保留记录并重新同步。');
      const session=await tx.studySession.findUnique({where:{id:event.sessionId}});
      if(session&&session.userId!==userId)throw new HttpError(403,'学习会话不属于当前账号。');
      if(!session)await tx.studySession.create({data:{id:event.sessionId,userId}});
      await tx.learningCard.upsert({where:{id},create:{id,itemId:item.id,direction:event.direction},update:{}});
      const state=await tx.userCardState.findUnique({where:{userId_cardId:{userId,cardId:id}}});
      const occurredAt=new Date(event.occurredAt);
      const memory=state?.memory as unknown as SerializedCard|undefined;
      let reason:string|null=null;
      if(event.schedulerVersion!==SCHEDULER_VERSION||event.parametersVersion!==PARAMETERS_VERSION)reason='复习算法版本已变化，请处理旧版本待同步记录。';
      else if(event.contentVersion!==item.contentVersion)reason='词条已修订，请确认新版内容后处理。';
      else if(occurredAt.getTime()>now.getTime()+5*60_000 || occurredAt.getTime()<now.getTime()-30*86400_000)reason='设备时间超出允许范围，请校准时间。';
      else if(!event.practice&&event.baseVersion!==(state?.version??0))reason='另一设备已更新此卡片，保留为练习或放弃本次待同步记录。';
      else if(!event.practice&&memory?.last_review&&occurredAt.getTime()<new Date(memory.last_review).getTime())reason='作答时间早于已接受的复习，不能重写历史。';
      const practice=event.practice||Boolean(state&&state.due.getTime()>occurredAt.getTime());
      let correct=event.correct;
      if(event.mode==='choice'){
        if(event.answer===undefined)throw new HttpError(400,'选择题缺少实际作答。');
        const expected=event.direction==='zh-ru'?item.russian:item.chinese;
        correct=searchKey(expected)===searchKey(event.answer);
      }
      const rating=!correct||event.hinted?'again':event.rating==='easy'&&event.mode==='choice'?'good':event.rating;
      await tx.reviewEvent.create({data:{id:event.id,userId,cardId:id,sessionId:event.sessionId,deviceId:event.deviceId,clientSequence:event.clientSequence,
        direction:event.direction,rating,correct,practice,occurredAt,receivedAt:now,effectiveAt:reason?null:occurredAt,
        baseVersion:event.baseVersion,contentVersion:event.contentVersion,schedulerVersion:event.schedulerVersion,parametersVersion:event.parametersVersion,
        status:reason?'conflict':'accepted',conflictReason:reason,payload:event as unknown as Prisma.InputJsonValue}});
      if(reason){result.conflicts.push({id:event.id,reason});if(state)result.states[id]={version:state.version,card:memory!};else result.resetCardIds!.push(id);continue;}
      if(!practice){
        const updated=applyRating(memory??null,rating,occurredAt);
        const saved=await tx.userCardState.upsert({where:{userId_cardId:{userId,cardId:id}},
          create:{userId,cardId:id,memory:updated as unknown as Prisma.InputJsonValue,due:new Date(updated.due),version:1},
          update:{memory:updated as unknown as Prisma.InputJsonValue,due:new Date(updated.due),version:{increment:1}}});
        result.states[id]={version:saved.version,card:updated};
      }else if(state)result.states[id]={version:state.version,card:memory!};
      result.acceptedIds.push(event.id);
    }
    // Return the latest accepted memory/mistake view, including practice events
    // and retries; an ACK must not erase a local correction flag accidentally.
    result.states=await stateDTOs(userId,[...new Set(events.map(event=>event.itemId))],tx);
    result.resetCardIds=[...new Set(events.map(event=>event.cardId).filter(id=>!result.states[id]))];
    return result;
  },{timeout:30_000});
}
