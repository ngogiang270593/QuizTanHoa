export const WORKFLOW_PERMISSIONS = ['draft','submit','approve','operate','manageUsers'];
export const ACCESS_PRESETS = {
 Admin:{label:'Quản trị viên',role:'Organizer',permissions:[...WORKFLOW_PERMISSIONS]},
 Author:{label:'Biên soạn',role:'Organizer',permissions:['draft','submit']},
 Reviewer:{label:'Người duyệt',role:'Organizer',permissions:['approve']},
 Operator:{label:'Tổ chức thi',role:'Organizer',permissions:['operate']},
 Candidate:{label:'Thí sinh',role:'Candidate',permissions:[]},
};
export const ACCESS_LABELS={draft:'Soạn nháp',submit:'Gửi duyệt / rút về',approve:'Duyệt / trả lại và xem kết quả',operate:'Tổ chức thi và xem kết quả',manageUsers:'Quản lý tài khoản và cấp quyền'};
export function workflowPermissions(user) {
 if(user?.role!=='Organizer')return [];
 if(user.workflowPermissions===undefined)return [...WORKFLOW_PERMISSIONS];
 return Array.isArray(user.workflowPermissions)?user.workflowPermissions.filter(p=>WORKFLOW_PERMISSIONS.includes(p)):[];
}
export const hasAccess=(user,permission)=>workflowPermissions(user).includes(permission);
export function accessLabel(user) {
 if(user.role==='Candidate')return 'Thí sinh';
 const actual=workflowPermissions(user);
 return Object.values(ACCESS_PRESETS).find(p=>p.role===user.role&&p.permissions.length===actual.length&&p.permissions.every(x=>actual.includes(x)))?.label||'Quyền tùy chỉnh';
}
export function requiredAccess(parts,method) {
 if(parts[1]!=='organizer')return null;
 const write=!['GET','HEAD','OPTIONS'].includes(method),resource=parts[2],sub=parts[4],action=parts[6];
 if(resource==='system')return 'manageUsers';
 if(resource==='award-catalog')return write?'manageUsers':['operate','approve','manageUsers'];
 if(['system-summary','activity'].includes(resource))return 'manageUsers';
 if(resource==='processes')return 'manageUsers';
 if(resource==='organization-units')return write?'manageUsers':null;
 if(resource==='review-queue')return 'approve';
 if(resource==='users')return 'manageUsers';
 if(resource==='topics')return write?['draft','manageUsers']:['draft','approve','submit','manageUsers'];
 if(resource==='question-bank')return write?'draft':['draft','approve','submit'];
 if(resource!=='competitions')return null;
 if(parts.length<=4)return write?'draft':['draft','submit','approve','operate'];
 if(sub==='results'&&!write)return parts.includes('excel')?'operate':['operate','approve'];
 if(['schedule','assignments','assignment-options','publication','publish','end','results'].includes(sub))return 'operate';
 if(sub==='awards')return parts.includes('approve')?'approve':write?'operate':['operate','approve'];
 if(sub==='field-groups')return write?'draft':['draft','submit','approve','operate'];
 if(sub==='exams') {
  if(['submit-review','withdraw-review'].includes(action))return 'submit';
  if(['approve','return-review'].includes(action))return 'approve';
  if(action==='review-history')return ['draft','submit','approve'];
  if(!write&&['questions','preview','versions','import-template'].includes(action))return ['draft','submit','approve'];
  return write?'draft':['draft','submit','approve','operate'];
 }
 return write?'operate':null;
}
