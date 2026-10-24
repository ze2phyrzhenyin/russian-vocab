import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const skipBuild=process.argv.includes('--skip-build');
const python=process.env.SLOVO_PYTHON??'.local/content-venv/bin/python';
if(!existsSync(python)||!existsSync('data/processed/annotations.json'))throw new Error('Run pnpm run setup first. Verification requires the real private input and content environment.');
const checks=[['environment','node',['scripts/check_environment.mjs']],['lint','pnpm',['lint']],['typecheck','pnpm',['typecheck']],['domain-database','pnpm',['test']],['importer',python,['-m','unittest','discover','-s','tests/importer','-v']],['content',python,['-m','unittest','discover','-s','tests/content','-v']],['coverage','pnpm',['content:report']],...skipBuild?[]:[['build','pnpm',['build']]]];
const report={startedAt:new Date().toISOString(),node:process.version,platform:process.platform,buildSkipped:skipBuild,browserTests:'Run pnpm test:e2e against a running build separately.',checks:[]};
await mkdir('artifacts/verification',{recursive:true});
for(const [name,command,args] of checks){
  console.log(`\n[verify] ${name}`);const started=Date.now();
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:20*1024*1024});
  const output=(result.stdout??'')+(result.stderr??'');process.stdout.write(output);
  await writeFile(`artifacts/verification/${name}.log`,output);
  report.checks.push({name,exitCode:result.status,durationMs:Date.now()-started});
  await writeFile('artifacts/verification/latest.json',JSON.stringify(report,null,2));
  if(result.status!==0){process.exitCode=1;break}
}
