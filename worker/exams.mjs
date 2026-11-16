import {ensure,fail,text,integer,now,json,pick,sha256,parseLocal,local,TIME_ZONE} from './common.mjs';
import {hasAccess} from '../shared/access.mjs';
import {topicCatalog} from './topicCatalog.mjs';
import {importPreview,workbookResponse,questionHeaders} from './xlsx.mjs';

export const competitionProfile=c=>pick(c,['id','name','description','rules','status','isDemo','createdAtUtc','updatedAtUtc','opensAtUtc','startDeadlineUtc','closesAtUtc','publishedAtUtc','durationMinutes']);
const questionKeys=['topic','type','content','options','correctAnswer','points','isScenario','explanation','source','group','requiresSourceReview','sourceReviewed','reviewedByUserId','reviewedAtUtc'];
export const questionFields=q=>pick(q,questionKeys);
export function syncQuestionCounts(exam, questions) {
  if (!questions.length) return;
  exam.targetQuestionCount=questions.length;
  exam.commonQuestionCount=questions.filter(q=>q.group==='Common').length;
  exam.specializedQuestionCount=questions.filter(q=>q.group==='Specialized').length;
}
export function applyQuestion(body,userId) {
  const type=body.type??'SingleChoice',group=body.group??'Common';
  ensure(['SingleChoice','TrueFalse'].includes(type),'Loại câu hỏi không hợp lệ.');
  ensure(Array.isArray(body.options)&&body.options.length<=6,'Tối đa 6 phương án.');
  const options=type==='TrueFalse'?[{key:'True',text:'Đúng'},{key:'False',text:'Sai'}]:body.options.map(o=>({key:text(o?.key,20),text:text(o?.text,2000)}));
  const source=text(body.source,2000),reviewed=body.sourceReviewed===true&&source.length>0;
  ensure(Number.isFinite(body.points),'Điểm phải là một số.');
  return {topic:text(body.topic,200),type,group,options,content:text(body.content,5000),correctAnswer:body.correctAnswer?text(body.correctAnswer,20):null,
    points:body.points,isScenario:body.isScenario===true,explanation:text(body.explanation,5000),source,
    requiresSourceReview:body.requiresSourceReview===true,sourceReviewed:reviewed,reviewedByUserId:reviewed?userId:null,reviewedAtUtc:reviewed?now():null};
}
export function validateQuestion(q) {
  const errors=[],add=(field,message)=>errors.push({field,message,questionId:q.id??null,questionNumber:q.position??null});
  if(!['SingleChoice','TrueFalse'].includes(q.type))add('type','Loại câu hỏi không hợp lệ.');
  if(!q.content?.trim())add('content','Câu hỏi chưa có nội dung.');
  if(q.content?.length>5000)add('content','Nội dung tối đa 5.000 ký tự.');
  if(!Array.isArray(q.options)||q.options.length<2||q.options.length>6)add('options','Câu hỏi cần từ 2 đến 6 phương án.');
  else {
    if(q.options.some(o=>!o.key?.trim()||!o.text?.trim()||o.key.length>20||o.text.length>2000))add('options','Mỗi phương án cần mã và nội dung hợp lệ.');
    if(new Set(q.options.map(o=>o.key.toLowerCase())).size!==q.options.length)add('options','Mã phương án không được trùng nhau.');
    if(q.options.filter(o=>o.key===q.correctAnswer).length!==1)add('correctAnswer','Chưa chọn một đáp án đúng hợp lệ.');
  }
  if(!(q.points>0&&q.points<=1000))add('points','Điểm phải lớn hơn 0 và không vượt quá 1.000.');
  return errors;
}
export const touch=e=>{ensure(e.reviewStatus!=='PendingReview','Đề đang chờ duyệt. Hãy rút về hoặc trả lại trước khi chỉnh sửa.',409);e.draftRevision++;e.reviewStatus='Draft';e.updatedAtUtc=now();};
function reviewEvent(db,exam,user,action,note='') {
 db.put('reviewEvents',{id:db.next('reviewEvents'),examId:exam.id,competitionId:exam.competitionId,actorUserId:user.id,actorName:user.fullName||user.username,action,note,draftRevision:exam.draftRevision,occurredAtUtc:now()});
}
export async function examProfile(db,exam) {
  const group=await db.get('groups',exam.fieldGroupId),version=exam.currentApprovedVersionId?await db.get('versions',exam.currentApprovedVersionId):null;
  return {...exam,fieldGroupName:group?.name??'',isApproved:version?.draftRevision===exam.draftRevision,
    competitionStatus:(await db.get('competitions',exam.competitionId))?.status||'Draft',reviewStatus:version?.draftRevision===exam.draftRevision?'Approved':exam.reviewStatus==='Returned'?'Draft':exam.reviewStatus||'Draft',questionCount:(await db.all('questions','examId',exam.id)).length};
}
export async function loadVersion(db,id) {
  const v=await db.get('versions',id);if(!v)return null;
  const chunks=(await db.all('versionChunks','versionId',id)).sort((a,b)=>a.index-b.index);
  return {...v,snapshot:{schemaVersion:1,exam:v.exam,questions:chunks.flatMap(c=>c.questions),approvedAtUtc:v.approvedAtUtc}};
}
async function examInput(db,cid,body) {
  const fieldGroupId=integer(body.fieldGroupId,1,2147483647),group=await db.get('groups',fieldGroupId);
  ensure(group?.competitionId===cid,'Nhóm lĩnh vực không thuộc cuộc thi này.');
  const targetQuestionCount=integer(body.targetQuestionCount,1,500),commonQuestionCount=integer(body.commonQuestionCount??targetQuestionCount,0,500),specializedQuestionCount=integer(body.specializedQuestionCount??0,0,500);

  return {name:text(body.name,300,true),fieldGroupId,durationMinutes:integer(body.durationMinutes,1,480),targetQuestionCount,commonQuestionCount,specializedQuestionCount};
}
async function preview(db,exam) {
  const questions=(await db.all('questions','examId',exam.id)).sort((a,b)=>a.position-b.position||a.id-b.id),errors=[];
  if(!questions.length)errors.push({field:'questions',message:'Đề chưa có câu hỏi; chưa thể duyệt đề.'});
  if(questions.length!==exam.targetQuestionCount)errors.push({field:'targetQuestionCount',message:`Đề đang có ${questions.length} câu, cần ${exam.targetQuestionCount} câu.`});

  questions.forEach(q=>errors.push(...validateQuestion(q)));
  return {exam:await examProfile(db,exam),questions,validation:{canApprove:errors.length===0,errors,warnings:[]}};
}
export async function bankRoute(ctx) {
  const {db,body,method,parts,url,user}=ctx;
  if(parts[2]!=='question-bank')return;
  if(parts[3]==='set-topic'&&method==='POST') {
    ensure(Array.isArray(body.questionIds)&&body.questionIds.length>0&&body.questionIds.length<=400&&new Set(body.questionIds).size===body.questionIds.length,'Chọn từ 1 đến 400 câu hỏi khác nhau.');
    const topic=(await topicCatalog(db)).find(t=>t.id===body.topicId);ensure(topic,'Chủ đề không tồn tại.',404);
    const bank=await db.all('bank'),selected=body.questionIds.map(id=>bank.find(q=>q.id===id&&q.isActive));ensure(selected.every(Boolean),'Một hoặc nhiều câu hỏi không còn hoạt động.',404);
    const ids=new Set(body.questionIds),linked=(await db.all('questions')).filter(q=>ids.has(q.bankQuestionId));
    ensure(selected.length+linked.length<440,'Có quá nhiều bản liên kết. Hãy chia nhỏ danh sách câu hỏi.',409);
    for(const q of selected){q.topic=topic.name;q.updatedAtUtc=now();db.put('bank',q);}
    const exams=new Set();for(const q of linked){q.topic=topic.name;db.put('questions',q);exams.add(q.examId);}
    for(const id of exams){const e=await db.get('exams',id);touch(e);db.put('exams',e);}
    ensure(db.writes.size<=449,'Có quá nhiều liên kết. Hãy chia nhỏ danh sách.',409);return json({updatedCount:selected.length});
  }
  const id=Number(parts[3]);
  if(parts.length===3&&method==='GET') {
    const search=(url.searchParams.get('search')||'').trim().toLocaleLowerCase('vi'),group=url.searchParams.get('group'),topic=url.searchParams.get('topic');
    const linked=await db.all('questions');
    return json((await db.all('bank')).filter(q=>q.isActive&&(!search||q.content.toLocaleLowerCase('vi').includes(search))&&(!group||q.group===group)&&(!topic||(q.topic?.trim()||q.source?.split('|')[0].trim()||'Chưa phân chủ đề')===topic))
      .sort((a,b)=>b.updatedAtUtc.localeCompare(a.updatedAtUtc)||a.id-b.id).map(q=>({...q,linkedDraftCount:linked.filter(item=>item.bankQuestionId===q.id).length})));
  }
  if(parts.length===3&&method==='POST') {
    const q={...applyQuestion(body,user.id),id:db.next('bank'),isActive:true,createdByUserId:user.id,createdAtUtc:now(),updatedAtUtc:now()};db.put('bank',q);return json(q,201);
  }
  const question=await db.get('bank',id);ensure(question?.isActive,'Không tìm thấy câu hỏi đang hoạt động.',404);
  if(parts.length===4&&['PUT','DELETE'].includes(method)) {
    if(method==='PUT')Object.assign(question,applyQuestion(body,user.id));else question.isActive=false;
    question.updatedAtUtc=now();db.put('bank',question);
    const changed=new Set();
    for(const linked of await db.all('questions','bankQuestionId',id)) {
      if(method==='PUT')Object.assign(linked,questionFields(question));else linked.bankQuestionId=null;
      db.put('questions',linked);changed.add(linked.examId);
    }
    for(const examId of changed){const e=await db.get('exams',examId);touch(e);db.put('exams',e);}
    return method==='PUT'?json(question):json(null,204);
  }
}
export async function contentRoute(ctx,competition) {
  const {db,body,method,parts,user}=ctx,cid=competition.id,sub=parts[4],id=Number(parts[5]);
  if(sub==='field-groups') {
    const groups=await db.all('groups','competitionId',cid);
    if(parts.length===5&&method==='GET')return json(groups.sort((a,b)=>a.id-b.id));
    if((parts.length===5&&method==='POST')||(parts.length===6&&method==='PUT')) {
      const group=method==='POST'?{id:db.next('groups'),competitionId:cid,isSample:false}:groups.find(g=>g.id===id);
      ensure(group,'Không tìm thấy nhóm lĩnh vực.',404);
      const name=text(body.name,200,true);ensure(!groups.some(g=>g.id!==group.id&&g.name===name),'Tên nhóm lĩnh vực đã tồn tại.');
      if(group.name!==name&&method==='PUT')for(const exam of await db.all('exams','fieldGroupId',id)){touch(exam);db.put('exams',exam);}
      group.rankingGroupName=body.rankingGroupName!=null?(text(body.rankingGroupName,200)||name):(group.rankingGroupName===group.name?name:group.rankingGroupName||name);
      group.name=name;group.isSample=false;db.put('groups',group);return json(group,method==='POST'?201:200);
    }
  }
  if(sub==='schedule'&&parts.length===5) {
    if(method==='PUT') {
      const opens=parseLocal(body.opensAtLocal),deadline=parseLocal(body.startDeadlineLocal),closes=parseLocal(body.closesAtLocal);
      ensure(opens<deadline&&deadline<=closes,'Lịch thi phải có giờ mở < hạn bắt đầu ≤ giờ đóng.');
      const durationMinutes=body.durationMinutes==null?competition.durationMinutes:integer(body.durationMinutes,1,480);
      Object.assign(competition,{durationMinutes,opensAtUtc:opens,startDeadlineUtc:deadline,closesAtUtc:closes,updatedAtUtc:now()});db.put('competitions',competition);
    }
    if(['GET','PUT'].includes(method)) {
      const available=(Date.parse(competition.closesAtUtc)-Date.parse(competition.startDeadlineUtc))/60000;
      const exams=await db.all('exams','competitionId',cid);
      const warnings=competition.durationMinutes!=null?(competition.durationMinutes>available?[{examId:null,examName:'Th\u1eddi l\u01b0\u1ee3ng chung',durationMinutes:competition.durationMinutes,availableMinutes:Math.max(0,available),message:`Th\u1eddi l\u01b0\u1ee3ng ${competition.durationMinutes} ph\u00fat d\u00e0i h\u01a1n th\u1eddi gian c\u00f2n l\u1ea1i khi b\u1eaft \u0111\u1ea7u s\u00e1t h\u1ea1n.`}]:[]):exams.filter(e=>e.durationMinutes>available).map(e=>({examId:e.id,examName:e.name,durationMinutes:e.durationMinutes,availableMinutes:Math.max(0,available),message:`\u0110\u1ec1 ${e.name} d\u00e0i h\u01a1n th\u1eddi gian c\u00f2n l\u1ea1i khi b\u1eaft \u0111\u1ea7u s\u00e1t h\u1ea1n.`}));
      return json({...pick(competition,['durationMinutes','opensAtUtc','startDeadlineUtc','closesAtUtc']),opensAtLocal:local(competition.opensAtUtc),startDeadlineLocal:local(competition.startDeadlineUtc),closesAtLocal:local(competition.closesAtUtc),timeZone:TIME_ZONE,warnings});
    }
  }
  if(sub!=='exams')return;
  if(parts.length===5) {
    if(method==='GET')return json(await Promise.all((await db.all('exams','competitionId',cid)).sort((a,b)=>a.id-b.id).map(e=>examProfile(db,e))));
    if(method==='POST'){const e={...await examInput(db,cid,body),id:db.next('exams'),competitionId:cid,isDemo:competition.isDemo,draftRevision:1,currentApprovedVersionId:null,createdAtUtc:now(),updatedAtUtc:now()};db.put('exams',e);return json(await examProfile(db,e),201);}
  }
  const exam=await db.get('exams',id);ensure(exam?.competitionId===cid,'Không tìm thấy đề thi trong cuộc thi.',404);
  if(parts.length===6) {
    if(method==='PUT'){Object.assign(exam,await examInput(db,cid,body));touch(exam);db.put('exams',exam);}
    if(['GET','PUT'].includes(method))return json(await examProfile(db,exam));
  }
  const action=parts[6],qid=Number(parts[7]);
  if(action==='preview'&&method==='GET')return json(await preview(db,exam));
  if(action==='review-history'&&method==='GET')return json((await db.all('reviewEvents','examId',id)).sort((a,b)=>b.id-a.id));
  if(action==='submit-review'&&method==='POST') {
    const p=await preview(db,exam);
    ensure(p.validation.canApprove,'Đề chưa đủ điều kiện gửi duyệt.',400,{errors:p.validation.errors});
    ensure(competition.opensAtUtc&&competition.startDeadlineUtc&&competition.closesAtUtc&&competition.opensAtUtc<competition.startDeadlineUtc&&competition.startDeadlineUtc<=competition.closesAtUtc,'Cần lưu lịch thi hợp lệ trước khi trình duyệt.',400);
    ensure((await db.all('assignments','competitionId',cid)).length>0,'Cần phân công ít nhất một thí sinh trước khi trình duyệt.',400);
    ensure(p.exam.reviewStatus!=='Approved'&&exam.reviewStatus!=='PendingReview','Đề đã duyệt hoặc đang chờ duyệt.',409);
    ensure(body.draftRevision==null||body.draftRevision===exam.draftRevision,'Bản nháp đã thay đổi. Hãy tải lại trước khi gửi duyệt.',409);
    Object.assign(exam,{reviewStatus:'PendingReview',submittedRevision:exam.draftRevision,submittedByUserId:user.id,submittedAtUtc:now(),reviewNote:'',updatedAtUtc:now()});db.put('exams',exam);reviewEvent(db,exam,user,'Submitted');return json(await examProfile(db,exam));
  }
  if(['withdraw-review','return-review'].includes(action)&&method==='POST') {
    ensure(exam.reviewStatus==='PendingReview','Đề không ở trạng thái chờ duyệt.',409);
    if(action==='withdraw-review')ensure(exam.submittedByUserId===user.id||hasAccess(user,'manageUsers'),'Chỉ người gửi hoặc quản trị viên được rút đề.',403);
    const note=text(body.note,2000,action==='return-review');
    exam.reviewStatus='Draft';exam.reviewNote=note;exam.updatedAtUtc=now();db.put('exams',exam);reviewEvent(db,exam,user,action==='return-review'?'Returned':'Withdrawn',note);return json(await examProfile(db,exam));
  }
  if(action==='approve'&&method==='POST') {
    const p=await preview(db,exam);ensure(p.validation.canApprove,'Chưa thể duyệt đề. Vui lòng sửa các lỗi được chỉ rõ.',400,{canApprove:false,errors:p.validation.errors});
    const versions=await db.all('versions','examId',id),existing=versions.find(v=>v.draftRevision===exam.draftRevision);
    if(existing&&exam.currentApprovedVersionId===existing.id)return json(await loadVersion(db,existing.id));
    ensure(exam.reviewStatus==='PendingReview'&&exam.submittedRevision===exam.draftRevision,'Đề phải được gửi chờ duyệt trước khi duyệt.',409);
    const approvalNote=text(body.note,2000,true);
    const approvedAtUtc=now(),snapshot={schemaVersion:1,exam:pick(p.exam,['id','competitionId','name','fieldGroupId','fieldGroupName','durationMinutes','targetQuestionCount','commonQuestionCount','specializedQuestionCount','isDemo']),questions:p.questions,approvedAtUtc};
    const version={id:db.next('versions'),examId:id,competitionId:cid,versionNumber:Math.max(0,...versions.map(v=>v.versionNumber))+1,draftRevision:exam.draftRevision,
      exam:snapshot.exam,hashSha256:await sha256(JSON.stringify(snapshot)),approvedAtUtc,approvedByUserId:user.id};
    let chunk=[],size=0,index=0;
    const flush=()=>{if(chunk.length){db.put('versionChunks',{id:`${version.id}_${index}`,versionId:version.id,competitionId:cid,index:index++,questions:chunk});chunk=[];size=0;}};
    for(const q of p.questions){const bytes=new TextEncoder().encode(JSON.stringify(q)).length;if(size+bytes>200000)flush();chunk.push(q);size+=bytes;}flush();
    db.put('versions',version);for(const a of await db.all('assignments','competitionId',cid)){if(a.examId===exam.id&&!a.examVersionId){a.examVersionId=version.id;a.updatedAtUtc=now();db.put('assignments',a);}}exam.currentApprovedVersionId=version.id;exam.reviewStatus='Approved';exam.reviewNote=approvalNote;db.put('exams',exam);reviewEvent(db,exam,user,'Approved',exam.reviewNote);return json({...version,snapshot});
  }
  if(action==='versions'&&method==='GET') {
    if(parts.length===7)return json((await db.all('versions','examId',id)).sort((a,b)=>b.versionNumber-a.versionNumber).map(v=>({...v,snapshot:null})));
    const version=await loadVersion(db,qid);ensure(version?.examId===id,'Không tìm thấy phiên bản đề đã duyệt.',404);return json(version);
  }
  if(action==='questions') {
    const questions=await db.all('questions','examId',id);
    if(parts.length===7&&method==='GET')return json(questions.sort((a,b)=>a.position-b.position||a.id-b.id));
    if(parts.length===7&&method==='POST') {
      ensure(questions.length<500,'Mỗi đề hỗ trợ tối đa 500 câu hỏi.');
      const q={...applyQuestion(body,user.id),id:db.next('questions'),examId:id,bankQuestionId:null,position:Math.max(0,...questions.map(q=>q.position))+1};db.put('questions',q);touch(exam);db.put('exams',exam);return json(q,201);
    }
    if(parts[7]==='from-bank'&&method==='POST') {
      ensure(Array.isArray(body.questionIds)&&body.questionIds.length>0&&body.questionIds.length<=400&&new Set(body.questionIds).size===body.questionIds.length,'Chọn từ 1 đến 400 câu hỏi, không trùng nhau.');
      const bank=await db.all('bank'),selected=body.questionIds.map(n=>bank.find(q=>q.id===n&&q.isActive));ensure(selected.every(Boolean),'Một hoặc nhiều câu hỏi không còn hoạt động.');
        const existing=new Set(questions.map(q=>q.bankQuestionId)),fresh=selected.filter(q=>!existing.has(q.id));
        ensure(questions.length+fresh.length<=500,'Mỗi đề hỗ trợ tối đa 500 câu hỏi.');
        if(!fresh.length)return json([]);
        let pos=Math.max(0,...questions.map(q=>q.position));const added=fresh.map(q=>({...questionFields(q),id:db.next('questions'),examId:id,bankQuestionId:q.id,position:++pos}));added.forEach(q=>db.put('questions',q));
        if(body.syncCounts===true)syncQuestionCounts(exam,[...questions,...added]);
        touch(exam);db.put('exams',exam);return json(added);
    }
      if(parts[7]==='remove-many'&&method==='POST') {
        ensure(Array.isArray(body.questionIds)&&body.questionIds.length>0&&body.questionIds.length<=400&&new Set(body.questionIds).size===body.questionIds.length,'Chọn từ 1 đến 400 câu hỏi, không trùng nhau.');
        const ids=new Set(body.questionIds);ensure(body.questionIds.every(n=>questions.some(q=>q.id===n)),'Có câu hỏi không thuộc đề thi này.',404);
        for(const n of ids)db.remove('questions',n);
        if(body.syncCounts===true)syncQuestionCounts(exam,questions.filter(q=>!ids.has(q.id)));
        touch(exam);db.put('exams',exam);return json({removedCount:ids.size});
      }
    const question=questions.find(q=>q.id===qid);ensure(question,'Không tìm thấy câu hỏi trong đề thi.',404);
    if(parts.length===8&&['PUT','DELETE'].includes(method)) {
      if(method==='PUT'){Object.assign(question,applyQuestion(body,user.id));db.put('questions',question);}else db.remove('questions',qid);
      touch(exam);db.put('exams',exam);return method==='PUT'?json(question):json(null,204);
    }
  }
  if(action==='import-template'&&method==='GET')return workbookResponse([questionHeaders], 'MauNhapCauHoi_TanHoa.xlsx','CauHoi');
  if(['import-preview','import'].includes(action)&&method==='POST') {
    const file=ctx.form?.get('file');ensure(file&&typeof file.arrayBuffer==='function'&&/\.xlsx$/i.test(file.name)&&file.size>0&&file.size<=5*1024*1024,'Chọn tệp Excel .xlsx hợp lệ, tối đa 5 MB.');
    const p=importPreview(new Uint8Array(await file.arrayBuffer()));
    if(action==='import-preview')return json(p);
    ensure(p.canImport,'Tệp có lỗi, vui lòng kiểm tra lại.',400,p);
    const questions=await db.all('questions','examId',id);ensure(questions.length+p.totalRows<=500,'Mỗi đề hỗ trợ tối đa 500 câu hỏi.');
    ensure(p.totalRows<=400,'Gói miễn phí hỗ trợ nhập tối đa 400 câu mỗi lần. Hãy chia tệp.');
    let pos=Math.max(0,...questions.map(q=>q.position));
    for(const row of p.rows)db.put('questions',{...applyQuestion(row.question,user.id),id:db.next('questions'),examId:id,bankQuestionId:null,position:++pos});
    touch(exam);db.put('exams',exam);return json({message:`Đã nhập ${p.totalRows} câu hỏi vào bản nháp.`,importedCount:p.totalRows,draftRevision:exam.draftRevision,warnings:[]});
  }
}
