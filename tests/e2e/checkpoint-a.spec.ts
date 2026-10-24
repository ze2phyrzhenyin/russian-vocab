import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
test('A: real login, textbook selection, mistakes, persisted progress and mobile layouts',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await mkdir('artifacts/screenshots',{recursive:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');await page.getByRole('button',{name:'一键体验',exact:true}).click();
  await expect(page.getByRole('heading',{name:'今天，让几个词更熟悉。'})).toBeVisible();
  await page.screenshot({path:'artifacts/screenshots/A-today-390.png',fullPage:true});
  const statsBefore=await page.evaluate(async()=>{const r=await fetch('/api/bootstrap');return (await r.json()).stats.today as number});
  await page.getByRole('button',{name:'教材',exact:true}).click();
  await expect(page.getByRole('tab',{name:/东方俄语 06/})).toBeVisible();
  await expect(page.getByRole('button',{name:/第 1 课/}).first()).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'开始学习',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停学习，保存位置'})).toBeVisible();
  for(let step=0;step<8;step++){
    const reveal=page.getByRole('button',{name:'查看答案',exact:true});
    if(await reveal.isVisible()){
      await reveal.click();await page.getByRole('button',{name:step===0?'忘记了':'记住了',exact:true}).click();
    }else{
      const expected=await page.evaluate(async()=>{
        const request=indexedDB.open('slovo-offline-v1');
        const database=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        const read=database.transaction('sessions','readonly').objectStore('sessions').getAll();
        const rows=await new Promise<{value:{cursor:number;queue:{question:{correctOptionId:string;options:{id:string;text:string}[]}}[]}}[]>((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error)});database.close();
        const current=rows[0].value;const q=current.queue[current.cursor].question;return q.options.find(option=>option.id!==q.correctOptionId)!.text;
      });
      await page.locator('.answer-option').filter({hasText:expected}).click();
    }
    if(step===0){await expect(page.getByText('再认识它一次',{exact:true})).toBeVisible();await page.screenshot({path:'artifacts/screenshots/A-wrong-feedback-390.png',fullPage:true})}
    await page.getByRole('button',{name:'保存并继续',exact:true}).click();
    await expect(page.getByRole('button',{name:'保存并继续',exact:true})).toBeHidden();
  }
  await page.getByRole('button',{name:'暂停学习，保存位置'}).click();
  await expect.poll(()=>page.evaluate(async()=>{const r=await fetch('/api/bootstrap');return (await r.json()).stats.today as number})).toBeGreaterThanOrEqual(statsBefore+8);
  await page.reload();await expect(page.getByRole('button',{name:'继续上次学习',exact:true})).toBeVisible();
  for(const width of [360,390,430]){
    await page.setViewportSize({width,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/screenshots/A-today-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:960});await page.screenshot({path:'artifacts/screenshots/A-today-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  await page.getByRole('button',{name:'一键体验',exact:true}).click();
  await expect(page.getByRole('button',{name:'继续上次学习',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
