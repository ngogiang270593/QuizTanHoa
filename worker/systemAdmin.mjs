import {json,now} from './common.mjs';
import {accountGroup} from '../shared/accountGroups.mjs';
import {resolveProcessAccess} from '../shared/processes.mjs';
export async function systemAdminRoute(ctx){
 const {db,parts,method}=ctx;if(method!=='GET')return;
 const catalog=await db.all('processes'),users=(await db.all('users')).map(u=>resolveProcessAccess(u,catalog));
 if(parts[2]==='system-summary')return json({serverTimeUtc:now(),userCount:users.length,activeCount:users.filter(u=>u.isActive).length,groups:Object.fromEntries(['SystemAdmin','Editorial','Candidate'].map(group=>[group,users.filter(u=>accountGroup(u)===group).length])),processCount:catalog.length,departmentCount:(await db.all('units')).length,topicCount:(await db.all('topics')).length});
 if(parts[2]==='activity'){
  const entries=[];
  for(const [table,category]of [['accessEvents','Tài khoản & phân quyền'],['processEvents','Quy trình'],['reviewEvents','Duyệt đề']])for(const event of await db.all(table))entries.push({id:table+'-'+event.id,category,action:event.action,actorName:event.actorName||users.find(u=>u.id===event.actorUserId)?.fullName||'Tài khoản đã xóa',occurredAtUtc:event.occurredAtUtc,target:event.userId?'Tài khoản #'+event.userId:event.examId?'Đề #'+event.examId:'Quy trình #'+event.processId,note:table==='reviewEvents'?event.note||'':''});
  return json(entries.sort((a,b)=>b.occurredAtUtc.localeCompare(a.occurredAtUtc)).slice(0,200));
 }
}
