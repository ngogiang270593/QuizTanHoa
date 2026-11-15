import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://quiztanhoa.pages.dev';let token;
const password=fs.readFileSync(new URL('../.data/cloud/admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);
async function call(method,path,body){const r=await fetch(origin+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`${path}: ${r.status}`);return r.status===204?null:r.json();}
try{
 assert.equal((await call('GET','/health')).environment,'production');
 const login=await call('POST','/Auth/login',{username:'admin',password});token=login.token;assert.ok(login.workflowPermissions.includes('manageUsers'));
 const processes=await call('GET','/organizer/processes');assert.equal(processes.length,3);assert.deepEqual(processes.map(p=>p.name).sort(),['Quản trị hệ thống','Biên tập – Duyệt','Thi'].sort());
 const users=await call('GET','/organizer/users');assert.ok(users.every(u=>u.processIds?.length&&u.processIds.every(id=>processes.some(p=>p.id===id))));
 assert.equal(login.accountGroup,'SystemAdmin');
 const summary=await call('GET','/organizer/system-summary');assert.equal(summary.userCount,users.length);assert.equal(summary.processCount,3);assert.ok(Array.isArray(await call('GET','/organizer/activity')));
 for(const route of ['/quan-tri','/quan-tri/nhat-ky','/ban-to-chuc','/thi-sinh'])assert.equal((await fetch(origin+route)).status,200);
 const units=await call('GET','/organizer/organization-units');assert.equal(units.length,9);
 const questions=await call('GET','/organizer/question-bank?topic='+encodeURIComponent('Nghị Quyết 57'));assert.equal(questions.length,30);
 const html=await (await fetch(origin+'/ban-to-chuc/danh-muc?tab=quy-trinh')).text();const js=html.match(/src="([^"]+\.js)"/)?.[1],css=html.match(/href="([^"]+\.css)"/)?.[1];assert.ok(js&&css);
 const bundle=await (await fetch(new URL(js,origin))).text(),styles=await (await fetch(new URL(css,origin))).text();
 for(const text of ['Quản trị hệ thống','Biên tập – Duyệt','Lọc nhóm tài khoản','Nhật ký hoạt động','/quan-tri','Ghi chú duyệt (bắt buộc)','Ghi chú trả lại (bắt buộc)','Xác nhận duyệt','Trả lại về Nháp','Công khai cuộc thi','Lưu quy trình','/organizer/processes'])assert.ok(bundle.includes(text),'Missing deployed control: '+text);
 assert.ok(styles.includes('input[type=search]')||styles.includes('input[type="search"]'));
 const report={site:origin,verified:true,defaultProcesses:processes.map(p=>p.name),assignedAccounts:users.length,questionCount:questions.length,departments:units.length,reviewNotesDeployed:true,unifiedSearchStyles:true};
 fs.mkdirSync(new URL('../.artifacts/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../.artifacts/processes-production-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(token)await call('POST','/Auth/logout',{});}
