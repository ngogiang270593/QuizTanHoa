import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { questionErrors } from '../frontend/src/questionDraft.mjs';

const root=path.resolve(import.meta.dirname,'..'),filename=process.argv[2];
assert.ok(filename,'Pass the prepared question-set JSON path.');
const batch=JSON.parse(fs.readFileSync(filename,'utf8'));
assert.equal(batch.questions.length,batch.questionCount);assert.equal(batch.questionCount,30);
for(const item of batch.questions)assert.deepEqual(questionErrors(item.payload),{},`Invalid question ${item.originalNumber}`);
assert.equal(new Set(batch.questions.map(q=>q.payload.content)).size,batch.questionCount,'Duplicate content in the supplied set.');
const credential=fs.readFileSync(path.join(root,'.data/cloud/admin-login.txt'),'utf8');
const password=credential.match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password,'Admin credential missing.');
const origin='https://quiztanhoa.pages.dev';let token;
async function request(method,route,body,expected=200){
  const headers={};if(token)headers.Authorization=`Bearer ${token}`;if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(`${origin}/api${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json();assert.equal(response.status,expected,`${method} ${route}: ${data.message||response.status}`);return data;
}
function equalQuestion(actual,expected){return ['type','group','content','correctAnswer','points','isScenario','explanation'].every(key=>actual[key]===expected[key])&&JSON.stringify(actual.options)===JSON.stringify(expected.options);}
const report={site:origin,sourceFile:batch.sourceFile,sourceSha256:batch.sourceSha256,startedAtUtc:new Date().toISOString(),created:0,reused:0,questions:[]};
const reportFile=path.join(root,'.data/imports/aaa-import-report.json');
try{
  const health=await request('GET','/health');assert.equal(health.environment,'production');
  const login=await request('POST','/Auth/login',{username:'admin',password});assert.equal(login.role,'Organizer');token=login.token;
  const existing=await request('GET','/organizer/question-bank');
  // Preflight the entire batch before the first write. Never overwrite edits.
  for(const item of batch.questions){const sourceMatches=existing.filter(q=>q.source===item.payload.source);assert.ok(sourceMatches.length<=1,`Duplicate existing source for question ${item.originalNumber}`);if(sourceMatches.length)assert.ok(equalQuestion(sourceMatches[0],item.payload),`Question ${item.originalNumber} was already imported and subsequently edited; stopping without overwriting it.`);}
  if(!process.argv.includes('--write')){
    console.log(JSON.stringify({preflight:true,site:origin,existingActiveQuestions:existing.length,preparedQuestions:batch.questionCount,alreadyPresent:batch.questions.filter(item=>existing.some(q=>equalQuestion(q,item.payload))).length}));
  }else{
    // The bank sorts newest first; reverse insertion keeps source question 1 at the top.
    for(const item of [...batch.questions].reverse()){
      let record=existing.find(q=>q.source===item.payload.source)||existing.find(q=>equalQuestion(q,item.payload));
      if(record)report.reused++;
      else{record=await request('POST','/organizer/question-bank',item.payload,201);assert.ok(equalQuestion(record,item.payload));existing.push(record);report.created++;}
      report.questions.push({originalNumber:item.originalNumber,id:record.id,correctAnswer:record.correctAnswer});
      fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
      console.log(`Verified question ${item.originalNumber}: bank ID ${record.id}.`);
    }
    const persisted=await request('GET','/organizer/question-bank');
    for(const item of batch.questions){const id=report.questions.find(q=>q.originalNumber===item.originalNumber).id,record=persisted.find(q=>q.id===id);assert.ok(record&&equalQuestion(record,item.payload),`Read-back mismatch at source question ${item.originalNumber}`);}
    report.questions.sort((a,b)=>a.originalNumber-b.originalNumber);report.completedAtUtc=new Date().toISOString();report.readBackVerified=true;
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
    console.log(JSON.stringify({completed:true,created:report.created,reused:report.reused,verifiedQuestions:report.questions.length,pointsPerQuestion:batch.pointsPerQuestion,maximumScore:batch.maximumScore,report:'.data/imports/aaa-import-report.json'}));
  }
}finally{if(token)await request('POST','/Auth/logout',{});}
