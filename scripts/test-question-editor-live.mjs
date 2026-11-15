import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createQuestionDraft, emptyQuestion, questionPayload } from '../frontend/src/questionDraft.mjs';

const origin=(process.argv[2]||'').replace(/\/$/,'');
assert.ok(origin.startsWith('https://'),'Pass an HTTPS preview URL.');
let token;
const created=[];
async function call(method,route,body,status=200){
  const headers={};if(token)headers.Authorization=`Bearer ${token}`;if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(`${origin}/api${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=response.status===204?null:await response.json();assert.equal(response.status,status,`${method} ${route}: ${data?.message||response.status}`);return data;
}
const health=await call('GET','/health');assert.equal(health.environment,'preview','This test must not create questions in production.');
const secret=fs.readFileSync(path.resolve(import.meta.dirname,'../.data/cloud/preview-admin-login.txt'),'utf8').match(/Mật khẩu khởi tạo: (.+)/)?.[1];
token=(await call('POST','/Auth/login',{username:'admin',password:secret})).token;
const marker=`Editor ${crypto.randomBytes(5).toString('hex')}`;
try{
  const tf=await call('POST','/organizer/question-bank',questionPayload(createQuestionDraft({type:'TrueFalse',content:`${marker}: phát biểu đúng/sai.`,group:'Specialized',correctAnswer:'False',points:2.5,isScenario:true,source:'Tài liệu kiểm tra',explanation:'Giải thích đã nhập.',requiresSourceReview:true,sourceReviewed:true})),201);created.push(tf.id);
  const edited=createQuestionDraft(tf);edited.content+=' Đã chỉnh sửa.';
  const updated=await call('PUT',`/organizer/question-bank/${tf.id}`,questionPayload(edited));
  for(const key of ['type','correctAnswer','points','isScenario','group','source','explanation','requiresSourceReview','sourceReviewed'])assert.deepEqual(updated[key],tf[key],key);
  assert.equal(updated.options.length,2);
  console.log('PASS True/False edit preserves answer, points, scenario and source data in Firestore.');
  const six=await call('POST','/organizer/question-bank',questionPayload(createQuestionDraft({...emptyQuestion(),content:`${marker}: sáu phương án.`,options:['A','B','C','D','E','F'].map(key=>({key,text:`Phương án ${key}`})),correctAnswer:'F'})),201);created.push(six.id);
  const sixEdited=createQuestionDraft(six);sixEdited.options[0].text='Phương án A đã sửa';
  const sixSaved=await call('PUT',`/organizer/question-bank/${six.id}`,questionPayload(sixEdited));assert.equal(sixSaved.options.length,6);assert.equal(sixSaved.correctAnswer,'F');
  const partial=await call('POST','/organizer/question-bank',questionPayload(createQuestionDraft({...emptyQuestion(),content:`${marker}: đang soạn.`})),201);created.push(partial.id);assert.equal(partial.correctAnswer,null);
  const found=await call('GET',`/organizer/question-bank?search=${encodeURIComponent(marker)}&group=Specialized`);assert.ok(found.some(q=>q.id===tf.id));assert.ok(!found.some(q=>q.id===six.id));
  console.log('PASS six-option answers, draft saves and group/search filtering on the preview API.');
}finally{
  for(const id of created)await call('DELETE',`/organizer/question-bank/${id}`,undefined,204);
  if(token)await call('POST','/Auth/logout',{});
}
console.log('Question editor data checks passed. Temporary preview questions were removed.');
