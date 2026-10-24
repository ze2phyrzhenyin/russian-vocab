import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {config} from 'dotenv';
import {homedir} from 'node:os';
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.status!==0)throw new Error(`${command} ${args[0]??''} failed (${result.status}). No databases were erased.`)}
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Use Node.js 24 LTS.');
await mkdir('.local',{recursive:true});
if(!existsSync('.env')){
  const password=randomBytes(24).toString('hex');
  await writeFile('.env',`DATABASE_URL=postgresql://slovo:${password}@127.0.0.1:55486/slovo_demo\nPOSTGRES_DB=slovo_demo\nPOSTGRES_USER=slovo\nPOSTGRES_PASSWORD=${password}\nBETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\nBETTER_AUTH_URL=${process.env.SLOVO_ORIGIN??'http://localhost:4186'}\nAPP_ENV=development\nDEMO_MODE=true\nVOCAB_SOURCE_PATH=data/source/东方俄语词汇汇总_第1至6册.xlsx\nAI_PROVIDER=unconfigured\n`,{mode:0o600});
  console.log('Created private .env for an isolated local demo.');
}
config({quiet:true});
const {readRuntimeConfig}=await import('../src/lib/config.ts');
readRuntimeConfig();
if(!existsSync(process.env.VOCAB_SOURCE_PATH??'data/source/东方俄语词汇汇总_第1至6册.xlsx'))throw new Error('Workbook missing. Set VOCAB_SOURCE_PATH or copy the provided workbook into data/source.');
if(process.argv.includes('--compose-db'))run('docker',['compose','-p','slovo-demo','up','-d','--wait','db']);
const uvCandidate=process.env.SLOVO_UV??`${homedir()}/.local/bin/uv`;
const uv=spawnSync(uvCandidate,['--version'],{stdio:'ignore'}).status===0?uvCandidate:spawnSync('uv',['--version'],{stdio:'ignore'}).status===0?'uv':null;
if(uv){
  run(uv,['venv','--allow-existing','.local/content-venv']);
  run(uv,['pip','install','--python','.local/content-venv/bin/python','-r','requirements.txt']);
}else{
  if(spawnSync('python3',['-c','import ensurepip'],{stdio:'ignore'}).status!==0)throw new Error('Python ensurepip is unavailable. Install python3-venv or uv, then rerun setup. The project database is preserved.');
  run('python3',['-m','venv','.local/content-venv']);
  run('.local/content-venv/bin/python',['-m','pip','install','-r','requirements.txt']);
}
run('pnpm',['db:generate']);run('pnpm',['db:migrate']);
process.env.SLOVO_PYTHON='.local/content-venv/bin/python';
run('pnpm',['import:vocab']);
run('.local/content-venv/bin/python',['scripts/build_annotations.py']);
run('pnpm',['exec','tsx','scripts/import_annotations.ts']);
if(process.env.DEMO_MODE==='true')run('pnpm',['seed:demo']);
else console.log('Demo seed skipped: DEMO_MODE is not true.');
run('pnpm',['ocr:prepare']);
console.log('Setup complete. Run pnpm dev. Demo credentials, when seeded: .local/demo-access.md');
