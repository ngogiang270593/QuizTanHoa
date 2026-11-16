import {WORKFLOW_PERMISSIONS,workflowPermissions} from './access.mjs';
export const PROCESS_PERMISSION_LABELS={draft:'Soạn nháp',submit:'Gửi duyệt / rút đề',approve:'Duyệt / trả lại',operate:'Tổ chức thi và kết quả',manageUsers:'Quản lý tài khoản và danh mục',takeExam:'Dự thi được phân công'};
export const PROCESS_DEFAULTS=[
 {code:'SYSTEM_ADMIN',name:'Quản trị hệ thống',role:'Organizer',steps:['manageUsers'],description:'Tài khoản, phân quyền, danh mục và nhật ký hệ thống. Nghiệp vụ thi được cấp riêng khi cần.'},
 {code:'ORGANIZER',name:'Biên tập và tổ chức thi',role:'Organizer',steps:['draft','submit','operate'],description:'Biên tập đề, gửi duyệt, tổ chức thi và xem kết quả cuộc thi.'},
 {code:'REVIEWER',name:'Duyệt đề',role:'Organizer',steps:['approve'],description:'Duyệt hoặc trả lại đề; xem kết quả cuộc thi ở chế độ chỉ đọc.'},
 {code:'CANDIDATE',name:'Thi',role:'Candidate',steps:['takeExam'],description:'Vào cuộc thi được phân công sau khi công khai, làm và nộp bài theo lịch.'},
];
export const processStages=role=>role==='Candidate'?['Thi']:['Nháp','Chờ duyệt','Đã duyệt','Công khai'];
export const processNameKey=name=>String(name||'').trim().normalize('NFC').toLocaleLowerCase('vi');
export function normalizeProcess(body) {
 const name=typeof body.name==='string'?body.name.trim().normalize('NFC'):'';
 const description=typeof body.description==='string'?body.description.trim():'';
 const {role,steps}=body;
 if(!name||name.length>200)throw new Error('Tên quy trình phải có từ 1 đến 200 ký tự.');
 if(description.length>2000)throw new Error('Mô tả tối đa 2.000 ký tự.');
 if(!['Organizer','Candidate'].includes(role))throw new Error('Loại tài khoản không hợp lệ.');
 if(!Array.isArray(steps)||!steps.length||steps.length>5||new Set(steps).size!==steps.length)throw new Error('Quy trình cần các quyền không trùng nhau.');
 if(role==='Candidate'?(steps.length!==1||steps[0]!=='takeExam'):steps.some(p=>!WORKFLOW_PERMISSIONS.includes(p)))throw new Error('Quyền không phù hợp với loại tài khoản của quy trình.');
 return {name,description,role,steps:[...steps]};
}
export function resolveProcessAccess(user,catalog) {
 if(!Array.isArray(user.processIds))return {...user};
 const assignedProcesses=user.processIds.map(id=>catalog.find(p=>p.id===id)).filter(p=>p&&p.role===user.role);
 const union=[...new Set(assignedProcesses.flatMap(p=>p.steps))];
 const keys=Array.isArray(user.permissionScope)&&user.role==='Organizer'?union.filter(p=>user.permissionScope.includes(p)):union;
 return {...user,assignedProcesses:assignedProcesses.map(p=>({id:p.id,name:p.name,role:p.role,steps:[...p.steps]})),processPermissionKeys:keys,workflowPermissions:user.role==='Organizer'?keys.filter(p=>WORKFLOW_PERMISSIONS.includes(p)):[]};
}
export function processSignature(role,steps){return role+':'+[...new Set(steps)].sort().join(',');}
export function legacyProcessSteps(user){return user.role==='Candidate'?['takeExam']:workflowPermissions(user);}
