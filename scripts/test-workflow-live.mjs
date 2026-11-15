import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const origin=(process.argv[2]||'').replace(/\/$/,'');assert.ok(origin.startsWith('https://'));
const credential=fs.readFileSync(new URL('../.data/cloud/preview-admin-login.txt',import.meta.url),'utf8');
const password=credential.match(/Mật khẩu khởi tạo: (.+)/)?.[1];assert.ok(password);
let admin;const users=[],tokens=[];
async function call(method,path,body,token=admin,status=200){const r=await fetch(origin+'/api'+path,{method,headers:{'X-Quiz-Attempt-Tab':'workflow-preview-tab',...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});let data=r.status===204?null:await r.json();assert.equal(r.status,status,`${method} ${path}: HTTP ${r.status}, ${data?.message||''}`);return data;}
assert.equal((await call('GET','/health')).environment,'preview','QA writes are permitted only in preview.');
admin=(await call('POST','/Auth/login',{username:'admin',password},null)).token;
const marker='wf'+crypto.randomBytes(5).toString('hex');
async function account(suffix,role,workflowPermissions){const u=await call('POST','/organizer/users',{username:marker+suffix,fullName:'MINH HỌA KIỂM THỬ QUYỀN '+suffix,role,workflowPermissions},admin,201);users.push(u);const login=await call('POST','/Auth/login',{username:u.username,password:'123456'},null);tokens.push(login.token);return {...u,token:login.token};}
try {
 const author=await account('author','Organizer',['draft','submit']),reviewer=await account('reviewer','Organizer',['approve']),operator=await account('operator','Organizer',['operate']),candidate=await account('candidate','Candidate',[]);
 const c=await call('POST','/organizer/competitions',{name:'KIỂM THỬ PHÂN QUYỀN '+marker},author.token,201),base=`/organizer/competitions/${c.id}`;
 const group=(await call('GET',`${base}/field-groups`,undefined,author.token))[0];
 const exam=await call('POST',`${base}/exams`,{name:'Đề kiểm thử quy trình',fieldGroupId:group.id,durationMinutes:5,targetQuestionCount:1},author.token,201),ep=`${base}/exams/${exam.id}`;
 await call('POST',`${ep}/questions`,{topic:'Kiểm thử quyền',type:'SingleChoice',content:'Câu kiểm thử phân quyền',options:[{key:'A',text:'Đúng'},{key:'B',text:'Sai'}],correctAnswer:'A',points:1},author.token,201);
 await call('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},author.token,403);
 await call('POST',`${base}/publish`,{},author.token,403);
 await call('GET',`${ep}/questions`,undefined,operator.token,403);
 const editorDesk=await call('GET','/organizer/workflows',undefined,author.token);assert.ok(editorDesk.editorial.exams.some(e=>e.id===exam.id));assert.equal(editorDesk.operations,null);
 await call('POST',`${ep}/submit-review`,{},author.token);
 await call('POST',`${ep}/questions`,{type:'TrueFalse',options:[],content:'Vượt khóa',correctAnswer:'True',points:1},author.token,409);
 await call('POST',`${ep}/return-review`,{note:'Cần kiểm tra lại nội dung'},reviewer.token);
 await call('POST',`${ep}/submit-review`,{},author.token);
 await call('POST',`${ep}/approve`,{note:'Duyệt đề sau khi kiểm tra'},reviewer.token);
 assert.equal((await call('GET',ep,undefined,author.token)).reviewStatus,'Approved');
 const approvedDesk=await call('GET','/organizer/workflows',undefined,operator.token);assert.ok(approvedDesk.approvedExams.some(e=>e.id===exam.id));assert.equal(approvedDesk.editorial,null);assert.ok(!JSON.stringify(approvedDesk).includes('correctAnswer'));
 const local=n=>new Date(Date.now()+n*60000+7*3600000).toISOString().slice(0,19);
 await call('PUT',`${base}/schedule`,{opensAtLocal:local(-2),startDeadlineLocal:local(30),closesAtLocal:local(60)},operator.token);
 await call('POST',`${base}/assignments`,{userIds:[candidate.id],examId:exam.id},operator.token,201);
 await call('POST',`${base}/publish`,{},operator.token);
 const started=await call('POST',`/candidate/competitions/${c.id}/attempt/start`,{},candidate.token);
 assert.ok(started.questions?.length===1);assert.ok(!Object.hasOwn(started.questions[0],'correctAnswer'));
 const liveDesk=await call('GET','/organizer/workflows',undefined,operator.token);assert.equal(liveDesk.operations.find(r=>r.id===c.id).inProgressCount,1);
 await call('POST',`/candidate/competitions/${c.id}/attempt/submit`,{},candidate.token);
 const doneDesk=await call('GET','/organizer/workflows',undefined,operator.token);assert.equal(doneDesk.operations.find(r=>r.id===c.id).submittedCount,1);
 await call('GET','/organizer/users',undefined,candidate.token,403);
 await call('PUT',`/organizer/users/${author.id}/access`,{role:'Organizer',workflowPermissions:['approve']});
 await call('GET','/Auth/me',undefined,author.token,401);
 const audit=await call('GET',`${ep}/review-history`,undefined,reviewer.token);assert.deepEqual(audit.map(e=>e.action),['Approved','Submitted','Returned','Submitted']);
 const summary={origin,verified:true,competitionId:c.id,workflow:'Nháp → Chờ duyệt → Trả lại → Chờ duyệt → Duyệt → Thi → Nộp bài',permissionsEnforced:true,accessChangeRevokesSessions:true};
 fs.writeFileSync(new URL('../.artifacts/workflow-preview-verification.json',import.meta.url),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
} finally {
 for(const u of users)await call('PUT',`/organizer/users/${u.id}`,{fullName:u.fullName,department:u.department||'',isActive:false}).catch(()=>{});
 for(const token of tokens)await call('POST','/Auth/logout',{},token).catch(()=>{});
 if(admin)await call('POST','/Auth/logout',{},admin).catch(()=>{});
}

