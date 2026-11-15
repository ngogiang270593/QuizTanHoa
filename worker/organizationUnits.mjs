import {ensure,json,now} from './common.mjs';
import {normalizeUnit,findUnitConflict,departmentMatches} from '../shared/organizationUnits.mjs';
export async function organizationUnitsRoute(ctx) {
 const {db,body,method,parts,user}=ctx;
 const units=await db.all('units'),users=await db.all('users');
 const response=unit=>({...unit,userCount:users.filter(u=>departmentMatches(u,unit.name)).length});
 if(parts.length===3&&method==='GET')return json(units.sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'vi')).map(response));
 const unit=parts.length===4?units.find(u=>u.id===Number(parts[3])):null;
 if(parts.length===4)ensure(unit,'Không tìm thấy phòng ban.',404);
 if((parts.length===3&&method==='POST')||(parts.length===4&&method==='PUT')) {
  let fields;try{fields=normalizeUnit(body);}catch(e){ensure(false,e.message);}
  ensure(!findUnitConflict(units,fields,unit?.id),'Mã hoặc tên phòng ban đã tồn tại.',409);
  let changed=0;
  if(unit) {
   const old={code:unit.code,name:unit.name,sortOrder:unit.sortOrder};
   for(const account of users)if(departmentMatches(account,unit.name)&&account.department!==fields.name){account.department=fields.name;db.put('users',account);changed++;}
   Object.assign(unit,fields,{updatedAtUtc:now()});db.put('units',unit);
   db.put('unitEvents',{id:db.next('unitEvents'),unitId:unit.id,actorUserId:user.id,action:'Updated',occurredAtUtc:now(),before:old,after:fields,updatedUserCount:changed});
  }else{
   const created={...fields,id:db.next('units'),createdAtUtc:now(),updatedAtUtc:now()};db.put('units',created);
   db.put('unitEvents',{id:db.next('unitEvents'),unitId:created.id,actorUserId:user.id,action:'Created',occurredAtUtc:now(),after:fields});
   return json({...response(created),updatedUserCount:0},201);
  }
  ensure(db.writes.size<=449,'Phòng ban có quá nhiều tài khoản để cập nhật cùng lúc. Vui lòng chia nhỏ hoặc liên hệ quản trị.',409);
  return json({...response(unit),updatedUserCount:changed});
 }
 if(parts.length===4&&method==='DELETE') {
  ensure(!users.some(u=>departmentMatches(u,unit.name)),'Phòng ban đang có tài khoản trực thuộc. Hãy chuyển tài khoản sang phòng ban khác trước khi xóa.',409);
  db.remove('units',unit.id);db.put('unitEvents',{id:db.next('unitEvents'),unitId:unit.id,actorUserId:user.id,action:'Deleted',occurredAtUtc:now(),before:unit});return json(null,204);
 }
}
