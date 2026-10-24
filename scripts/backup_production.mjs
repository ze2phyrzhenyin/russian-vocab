import {spawn} from 'node:child_process';
import {mkdir,open,stat,rename} from 'node:fs/promises';
import path from 'node:path';
const directory=path.resolve('.local/backups');
await mkdir(directory,{recursive:true,mode:0o700});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const target=path.join(directory,`slovo-${stamp}.dump`);
const temporary=target+'.partial';
const output=await open(temporary,'wx',0o600);
try{
  const child=spawn('docker',['compose','--env-file','.env.production','-f','compose.production.yaml','exec','-T','db','pg_dump','-U','slovo','-d','slovo','--format=custom'],{stdio:['ignore',output.fd,'inherit']});
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  if(exitCode!==0)throw new Error(`Database backup failed (${exitCode}); partial file retained for diagnosis.`);
  await output.sync();
}finally{await output.close();}
if((await stat(temporary)).size<100)throw new Error('Database backup is unexpectedly small.');
await rename(temporary,target);
console.log(`Private database backup created: ${target}`);
