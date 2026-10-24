import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
await mkdir('tests/fixtures',{recursive:true});
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1280,height:680},deviceScaleFactor:1});
  await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;background:white;color:black;font:64px Arial,\'PingFang SC\',sans-serif;line-height:1.8;padding:64px"><div>книга 书</div><div>мама 妈妈</div><div>город 城市</div><div>Я читаю. 我在读书。</div></body></html>');
  await page.screenshot({path:'tests/fixtures/ru-zh-sample.png'});
}finally{await browser.close()}
