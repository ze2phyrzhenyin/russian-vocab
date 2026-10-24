import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {config} from 'dotenv';
config({quiet:true});
const check=(command,args)=>{const result=spawnSync(command,args,{encoding:'utf8'});return{available:result.status===0,version:result.status===0?result.stdout.trim().split('\n')[0]:null}};
const report={node:process.version,nodeCompatible:Number(process.versions.node.split('.')[0])===24,pnpm:check('pnpm',['--version']),python:check('python3',['--version']),pythonEnvironment:existsSync('.local/content-venv/bin/python'),uv:check(existsSync(`${homedir()}/.local/bin/uv`)?`${homedir()}/.local/bin/uv`:'uv',['--version']),docker:check('docker',['--version']),compose:check('docker',['compose','version']),sourceWorkbook:existsSync(process.env.VOCAB_SOURCE_PATH??'data/source/东方俄语词汇汇总_第1至6册.xlsx'),configured:!!process.env.DATABASE_URL&&!!process.env.BETTER_AUTH_SECRET,ocrModels:['rus','chi_sim'].every(lang=>existsSync(`public/ocr/lang/${lang}.traineddata.gz`))};
console.log(JSON.stringify(report,null,2));
if(!report.nodeCompatible||!report.pnpm.available||!report.python.available)process.exitCode=1;
