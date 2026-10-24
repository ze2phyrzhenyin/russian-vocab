import 'dotenv/config';
import {db} from '../src/lib/db';
import {readRuntimeConfig} from '../src/lib/config';
async function main(){
  const flag=process.argv.indexOf('--email');const email=flag<0?'':process.argv[flag+1];const confirm=process.argv.indexOf('--confirm');
  if(!readRuntimeConfig().demoMode||!['demo@ruslearn.test','new@ruslearn.test'].includes(email)||confirm<0||process.argv[confirm+1]!==email)throw new Error('Use --email <demo/new@ruslearn.test> --confirm <same email> in isolated demo mode.');
  const user=await db.user.findUnique({where:{email}});if(!user||!user.demo||user.role==='admin')throw new Error('Refusing non-demo or administrator data.');
  await db.$transaction(async tx=>{
    await tx.reviewEvent.deleteMany({where:{userId:user.id}});await tx.studySession.deleteMany({where:{userId:user.id}});await tx.userCardState.deleteMany({where:{userId:user.id}});await tx.itemFlag.deleteMany({where:{userId:user.id}});
    await tx.ocrJob.deleteMany({where:{userId:user.id}});await tx.deck.deleteMany({where:{userId:user.id}});
    await tx.learningCard.deleteMany({where:{item:{ownerId:user.id}}});await tx.learningItem.deleteMany({where:{ownerId:user.id}});
    await tx.session.deleteMany({where:{userId:user.id}});await tx.user.update({where:{id:user.id},data:{preferences:{},timeZone:'Asia/Shanghai'}});
  });console.log(`Reset only ${email}. Textbooks, revisions and other users are unchanged. Clear this demo account browser cache separately. Re-run seed:demo for demo progress.`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
