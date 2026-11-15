import {ensure,fail,json,now,shuffle,pick,TIME_ZONE,permissions,text} from './common.mjs';
import {competitionProfile,loadVersion,examProfile} from './exams.mjs';
import {candidateAwards} from './results.mjs';

export const validSchedule=c=>c.opensAtUtc&&c.startDeadlineUtc&&c.closesAtUtc&&c.opensAtUtc<c.startDeadlineUtc&&c.startDeadlineUtc<=c.closesAtUtc;
export const attemptStatus=a=>!a?'NotStarted':a.submittedAtUtc?'Submitted':Date.parse(a.deadlineAtUtc)<=Date.now()?'Expired':'InProgress';
const statusLabel=s=>({NotStarted:'Chưa bắt đầu',Submitted:'Đã nộp bài',Expired:'Hết thời gian',InProgress:'Đang làm bài'})[s];
export function finalize(db,a) { if(a&&!a.isInvalidated&&!a.submittedAtUtc&&Date.parse(a.deadlineAtUtc)<=Date.now()){a.submittedAtUtc=a.deadlineAtUtc;db.put('attempts',a);}return a; }
async function activeAttempt(db,cid,uid) { return (await db.all('attempts','userId',uid)).filter(a=>a.competitionId===cid&&!a.isInvalidated).sort((a,b)=>b.id-a.id)[0]||null; }
export async function assignmentMetadata(db,a) {
  if(!a)return null;
  const version=await db.get('versions',a.examVersionId),exam=await db.get('exams',a.examId);
  if(!version||!exam||exam.competitionId!==a.competitionId||version.examId!==a.examId||version.exam?.competitionId!==a.competitionId)return null;
  return {...pick(version.exam,['id','name','fieldGroupName','durationMinutes','targetQuestionCount','isDemo']),versionId:version.id,versionNumber:version.versionNumber};
}
export async function publication(db,c) {
  const assignments=await db.all('assignments','competitionId',c.id),versions=await db.all('versions','competitionId',c.id),users=await db.all('users');
  const exams=await db.all('exams','competitionId',c.id),byId=new Map(exams.map(e=>[e.id,e])),byVersion=new Map(versions.map(v=>[v.id,v]));
  const errors=[],error=(field,message)=>errors.push({field,message});
  if(c.status==='Ended')error('status','Cuộc thi đã kết thúc, không thể công bố lại.');
  if(!validSchedule(c))error('schedule','Cần lịch hợp lệ: ngày giờ mở thi < hạn bắt đầu ≤ ngày giờ đóng thi.');
  const approvedExamCount=new Set(versions.map(v=>v.examId)).size;
  if(!approvedExamCount)error('exams','Cuộc thi cần có ít nhất một đề đã duyệt.');
  if(!assignments.length)error('assignments','Cần phân đề cho ít nhất một thí sinh trước khi công bố.');
  for(const a of assignments){const u=users.find(u=>u.id===a.userId),v=byVersion.get(a.examVersionId),e=byId.get(a.examId);if(!u?.isActive||u.role!=='Candidate')error('assignments','Có tài khoản không còn là thí sinh đang hoạt động.');if(!v||!e||v.examId!==e.id)error('assignments','Có phân công chưa có đề đã duyệt hợp lệ.');if(c.status==='Draft'&&v&&e&&(v.draftRevision!==e.draftRevision||e.reviewStatus==='PendingReview'||e.currentApprovedVersionId!==v.id))error('exams','Cần duyệt và phân công đúng phiên bản hiện tại trước khi công khai.');}
  return {status:c.status,publishedAtUtc:c.publishedAtUtc,canPublish:!errors.length&&c.status==='Draft',errors,assignmentCount:assignments.length,approvedExamCount};
}
export async function assignmentRoute(ctx,c) {
  const {db,parts,method,body,user}=ctx,action=parts[4],uid=Number(parts[5]);
  if(action==='publication'&&method==='GET')return json(await publication(db,c));
  if(action==='publish'&&method==='POST') {
    ensure(c.status!=='Ended','Cuộc thi đã kết thúc.',409);
    if(c.status!=='Published') {const readiness=await publication(db,c);ensure(readiness.canPublish,'Chưa đủ điều kiện công bố.',400,readiness);c.status='Published';c.publishedAtUtc=now();c.updatedAtUtc=now();db.put('competitions',c);}
    return json(await publication(db,c));
  }
  if(action==='assignment-options'&&method==='GET') {
    const accounts=(await db.all('users','role','Candidate')).filter(u=>u.isActive).sort((a,b)=>a.fullName.localeCompare(b.fullName,'vi')).map(u=>pick(u,['id','username','fullName','department','isDemo']));
    const versions=await db.all('versions','competitionId',c.id),groups=await db.all('groups','competitionId',c.id);
    const approvedExams=(await db.all('exams','competitionId',c.id)).filter(e=>versions.some(v=>v.id===e.currentApprovedVersionId&&v.draftRevision===e.draftRevision)).map(e=>({...e,fieldGroupName:groups.find(g=>g.id===e.fieldGroupId)?.name,versionNumber:versions.find(v=>v.id===e.currentApprovedVersionId)?.versionNumber}));
    return json({accounts,approvedExams});
  }
  if(action!=='assignments')return;
  const assignments=await db.all('assignments','competitionId',c.id),attempts=await db.all('attempts','competitionId',c.id);
  if(parts.length===5&&method==='GET') {
    const users=await db.all('users'),versions=await db.all('versions','competitionId',c.id);
    return json(assignments.map(a=>{
      const u=users.find(u=>u.id===a.userId)||{},v=versions.find(v=>v.id===a.examVersionId),attempt=finalize(db,attempts.filter(t=>t.userId===a.userId&&!t.isInvalidated).sort((a,b)=>b.id-a.id)[0]),status=attemptStatus(attempt);
      return {...a,...pick(u,['username','fullName','department','isActive']),isDemo:!!(u.isDemo||c.isDemo),examName:v?.exam?.name,versionNumber:v?.versionNumber,attemptStatus:status,attemptStatusLabel:statusLabel(status),canChange:!attempt&&c.status!=='Ended'};
    }).sort((a,b)=>a.fullName.localeCompare(b.fullName,'vi')));
  }
  ensure(c.status!=='Ended','Cuộc thi đã kết thúc, không thể thay đổi phân công.',409);
  if(parts.length===7&&parts[6]==='attempt-session'&&method==='POST') {
    const a=assignments.find(a=>a.userId===uid);ensure(a&&await assignmentMetadata(db,a),'Không tìm thấy phân công hợp lệ.',404);ensure(c.status==='Published','Chỉ có thể chuyển phiên trong cuộc thi đã công bố.',409);
    const reason=text(body.reason,1000,true),attempt=finalize(db,attempts.filter(t=>t.userId===uid&&!t.isInvalidated).sort((a,b)=>b.id-a.id)[0]);ensure(attempt,'Không tìm thấy lượt cũ cần chuyển phiên hoặc thay thế.',409);
    const sessions=(await db.all('sessions','userId',uid)).filter(s=>!s.revokedAtUtc&&Date.parse(s.expiresAtUtc)>Date.now()&&s.id!==attempt.ownerSessionId).sort((a,b)=>b.createdAtUtc.localeCompare(a.createdAtUtc));
    ensure(sessions.length,'Không tìm thấy phiên đăng nhập mới đang hoạt động của thí sinh.',409);
    const next=sessions[0],previous=attempt.ownerSessionId;
    if(body.allowRetake===true) {
      ensure(validSchedule(c)&&Date.parse(c.closesAtUtc)>Date.now(),'Không thể cấp lượt thay thế sau giờ đóng thi.',409);
      Object.assign(attempt,{isInvalidated:true,invalidatedAtUtc:now(),invalidatedByUserId:user.id,invalidationReason:reason,writerTabId:null,writerLeaseUntilUtc:null});
      db.put('grants',{id:`${c.id}_${uid}`,competitionId:c.id,userId:uid,sessionId:next.id,oldAttemptId:attempt.id,actorUserId:user.id,createdAtUtc:now(),reason});
    }else{
      ensure(!attempt.submittedAtUtc&&Date.parse(attempt.deadlineAtUtc)>Date.now(),'Lượt thi đã kết thúc; chỉ có thể cấp lượt thay thế nếu thể lệ cho phép.',409);
      Object.assign(attempt,{ownerSessionId:next.id,writerTabId:null,writerLeaseUntilUtc:null});
    }
    db.put('attempts',attempt);db.put('attemptEvents',{id:db.next('attemptEvents'),competitionId:c.id,attemptId:attempt.id,actorUserId:user.id,occurredAtUtc:now(),action:body.allowRetake?'ReplacementAuthorized':'SessionTransferred',reason,previousSessionId:previous,newSessionId:next.id,replacementAttemptId:null});
    return json({message:body.allowRetake?'Đã vô hiệu hóa lượt cũ. Thí sinh có thể bắt đầu lượt thay thế bằng phiên mới.':'Đã chuyển quyền làm bài sang phiên đăng nhập mới.',attemptId:body.allowRetake?null:attempt.id,deadlineAtUtc:body.allowRetake?null:attempt.deadlineAtUtc});
  }
  if((parts.length===5&&method==='POST')||(parts.length===6&&method==='PUT')) {
    const userIds=method==='PUT'?[uid]:body.userIds;
    ensure(Array.isArray(userIds)&&userIds.length>0&&userIds.length<=400&&userIds.every(id=>Number.isInteger(id)&&id>0)&&new Set(userIds).size===userIds.length,'Chọn từ 1 đến 400 thí sinh, không trùng nhau.');
    const exam=await db.get('exams',body.examId),version=exam?.currentApprovedVersionId?await db.get('versions',exam.currentApprovedVersionId):null;
    ensure(exam?.competitionId===c.id&&version?.examId===exam.id&&version.draftRevision===exam.draftRevision,'Chỉ được chọn đề đã duyệt bản hiện tại và thuộc đúng cuộc thi này.');
    const users=await db.all('users');
    for(const userId of userIds) {
      const u=users.find(u=>u.id===userId),existing=assignments.find(a=>a.userId===userId);
      ensure(u?.isActive&&u.role==='Candidate','Một hoặc nhiều tài khoản không tồn tại, đã khóa hoặc không phải Thí sinh.');
      ensure(!attempts.some(a=>a.userId===userId&&!a.isInvalidated),'Thí sinh đã bắt đầu làm bài; không thể đổi đề hoặc phân công.',409);
      ensure(method==='PUT'?!!existing:!existing,method==='PUT'?'Không tìm thấy phân công.':'Một hoặc nhiều tài khoản đã có phân công.',409);
      db.put('assignments',{id:`${c.id}_${userId}`,competitionId:c.id,userId,examId:exam.id,examVersionId:version.id,assignedAtUtc:existing?.assignedAtUtc||now(),updatedAtUtc:now(),assignedByUserId:user.id});
    }
    return json({message:`Đã phân đề cho ${userIds.length} thí sinh.`,assignedCount:userIds.length},method==='POST'?201:200);
  }
  if(parts.length===6&&method==='DELETE') {
    const a=assignments.find(a=>a.userId===uid);ensure(a,'Không tìm thấy phân công.',404);ensure(!attempts.some(a=>a.userId===uid&&!a.isInvalidated),'Thí sinh đã bắt đầu làm bài; không thể thu hồi phân công.',409);db.remove('assignments',a.id);return json(null,204);
  }
}
async function assigned(ctx,cid,allowEnded=false) {
  const {db,user}=ctx,c=await db.get('competitions',cid),a=await db.get('assignments',`${cid}_${user.id}`);
  const plan=allowEnded&&c?.status==='Ended'?await db.get('awardPlans',cid):null;
  ensure(c&&(c.status==='Published'||allowEnded&&c.status==='Ended'&&plan?.status==='Published')&&a,'Không tìm thấy cuộc thi hoặc đề được phân tham gia.',404);
  const meta=await assignmentMetadata(db,a);ensure(meta,'Không tìm thấy đề đã duyệt hợp lệ.',404);return {c,a,meta};
}
function canStart(c,attempt,grant) { return c.status==='Published'&&!attempt&&validSchedule(c)&&Date.parse(c.opensAtUtc)<=Date.now()&&(grant||Date.now()<=Date.parse(c.startDeadlineUtc))&&Date.now()<Date.parse(c.closesAtUtc); }
async function candidateCompetition(ctx,cid) {
  const {c,meta}=await assigned(ctx,cid,true),a=await activeAttempt(ctx.db,cid,ctx.user.id),grant=await ctx.db.get('grants',`${cid}_${ctx.user.id}`),status=attemptStatus(a);
  const allowed=canStart(c,a,grant?.sessionId===ctx.session.id);
  return {...competitionProfile(c),assignedExam:meta,attemptStatus:status,attemptStatusLabel:statusLabel(status),canStart:allowed,startBlockedReason:allowed?null:c.status==='Ended'?'Cuộc thi đã kết thúc.':a?'Bạn đã bắt đầu hoặc đã nộp lượt thi.':'Hiện không nằm trong thời gian được phép bắt đầu lượt thi.'};
}
function claim(ctx,a) {
  const tab=ctx.request.headers.get('X-Quiz-Attempt-Tab');
  ensure(/^[a-zA-Z0-9_-]{8,64}$/.test(tab||''),'Phiên tab làm bài không hợp lệ.');
  ensure(a.ownerSessionId===ctx.session.id,'Tài khoản đang có phiên làm bài',409);
  ensure(!a.writerTabId||a.writerTabId===tab||!a.writerLeaseUntilUtc||Date.parse(a.writerLeaseUntilUtc)<=Date.now(),'Bài thi đang được mở ở tab khác.',409);
  a.writerTabId=tab;a.writerLeaseUntilUtc=new Date(Date.now()+60000).toISOString();ctx.db.put('attempts',a);
}
async function packet(db,a) {
  const status=attemptStatus(a),version=status==='InProgress'?await loadVersion(db,a.examVersionId):null;
  const byId=new Map((version?.snapshot.questions||[]).map(q=>[q.id,q]));
  return {attemptId:a.id,attemptStatus:status,startedAtUtc:a.startedAtUtc,deadlineAtUtc:a.deadlineAtUtc,submittedAtUtc:a.submittedAtUtc||null,serverNowUtc:now(),remainingSeconds:status==='InProgress'?Math.max(0,Math.ceil((Date.parse(a.deadlineAtUtc)-Date.now())/1000)):0,answeredCount:a.questions.filter(q=>q.answer).length,totalQuestionCount:a.questions.length,
    leaseHeartbeatMilliseconds:20000,
    questions:status==='InProgress'?a.questions.map(q=>{const source=byId.get(q.id);ensure(source,'Phiên bản đề không hợp lệ.',409);return {id:q.id,position:q.position,type:source.type,content:source.content,options:q.optionsOrder.map(key=>source.options.find(o=>o.key===key)),answer:q.answer,isMarked:q.isMarked};}):[]};
}
export async function candidateRoute(ctx) {
  const {db,parts,method,user,body}=ctx;if(parts[1]!=='candidate')return;
  if(parts[2]==='overview'&&method==='GET')return json({role:user.role,timeZone:TIME_ZONE,serverTimeUtc:now(),permissions:permissions(user)});
  if(parts[2]!=='competitions')return;
  const cid=Number(parts[3]);
  if(parts.length===3&&method==='GET') {
    const result=[];
    for(const a of await db.all('assignments','userId',user.id)) {
      const c=await db.get('competitions',a.competitionId);if(c?.status==='Draft')continue;
      if(c?.status==='Ended'&&(await db.get('awardPlans',c.id))?.status!=='Published')continue;
      if(c)result.push(await candidateCompetition(ctx,c.id));
    }
    return json(result.sort((a,b)=>b.updatedAtUtc.localeCompare(a.updatedAtUtc)));
  }
  if((parts.length===4||parts[4]==='exam')&&method==='GET')return json(await candidateCompetition(ctx,cid));
  if(parts[4]==='awards'&&method==='GET'){await assigned(ctx,cid,true);return json(await candidateAwards(ctx,cid));}
  if(parts[4]!=='attempt')return;
  const {c,a,meta}=await assigned(ctx,cid),action=parts[5],grant=await db.get('grants',`${cid}_${user.id}`);
  let attempt=await activeAttempt(db,cid,user.id);
  if(!attempt) {
    ensure(!grant||grant.sessionId===ctx.session.id,'Tài khoản đang có phiên làm bài',409);
    if(parts.length===5&&method==='GET'){const allowed=canStart(c,null,grant?.sessionId===ctx.session.id);return json({attemptStatus:'NotStarted',canStart:allowed,startBlockedReason:allowed?null:'Hiện không nằm trong thời gian được phép bắt đầu lượt thi.',serverNowUtc:now(),assignedExam:meta});}
    ensure(action==='start'&&method==='POST','Bạn chưa bắt đầu lượt thi.',409);
    ensure(canStart(c,null,grant?.sessionId===ctx.session.id),'Hiện không nằm trong thời gian được phép bắt đầu lượt thi.',409);
    const version=await loadVersion(db,a.examVersionId);ensure(version?.snapshot.questions.length,'Phiên bản đề không có câu hỏi.',409);
    attempt={id:db.next('attempts'),competitionId:cid,examId:a.examId,userId:user.id,examVersionId:a.examVersionId,ownerSessionId:ctx.session.id,startedAtUtc:now(),deadlineAtUtc:new Date(Math.min(Date.now()+meta.durationMinutes*60000,Date.parse(c.closesAtUtc))).toISOString(),submittedAtUtc:null,isInvalidated:false,writerTabId:null,writerLeaseUntilUtc:null,
      questions:shuffle(version.snapshot.questions).map((q,index)=>({id:q.id,position:index+1,optionsOrder:shuffle(q.options.map(o=>o.key)),answer:null,isMarked:false,updatedAtUtc:null}))};
    claim(ctx,attempt);db.put('attempts',attempt);
    if(grant){db.remove('grants',grant.id);for(const e of await db.all('attemptEvents','attemptId',grant.oldAttemptId))if(e.action==='ReplacementAuthorized'&&!e.replacementAttemptId){e.replacementAttemptId=attempt.id;db.put('attemptEvents',e);}}
    return json(await packet(db,attempt));
  }
  ensure(attempt.ownerSessionId===ctx.session.id,'Tài khoản đang có phiên làm bài',409);
  finalize(db,attempt);
  if((parts.length===5&&method==='GET')||(action==='start'&&method==='POST')){if(!attempt.submittedAtUtc)claim(ctx,attempt);return json(await packet(db,attempt));}
  if(action==='submit'&&method==='POST') {
    if(!attempt.submittedAtUtc){claim(ctx,attempt);attempt.submittedAtUtc=now();db.put('attempts',attempt);}return json(await packet(db,attempt));
  }
  if(action==='lease'&&method==='POST') {
    if(attempt.submittedAtUtc)return json({message:'Lượt thi đã kết thúc.'},409);
    claim(ctx,attempt);return json({leaseUntilUtc:attempt.writerLeaseUntilUtc});
  }
  if(action==='questions'&&parts.length===7&&method==='PUT') {
    if(attempt.submittedAtUtc)return json({message:'Lượt thi đã kết thúc và không thể thay đổi câu trả lời.'},409);
    claim(ctx,attempt);const q=attempt.questions.find(q=>q.id===Number(parts[6]));ensure(q,'Câu hỏi không thuộc lượt thi này.',404);
    ensure(body.answer==null||body.answer===''||typeof body.answer==='string'&&q.optionsOrder.includes(body.answer),'Phương án trả lời không hợp lệ cho câu hỏi này.');
    q.answer=body.answer||null;q.isMarked=body.isMarked===true;q.updatedAtUtc=now();db.put('attempts',attempt);return json({saved:true,updatedAtUtc:q.updatedAtUtc});
  }
}
