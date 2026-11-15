import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const origin=(process.argv[2]||'').replace(/\/$/,'');assert.ok(origin.startsWith('https://'));let admin;
const users=[],units=[];
const password=fs.readFileSync(new URL('../.data/cloud/preview-admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);
async function call(method,path,body,token=admin,status=200){const r=await fetch(origin+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=r.status===204?null:await r.json();assert.equal(r.status,status,`${method} ${path}: HTTP ${r.status}, ${data?.message||''}`);return data;}
assert.equal((await call('GET','/health')).environment,'preview','Department QA must run only in preview.');
admin=(await call('POST','/Auth/login',{username:'admin',password},null)).token;
const marker='dept'+crypto.randomBytes(5).toString('hex'),base='/organizer/organization-units';
try{
 const unit=await call('POST',base,{code:marker+'_A',name:'Phòng kiểm thử '+marker,sortOrder:100},admin,201);units.push(unit.id);
 const other=await call('POST',base,{code:marker+'_B',name:'Phòng nhận '+marker,sortOrder:101},admin,201);units.push(other.id);
 await call('POST',base,{code:unit.code,name:'Trùng mã '+marker},admin,409);
 const reader=await call('POST','/organizer/users',{username:marker+'reader',fullName:'KIỂM THỬ DANH MỤC',role:'Organizer',workflowPermissions:['draft']},admin,201);users.push(reader.id);
 const readToken=(await call('POST','/Auth/login',{username:reader.username,password:'123456'},null)).token;
 await call('POST',base,{code:marker+'_NO',name:'Không được'},readToken,403);
 assert.ok((await call('GET',base,undefined,readToken)).some(u=>u.id===unit.id));
 const account=await call('POST','/organizer/users',{username:marker+'user',fullName:'KIỂM THỬ TÀI KHOẢN PHÒNG',departmentId:unit.id,department:'Không dùng tên này'},admin,201);users.push(account.id);assert.equal(account.department,unit.name);
 await call('DELETE',`${base}/${unit.id}`,undefined,admin,409);
 const renamed='Phòng đã đổi '+marker;
 const changed=await call('PUT',`${base}/${unit.id}`,{code:unit.code,name:renamed,sortOrder:102});assert.equal(changed.updatedUserCount,1);
 assert.equal((await call('GET',`/organizer/users/${account.id}`)).department,renamed);
 await call('PUT',`/organizer/users/${account.id}`,{fullName:account.fullName,departmentId:unit.id,department:unit.name,isActive:false});
 assert.equal((await call('GET',`/organizer/users/${account.id}`)).department,renamed);
 await call('DELETE',`${base}/${unit.id}`,undefined,admin,409);
 await call('PUT',`/organizer/users/${account.id}`,{fullName:account.fullName,departmentId:other.id,isActive:false});
 await call('DELETE',`${base}/${unit.id}`,undefined,admin,204);
 const report={origin,verified:true,departmentCRUD:true,accountRenameSynchronized:true,usedDepartmentDeleteBlocked:true,permissionsEnforced:true};fs.writeFileSync(new URL('../.artifacts/departments-preview-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 for(const id of users.reverse()){
  await call('PUT',`/organizer/users/${id}/access`,{role:'Candidate',workflowPermissions:[]}).catch(()=>{});
  await call('DELETE',`/organizer/users/${id}`,undefined,admin,204).catch(()=>{});
 }
 for(const id of units)await call('DELETE',`${base}/${id}`,undefined,admin,204).catch(()=>{});
 if(admin)await call('POST','/Auth/logout',{}).catch(()=>{});
}
