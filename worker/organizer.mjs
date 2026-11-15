import {ensure,fail,text,integer,now,json,profile,permissions,TIME_ZONE} from './common.mjs';
import {hasAccess,WORKFLOW_PERMISSIONS,workflowPermissions} from '../shared/access.mjs';
import {processesRoute,resolveAccessRequest} from './processes.mjs';
import {resolveProcessAccess} from '../shared/processes.mjs';
import {passwordHash} from './auth.mjs';
import {competitionProfile,contentRoute,bankRoute,questionFields,syncQuestionCounts} from './exams.mjs';
import {organizationUnitsRoute} from './organizationUnits.mjs';
import {workflowOverview} from './workflows.mjs';
import {topicsRoute} from './topicCatalog.mjs';
import {selectTopicQuestions} from './topics.mjs';
import {assignmentRoute} from './attempts.mjs';
import {systemAdminRoute} from './systemAdmin.mjs';
import {resultsRoute} from './results.mjs';

export async function organizerRoute(ctx) {
  const {db,body,method,parts,user,env}=ctx;
  const auditAccount=(account,action)=>db.put('accessEvents',{id:db.next('accessEvents'),userId:account.id,actorUserId:user.id,actorName:user.fullName||user.username,action,occurredAtUtc:now()});
  if(parts[1]!=='organizer')return;
  if(['system-summary','activity'].includes(parts[2]))return systemAdminRoute(ctx);
  if(parts[2]==='processes')return processesRoute(ctx);
  if(parts[2]==='workflows'&&method==='GET')return workflowOverview(ctx);
  if(parts[2]==='overview'&&method==='GET') {
    const users=await db.all('users');return json({role:user.role,timeZone:TIME_ZONE,serverTimeUtc:now(),userCount:users.length,organizerCount:users.filter(u=>u.role==='Organizer').length,candidateCount:users.filter(u=>u.role==='Candidate').length,demoUserCount:users.filter(u=>u.isDemo).length,permissions:permissions(user)});
  }
  if(parts[2]==='review-queue'&&method==='GET') {
    const competitions=await db.all('competitions');return json((await db.all('exams')).filter(e=>e.reviewStatus==='PendingReview').sort((a,b)=>a.submittedAtUtc.localeCompare(b.submittedAtUtc)).map(e=>({...e,competitionName:competitions.find(c=>c.id===e.competitionId)?.name||''})));
  }
  if(parts[2]==='organization-units')return organizationUnitsRoute(ctx);
  if(parts[2]==='users') {
    const catalog=await db.all('processes');
    const decorate=u=>resolveProcessAccess(u,catalog);
    const userProfile=u=>profile(decorate(u));
    const id=Number(parts[3]);
    if(parts.length===3&&method==='GET')return json((await db.all('users')).sort((a,b)=>a.id-b.id).map(userProfile));
    if(parts.length===3&&method==='POST') {
      const username=text(body.username,100,true).toLowerCase();ensure(!/[\s\x00-\x1f]/.test(username),'Tên đăng nhập không được có khoảng trắng.');
      ensure(!(await db.all('users','username',username)).length,'Tên đăng nhập đã được sử dụng.',409);
      if(body.departmentId!=null){ensure(Number.isInteger(body.departmentId)&&body.departmentId>0&&body.departmentId<=2147483647,'Phòng ban không hợp lệ.');const unit=await db.get('units',body.departmentId);ensure(unit,'Phòng ban không còn tồn tại. Hãy tải lại danh mục.',409);body.department=unit.name;}
      const access=await resolveAccessRequest(db,body);catalog.splice(0,catalog.length,...await db.all('processes'));
      const account={id:db.next('users'),username,fullName:text(body.fullName,200,true),department:text(body.department,200),role:access.role,processIds:access.processIds,permissionScope:access.permissionScope,workflowPermissions:access.workflowPermissions,isActive:true,isDemo:false,mustChangePassword:false,password:await passwordHash('123456',env.PASSWORD_PEPPER)};
      ensure(['Organizer','Candidate'].includes(account.role)&&Array.isArray(account.workflowPermissions)&&new Set(account.workflowPermissions).size===account.workflowPermissions.length&&account.workflowPermissions.every(p=>WORKFLOW_PERMISSIONS.includes(p)),'Bộ quyền không hợp lệ.');
      ensure(account.role==='Candidate'?account.workflowPermissions.length===0:account.workflowPermissions.length>0,'Tài khoản tổ chức cần ít nhất một quyền.');
      db.put('users',account);auditAccount(account,'AccountCreated');return json(userProfile(account),201);
    }
    const account=await db.get('users',id);ensure(account,'Không tìm thấy tài khoản.',404);
    if(parts[4]==='access'&&parts.length===5&&method==='PUT') {
      ensure(id!==user.id,'Không thể thay đổi quyền của chính tài khoản đang đăng nhập.',409);
      const access=await resolveAccessRequest(db,body);catalog.splice(0,catalog.length,...await db.all('processes'));
      const admins=(await db.all('users')).filter(u=>u.isActive&&hasAccess(decorate(u),'manageUsers'));
      ensure(!account.isActive||!hasAccess(decorate(account),'manageUsers')||access.workflowPermissions.includes('manageUsers')||admins.length>1,'Phải giữ ít nhất một tài khoản có quyền quản lý người dùng.',409);
      ensure(account.role===access.role||!(await db.all('attempts','userId',id)).some(a=>!a.submittedAtUtc),'Tài khoản đang có lượt thi chưa kết thúc; chưa thể đổi vai trò.',409);
      const before={role:account.role,processIds:account.processIds||[],workflowPermissions:workflowPermissions(decorate(account))};
      account.role=access.role;account.processIds=access.processIds;account.permissionScope=access.permissionScope;account.workflowPermissions=access.workflowPermissions;db.put('users',account);
      for(const s of await db.all('sessions','userId',id))if(!s.revokedAtUtc){s.revokedAtUtc=now();db.put('sessions',s);}
      db.put('accessEvents',{id:db.next('accessEvents'),userId:id,actorUserId:user.id,actorName:user.fullName||user.username,action:'AccessChanged',occurredAtUtc:now(),before,after:{role:account.role,processIds:account.processIds,processNames:access.assignedProcesses.map(p=>p.name),workflowPermissions:account.workflowPermissions}});
      return json(userProfile(account));
    }
    if(parts[4]==='access-history'&&method==='GET')return json((await db.all('accessEvents','userId',id)).filter(e=>e.action==='AccessChanged').sort((a,b)=>b.occurredAtUtc.localeCompare(a.occurredAtUtc)));
    if(parts.length===4&&method==='GET')return json(userProfile(account));
    if(parts.length===4&&method==='PUT') {
      ensure(typeof body.isActive==='boolean','Trạng thái tài khoản không hợp lệ.');
      ensure(body.isActive||id!==user.id,'Không thể khóa tài khoản đang đăng nhập.');
      if(!body.isActive&&account.isActive&&hasAccess(decorate(account),'manageUsers'))ensure((await db.all('users')).filter(u=>u.isActive&&hasAccess(decorate(u),'manageUsers')).length>1,'Không thể khóa tài khoản Ban Tổ chức hoạt động cuối cùng.',409);
      if(body.departmentId!=null){ensure(Number.isInteger(body.departmentId)&&body.departmentId>0&&body.departmentId<=2147483647,'Phòng ban không hợp lệ.');const unit=await db.get('units',body.departmentId);ensure(unit,'Phòng ban không còn tồn tại. Hãy tải lại danh mục.',409);body.department=unit.name;}
      Object.assign(account,{fullName:text(body.fullName,200,true),department:text(body.department,200),isActive:body.isActive});db.put('users',account);auditAccount(account,body.isActive?'AccountUpdated':'AccountDisabled');return json(userProfile(account));
    }
    if(parts.length===4&&method==='DELETE') {
      ensure(account.role==='Candidate','Chỉ có thể xóa tài khoản thí sinh.',409);
      ensure(!(await db.all('assignments','userId',id)).length&&!(await db.all('attempts','userId',id)).length,'Tài khoản đã có phân công hoặc lượt thi; hãy khóa tài khoản để bảo toàn lịch sử.',409);
      db.remove('users',id);auditAccount(account,'AccountDeleted');for(const session of await db.all('sessions','userId',id))db.remove('sessions',session.id);return json(null,204);
    }
  }
  if(parts[2]==='topics')return topicsRoute(ctx);
  if(parts[2]==='question-bank')return bankRoute(ctx);
  if(parts[2]!=='competitions')return;
  const cid=Number(parts[3]);
  if(parts.length===3&&method==='GET')return json((await db.all('competitions')).sort((a,b)=>b.updatedAtUtc.localeCompare(a.updatedAtUtc)||b.id-a.id).map(competitionProfile));
  if(parts.length===3&&method==='POST') {
    let selected=[],initial=null;
    if(body.initialExam!=null) {
      initial={...body.initialExam};
      if(initial.topics?.length) { ensure(!initial.questionIds?.length,'Không kết hợp chủ đề với chọn câu thủ công.'); initial.questionIds=selectTopicQuestions(await db.all('bank'),initial.topics).map(q=>q.id); }
      ensure(Array.isArray(initial.questionIds)&&initial.questionIds.length>0&&initial.questionIds.length<=400&&new Set(initial.questionIds).size===initial.questionIds.length,'Chọn từ 1 đến 400 câu hỏi, không trùng nhau.');
      initial={name:text(initial.name||'Đề thi chính',300,true),durationMinutes:integer(initial.durationMinutes??30,1,480),questionIds:initial.questionIds};
      const bank=await db.all('bank');selected=initial.questionIds.map(id=>bank.find(q=>q.id===id&&q.isActive));
      ensure(selected.every(Boolean),'Một hoặc nhiều câu hỏi không còn hoạt động trong ngân hàng.');
    }
    const competition={id:db.next('competitions'),name:text(body.name,300,true),description:text(body.description,5000),rules:text(body.rules,20000),status:'Draft',isDemo:user.isDemo,createdByUserId:user.id,createdAtUtc:now(),updatedAtUtc:now(),opensAtUtc:null,startDeadlineUtc:null,closesAtUtc:null,publishedAtUtc:null};db.put('competitions',competition);
    for(const name of ['Kiến thức chung','Kinh tế và hạ tầng','Đất đai và môi trường','Tài chính','Hành chính và tư pháp','Văn hóa và xã hội'])db.put('groups',{id:db.next('groups'),competitionId:competition.id,name,rankingGroupName:name,isSample:true});
    let initialExamId=null;
    if(initial) {
      const groups=await db.all('groups','competitionId',competition.id);
      const exam={id:db.next('exams'),competitionId:competition.id,name:initial.name,durationMinutes:initial.durationMinutes,fieldGroupId:groups[0].id,isDemo:competition.isDemo,draftRevision:1,currentApprovedVersionId:null,createdAtUtc:now(),updatedAtUtc:now()};
      syncQuestionCounts(exam,selected);db.put('exams',exam);initialExamId=exam.id;
      selected.forEach((q,index)=>db.put('questions',{...questionFields(q),id:db.next('questions'),examId:exam.id,bankQuestionId:q.id,position:index+1}));
    }
    return json({...competitionProfile(competition),initialExamId,initialQuestionCount:selected.length},201);
  }
  const competition=await db.get('competitions',cid);ensure(competition,'Không tìm thấy cuộc thi.',404);
  if(parts.length===4) {
    if(method==='GET')return json(competitionProfile(competition));
    if(method==='PUT'){Object.assign(competition,{name:text(body.name,300,true),description:text(body.description,5000),rules:text(body.rules,20000),updatedAtUtc:now()});db.put('competitions',competition);return json(competitionProfile(competition));}
    if(method==='DELETE') {
      ensure(competition.status==='Draft','Chỉ có thể xóa cuộc thi đang ở trạng thái nháp.',409);
      ensure(!(await db.all('attempts','competitionId',cid)).length,'Không thể xóa cuộc thi đã có lượt thi.',409);
      const exams=await db.all('exams','competitionId',cid),ids=new Set(exams.map(e=>e.id));
      for(const table of ['groups','assignments','versions','versionChunks','awardPlans','awardEvents','reviewEvents'])for(const row of await db.all(table,'competitionId',cid))db.remove(table,row.id);
      for(const q of await db.all('questions'))if(ids.has(q.examId))db.remove('questions',q.id);
      for(const e of exams)db.remove('exams',e.id);db.remove('competitions',cid);return json(null,204);
    }
  }
  return await contentRoute(ctx,competition) || await assignmentRoute(ctx,competition) || await resultsRoute(ctx,competition);
}
