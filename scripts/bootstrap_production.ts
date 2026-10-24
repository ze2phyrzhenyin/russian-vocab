import 'dotenv/config';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {db} from '../src/lib/db';
import {auth} from '../src/lib/auth';
import {readRuntimeConfig} from '../src/lib/config';

async function main(){
  const config=readRuntimeConfig();
  if(!config.production||config.demoMode)throw new Error('Production bootstrap requires APP_ENV=production and DEMO_MODE=false.');
  const email='admin@slovo.zhaoyang.fr';
  const file='.local/production-admin-access.md';
  const previous=await db.user.findUnique({where:{email}});
  if(previous){
    if(previous.role!=='admin'||previous.demo)throw new Error('Reserved address already belongs to another account; bootstrap refuses to promote or reset it.');
    await access(file);
    console.log('Administrator already exists; credentials and progress preserved.');return;
  }
  if(await db.user.count({where:{role:'admin'}}))throw new Error('An administrator already exists. Refusing an automatic second administrator.');
  const password=randomBytes(24).toString('base64url');
  await mkdir('.local',{recursive:true});
  // Persist the recovery handoff before creation; never log the password.
  await writeFile(file,`# 正式环境内容管理员\n\n地址：${config.baseURL}\n\n邮箱：${email}\n\n密码：${password}\n`,{mode:0o600,flag:'wx'});
  const signup=await auth.api.signUpEmail({body:{email,password,name:'内容管理员'}});
  await db.user.update({where:{id:signup.user.id},data:{role:'admin',demo:false}});
  console.log(`Production administrator created. Private credentials: ${file}`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Production bootstrap failed');process.exitCode=1}).finally(()=>db.$disconnect());
