import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://quiztanhoa.pages.dev';
const loginText=fs.readFileSync(new URL('../.data/cloud/admin-login.txt',import.meta.url),'utf8');
const password=loginText.match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);let token;
async function call(method,path,body){const r=await fetch(origin+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`${path}: HTTP ${r.status}`);return r.status===204?null:r.json();}
try{
 assert.equal((await call('GET','/health')).environment,'production');
 token=(await call('POST','/Auth/login',{username:'admin',password})).token;
 const topics=await call('GET','/organizer/topics');const topic=topics.find(t=>t.name==='Nghị Quyết 57');assert.ok(topic);assert.equal(topic.questionCount,30);
 const bank=await call('GET','/organizer/question-bank?topic='+encodeURIComponent(topic.name));assert.equal(bank.length,30);assert.ok(bank.every(q=>q.topic===topic.name));
 const imported=JSON.parse(fs.readFileSync(new URL('../.data/imports/aaa-import-report.json',import.meta.url),'utf8'));assert.deepEqual(bank.map(q=>q.id).sort((a,b)=>a-b),imported.questions.map(q=>q.id).sort((a,b)=>a-b));
 const html=await (await fetch(origin+'/ban-to-chuc/danh-muc')).text();const js=html.match(/src="([^"]+\.js)"/);assert.ok(js);const bundle=await (await fetch(new URL(js[1],origin))).text();assert.ok(bundle.includes('topic-catalog-panel'));assert.ok(bundle.includes('Áp dụng chủ đề'));
 console.log(JSON.stringify({site:origin,topic:topic.name,verifiedQuestions:bank.length,catalogMenuDeployed:true,bulkTopicActionDeployed:true}));
}finally{if(token)await call('POST','/Auth/logout',{});}
