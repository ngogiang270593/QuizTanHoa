import {hasAccess} from './access.mjs';
export const EDITORIAL_PATH='/ban-to-chuc/bien-tap';
export const DELIVERY_PATH='/ban-to-chuc/duyet-thi';
export const OPERATIONS_PATH='/ban-to-chuc/to-chuc-thi';
export const APPROVED_PATH='/ban-to-chuc/de-da-duyet';
export const RESULTS_PATH='/ban-to-chuc/ket-qua';
export function workflowSections(user) {
 if(user?.role==='Candidate')return ['candidate'];
 if(user?.role!=='Organizer')return [];
 const result=[];
 if(hasAccess(user,'draft')||hasAccess(user,'submit'))result.push('editorial');
 if(hasAccess(user,'approve')||hasAccess(user,'operate'))result.push('delivery');
 if(hasAccess(user,'manageUsers'))result.push('administration');
 return result;
}
export const isWorkflowPath=path=>[EDITORIAL_PATH,DELIVERY_PATH,OPERATIONS_PATH,RESULTS_PATH,APPROVED_PATH].includes(path);
export function canOpenWorkflow(user,path) {
 const sections=workflowSections(user);
 return path===EDITORIAL_PATH?sections.includes('editorial'):[DELIVERY_PATH,APPROVED_PATH].includes(path)?sections.includes('delivery'):path===RESULTS_PATH?hasAccess(user,'approve')||hasAccess(user,'operate'):path===OPERATIONS_PATH?hasAccess(user,'operate'):false;
}
export const reviewState=exam=>exam.isApproved?'Approved':exam.reviewStatus||'Draft';
export function operationStep(competition,at) {
 const base=`/ban-to-chuc/cuoc-thi/${competition.id}`;
 if(competition.status==='Ended')return {key:'ended',label:'Đã kết thúc',action:'Xem kết quả và giải',url:`${base}/xet-giai`};
 if(competition.status==='Published') {
  const closed=competition.closesAtUtc&&Date.parse(competition.closesAtUtc)<=Date.parse(at);
  const upcoming=competition.opensAtUtc&&Date.parse(competition.opensAtUtc)>Date.parse(at);
  return {key:closed?'closed':upcoming?'scheduled':'running',label:closed?'Đã hết giờ thi':upcoming?'Chờ mở thi':'Đang mở thi',action:closed?'Rà soát kết quả':'Theo dõi thí sinh',url:`${base}/${closed?'xet-giai':'phan-cong'}`};
 }
 if(!competition.approvedExamCount)return {key:'approval',label:'Chờ có đề đã duyệt',action:'Đang chờ duyệt đề',url:null};
 if(!competition.scheduleComplete)return {key:'schedule',label:'Cần xếp lịch',action:'Cấu hình lịch thi',url:`${base}/lich-thi`};
 if(!competition.assignmentCount)return {key:'assign',label:'Cần phân công',action:'Phân công thí sinh',url:`${base}/phan-cong`};
 return {key:'publish',label:'Chờ công bố',action:'Kiểm tra và công bố',url:`${base}/phan-cong`};
}
export function candidateInView(row,view) {
 const finished=['Submitted','Expired'].includes(row.attemptStatus)||row.status==='Ended';
 if(view==='results')return finished;
 if(view==='schedule')return !finished;
 return true;
}
