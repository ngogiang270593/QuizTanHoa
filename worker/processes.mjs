import {ensure,now,json} from './common.mjs';
import {WORKFLOW_PERMISSIONS,hasAccess} from '../shared/access.mjs';
import {PROCESS_DEFAULTS,normalizeProcess,processNameKey,processSignature,legacyProcessSteps,resolveProcessAccess} from '../shared/processes.mjs';
export async function ensureProcessCatalog(db) {
 const state=await db.get('processState','catalog');if(state?.version===3)return;
 const old=await db.all('processes'),catalog=old.map(p=>({...p,steps:[...p.steps]})),stamp=now();
 for(const preset of PROCESS_DEFAULTS){let p=catalog.find(p=>p.code===preset.code);if(!p){p={...preset,id:db.next('processes'),createdAtUtc:stamp,updatedAtUtc:stamp};catalog.push(p);}else Object.assign(p,preset,{updatedAtUtc:stamp});db.put('processes',p);}
 for(const raw of await db.all('users')){
  const resolved=Array.isArray(raw.processIds)?resolveProcessAccess(raw,old):raw;
  const scope=raw.role==='Organizer'?legacyProcessSteps(resolved):null;
  const codes=raw.role==='Candidate'?['CANDIDATE']:[...(scope.includes('manageUsers')?['SYSTEM_ADMIN']:[]),...(scope.some(p=>p!=='manageUsers')?['ORGANIZER']:[])];
  db.put('users',{...raw,processIds:codes.map(code=>catalog.find(p=>p.code===code).id),permissionScope:scope});
 }
 for(const p of old)if(['EDITORIAL','REVIEW_OPERATE','REVIEW','OPERATE','USERS','ADMIN'].includes(p.code)||p.code?.startsWith('LEGACY_'))db.remove('processes',p.id);
 db.put('processState',{id:'catalog',initialized:true,version:3,initializedAtUtc:stamp});
 ensure(db.writes.size<=449,'Dữ liệu cần chia lô để chuyển sang quy trình.',409);
}
export async function hydrateProcessAccess(db,user) {
 await ensureProcessCatalog(db);let stored=await db.get('users',user.id);
 if(!Array.isArray(stored.processIds)){const access=await resolveAccessRequest(db,{role:stored.role,workflowPermissions:legacyProcessSteps(stored).filter(p=>p!=='takeExam')});stored={...stored,processIds:access.processIds,permissionScope:access.permissionScope};db.put('users',stored);}
 return resolveProcessAccess(stored,await db.all('processes'));
}
export async function resolveAccessRequest(db,body) {
 await ensureProcessCatalog(db);const catalog=await db.all('processes');
 let ids=body.processIds,role=body.role??'Candidate',permissionScope=null;
 if(ids===undefined){
  const caps=body.workflowPermissions??[];
  ensure(['Organizer','Candidate'].includes(role)&&Array.isArray(caps)&&new Set(caps).size===caps.length&&caps.every(p=>WORKFLOW_PERMISSIONS.includes(p))&&(role==='Candidate'?caps.length===0:caps.length>0),'Bộ quyền không hợp lệ.');
  const codes=role==='Candidate'?['CANDIDATE']:[...(caps.includes('manageUsers')?['SYSTEM_ADMIN']:[]),...(caps.some(p=>p!=='manageUsers')?['ORGANIZER']:[])];
  const targets=codes.map(code=>catalog.find(p=>p.code===code));ensure(targets.every(Boolean),'Hãy tạo hoặc chọn quy trình phù hợp.',409);ids=targets.map(p=>p.id);permissionScope=role==='Organizer'?caps:null;
 }
 ensure(Array.isArray(ids)&&ids.length>0&&ids.length<=20&&new Set(ids).size===ids.length&&ids.every(id=>Number.isInteger(id)&&id>0),'Chọn từ 1 đến 20 quy trình khác nhau.');
 const selected=ids.map(id=>catalog.find(p=>p.id===id));ensure(selected.every(Boolean),'Một quy trình không còn tồn tại. Hãy tải lại danh mục.',409);
 ensure(['Organizer','Candidate'].includes(role)&&selected.every(p=>p.role===role),'Không gán chung quy trình tổ chức và quy trình thí sinh.');
 const resolved=resolveProcessAccess({role,processIds:ids,permissionScope},catalog);
 return {role,processIds:ids,permissionScope,workflowPermissions:resolved.workflowPermissions,assignedProcesses:resolved.assignedProcesses};
}
export async function processesRoute(ctx) {
 const {db,body,method,parts,user}=ctx;await ensureProcessCatalog(db);
 const catalog=await db.all('processes'),users=await db.all('users');
 const profile=p=>({...p,userCount:users.filter(u=>u.processIds?.includes(p.id)).length});
 if(parts.length===3&&method==='GET')return json(catalog.sort((a,b)=>a.id-b.id).map(profile));
 const process=catalog.find(p=>p.id===Number(parts[3]));if(parts.length===4)ensure(process,'Không tìm thấy quy trình.',404);
 if((parts.length===3&&method==='POST')||(parts.length===4&&method==='PUT')){
  let fields;try{fields=normalizeProcess(body);}catch(e){ensure(false,e.message);}
  ensure(!catalog.some(p=>p.id!==process?.id&&processNameKey(p.name)===processNameKey(fields.name)),'Tên quy trình đã tồn tại.',409);
  if(!process){const id=db.next('processes'),created={id,code:'CUSTOM_'+id,...fields,createdAtUtc:now(),updatedAtUtc:now()};db.put('processes',created);db.put('processEvents',{id:db.next('processEvents'),processId:id,actorUserId:user.id,action:'Created',occurredAtUtc:now(),after:fields});return json({...profile(created),affectedUserCount:0},201);}
  const assigned=users.filter(u=>u.processIds?.includes(process.id));
  ensure(!assigned.length||process.role===fields.role,'Quy trình đang được gán; không thể đổi loại tài khoản.',409);
  const proposed=catalog.map(p=>p.id===process.id?{...p,...fields}:p),before={name:process.name,description:process.description||'',role:process.role,steps:process.steps};
  ensure(users.some(u=>u.isActive&&hasAccess(resolveProcessAccess(u,proposed),'manageUsers')),'Phải giữ ít nhất một tài khoản quản lý người dùng.',409);
  ensure(!hasAccess(user,'manageUsers')||hasAccess(resolveProcessAccess(user,proposed),'manageUsers'),'Không được bỏ quyền quản lý của chính bạn qua sửa quy trình.',409);
  const rightsChanged=JSON.stringify(process.steps)!==JSON.stringify(fields.steps);
  if(rightsChanged){const ids=new Set(assigned.map(u=>u.id));for(const s of await db.all('sessions'))if(ids.has(s.userId)&&!s.revokedAtUtc){s.revokedAtUtc=now();db.put('sessions',s);}}
  Object.assign(process,fields,{updatedAtUtc:now()});db.put('processes',process);
  db.put('processEvents',{id:db.next('processEvents'),processId:process.id,actorUserId:user.id,action:'Updated',occurredAtUtc:now(),before,after:fields,affectedUserCount:assigned.length});
  ensure(db.writes.size<=449,'Quy trình có quá nhiều phiên liên quan để cập nhật trong một lần.',409);return json({...profile(process),affectedUserCount:assigned.length});
 }
 if(parts.length===4&&method==='DELETE'){
  ensure(!users.some(u=>u.processIds?.includes(process.id)),'Quy trình đang được gán cho tài khoản. Hãy bỏ gán hoặc đổi quy trình trước khi xóa.',409);
  db.remove('processes',process.id);db.put('processEvents',{id:db.next('processEvents'),processId:process.id,actorUserId:user.id,action:'Deleted',occurredAtUtc:now(),before:process});return json(null,204);
 }
}
