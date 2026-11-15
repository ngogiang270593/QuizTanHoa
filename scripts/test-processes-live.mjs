import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://verify.quiztanhoa.pages.dev';let token,account,process;
const password=fs.readFileSync(new URL('../.data/cloud/preview-admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);
async function call(method,path,body,auth=token,status=200){const r=await fetch(origin+'/api'+path,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=r.status===204?null:await r.json();assert.equal(r.status,status,`${method} ${path}: ${data?.message||r.status}`);return data;}
assert.equal((await call('GET','/health')).environment,'preview');
token=(await call('POST','/Auth/login',{username:'admin',password},null)).token;
const catalog=await call('GET','/organizer/processes'),candidate=catalog.find(p=>p.code==='CANDIDATE');
assert.equal(catalog.length,3);assert.ok(catalog.some(p=>p.name==='Biên tập – Duyệt'));assert.equal(candidate.name,'Thi');
try{
 const marker=Date.now().toString(36);
 process=await call('POST','/organizer/processes',{name:'KIỂM THỬ QUY TRÌNH '+marker,role:'Organizer',steps:['draft','submit']},token,201);
 account=await call('POST','/organizer/users',{username:'proc'+marker,fullName:'MINH HỌA KIỂM THỬ QUY TRÌNH',role:'Organizer',processIds:[process.id]},token,201);
 const login=await call('POST','/Auth/login',{username:account.username,password:'123456'},null);assert.deepEqual(login.workflowPermissions,['draft','submit']);
 await call('DELETE',`/organizer/processes/${process.id}`,undefined,token,409);
 await call('POST','/organizer/processes',{name:'Không được phép',role:'Organizer',steps:['manageUsers']},login.token,403);
 await call('PUT',`/organizer/users/${account.id}/access`,{role:'Organizer',processIds:[process.id,candidate.id]},token,400);
 await call('PUT',`/organizer/processes/${process.id}`,{name:process.name,role:'Organizer',steps:['submit','draft','approve']});
 await call('GET','/Auth/me',undefined,login.token,401);
 const refreshed=await call('POST','/Auth/login',{username:account.username,password:'123456'},null);assert.deepEqual(refreshed.workflowPermissions,['submit','draft','approve']);
 await call('POST','/Auth/logout',{},refreshed.token);
 console.log(JSON.stringify({preview:true,defaultProcesses:3,orderedPermissions:true,assignment:true,apiGuards:true,sessionRevocation:true}));
}finally{
 if(account){await call('PUT',`/organizer/users/${account.id}/access`,{role:'Candidate',processIds:[candidate.id]});await call('DELETE',`/organizer/users/${account.id}`,undefined,token,204);}
 if(process)await call('DELETE',`/organizer/processes/${process.id}`,undefined,token,204);
 await call('POST','/Auth/logout',{});
}
