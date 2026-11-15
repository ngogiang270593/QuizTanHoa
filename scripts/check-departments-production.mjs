import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://quiztanhoa.pages.dev';let token;
const local=JSON.parse(fs.readFileSync(new URL('../.data/imports/organization-units-local.json',import.meta.url),'utf8')).units;
const password=fs.readFileSync(new URL('../.data/cloud/admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);
async function call(method,path,body){const r=await fetch(origin+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`${path}: HTTP ${r.status}`);return r.status===204?null:r.json();}
try{
 assert.equal((await call('GET','/health')).environment,'production');token=(await call('POST','/Auth/login',{username:'admin',password})).token;
 const units=await call('GET','/organizer/organization-units');
 for(const expected of local){const match=units.filter(u=>u.code===expected.code);assert.equal(match.length,1);assert.equal(match[0].name,expected.name);assert.equal(match[0].sortOrder,expected.sortOrder);assert.ok(Number.isInteger(match[0].userCount));}
 const response=await fetch(origin+'/ban-to-chuc/danh-muc?tab=phong-ban');assert.equal(response.status,200);const html=await response.text(),asset=html.match(/src="([^"]+\.js)"/)?.[1];assert.ok(asset);
 const bundle=await (await fetch(new URL(asset,origin))).text();assert.ok(bundle.includes('Thêm phòng ban')&&bundle.includes('Lưu phòng ban')&&bundle.includes('Chưa phân phòng ban')&&bundle.includes('phong-ban'));
 const summary={site:origin,verifiedLocalDepartments:local.length,catalogTabsDeployed:true,departmentCRUDDeployed:true,accountDepartmentSelectorDeployed:true};fs.writeFileSync(new URL('../.artifacts/departments-production-verification.json',import.meta.url),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{if(token)await call('POST','/Auth/logout',{});}
