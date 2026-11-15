import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const origin=(process.argv[2]||'').replace(/\/$/,'');
assert.ok(origin.startsWith('https://'));
let token,competition;
const bank=[];
async function call(method,route,body,status=200){
  const headers={};if(token)headers.Authorization=`Bearer ${token}`;if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(`${origin}/api${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=response.status===204?null:await response.json();
  assert.equal(response.status,status,`${method} ${route}: ${JSON.stringify(data)}`);return data;
}
assert.equal((await call('GET','/health')).environment,'preview','Mutating QA must run only in preview.');
const password=fs.readFileSync(new URL('../.data/cloud/preview-admin-login.txt',import.meta.url),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];
assert.ok(password);token=(await call('POST','/Auth/login',{username:'admin',password})).token;
const marker=`Selection ${crypto.randomBytes(5).toString('hex')}`;
try {
  for(const group of ['Common','Specialized','Common']) bank.push(await call('POST','/organizer/question-bank',{type:'SingleChoice',group,content:marker,options:[{key:'A',text:'Yes'},{key:'B',text:'No'}],correctAnswer:'A',points:1,isScenario:false},201));
  const before=await call('GET','/organizer/competitions');
  await call('POST','/organizer/competitions',{name:marker,initialExam:{questionIds:[bank[0].id,99999999]}},400);
  assert.equal((await call('GET','/organizer/competitions')).length,before.length);
  competition=await call('POST','/organizer/competitions',{name:marker,initialExam:{name:'Selected exam',durationMinutes:30,questionIds:[bank[1].id,bank[0].id]}},201);
  const ep=`/organizer/competitions/${competition.id}/exams/${competition.initialExamId}`;
  const questions=await call('GET',`${ep}/questions`);assert.deepEqual(questions.map(q=>q.bankQuestionId),[bank[1].id,bank[0].id]);
  let exam=await call('GET',ep);assert.equal(exam.targetQuestionCount,2);assert.equal(exam.commonQuestionCount,1);assert.equal(exam.specializedQuestionCount,1);
  const version=await call('POST',`${ep}/approve`,{});
  const added=await call('POST',`${ep}/questions/from-bank`,{questionIds:[bank[0].id,bank[2].id],syncCounts:true});assert.equal(added.length,1);
  assert.deepEqual(await call('POST',`${ep}/questions/from-bank`,{questionIds:[bank[0].id,bank[2].id],syncCounts:true}),[]);
  await call('POST',`${ep}/questions/remove-many`,{questionIds:[questions[0].id,99999999],syncCounts:true},404);
  assert.equal((await call('GET',`${ep}/questions`)).length,3);
  await call('POST',`${ep}/questions/remove-many`,{questionIds:[questions[0].id,added[0].id],syncCounts:true});
  exam=await call('GET',ep);assert.equal(exam.targetQuestionCount,1);assert.equal(exam.specializedQuestionCount,0);assert.equal(exam.isApproved,false);
  const savedVersion=await call('GET',`${ep}/versions/${version.id}`);assert.equal(savedVersion.hashSha256,version.hashSha256);assert.equal(savedVersion.snapshot.questions.length,2);
  console.log('PASS Firestore atomic create, ordered selection, duplicate prevention, scoped bulk removal, count sync and immutable approved versions.');
}finally{
  if(competition)await call('DELETE',`/organizer/competitions/${competition.id}`,undefined,204);
  for(const q of bank)await call('DELETE',`/organizer/question-bank/${q.id}`,undefined,204);
  if(token)await call('POST','/Auth/logout',{});
}
console.log('Preview QA data cleaned. Production data unchanged.');
