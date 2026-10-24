import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const origin=process.env.SLOVO_SMOKE_URL??process.env.BETTER_AUTH_URL??'http://localhost:4186';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Demo smoke is restricted to loopback/SSH-forwarded environments.');
const configResponse=await fetch(`${origin}/api/config`);
assert.equal(configResponse.status,200);assert.equal((await configResponse.json()).demoMode,true);
const access=await readFile(process.env.SLOVO_ADMIN_ACCESS_FILE??'.local/demo-access.md','utf8');
const adminPassword=access.match(/^- admin@ruslearn\.test \/ (\S+)/m)?.[1];
if(!adminPassword)throw new Error('Private administrator access record is missing.');
const results=[];
for(const [email,password,role] of [['demo@ruslearn.test','RusDemo!2026','user'],['new@ruslearn.test','RusDemo!2026','user'],['admin@ruslearn.test',adminPassword,'admin']]){
  const login=await fetch(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(login.status,200,`Login failed for ${email}`);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);
  assert.ok(cookie.includes(`slovo-${new URL(origin).port||'app'}.session_token=`),'Cookie namespace must isolate this instance.');
  const bootstrap=await fetch(`${origin}/api/bootstrap`,{headers:{cookie}});assert.equal(bootstrap.status,200);
  const data=await bootstrap.json();assert.equal(data.user.email,email);assert.equal(data.user.role,role);
  assert.equal(data.books.length,6);assert.equal(data.books.reduce((n,book)=>n+book.lessons.length,0),69);
  const admin=await fetch(`${origin}/api/admin/issues`,{headers:{cookie}});assert.equal(admin.status,role==='admin'?200:403);
  const logout=await fetch(`${origin}/api/auth/sign-out`,{method:'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);
  results.push({email,role,loginStatus:200,books:6,lessons:69,adminStatus:admin.status,stats:data.stats});
}
const report={checkedAt:new Date().toISOString(),origin,passed:true,accounts:results};
await mkdir('artifacts/deployment',{recursive:true});await writeFile(`artifacts/deployment/smoke-${new URL(origin).port||'default'}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
