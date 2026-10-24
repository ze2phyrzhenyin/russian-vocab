import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const repos=['ankitects/anki','open-spaced-repetition/ts-fsrs','kirill-markin/flashcards-open-source-app','LuteOrg/lute-v3','no-plagiarism/pymorphy3','tatuylonen/wiktextract','naptha/tesseract.js','PaddlePaddle/PaddleOCR'];
await mkdir('artifacts/research/sources',{recursive:true});
const rows=[];
for(const repo of repos){
  try{
    const commit=execFileSync('git',['ls-remote',`https://github.com/${repo}.git`,'HEAD'],{encoding:'utf8',timeout:30000}).split(/\s/)[0];
    const name=repo.replace('/','--');
    let licensePath=null;
    for(const candidate of ['LICENSE','LICENSE.md','LICENSE.txt']){try{const license=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30',`https://raw.githubusercontent.com/${repo}/${commit}/${candidate}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']});licensePath=`artifacts/research/sources/${name}-LICENSE`;await writeFile(licensePath,license);break}catch{}}
    rows.push({repo,commit,licensePath,checkedAt:new Date().toISOString()});
  }catch(error){rows.push({repo,error:error.message,checkedAt:new Date().toISOString()})}
}
await writeFile('artifacts/research/repositories.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
