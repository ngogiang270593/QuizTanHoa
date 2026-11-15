import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const origin='https://quiztanhoa.pages.dev',checks=[];
for(const route of ['/','/dang-nhap','/ban-to-chuc','/thi-sinh/cuoc-thi']) {
  const response=await fetch(`${origin}${route}`,{signal:AbortSignal.timeout(20000)}),html=await response.text();
  assert.equal(response.status,200,route);assert.ok(response.headers.get('Content-Type')?.includes('text/html'),route);assert.ok(html.includes('id="root"'),route);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.ok(!html.includes('BEGIN PRIVATE KEY'));checks.push({route,status:response.status});
}
const healthResponse=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(20000)}),health=await healthResponse.json();
assert.equal(healthResponse.status,200);assert.equal(health.status,'ok');assert.equal(health.storage,'Firestore');assert.equal(health.environment,'production');
const forbidden=await fetch(`${origin}/api/organizer/users`,{signal:AbortSignal.timeout(20000)});assert.equal(forbidden.status,401);
console.log('PASS production URL, SPA routes, security headers, Firestore health and anonymous API rejection.');
const file=path.resolve(import.meta.dirname,'../.data/cloud/admin-login.txt'),password=fs.readFileSync(file,'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];
assert.ok(password,'Initial admin credential missing.');
const loginResponse=await fetch(`${origin}/api/Auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password}),signal:AbortSignal.timeout(20000)});
assert.equal(loginResponse.status,200);const login=await loginResponse.json();assert.equal(login.role,'Organizer');assert.equal(login.mustChangePassword,false);
const headers={Authorization:`Bearer ${login.token}`};
const me=await fetch(`${origin}/api/Auth/me`,{headers,signal:AbortSignal.timeout(20000)});assert.equal(me.status,200);assert.equal((await me.json()).username,'admin');
const overview=await fetch(`${origin}/api/organizer/overview`,{headers,signal:AbortSignal.timeout(20000)});assert.equal(overview.status,200);
const logout=await fetch(`${origin}/api/Auth/logout`,{method:'POST',headers,signal:AbortSignal.timeout(20000)});assert.equal(logout.status,200);
const revoked=await fetch(`${origin}/api/Auth/me`,{headers,signal:AbortSignal.timeout(20000)});assert.equal(revoked.status,401);
console.log('PASS production admin login without mandatory password change, authorized overview and server-side logout. Password was not changed or printed.');
const dir=path.resolve(import.meta.dirname,'../.artifacts');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'cloud-production-check.json'),JSON.stringify({url:origin,checkedAtUtc:new Date().toISOString(),health,staticRoutes:checks,adminLogin:true,forcedPasswordChange:false,overviewAccess:true,logoutRevocation:true},null,2));
