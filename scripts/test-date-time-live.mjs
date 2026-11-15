import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=(process.argv[2]||'').replace(/\/$/,'');
assert.ok(origin.startsWith('https://'));
let token,competition;
async function call(method,route,body,status=200){
  const response=await fetch(`${origin}/api${route}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data=response.status===204?null:await response.json();assert.equal(response.status,status,`${route}: ${JSON.stringify(data)}`);return data;
}
assert.equal((await call('GET','/health')).environment,'preview');
const password=fs.readFileSync(new URL('../.data/cloud/preview-admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];
assert.ok(password);token=(await call('POST','/Auth/login',{username:'admin',password})).token;
try {
  competition=await call('POST','/organizer/competitions',{name:`Datetime QA ${Date.now()}`},201);
  const route=`/organizer/competitions/${competition.id}/schedule`;
  const input={opensAtLocal:'29/02/2028 08:00:01',startDeadlineLocal:'29/02/2028 08:00:02',closesAtLocal:'29/02/2028 08:00:03'};
  await call('PUT',route,input);
  const saved=await call('GET',route);
  for(const key of Object.keys(input))assert.equal(saved[key],input[key]);
  assert.equal(saved.opensAtUtc,'2028-02-29T01:00:01.000Z');
  await call('PUT',route,{...input,startDeadlineLocal:'29/02/2028 08:00:00'},400);
  await call('PUT',route,{...input,opensAtLocal:'30/02/2028 08:00:01'},400);
  assert.equal((await call('GET',route)).opensAtLocal,input.opensAtLocal);
  console.log('PASS Firestore second precision, Vietnam timezone, leap day, ordering and invalid-date validation.');
} finally {
  if(competition)await call('DELETE',`/organizer/competitions/${competition.id}`,undefined,204);
  if(token)await call('POST','/Auth/logout',{});
}
console.log('Temporary preview competition cleaned.');
