import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../index.mjs';
import {FirestoreStore,ConflictError,encodeValue,decodeValue} from '../firestore.mjs';
import {passwordHash} from '../auth.mjs';
import {assignRanks,proposal,scoreAttempt} from '../results.mjs';
import {workbookBytes,importPreview,questionHeaders} from '../xlsx.mjs';

class MemoryStore extends FirestoreStore {
  constructor(shared){super({});this.shared=shared;}
  async begin(){this.records=structuredClone(this.shared.records);this.version=this.shared.revision;this.metadata=structuredClone(this.shared.metadata);}
  async get(table,id){const p=this.path(table,id);return this.writes.has(p)?this.writes.get(p):this.records.get(p)||null;}
  async all(table,field,value){const paths=new Set([...this.records.keys(),...this.writes.keys()]);return [...paths].filter(p=>p.startsWith(`qt_${table}/`)).map(p=>this.writes.has(p)?this.writes.get(p):this.records.get(p)).filter(r=>r&&(!field||r[field]===value));}
  async commit(){if(!this.writes.size)return;if(this.version!==this.shared.revision)throw new ConflictError();for(const [p,v]of this.writes)if(v)this.shared.records.set(p,structuredClone(v));else this.shared.records.delete(p);this.shared.metadata=structuredClone(this.metadata);this.shared.revision++;}
}
const pepper='test-pepper-with-at-least-thirty-two-random-bytes';
const initial='Initial_Admin_Password_123!';
const candidatePassword='Candidate_Strong_Password_123!';

test('schedule saves and reloads Vietnamese date strings with second precision',async()=>{
  const {call,ok,admin}=await fixture();
  const c=await ok('POST','/organizer/competitions',{name:'Second precision'}),route=`/organizer/competitions/${c.id}/schedule`;
  const input={opensAtLocal:'10/01/2030 08:00:01',startDeadlineLocal:'10/01/2030 08:00:02',closesAtLocal:'10/01/2030 08:00:03'};
  await ok('PUT',route,input);
  const saved=await ok('GET',route);
  for(const key of Object.keys(input))assert.equal(saved[key],input[key]);
  assert.equal(saved.opensAtUtc,'2030-01-10T01:00:01.000Z');
  assert.equal((await call('PUT',route,{...input,startDeadlineLocal:'10/01/2030 08:00:00'},admin)).status,400);
  assert.equal((await ok('GET',route)).startDeadlineLocal,input.startDeadlineLocal);
});

test('multi-select creates drafts atomically, skips duplicates and removes only scoped draft questions',async()=>{
  const {state,call,ok,admin,newCandidate}=await fixture();
  const payload={type:'SingleChoice',group:'Common',content:'Library question',options:[{key:'A',text:'Yes'},{key:'B',text:'No'}],correctAnswer:'A',points:1,isScenario:false};
  const a=await ok('POST','/organizer/question-bank',payload), b=await ok('POST','/organizer/question-bank',{...payload,group:'Specialized'}), c=await ok('POST','/organizer/question-bank',payload);
  assert.equal((await call('POST','/organizer/competitions',{name:'Invalid',initialExam:{questionIds:[a.id,9999]}},admin)).status,400);
  assert.equal((await ok('GET','/organizer/competitions')).length,0);
  const competition=await ok('POST','/organizer/competitions',{name:'Selected questions',initialExam:{name:'Exam',durationMinutes:30,questionIds:[b.id,a.id]}});
  const ep=`/organizer/competitions/${competition.id}/exams/${competition.initialExamId}`;
  let exam=await ok('GET',ep),questions=await ok('GET',`${ep}/questions`);
  assert.equal(competition.status,'Draft'); assert.equal(exam.currentApprovedVersionId,null);
  assert.deepEqual(questions.map(q=>q.bankQuestionId),[b.id,a.id]);
  assert.equal(exam.targetQuestionCount,2);assert.equal(exam.commonQuestionCount,1);assert.equal(exam.specializedQuestionCount,1);
  await ok('POST',`${ep}/submit-review`,{});
  const version=await ok('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'});
  const added=await ok('POST',`${ep}/questions/from-bank`,{questionIds:[a.id,c.id],syncCounts:true});assert.equal(added.length,1);
  exam=await ok('GET',ep);assert.equal(exam.targetQuestionCount,3);assert.equal(exam.commonQuestionCount,2);assert.equal(exam.isApproved,false);
  const revision=exam.draftRevision;
  assert.deepEqual(await ok('POST',`${ep}/questions/from-bank`,{questionIds:[a.id,c.id],syncCounts:true}),[]);
  assert.equal((await ok('GET',ep)).draftRevision,revision);
  assert.equal((await call('POST',`${ep}/questions/remove-many`,{questionIds:[questions[0].id,9999],syncCounts:true},admin)).status,404);
  assert.equal((await ok('GET',`${ep}/questions`)).length,3);
  await ok('POST',`${ep}/questions/remove-many`,{questionIds:[questions[0].id,added[0].id],syncCounts:true});
  exam=await ok('GET',ep);assert.equal(exam.targetQuestionCount,1);assert.equal(exam.specializedQuestionCount,0);
  assert.equal((await ok('GET','/organizer/question-bank')).length,3);
  assert.equal(state.records.get(`qt_versions/${version.id}`).hashSha256,version.hashSha256);
  assert.equal((await ok('GET',`${ep}/versions/${version.id}`)).snapshot.questions.length,2);
  const candidate=await newCandidate('selection.candidate');
  assert.equal((await call('POST',`${ep}/questions/remove-many`,{questionIds:[questions[1].id]},candidate.token)).status,403);
  await ok('POST',`${ep}/questions/remove-many`,{questionIds:[questions[1].id],syncCounts:true});
  assert.equal((await ok('GET',`${ep}/questions`)).length,0);
  assert.equal((await ok('GET',ep)).targetQuestionCount,1);
});

async function fixture(){
  const state={records:new Map(),revision:0,metadata:{counters:{users:1}}};
  state.records.set('qt_users/1',{id:1,username:'admin',fullName:'Admin',department:'BTC',role:'Organizer',isActive:true,isDemo:false,mustChangePassword:false,password:await passwordHash(initial,pepper)});
  async function call(method,path,body,token,tab='tab-integration-01',extraHeaders={}) {
    const headers={...extraHeaders};if(token)headers.Authorization=`Bearer ${token}`;if(tab)headers['X-Quiz-Attempt-Tab']=tab;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await handleApi(new Request(`https://quiztanhoa.pages.dev/api${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{PASSWORD_PEPPER:pepper},()=>new MemoryStore(state));
    const type=response.headers.get('Content-Type')||'';
    const data=response.status===204?null:type.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer());
    return {status:response.status,data,headers:response.headers};
  }
  const admin=(await call('POST','/Auth/login',{username:'ADMIN',password:initial})).data.token;
  const ok=async(method,path,body,token=admin,tab)=>{const r=await call(method,path,body,token,tab);assert.ok(r.status>=200&&r.status<300,`${method} ${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;};
  const newCandidate=async username=>{const u=await ok('POST','/organizer/users',{username,fullName:username,department:'Phòng Kinh tế'});let login=await ok('POST','/Auth/login',{username,password:'123456'},null);assert.equal(login.mustChangePassword,false);assert.equal((await call('GET','/candidate/overview',undefined,login.token)).status,200);await ok('POST','/Auth/change-password',{currentPassword:'123456',newPassword:candidatePassword,confirmPassword:candidatePassword},login.token);assert.equal((await call('GET','/Auth/me',undefined,login.token)).status,401);login=await ok('POST','/Auth/login',{username,password:candidatePassword},null);return {...u,token:login.token};};
  return {state,call,ok,admin,newCandidate};
}

test('complete exam lifecycle preserves authorization, pinned versions, session ownership, grading and immutable awards',async()=>{
  const {state,call,ok,admin,newCandidate}=await fixture();
  assert.equal((await call('GET','/organizer/users')).status,401);
  assert.equal((await call('GET','/health',undefined,null,null,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await ok('GET','/health')).storage,'Firestore');
  const candidate=await newCandidate('candidate.one');
  assert.equal((await call('GET','/organizer/users',undefined,candidate.token)).status,403);
  const c=await ok('POST','/organizer/competitions',{name:'Kiểm tra tích hợp',description:'',rules:''}),base=`/organizer/competitions/${c.id}`;
  assert.equal(c.status,'Draft');
  const groups=await ok('GET',`${base}/field-groups`);assert.equal(groups.length,6);
  const config={name:'Đề A',fieldGroupId:groups[0].id,durationMinutes:5,targetQuestionCount:2,commonQuestionCount:1,specializedQuestionCount:1};
  const exam=await ok('POST',`${base}/exams`,config),ep=`${base}/exams/${exam.id}`;
  assert.equal((await call('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},admin)).status,400);
  const q1=await ok('POST','/organizer/question-bank',{type:'SingleChoice',group:'Common',content:'Câu hỏi một',options:[{key:'A',text:'Đúng'},{key:'B',text:'Sai'}],correctAnswer:'A',points:2,isScenario:false});
  const q2=await ok('POST','/organizer/question-bank',{type:'TrueFalse',group:'Specialized',content:'Câu hỏi hai',options:[],correctAnswer:'True',points:3,isScenario:true});
  const imported=await ok('POST',`${ep}/questions/from-bank`,{questionIds:[q1.id,q2.id]});
  await ok('POST',`${ep}/submit-review`,{});
  const version=await ok('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'});assert.equal(version.snapshot.questions.length,2);
  const template=await ok('GET',`${ep}/import-template`);assert.equal(template[0],0x50);
  const d=n=>new Date(Date.now()+n*60000+7*3600000).toISOString().slice(0,16);
  await ok('PUT',`${base}/schedule`,{opensAtLocal:d(-2),startDeadlineLocal:d(20),closesAtLocal:d(30)});
  await ok('POST',`${base}/assignments`,{userIds:[candidate.id],examId:exam.id});
  assert.equal((await ok('GET',`${base}/publication`)).canPublish,true);
  await ok('POST',`${base}/publish`,{});
  const cb=`/candidate/competitions/${c.id}`,ap=`${cb}/attempt`;
  assert.equal((await ok('GET',cb,undefined,candidate.token)).canStart,true);
  const starts=await Promise.all([call('POST',`${ap}/start`,{},candidate.token),call('POST',`${ap}/start`,{},candidate.token)]);
  assert.deepEqual(starts.map(r=>r.status),[200,200]);assert.equal(starts[0].data.attemptId,starts[1].data.attemptId);
  const packet=starts[0].data;assert.equal(packet.questions.length,2);assert.ok(!JSON.stringify(packet).includes('correctAnswer'));assert.ok(!JSON.stringify(packet).includes('explanation'));
  const alternate=await ok('POST','/Auth/login',{username:candidate.username,password:candidatePassword},null);
  assert.equal((await call('GET',ap,undefined,alternate.token)).status,409);
  assert.equal((await call('GET',ap,undefined,candidate.token,'different-tab-02')).status,409);
  assert.equal((await call('PUT',`${ap}/questions/9999`,{answer:'A'},candidate.token)).status,404);
  assert.equal((await call('PUT',`${ap}/questions/${imported[0].id}`,{answer:'BAD'},candidate.token)).status,400);
  // Changing the live bank updates drafts, while issued attempts keep version 1.
  await ok('PUT',`/organizer/question-bank/${q1.id}`,{...q1,content:'Bản nháp đã sửa',correctAnswer:'B'});
  assert.equal((await ok('GET',ep)).isApproved,false);
  const stillIssued=await ok('GET',ap,undefined,candidate.token);assert.equal(stillIssued.questions.find(q=>q.id===imported[0].id).content,'Câu hỏi một');
  await ok('PUT',`${ap}/questions/${imported[0].id}`,{answer:'A',isMarked:true,totalScore:999},candidate.token);
  await ok('PUT',`${ap}/questions/${imported[1].id}`,{answer:'True'},candidate.token);
  const submitted=await ok('POST',`${ap}/submit`,{},candidate.token);assert.equal(submitted.attemptStatus,'Submitted');assert.deepEqual(submitted.questions,[]);
  assert.equal((await ok('POST',`${ap}/submit`,{},candidate.token)).submittedAtUtc,submitted.submittedAtUtc);
  assert.equal((await call('PUT',`${ap}/questions/${imported[0].id}`,{answer:'B'},candidate.token)).status,409);
  const result=await ok('GET',`${base}/results`);assert.equal(result.rows[0].totalScore,5);assert.equal(result.rows[0].correctAnswersCount,2);assert.equal(result.rows[0].scenarioScore,3);assert.equal(result.rows[0].rank,1);
  assert.equal((await ok('GET',`${cb}/awards`,undefined,candidate.token)).individualScore,null);
  const categories=[{rankingGroupName:groups[0].name,awardName:'Giải Nhất',quantity:1}];
  const proposed=await ok('POST',`${base}/awards/proposal`,{categories});assert.equal(proposed.nominees.length,1);
  const nominees=proposed.nominees.map(n=>({attemptId:n.attemptId,awardName:n.awardName,rankingGroupName:n.rankingGroupName}));
  const saved=await ok('PUT',`${base}/awards/draft`,{revision:0,categories,nominees,individualScoresPublished:true,tieReviewConfirmed:true});
  assert.equal(saved.awards.revision,1);
  assert.equal((await call('PUT',`${base}/awards/draft`,{revision:0,categories,nominees},admin)).status,409);
  await ok('POST',`${base}/awards/approve`,{revision:1});await ok('POST',`${base}/awards/publish`,{});
  const visible=await ok('GET',`${cb}/awards`,undefined,candidate.token);assert.equal(visible.individualScore.totalScore,5);assert.equal(visible.awards[0].awardName,'Giải Nhất');
  assert.equal((await call('PUT',`${base}/awards/draft`,{revision:1,categories,nominees},admin)).status,409);
  await ok('GET',`${base}/results/excel`);await ok('GET',`${base}/awards/excel`);
  await ok('POST',`${base}/end`,{});assert.equal((await ok('GET',cb,undefined,candidate.token)).status,'Ended');
  await ok('POST','/Auth/logout',{},candidate.token);assert.equal((await call('GET','/Auth/me',undefined,candidate.token)).status,401);
  assert.equal((await call('DELETE','/organizer/users/1',undefined,admin)).status,409);
  assert.equal(state.records.get('qt_versions/1').hashSha256,version.hashSha256);
});

test('expired attempts cannot save late answers and are finalized at their original deadline',async()=>{
  const {state,call,ok,newCandidate}=await fixture(),candidate=await newCandidate('expiry');
  const c=await ok('POST','/organizer/competitions',{name:'Expiry'}),base=`/organizer/competitions/${c.id}`;
  const group=(await ok('GET',`${base}/field-groups`))[0];
  const exam=await ok('POST',`${base}/exams`,{name:'E',fieldGroupId:group.id,durationMinutes:1,targetQuestionCount:1,commonQuestionCount:1,specializedQuestionCount:0});
  const ep=`${base}/exams/${exam.id}`;
  const q=await ok('POST',`${ep}/questions`,{type:'SingleChoice',group:'Common',content:'Câu hỏi',options:[{key:'A',text:'A'},{key:'B',text:'B'}],correctAnswer:'A',points:1});
  await ok('POST',`${ep}/submit-review`,{});
  await ok('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'});
  const local=n=>new Date(Date.now()+n*60000+7*3600000).toISOString().slice(0,16);
  await ok('PUT',`${base}/schedule`,{opensAtLocal:local(-2),startDeadlineLocal:local(2),closesAtLocal:local(4)});
  await ok('POST',`${base}/assignments`,{userIds:[candidate.id],examId:exam.id});await ok('POST',`${base}/publish`,{});
  const ap=`/candidate/competitions/${c.id}/attempt`,started=await ok('POST',`${ap}/start`,{},candidate.token);
  const stored=state.records.get(`qt_attempts/${started.attemptId}`);stored.deadlineAtUtc=new Date(Date.now()-1000).toISOString();
  assert.equal((await call('PUT',`${ap}/questions/${q.id}`,{answer:'A'},candidate.token)).status,409);
  const ended=await ok('GET',ap,undefined,candidate.token);assert.equal(ended.attemptStatus,'Submitted');assert.equal(ended.submittedAtUtc,stored.deadlineAtUtc);assert.equal(ended.answeredCount,0);
});

test('ranking uses correct answer count then elapsed time, preserves ties and includes boundary ties in proposals',()=>{
  const rows=[{attemptId:1,isValid:true,rankingGroupName:'G',correctAnswersCount:10,durationMilliseconds:300,rank:null,candidateCode:'a'},
    {attemptId:2,isValid:true,rankingGroupName:'G',correctAnswersCount:10,durationMilliseconds:300,rank:null,candidateCode:'b'},
    {attemptId:3,isValid:true,rankingGroupName:'G',correctAnswersCount:9,durationMilliseconds:1,rank:null,candidateCode:'c'}];
  assignRanks(rows);assert.deepEqual(rows.map(r=>r.rank),[1,1,3]);
  assert.equal(proposal([{rankingGroupName:'G',awardName:'Nhất',quantity:1}],rows).length,2);
});

test('XLSX round trip validates Vietnamese headers, treats exported formulas as text and rejects malformed files',()=>{
  const data=workbookBytes([questionHeaders,['Một đáp án đúng','Kiến thức chung','=literal text','Đúng','Sai','','','A',2,'','Nguồn','Không','Có']]);
  const p=importPreview(data);assert.equal(p.canImport,true);assert.equal(p.rows[0].question.content,'=literal text');assert.equal(p.rows[0].question.isScenario,true);
  assert.throws(()=>importPreview(new Uint8Array([0,1,2])));
  assert.throws(()=>importPreview(workbookBytes([['wrong header'],['data']])));
});

test('Firestore codecs preserve nested nullable fields, numbers and Unicode',()=>{
  const sample={id:3,role:'Thí sinh',questions:[{id:4,answer:null,isMarked:true}],score:2.5,active:false,empty:[]};assert.deepEqual(decodeValue(encodeValue(sample)),sample);
});

test('legacy first-login flags do not block access; optional password changes verify the old password and revoke all sessions',async()=>{
  const {state,call,ok,admin}=await fixture();
  state.records.get('qt_users/1').mustChangePassword=true;
  assert.equal((await ok('GET','/Auth/me')).mustChangePassword,false);
  assert.equal((await call('GET','/organizer/overview',undefined,admin)).status,200);
  const other=await ok('POST','/Auth/login',{username:'admin',password:initial},null);
  assert.equal(other.mustChangePassword,false);
  assert.equal((await call('POST','/Auth/change-password',{currentPassword:'wrong',newPassword:candidatePassword,confirmPassword:candidatePassword},admin)).status,400);
  assert.equal((await call('POST','/Auth/change-password',{currentPassword:initial,newPassword:candidatePassword,confirmPassword:'different'},admin)).status,400);
  await ok('POST','/Auth/change-password',{currentPassword:initial,newPassword:candidatePassword,confirmPassword:candidatePassword});
  for(const token of [admin,other.token])assert.equal((await call('GET','/Auth/me',undefined,token)).status,401);
  assert.equal((await call('POST','/Auth/login',{username:'admin',password:initial})).status,401);
  const updated=await ok('POST','/Auth/login',{username:'admin',password:candidatePassword},null);
  assert.equal((await call('GET','/organizer/overview',undefined,updated.token)).status,200);
});

test('topic quotas select exact counts without duplicates and reject invalid requests atomically',async()=>{
 const {call,ok,admin}=await fixture();
 const payload={type:'SingleChoice',group:'Common',content:'Topic question',options:[{key:'A',text:'Yes'},{key:'B',text:'No'}],correctAnswer:'A',points:1};
 for(let i=0;i<4;i++)await ok('POST','/organizer/question-bank',{...payload,topic:'Đất đai'});
 for(let i=0;i<3;i++)await ok('POST','/organizer/question-bank',{...payload,topic:'Hành chính',group:'Specialized'});
 for(const topics of [[{topic:'Đất đai',count:5}],[{topic:'Đất đai',count:1.5}],[{topic:'Đất đai',count:0}],[{topic:'Đất đai',count:1},{topic:'Đất đai',count:1}],[{topic:'Không có',count:1}]]){
  assert.equal((await call('POST','/organizer/competitions',{name:'Invalid topic',initialExam:{topics}},admin)).status,400);
 }
 assert.equal((await ok('GET','/organizer/competitions')).length,0);
 const c=await ok('POST','/organizer/competitions',{name:'Chủ đề',initialExam:{topics:[{topic:'Đất đai',count:2},{topic:'Hành chính',count:3}],durationMinutes:45}});
 const path=`/organizer/competitions/${c.id}/exams/${c.initialExamId}`;
 const questions=await ok('GET',`${path}/questions`),exam=await ok('GET',path);
 assert.equal(questions.length,5);assert.equal(new Set(questions.map(q=>q.bankQuestionId)).size,5);
 assert.equal(exam.commonQuestionCount,2);assert.equal(exam.specializedQuestionCount,3);assert.equal(exam.durationMinutes,45);
 assert.deepEqual(await ok('GET',`${path}/questions`),questions);
 const bank=await ok('GET','/organizer/question-bank');assert.equal(bank.filter(q=>q.topic==='Đất đai').length,4);
 const single=await ok('POST','/organizer/competitions',{name:'Một chủ đề',initialExam:{topics:[{topic:'Đất đai',count:1}]}});assert.equal(single.initialQuestionCount,1);
});

test('topic review saves exactly the retained questions and leaves the question bank unchanged',async()=>{
 const {ok}=await fixture();
 const payload={type:'SingleChoice',group:'Common',content:'Review topic',topic:'Đất đai',options:[{key:'A',text:'Yes'},{key:'B',text:'No'}],correctAnswer:'A',points:1};
 const bank=[];for(let i=0;i<4;i++)bank.push(await ok('POST','/organizer/question-bank',{...payload,topic:i<2?'Đất đai':'Hành chính'}));
 const retained=[bank[0].id,bank[3].id];
 const c=await ok('POST','/organizer/competitions',{name:'Rà soát chủ đề',initialExam:{questionIds:retained}});
 const route=`/organizer/competitions/${c.id}/exams/${c.initialExamId}`;
 assert.deepEqual((await ok('GET',`${route}/questions`)).map(q=>q.bankQuestionId),retained);
 assert.equal((await ok('GET',route)).targetQuestionCount,2);
 assert.equal((await ok('GET','/organizer/question-bank')).length,4);
});

test('topic catalog CRUD, bulk move and rename preserve approved snapshots without knowledge quotas',async()=>{
 const {ok,call,admin,newCandidate}=await fixture();
 const a=await ok('POST','/organizer/topics',{name:'Nghị Quyết 57'});
 assert.equal((await call('POST','/organizer/topics',{name:' nghị quyết 57 '},admin)).status,409);
 assert.equal((await call('POST','/organizer/topics',{name:'  '},admin)).status,400);
 const empty=await ok('POST','/organizer/topics',{name:'Chủ đề trống'});
 await ok('DELETE',`/organizer/topics/${empty.id}`);
 const p={topic:a.name,type:'SingleChoice',content:'Câu theo chủ đề',options:[{key:'A',text:'Đúng'},{key:'B',text:'Sai'}],correctAnswer:'A',points:1};
 const q=await ok('POST','/organizer/question-bank',p);
 const c=await ok('POST','/organizer/competitions',{name:'Chỉ chủ đề',initialExam:{questionIds:[q.id]}});
 const path=`/organizer/competitions/${c.id}/exams/${c.initialExamId}`;
 const exam=await ok('GET',path);
 await ok('PUT',path,{name:exam.name,fieldGroupId:exam.fieldGroupId,durationMinutes:30,targetQuestionCount:1});
 await ok('POST',`${path}/submit-review`,{});
 const version=await ok('POST',`${path}/approve`,{note:'Duyệt đề sau khi kiểm tra'});
 assert.equal((await call('DELETE',`/organizer/topics/${a.id}`,undefined,admin)).status,409);
 await ok('PUT',`/organizer/topics/${a.id}`,{name:'Nghị Quyết 57 cập nhật'});
 assert.equal((await ok('GET','/organizer/question-bank'))[0].topic,'Nghị Quyết 57 cập nhật');
 assert.equal((await ok('GET',`${path}/questions`))[0].topic,'Nghị Quyết 57 cập nhật');
 assert.equal((await ok('GET',`${path}/versions/${version.id}`)).snapshot.questions[0].topic,'Nghị Quyết 57');
 assert.equal((await ok('GET',path)).isApproved,false);
 const b=await ok('POST','/organizer/topics',{name:'Chuyển đổi số'});
 assert.equal((await call('POST','/organizer/question-bank/set-topic',{topicId:b.id,questionIds:[q.id,99999]},admin)).status,404);
 assert.equal((await ok('GET','/organizer/question-bank'))[0].topic,'Nghị Quyết 57 cập nhật');
 await ok('POST','/organizer/question-bank/set-topic',{topicId:b.id,questionIds:[q.id]});
 const catalog=await ok('GET','/organizer/topics');assert.equal(catalog.find(t=>t.id===b.id).questionCount,1);assert.equal(catalog.find(t=>t.id===a.id).questionCount,0);
 await ok('DELETE',`/organizer/topics/${a.id}`);
 assert.equal((await ok('GET','/organizer/question-bank?topic=Chuyển%20đổi%20số')).length,1);
 const candidate=await newCandidate('topic.candidate');
 assert.equal((await call('GET','/organizer/topics',undefined,candidate.token)).status,403);
 assert.equal((await call('POST','/organizer/question-bank/set-topic',{topicId:b.id,questionIds:[q.id]},candidate.token)).status,403);
});

test('least privilege workflow prevents API bypass, locks submitted revisions and revokes changed access',async()=>{
 const {ok,call,admin,state,newCandidate}=await fixture();
 async function staff(username,permissions) {
  const u=await ok('POST','/organizer/users',{username,fullName:username,role:'Organizer',workflowPermissions:permissions});
  const login=await ok('POST','/Auth/login',{username,password:'123456'},null);assert.deepEqual(login.workflowPermissions,permissions);return {...u,token:login.token};
 }
 const author=await staff('author',['draft','submit']),reviewer=await staff('reviewer',['approve']),operator=await staff('operator',['operate']);
 const c=await ok('POST','/organizer/competitions',{name:'Phân quyền'},author.token),base=`/organizer/competitions/${c.id}`;
 const q=await ok('POST','/organizer/question-bank',{topic:'Nghị Quyết 57',type:'SingleChoice',content:'Nội dung',options:[{key:'A',text:'A'},{key:'B',text:'B'}],correctAnswer:'A',points:1},author.token);
 const groups=await ok('GET',`${base}/field-groups`,undefined,author.token);
 const e=await ok('POST',`${base}/exams`,{name:'Đề chờ duyệt',fieldGroupId:groups[0].id,durationMinutes:30,targetQuestionCount:1},author.token),ep=`${base}/exams/${e.id}`;
 await ok('POST',`${ep}/questions/from-bank`,{questionIds:[q.id],syncCounts:true},author.token);
 assert.equal((await call('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},author.token)).status,403);
 assert.equal((await call('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},reviewer.token)).status,409);
 assert.equal((await call('POST',`${base}/publish`,{},author.token)).status,403);
 assert.equal((await call('POST','/organizer/users',{username:'escalate',fullName:'No',role:'Organizer',workflowPermissions:['manageUsers']},author.token)).status,403);
 assert.equal((await call('GET',`${ep}/questions`,undefined,operator.token)).status,403);
 assert.equal((await call('PUT',`${ep}/questions/1`,{},reviewer.token)).status,403);
 await ok('POST',`${ep}/submit-review`,{},author.token);
 assert.equal((await ok('GET','/organizer/review-queue',undefined,reviewer.token)).length,1);
 assert.equal((await call('POST',`${ep}/questions`,{type:'TrueFalse',options:[],content:'New',correctAnswer:'True',points:1},author.token)).status,409);
 assert.equal((await call('PUT',`/organizer/question-bank/${q.id}`,{...q,content:'Bypass bank'},author.token)).status,409);
 assert.equal((await ok('GET','/organizer/question-bank',undefined,author.token))[0].content,'Nội dung');
 assert.equal((await call('POST',`${ep}/return-review`,{},reviewer.token)).status,400);
 await ok('POST',`${ep}/return-review`,{note:'Bổ sung căn cứ'},reviewer.token);
 assert.equal((await ok('GET',ep,undefined,author.token)).reviewStatus,'Draft');
 await ok('PUT',`/organizer/question-bank/${q.id}`,{...q,content:'Đã chỉnh sửa'},author.token);
 const revision=(await ok('GET',ep,undefined,author.token)).draftRevision;
 assert.equal((await call('POST',`${ep}/submit-review`,{draftRevision:revision-1},author.token)).status,409);
 await ok('POST',`${ep}/submit-review`,{draftRevision:revision},author.token);
 await ok('POST',`${ep}/withdraw-review`,{},author.token);
 await ok('POST',`${ep}/submit-review`,{},author.token);
 const v=await ok('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},reviewer.token);
 assert.equal((await ok('GET',ep,undefined,author.token)).reviewStatus,'Approved');
 assert.deepEqual((await ok('GET',`${ep}/review-history`,undefined,author.token)).map(e=>e.action),['Approved','Submitted','Withdrawn','Submitted','Returned','Submitted']);
 assert.equal((await ok('GET','/organizer/review-queue',undefined,reviewer.token)).length,0);
 await ok('PUT',`/organizer/question-bank/${q.id}`,{...q,content:'Bản nháp mới'},author.token);
 assert.equal((await ok('GET',ep,undefined,author.token)).reviewStatus,'Draft');
 assert.equal((await ok('GET',`${ep}/versions/${v.id}`,undefined,reviewer.token)).snapshot.questions[0].content,'Đã chỉnh sửa');
 assert.equal((await call('PUT',`/organizer/users/${author.id}/access`,{role:'Organizer',workflowPermissions:['manageUsers']},author.token)).status,403);
 assert.equal((await call('PUT','/organizer/users/1/access',{role:'Candidate',workflowPermissions:[]},admin)).status,409);
 await ok('PUT',`/organizer/users/${author.id}/access`,{role:'Organizer',workflowPermissions:['approve']});
 assert.equal((await call('GET','/Auth/me',undefined,author.token)).status,401);
 const changed=await ok('POST','/Auth/login',{username:'author',password:'123456'},null);
 assert.equal((await call('POST','/organizer/competitions',{name:'Denied'},changed.token)).status,403);
 assert.equal((await ok('GET',`/organizer/users/${author.id}/access-history`)).length,1);
 const candidate=await newCandidate('workflow.candidate');assert.equal((await call('GET',`${ep}/review-history`,undefined,candidate.token)).status,403);
 const both=await staff('both',['draft','submit','approve']);
 await ok('POST',`${ep}/submit-review`,{},both.token);
 assert.equal((await call('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},both.token)).status,403);
 assert.equal(state.records.get(`qt_exams/${e.id}`).reviewStatus,'PendingReview');
});

test('workflow desks expose only assigned process data and count current attempts without answer keys',async()=>{
 const {state,ok,call,admin,newCandidate}=await fixture();
 const people={};
 for(const [name,caps] of [['editor',['draft','submit']],['approver',['approve']],['operator',['operate']],['manager',['manageUsers']]]){
  const u=await ok('POST','/organizer/users',{username:'desk.'+name,fullName:name,role:'Organizer',workflowPermissions:caps});
  people[name]={...u,token:(await ok('POST','/Auth/login',{username:'desk.'+name,password:'123456'},null)).token};
 }
 const c=await ok('POST','/organizer/competitions',{name:'Desk test'}),base=`/organizer/competitions/${c.id}`;
 const q=await ok('POST','/organizer/question-bank',{topic:'Chủ đề bàn biên tập',type:'SingleChoice',content:'Không được lộ ra màn điều hành',options:[{key:'A',text:'A'},{key:'B',text:'B'}],correctAnswer:'A',points:1});
 const group=(await ok('GET',`${base}/field-groups`))[0];
 const e=await ok('POST',`${base}/exams`,{name:'Đề theo quy trình',fieldGroupId:group.id,durationMinutes:5,targetQuestionCount:1}),ep=`${base}/exams/${e.id}`;
 await ok('POST',`${ep}/questions/from-bank`,{questionIds:[q.id],syncCounts:true});
 let desk=await ok('GET','/organizer/workflows',undefined,people.editor.token);assert.equal(desk.editorial.questionCount,1);assert.equal(desk.editorial.topicCount,1);assert.equal(desk.editorial.exams[0].reviewStatus,'Draft');assert.equal(desk.operations,null);assert.equal(desk.review,null);
 desk=await ok('GET','/organizer/workflows',undefined,people.manager.token);assert.equal(desk.editorial,null);assert.equal(desk.review,null);assert.equal(desk.operations,null);assert.equal(desk.approvedExams,null);
 await ok('POST',`${ep}/submit-review`,{},people.editor.token);
 desk=await ok('GET','/organizer/workflows',undefined,people.approver.token);assert.equal(desk.review.exams[0].reviewStatus,'PendingReview');assert.equal(desk.editorial,null);assert.equal(desk.operations,null);
 await ok('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},people.approver.token);
 const candidate=await newCandidate('desk.candidate');
 const local=n=>new Date(Date.now()+n*60000+7*3600000).toISOString().slice(0,19);
 await ok('PUT',`${base}/schedule`,{opensAtLocal:local(-2),startDeadlineLocal:local(20),closesAtLocal:local(30)},people.operator.token);
 await ok('POST',`${base}/assignments`,{userIds:[candidate.id],examId:e.id},people.operator.token);
 await ok('POST',`${base}/publish`,{},people.operator.token);
 desk=await ok('GET','/organizer/workflows',undefined,people.operator.token);assert.equal(desk.editorial,null);assert.equal(desk.review,null);assert.equal(desk.approvedExams.length,1);assert.equal(desk.operations[0].notStartedCount,1);assert.equal(desk.operations[0].approvedExamCount,1);assert.equal(desk.operations[0].scheduleComplete,true);
 const packet=JSON.stringify(desk);assert.ok(!packet.includes('correctAnswer'));assert.ok(!packet.includes(q.content));assert.ok(!packet.includes('password'));
 await ok('POST',`/candidate/competitions/${c.id}/attempt/start`,{},candidate.token);
 desk=await ok('GET','/organizer/workflows',undefined,people.operator.token);assert.equal(desk.operations[0].inProgressCount,1);assert.equal(desk.operations[0].notStartedCount,0);
 await ok('POST',`/candidate/competitions/${c.id}/attempt/submit`,{},candidate.token);
 desk=await ok('GET','/organizer/workflows',undefined,people.operator.token);assert.equal(desk.operations[0].submittedCount,1);assert.equal(desk.operations[0].inProgressCount,0);
 assert.equal((await call('GET','/organizer/workflows',undefined,candidate.token)).status,403);
 assert.equal((await call('GET','/organizer/workflows')).status,401);
});

test('department catalog CRUD enforces account-management rights and keeps membership canonical',async()=>{
 const {ok,call,admin,newCandidate}=await fixture();
 const staff=await ok('POST','/organizer/users',{username:'units.editor',fullName:'Editor',role:'Organizer',workflowPermissions:['draft','submit']});
 const editor=(await ok('POST','/Auth/login',{username:staff.username,password:'123456'},null)).token;
 const root='/organizer/organization-units';
 const unit=await ok('POST',root,{code:'phong_kt',name:'Phòng Kinh tế',sortOrder:1});assert.equal(unit.code,'PHONG_KT');assert.equal(unit.userCount,0);
 assert.equal((await call('POST',root,{code:'X',name:'phòng kinh tế'},admin)).status,409);
 assert.equal((await call('POST',root,{code:'phong_kt',name:'Tên khác'},admin)).status,409);
 assert.equal((await call('POST',root,{code:'BAD CODE',name:'Tên'},admin)).status,400);
 for(const [method,path,body]of [['POST',root,{code:'NO',name:'Không được'}],['PUT',`${root}/${unit.id}`,{code:unit.code,name:'Không được'}],['DELETE',`${root}/${unit.id}`,undefined]])assert.equal((await call(method,path,body,editor)).status,403);
 assert.equal((await ok('GET',root,undefined,editor)).length,1);
 const u=await ok('POST','/organizer/users',{username:'units.user',fullName:'Tài khoản phòng',departmentId:unit.id,department:'Tên cũ không được dùng'});assert.equal(u.department,unit.name);
 assert.equal((await ok('GET',root))[0].userCount,1);
 assert.equal((await call('DELETE',`${root}/${unit.id}`,undefined,admin)).status,409);
 const changed=await ok('PUT',`${root}/${unit.id}`,{code:'PHONG_KT',name:'Phòng Kinh tế mới',sortOrder:2});assert.equal(changed.updatedUserCount,1);
 assert.equal((await ok('GET',`/organizer/users/${u.id}`)).department,'Phòng Kinh tế mới');
 await ok('PUT',`/organizer/users/${u.id}`,{fullName:u.fullName,departmentId:unit.id,department:'Phòng Kinh tế',isActive:false});
 assert.equal((await ok('GET',`/organizer/users/${u.id}`)).department,'Phòng Kinh tế mới');
 assert.equal((await call('DELETE',`${root}/${unit.id}`,undefined,admin)).status,409);
 const other=await ok('POST',root,{code:'EMPTY',name:'Phòng tiếp nhận',sortOrder:3});
 await ok('PUT',`/organizer/users/${u.id}`,{fullName:u.fullName,departmentId:other.id,isActive:false});
 await ok('DELETE',`${root}/${unit.id}`);
 assert.equal((await call('PUT',`${root}/${unit.id}`,{code:'OLD',name:'Đã xóa'},admin)).status,404);
 assert.equal((await call('POST','/organizer/users',{username:'units.bad',fullName:'Sai',departmentId:unit.id},admin)).status,409);
 const candidate=await newCandidate('units.candidate');assert.equal((await call('GET',root,undefined,candidate.token)).status,403);
 assert.equal((await call('GET',root)).status,401);
});

test('three default processes preserve prior rights, support assignment and enforce live catalog changes',async()=>{
 const {ok,call,admin}=await fixture();
 let catalog=await ok('GET','/organizer/processes');assert.equal(catalog.length,3);assert.deepEqual(catalog.map(p=>p.name),['Quản trị hệ thống','Biên tập – Duyệt','Thi']);
 const organizer=catalog.find(p=>p.code==='ORGANIZER'),system=catalog.find(p=>p.code==='SYSTEM_ADMIN'),candidate=catalog.find(p=>p.role==='Candidate');
 const limited=await ok('POST','/organizer/users',{username:'proc.editor',fullName:'Editor',role:'Organizer',workflowPermissions:['draft']});
 assert.deepEqual(limited.processIds,[organizer.id]);assert.deepEqual(limited.workflowPermissions,['draft']);
 let token=(await ok('POST','/Auth/login',{username:'proc.editor',password:'123456'},null)).token;
 assert.equal((await call('POST','/organizer/processes',{name:'Escalate',role:'Organizer',steps:['manageUsers']},token)).status,403);
 const process=await ok('POST','/organizer/processes',{name:'Quy trình kiểm thử',role:'Organizer',steps:['draft','submit'],description:'Kiểm thử quyền theo quy trình'});
 assert.equal((await call('POST','/organizer/processes',{name:'quy trình kiểm thử',role:'Organizer',steps:['draft']},admin)).status,409);
 assert.equal((await call('PUT',`/organizer/users/${limited.id}/access`,{role:'Organizer',processIds:[process.id,candidate.id]},admin)).status,400);
 await ok('PUT',`/organizer/users/${limited.id}/access`,{role:'Organizer',processIds:[process.id]});
 assert.equal((await call('GET','/Auth/me',undefined,token)).status,401);
 token=(await ok('POST','/Auth/login',{username:'proc.editor',password:'123456'},null)).token;
 assert.deepEqual((await ok('GET','/Auth/me',undefined,token)).workflowPermissions,['draft','submit']);
 assert.equal((await call('DELETE',`/organizer/processes/${process.id}`,undefined,admin)).status,409);
 assert.equal((await call('PUT',`/organizer/processes/${process.id}`,{name:process.name,role:'Candidate',steps:['takeExam']},admin)).status,409);
 await ok('PUT',`/organizer/processes/${process.id}`,{name:process.name,role:'Organizer',steps:['submit','draft','approve']});
 assert.equal((await call('GET','/Auth/me',undefined,token)).status,401);
 const refreshed=await ok('POST','/Auth/login',{username:'proc.editor',password:'123456'},null);assert.deepEqual(refreshed.workflowPermissions,['submit','draft','approve']);
 assert.equal((await call('PUT',`/organizer/processes/${system.id}`,{name:system.name,role:'Organizer',steps:['draft','submit','approve','operate']},admin)).status,409);
 await ok('PUT',`/organizer/users/${limited.id}/access`,{role:'Organizer',processIds:[organizer.id]});
 await ok('DELETE',`/organizer/processes/${process.id}`);catalog=await ok('GET','/organizer/processes');assert.equal(catalog.length,3);
});

test('three account groups isolate administration, editorial duties and candidate APIs',async()=>{
 const {ok,call,admin}=await fixture(),catalog=await ok('GET','/organizer/processes');
 const accounts={};
 for(const [code,group]of [['SYSTEM_ADMIN','SystemAdmin'],['ORGANIZER','Editorial'],['CANDIDATE','Candidate']]){
  const process=catalog.find(p=>p.code===code),u=await ok('POST','/organizer/users',{username:'groups.'+code.toLowerCase(),fullName:group,role:process.role,processIds:[process.id]});
  const login=await ok('POST','/Auth/login',{username:u.username,password:'123456'},null);assert.equal(login.accountGroup,group);accounts[group]={...u,token:login.token};
 }
 const sys=accounts.SystemAdmin.token,editor=accounts.Editorial.token,student=accounts.Candidate.token;
 for(const path of ['/organizer/users','/organizer/processes','/organizer/system-summary','/organizer/activity']){await ok('GET',path,undefined,sys);for(const token of [editor,student])assert.equal((await call('GET',path,undefined,token)).status,403);}
 for(const [method,path,body]of [['GET','/organizer/competitions',undefined],['GET','/organizer/question-bank',undefined],['GET','/organizer/review-queue',undefined],['POST','/organizer/competitions',{name:'Denied'}]])assert.equal((await call(method,path,body,sys)).status,403);
 await ok('POST','/organizer/topics',{name:'Admin topic'},sys);await ok('GET','/organizer/question-bank',undefined,editor);
 assert.equal((await call('PUT',`/organizer/users/${accounts.Editorial.id}/access`,{role:'Organizer',processIds:[catalog.find(p=>p.code==='SYSTEM_ADMIN').id]},editor)).status,403);
 await ok('GET','/candidate/competitions',undefined,student);for(const token of [sys,editor])assert.equal((await call('GET','/candidate/competitions',undefined,token)).status,403);
 const activity=await ok('GET','/organizer/activity',undefined,sys);assert.ok(activity.some(e=>e.action==='AccountCreated'));assert.ok(!JSON.stringify(activity).includes('password'));
 const summary=await ok('GET','/organizer/system-summary',undefined,sys);assert.equal(summary.processCount,3);assert.equal(summary.groups.Editorial,1);assert.equal(summary.groups.Candidate,1);
 await ok('PUT',`/organizer/users/${accounts.SystemAdmin.id}/access`,{role:'Organizer',processIds:catalog.filter(p=>p.role==='Organizer').map(p=>p.id)},admin);
 assert.equal((await call('GET','/Auth/me',undefined,sys)).status,401);
 const extra=await ok('POST','/Auth/login',{username:accounts.SystemAdmin.username,password:'123456'},null);await ok('GET','/organizer/question-bank',undefined,extra.token);
});

test('review decisions require notes, return to draft and block public release of an unapproved edit',async()=>{
 const {ok,call,admin,newCandidate}=await fixture();
 const q=await ok('POST','/organizer/question-bank',{type:'SingleChoice',topic:'Kiểm thử',content:'Câu hỏi',options:[{key:'A',text:'A'},{key:'B',text:'B'}],correctAnswer:'A',points:1});
 const c=await ok('POST','/organizer/competitions',{name:'Quy trình chuẩn',initialExam:{questionIds:[q.id]}}),base=`/organizer/competitions/${c.id}`,ep=`${base}/exams/${c.initialExamId}`;
 await ok('POST',`${ep}/submit-review`,{});
 assert.equal((await call('POST',`${ep}/approve`,{},admin)).status,400);
 assert.equal((await call('POST',`${ep}/return-review`,{},admin)).status,400);
 await ok('POST',`${ep}/return-review`,{note:'Bổ sung căn cứ trước khi duyệt'});
 assert.equal((await ok('GET',ep)).reviewStatus,'Draft');
 assert.equal((await ok('GET',ep)).reviewNote,'Bổ sung căn cứ trước khi duyệt');
 await ok('POST',`${ep}/submit-review`,{});await ok('POST',`${ep}/approve`,{note:'Đã kiểm tra đầy đủ nội dung và đáp án'});
 assert.equal((await ok('GET',ep)).reviewStatus,'Approved');
 const history=await ok('GET',`${ep}/review-history`);assert.equal(history[0].note,'Đã kiểm tra đầy đủ nội dung và đáp án');assert.equal(history[2].note,'Bổ sung căn cứ trước khi duyệt');
 const student=await newCandidate('proc.student'),time=n=>new Date(Date.now()+n*60000+7*3600000).toISOString().slice(0,19);
 await ok('PUT',`${base}/schedule`,{opensAtLocal:time(-1),startDeadlineLocal:time(5),closesAtLocal:time(40)});
 await ok('POST',`${base}/assignments`,{userIds:[student.id],examId:c.initialExamId});
 await ok('PUT',`/organizer/question-bank/${q.id}`,{...q,content:'Đã sửa sau duyệt'});
 assert.equal((await call('POST',`${base}/publish`,{},admin)).status,400);
 await ok('POST',`${ep}/submit-review`,{});await ok('POST',`${ep}/approve`,{note:'Duyệt bản đã chỉnh sửa'});
 await ok('PUT',`${base}/assignments/${student.id}`,{examId:c.initialExamId});
 await ok('POST',`${base}/publish`,{});assert.equal((await ok('GET',ep)).competitionStatus,'Published');
 assert.equal((await ok('GET','/candidate/competitions',undefined,student.token)).length,1);
});
