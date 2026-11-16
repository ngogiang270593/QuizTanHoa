import {json,now} from './common.mjs';
import {accountGroup} from '../shared/accountGroups.mjs';
import {resolveProcessAccess} from '../shared/processes.mjs';
import {ensure,text} from './common.mjs';

export async function deleteCompetitionBatch(ctx,id,{confirmationName,draftOnly=false}={}){
 const {db}=ctx,competition=await db.get('competitions',id);ensure(competition,'Không tìm thấy cuộc thi.',404);
 if(competition.status!=='Deleting'){
  if(draftOnly){ensure(competition.status==='Draft','Chỉ có thể xóa cuộc thi đang ở trạng thái nháp.',409);ensure(!(await db.all('attempts','competitionId',id)).length,'Không thể xóa cuộc thi đã có lượt thi.',409);}
  else ensure(confirmationName===competition.name,'Nhập chính xác tên cuộc thi để xác nhận xóa.',400);
  competition.status='Deleting';competition.updatedAtUtc=now();db.put('competitions',competition);return json({complete:false,deletedCount:0,remainingCount:null});
 }
 const exams=await db.all('exams','competitionId',id),examIds=new Set(exams.map(e=>e.id)),buckets=[];
 for(const table of ['attemptEvents','attempts','assignments','grants','versionChunks','versions','groups','reviewEvents','awardEvents','awardStructures','awardPlans'])buckets.push([table,await db.all(table,'competitionId',id)]);
 const questions=(await Promise.all(exams.map(exam=>db.all('questions','examId',exam.id)))).flat();buckets.push(['questions',questions],['exams',exams]);
 let deletedCount=0;
 for(const [table,rows] of buckets){for(const row of rows){if(deletedCount>=350)break;db.remove(table,row.id);deletedCount++;}if(deletedCount>=350)break;}
 const remainingCount=buckets.reduce((count,[,rows])=>count+rows.length,0)-deletedCount;
 if(!remainingCount){db.remove('competitions',id);return json({complete:true,deletedCount,remainingCount:0});}
 return json({complete:false,deletedCount,remainingCount});
}

const awardIcons=new Set(['first','second','third']);
const awardKey=name=>name.normalize('NFC').trim().toLocaleLowerCase('vi');
const defaultAwards=[{name:'Giải nhất',icon:'first'},{name:'Giải nhì',icon:'second'},{name:'Giải ba',icon:'third'}];
export async function awardCatalogRoute(ctx){
 const {db,parts,method,body}=ctx;
 if(method==='GET'){
  const meta=await db.get('awardCatalogMeta','defaultsV1');
  if(!meta){const items=await db.all('awardCatalog');for(const preset of defaultAwards)if(!items.some(item=>item.icon===preset.icon)){const row={...preset,id:db.next('awardCatalog'),createdAtUtc:now(),updatedAtUtc:now()};db.put('awardCatalog',row);}db.put('awardCatalogMeta',{id:'defaultsV1',seededAtUtc:now()});}
  return json((await db.all('awardCatalog')).sort((a,b)=>a.name.localeCompare(b.name,'vi')));
 }
 if(parts.length===3&&method==='POST'){
  const name=text(body.name,100,true).normalize('NFC'),icon=body.icon;
  ensure(name,'Nhập tên giải thưởng.');ensure(awardIcons.has(icon),'Chọn một biểu tượng giải thưởng hợp lệ.');
  const catalog=await db.all('awardCatalog');ensure(!catalog.some(item=>awardKey(item.name)===awardKey(name)),'Tên giải thưởng đã tồn tại.',409);
  const row={id:db.next('awardCatalog'),name,icon,createdAtUtc:now(),updatedAtUtc:now()};db.put('awardCatalog',row);return json(row,201);
 }
 if(parts.length===4&&['PUT','DELETE'].includes(method)){
  const id=Number(parts[3]),item=(await db.all('awardCatalog')).find(row=>row.id===id);ensure(item,'Không tìm thấy giải thưởng.',404);
  if(method==='DELETE'){db.remove('awardCatalog',id);return json(null,204);}
  const name=text(body.name,100,true).normalize('NFC'),icon=body.icon;
  ensure(name,'Nhập tên giải thưởng.');ensure(awardIcons.has(icon),'Chọn một biểu tượng giải thưởng hợp lệ.');
  const catalog=await db.all('awardCatalog');ensure(!catalog.some(row=>row.id!==id&&awardKey(row.name)===awardKey(name)),'Tên giải thưởng đã tồn tại.',409);
  Object.assign(item,{name,icon,updatedAtUtc:now()});db.put('awardCatalog',item);return json(item);
 }
}
export async function systemAdminRoute(ctx){
 const {db,parts,method,body,user}=ctx;
 if(parts[3]==='competitions'){
  if(parts.length===4&&method==='GET'){
   const competitions=(await db.all('competitions')).sort((a,b)=>b.updatedAtUtc.localeCompare(a.updatedAtUtc)||b.id-a.id);
   return json(await Promise.all(competitions.map(async c=>({id:c.id,name:c.name,status:c.status,isDemo:c.isDemo===true,updatedAtUtc:c.updatedAtUtc,examCount:(await db.all('exams','competitionId',c.id)).length,attemptCount:(await db.all('attempts','competitionId',c.id)).length,assignmentCount:(await db.all('assignments','competitionId',c.id)).length}))));
  }
  if(parts.length===5&&method==='DELETE'){
   const id=Number(parts[4]);ensure(Number.isSafeInteger(id)&&id>0,'Mã cuộc thi không hợp lệ.');
   return deleteCompetitionBatch(ctx,id,{confirmationName:body.confirmationName});
  }
  return;
 }
 if(method!=='GET')return;
 const catalog=await db.all('processes'),users=(await db.all('users')).map(u=>resolveProcessAccess(u,catalog));
 if(parts[2]==='system-summary')return json({serverTimeUtc:now(),userCount:users.length,activeCount:users.filter(u=>u.isActive).length,groups:Object.fromEntries(['SystemAdmin','Editorial','Candidate'].map(group=>[group,users.filter(u=>accountGroup(u)===group).length])),processCount:catalog.length,departmentCount:(await db.all('units')).length,topicCount:(await db.all('topics')).length});
 if(parts[2]==='activity'){
  const entries=[];
  for(const [table,category]of [['accessEvents','Tài khoản & phân quyền'],['processEvents','Quy trình'],['reviewEvents','Duyệt đề']])for(const event of await db.all(table))entries.push({id:table+'-'+event.id,category,action:event.action,actorName:event.actorName||users.find(u=>u.id===event.actorUserId)?.fullName||'Tài khoản đã xóa',occurredAtUtc:event.occurredAtUtc,target:event.userId?'Tài khoản #'+event.userId:event.examId?'Đề #'+event.examId:'Quy trình #'+event.processId,note:table==='reviewEvents'?event.note||'':''});
  return json(entries.sort((a,b)=>b.occurredAtUtc.localeCompare(a.occurredAtUtc)).slice(0,200));
 }
}
