import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Exercise the actual setup module in Node without downloading or changing live assets.
async function scenario(body: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'slovo-ocr-assets-'));
  try {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import {readFile,writeFile,readdir} from 'node:fs/promises';
      import {createHash} from 'node:crypto';
      import {ensureVerifiedModel} from ${JSON.stringify(pathToFileURL(path.resolve('scripts/prepare_ocr.mjs')).href)};
      const directory=process.env.OCR_TEST_DIRECTORY;
      const file=directory+'/rus.traineddata.gz';
      const valid=Buffer.from('verified model fixture');
      const expectedSha256=createHash('sha256').update(valid).digest('hex');
      ${body}
      console.log('verified');
    `], { env: { ...process.env, OCR_TEST_DIRECTORY: directory }, encoding: 'utf8' });
    expect(output.trim()).toBe('verified');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('atomic checksum-verified OCR model preparation', () => {
  it('keeps a verified cached model without downloading', () => scenario(`
    await writeFile(file,valid);
    const result=await ensureVerifiedModel({file,url:'unused',expectedSha256,download:()=>{throw new Error('must not download')}});
    assert.equal(result.sha256,expectedSha256);
    assert.deepEqual(await readFile(file),valid);
  `));

  it('repairs a truncated cached file larger than the old 100KB threshold', () => scenario(`
    await writeFile(file,Buffer.alloc(200001,1));
    let downloads=0;
    await ensureVerifiedModel({file,url:'fixture',expectedSha256,download:async(url,target)=>{
      downloads++;assert.notEqual(target,file);await writeFile(target,valid);
    }});
    assert.equal(downloads,1);
    assert.deepEqual(await readFile(file),valid);
    assert.deepEqual(await readdir(directory),['rus.traineddata.gz']);
  `));

  it('cleans interrupted downloads and preserves the prior final file', () => scenario(`
    const prior=Buffer.from('previous incomplete model');await writeFile(file,prior);
    await assert.rejects(ensureVerifiedModel({file,url:'fixture',expectedSha256,download:async(url,target)=>{
      await writeFile(target,Buffer.alloc(200001,2));throw new Error('connection interrupted');
    }}),/connection interrupted/);
    assert.deepEqual(await readFile(file),prior);
    assert.deepEqual(await readdir(directory),['rus.traineddata.gz']);
  `));

  it('rejects wrong content even when a download reports success', () => scenario(`
    await assert.rejects(ensureVerifiedModel({file,url:'fixture',expectedSha256,download:async(url,target)=>{
      await writeFile(target,Buffer.alloc(200001,3));
    }}),/checksum mismatch/);
    assert.deepEqual(await readdir(directory),[]);
  `));
});
