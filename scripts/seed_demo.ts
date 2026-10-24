import 'dotenv/config';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {db} from '../src/lib/db';
import {auth} from '../src/lib/auth';
import {readRuntimeConfig} from '../src/lib/config';
import {applyRating,cardId,SCHEDULER_VERSION,PARAMETERS_VERSION} from '../src/domain/learning';
import type {Prisma} from '../src/generated/prisma/client';

export async function seedDemo(){
  const config=readRuntimeConfig();
  if(!config.demoMode)throw new Error('Refusing fixed demo accounts outside explicit DEMO_MODE.');
  const accounts=[{email:'demo@ruslearn.test',name:'演示学习者',password:'RusDemo!2026',role:'user'},{email:'new@ruslearn.test',name:'新同学',password:'RusDemo!2026',role:'user'},{email:'admin@ruslearn.test',name:'内容管理员',password:randomBytes(20).toString('base64url'),role:'admin'}];
  // Check every reserved address before creating or changing any account.
  // An ordinary signup must never become an administrator or resettable demo.
  const previous=new Map<string,Awaited<ReturnType<typeof db.user.findUnique>>>();
  for(const account of accounts){
    const user=await db.user.findUnique({where:{email:account.email}});
    if(user&&(!user.demo||user.role!==account.role))throw new Error(`Refusing pre-existing non-demo or mismatched-role account: ${account.email}. No seed accounts changed.`);
    previous.set(account.email,user);
  }
  let createdAdmin:string|undefined;
  for(const account of accounts){
    if(!previous.get(account.email)){
      const signup=await auth.api.signUpEmail({body:{email:account.email,password:account.password,name:account.name}});
      await db.user.update({where:{id:signup.user.id},data:{role:account.role,demo:true}});
      if(account.role==='admin')createdAdmin=account.password;
    }
  }
  const demo=await db.user.findUniqueOrThrow({where:{email:'demo@ruslearn.test'}});
  const sessionId='seed-demo-initial-v1';
  if(!await db.studySession.findUnique({where:{id:sessionId}})){
    await db.$transaction(async tx=>{
      const items=await tx.learningItem.findMany({where:{ownerId:null,missingMeaning:false,meaningDisputed:false,sourceEntry:{bookId:1}},orderBy:{sourceEntry:{rowNumber:'asc'}},take:8});
      if(items.length<8)throw new Error('Import vocabulary before seeding demo progress.');
      await tx.studySession.create({data:{id:sessionId,userId:demo.id}});
      const now=new Date(Date.now()-3*86400_000);
      for(const [index,item] of items.entries()){
        const id=cardId(item.id,'ru-zh');const rating=index<3?'again':'good';const memory=applyRating(null,rating,now);
        await tx.userCardState.create({data:{userId:demo.id,cardId:id,memory:memory as unknown as Prisma.InputJsonValue,due:new Date(memory.due),version:1}});
        const event={id:randomUUID(),deviceId:'demo-seed',sessionId,clientSequence:index+1,cardId:id,itemId:item.id,direction:'ru-zh',rating,correct:rating==='good',practice:false,occurredAt:now.toISOString(),baseVersion:0,contentVersion:item.contentVersion,schedulerVersion:SCHEDULER_VERSION,parametersVersion:PARAMETERS_VERSION};
        await tx.reviewEvent.create({data:{...event,userId:demo.id,effectiveAt:now,occurredAt:now,receivedAt:now,itemId:undefined,payload:event} as unknown as Prisma.ReviewEventUncheckedCreateInput});
        if(index<3)await tx.itemFlag.create({data:{userId:demo.id,itemId:item.id,favorite:true}});
      }
      const deck=await tx.deck.create({data:{name:'我的第一本词集（演示）',category:'演示数据',userId:demo.id}});
      await tx.deckItem.createMany({data:items.slice(0,4).map(item=>({deckId:deck.id,itemId:item.id}))});
    });
  }
  await mkdir('.local',{recursive:true});
  let text=`# 本地隔离演示访问\n\n地址：${config.baseURL}\n\n- demo@ruslearn.test / RusDemo!2026（含明确的演示进度）\n- new@ruslearn.test / RusDemo!2026（全新用户，重跑 seed 不清除使用进度）\n`;
  if(createdAdmin)text+=`- admin@ruslearn.test / ${createdAdmin}\n`;
  else{try{const previous=await readFile('.local/demo-access.md','utf8');text+=previous.split('\n').find(line=>line.startsWith('- admin@'))??'- 管理员已存在；seed 不重置其密码。';}catch{text+='- 管理员已存在；seed 不重置其密码。';}}
  await writeFile('.local/demo-access.md',text+'\n',{mode:0o600});
  console.log('Demo seed complete. Credentials: .local/demo-access.md (private, not committed). Existing progress preserved.');
}
if(process.argv[1]?.endsWith('seed_demo.ts'))seedDemo().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
