import fs from 'node:fs';
import assert from 'node:assert/strict';
import {FirestoreStore} from '../worker/firestore.mjs';
const root=new URL('../',import.meta.url),file=p=>new URL(p,root);
const report=JSON.parse(fs.readFileSync(file('.data/imports/aaa-import-report.json'),'utf8'));
const prepared=JSON.parse(fs.readFileSync(file('.data/imports/aaa-30-questions.json'),'utf8'));
assert.equal(report.questions.length,30);assert.equal(prepared.questions.length,30);
const secrets=JSON.parse(fs.readFileSync(file('.data/cloud/pages-secrets.json'),'utf8'));
const db=new FirestoreStore({...secrets,FIRESTORE_NAMESPACE:'qt'});await db.begin();
try {
 const bank=await db.all('bank'),selected=report.questions.map(item=>{
  const q=bank.find(q=>q.id===item.id),expected=prepared.questions.find(q=>q.originalNumber===item.originalNumber);
  assert.ok(q?.isActive&&q.source===expected.payload.source,'Imported question identity mismatch; no data changed.');return q;
 });
 assert.equal(new Set(selected.map(q=>q.id)).size,30);
 const linked=(await db.all('questions')).filter(q=>selected.some(b=>b.id===q.bankQuestionId));
 const topics=await db.all('topics'),existing=topics.find(t=>t.name.toLocaleLowerCase('vi')==='nghị quyết 57');
 const before={savedAtUtc:new Date().toISOString(),bank:selected,linked,topic:existing||null};
 if(!process.argv.includes('--write')){console.log(JSON.stringify({preflight:true,matchedQuestions:selected.length,linkedDraftQuestions:linked.length,topic:'Nghị Quyết 57'}));}
 else {
  const backup=file('.data/imports/nghi-quyet-57-before.json');if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(before,null,2),{flag:'wx'});
  const stamp=new Date().toISOString();
  const topic=existing||{id:db.next('topics'),name:'Nghị Quyết 57',createdAtUtc:stamp,updatedAtUtc:stamp};db.put('topics',topic);
  for(const q of selected){q.topic=topic.name;q.updatedAtUtc=stamp;db.put('bank',q);}
  const exams=new Set();for(const q of linked){q.topic=topic.name;db.put('questions',q);exams.add(q.examId);}
  for(const id of exams){const e=await db.get('exams',id);e.draftRevision++;e.updatedAtUtc=stamp;db.put('exams',e);}
  await db.commit();
  const read=new FirestoreStore({...secrets,FIRESTORE_NAMESPACE:'qt'});await read.begin();
  try{for(const q of selected){const saved=await read.get('bank',q.id);assert.equal(saved.topic,topic.name);assert.equal(saved.content,q.content);assert.deepEqual(saved.options,q.options);assert.equal(saved.correctAnswer,q.correctAnswer);}await read.close();}finally{await read.close();}
  const summary={completedAtUtc:stamp,topicId:topic.id,topic:topic.name,verifiedQuestions:30,linkedDraftQuestions:linked.length};fs.writeFileSync(file('.data/imports/nghi-quyet-57-report.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }
}finally{await db.close();}
