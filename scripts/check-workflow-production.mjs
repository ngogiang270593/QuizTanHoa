import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://quiztanhoa.pages.dev';
const password=fs.readFileSync(new URL('../.data/cloud/admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);let token;
async function call(method,path,body){const r=await fetch(origin+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`${path}: HTTP ${r.status}`);return r.status===204?null:r.json();}
try {
 assert.equal((await call('GET','/health')).environment,'production');
 const login=await call('POST','/Auth/login',{username:'admin',password});token=login.token;assert.ok(login.workflowPermissions.includes('manageUsers'));assert.ok(login.workflowPermissions.includes('approve'));
 const queue=await call('GET','/organizer/review-queue');assert.ok(Array.isArray(queue));
 const desk=await call('GET','/organizer/workflows');assert.ok(desk.editorial&&desk.review&&Array.isArray(desk.operations)&&Array.isArray(desk.approvedExams));assert.ok(desk.editorial.questionCount>=30);assert.ok(!JSON.stringify(desk).includes('correctAnswer'));
 const users=await call('GET','/organizer/users');assert.ok(users.every(u=>Array.isArray(u.workflowPermissions)));
 const bank=await call('GET','/organizer/question-bank?topic='+encodeURIComponent('Nghị Quyết 57'));assert.equal(bank.length,30);
 const html=await (await fetch(origin+'/ban-to-chuc/cho-duyet')).text(),path=html.match(/src="([^"]+\.js)"/)?.[1];assert.ok(path);
 const bundle=await (await fetch(new URL(path,origin))).text();assert.ok(bundle.includes('submit-review')&&bundle.includes('Gửi chờ duyệt')&&bundle.includes('Lưu phân quyền')&&bundle.includes('Bàn biên tập')&&bundle.includes('Điều hành cuộc thi')&&bundle.includes('/thi-sinh/ket-qua'));
 for(const route of ['/ban-to-chuc/bien-tap','/ban-to-chuc/duyet-thi','/ban-to-chuc/to-chuc-thi','/ban-to-chuc/de-da-duyet','/ban-to-chuc/ket-qua','/thi-sinh/lich-thi','/thi-sinh/ket-qua']){const response=await fetch(origin+route);assert.equal(response.status,200);assert.ok((await response.text()).includes(path));}
 const summary={site:origin,deployed:true,currentAdminPreserved:true,permissionProfilesExposed:true,reviewQueueAvailable:true,questionBankPreserved:bank.length,workflowControlsDeployed:true,twoOrganizerProcesses:true,candidatePortalDeployed:true};fs.writeFileSync(new URL('../.artifacts/workflow-production-verification.json',import.meta.url),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{if(token)await call('POST','/Auth/logout',{});}
