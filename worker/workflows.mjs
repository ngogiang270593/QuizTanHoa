import {hasAccess} from '../shared/access.mjs';
import {now,json} from './common.mjs';
import {validSchedule,attemptStatus} from './attempts.mjs';
export async function workflowOverview(ctx) {
 const {db,user}=ctx;
 const competitions=await db.all('competitions'),exams=await db.all('exams'),versions=await db.all('versions');
 const metadata=exams.map(e=>{
  const approved=versions.some(v=>v.id===e.currentApprovedVersionId&&v.draftRevision===e.draftRevision);
  return {id:e.id,competitionId:e.competitionId,name:e.name,competitionName:competitions.find(c=>c.id===e.competitionId)?.name||'',draftRevision:e.draftRevision,reviewStatus:approved?'Approved':e.reviewStatus==='Returned'?'Draft':e.reviewStatus||'Draft',isApproved:approved,submittedAtUtc:e.submittedAtUtc||null,updatedAtUtc:e.updatedAtUtc,targetQuestionCount:e.targetQuestionCount,durationMinutes:e.durationMinutes,reviewNote:e.reviewNote||''};
 }).sort((a,b)=>b.updatedAtUtc.localeCompare(a.updatedAtUtc)||b.id-a.id);
 let editorial=null,review=null,operations=null,results=null;
 if(hasAccess(user,'draft')||hasAccess(user,'submit')) {
  const bank=(await db.all('bank')).filter(q=>q.isActive);
  editorial={questionCount:bank.length,topicCount:new Set(bank.map(q=>q.topic?.trim()||q.source?.split('|')[0].trim()).filter(Boolean)).size,exams:metadata};
 }
 if(hasAccess(user,'approve'))review={exams:metadata.filter(e=>['PendingReview','Approved'].includes(e.reviewStatus))};
 if(hasAccess(user,'operate')||hasAccess(user,'approve')) {
  const assignments=await db.all('assignments'),attempts=(await db.all('attempts')).filter(a=>!a.isInvalidated);
  operations=competitions.map(c=>{
   const assigned=assignments.filter(a=>a.competitionId===c.id),latest=new Map();
   for(const a of attempts.filter(a=>a.competitionId===c.id).sort((a,b)=>a.id-b.id))if(assigned.some(r=>r.userId===a.userId))latest.set(a.userId,a);
   const states=[...latest.values()].map(attemptStatus),own=metadata.filter(e=>e.competitionId===c.id);
   return {id:c.id,name:c.name,status:c.status,updatedAtUtc:c.updatedAtUtc,opensAtUtc:c.opensAtUtc,closesAtUtc:c.closesAtUtc,startDeadlineUtc:c.startDeadlineUtc,examCount:own.length,approvedExamCount:own.filter(e=>e.isApproved).length,pendingExamCount:own.filter(e=>e.reviewStatus==='PendingReview').length,scheduleComplete:!!validSchedule(c),assignmentCount:assigned.length,inProgressCount:states.filter(s=>s==='InProgress').length,submittedCount:states.filter(s=>s==='Submitted').length,expiredCount:states.filter(s=>s==='Expired').length,notStartedCount:assigned.length-latest.size};
  }).sort((a,b)=>b.updatedAtUtc.localeCompare(a.updatedAtUtc)||b.id-a.id);
  results=operations.map(({id,name,status,updatedAtUtc,examCount,approvedExamCount,submittedCount})=>({id,name,status,updatedAtUtc,examCount,approvedExamCount,submittedCount}));
  if(!hasAccess(user,'operate'))operations=null;
 }
 return json({serverTimeUtc:now(),editorial,review,operations,results,approvedExams:hasAccess(user,'approve')||hasAccess(user,'operate')?metadata.filter(e=>e.isApproved):null});
}
