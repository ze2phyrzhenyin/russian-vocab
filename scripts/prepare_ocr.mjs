import {createRequire} from 'node:module';
import {mkdir,copyFile,readdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const revision='806cd9adc8c6e8abc11c782db1818c990576bebc';
// Verified against the pinned upstream revision and actual working model files.
const expectedHashes={rus:'63a48ae166be2bb9862839b6f75e11afbac5e3be5bd5fa9a155ea43d5cdf9575',chi_sim:'59388039851e4d1293d729c183fd8c1fa9bbbb959eed996e945024671e68c1d6'};
async function digest(file){
  const bytes=await readFile(file);
  return {sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
function downloadFile(url,file){execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','120',url,'--output',file],{stdio:'inherit'});}
export async function ensureVerifiedModel({file,url,expectedSha256,download=downloadFile}){
  try{const current=await digest(file);if(current.sha256===expectedSha256)return current;}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.${randomUUID()}.tmp`;
  try{
    await download(url,temporary);
    const checked=await digest(temporary);
    if(checked.sha256!==expectedSha256)throw new Error(`OCR model checksum mismatch: ${path.basename(file)}. Incomplete model was not installed.`);
    await rename(temporary,file);
    return checked;
  }finally{await rm(temporary,{force:true});}
}
export async function prepareOcr(){
  const require=createRequire(import.meta.url);
  const workerRoot=path.dirname(require.resolve('tesseract.js/package.json'));
  const tesseractRequire=createRequire(path.join(workerRoot,'package.json'));
  const coreRoot=path.dirname(tesseractRequire.resolve('tesseract.js-core/package.json'));
  await mkdir('public/ocr/core',{recursive:true});await mkdir('public/ocr/lang',{recursive:true});
  await copyFile(path.join(workerRoot,'dist/worker.min.js'),'public/ocr/worker.min.js');
  for(const name of await readdir(coreRoot))if(/\.wasm(?:\.js)?$/.test(name))await copyFile(path.join(coreRoot,name),path.join('public/ocr/core',name));
  const files=[];
  for(const language of ['rus','chi_sim']){
    const file=`public/ocr/lang/${language}.traineddata.gz`;
    const url=`https://raw.githubusercontent.com/naptha/tessdata/${revision}/4.0.0/${language}.traineddata.gz`;
    const checked=await ensureVerifiedModel({file,url,expectedSha256:expectedHashes[language]});
    files.push({language,file,source:url,...checked});
  }
  await mkdir('artifacts/ocr',{recursive:true});
  await writeFile('artifacts/ocr/assets.json',JSON.stringify({workerVersion:require('tesseract.js/package.json').version,coreVersion:tesseractRequire('tesseract.js-core/package.json').version,files},null,2));
  console.log('Local OCR worker, WASM and Russian/Chinese models ready. See artifacts/ocr/assets.json.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await prepareOcr();
