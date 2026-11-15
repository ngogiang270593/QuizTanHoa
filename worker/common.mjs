import {workflowPermissions,accessLabel,hasAccess} from '../shared/access.mjs';
import {accountGroup} from '../shared/accountGroups.mjs';
export const TIME_ZONE='Asia/Ho_Chi_Minh';
export class HttpError extends Error {
  constructor(status,message,extra={}) { super(message);this.status=status;this.extra=extra; }
}
export const fail=(status,message,extra)=>{throw new HttpError(status,message,extra);};
export const ensure=(condition,message,status=400,extra)=>{if(!condition)fail(status,message,extra);};
export const now=()=>new Date().toISOString();
export const pick=(o,keys)=>Object.fromEntries(keys.map(key=>[key,o[key]??null]));
export function text(value,max=5000,required=false) { ensure(value==null || typeof value==='string','Giá trị văn bản không hợp lệ.'); const v=(value||'').trim();ensure(v.length<=max && (!required||v.length>0),`Văn bản phải ${required?'có nội dung và ':''}không quá ${max} ký tự.`);return v; }
export function integer(value,min,max) { ensure(Number.isInteger(value)&&value>=min&&value<=max,`Giá trị phải là số nguyên từ ${min} đến ${max}.`);return value; }
export const json=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export const randomHex=(size=32)=>[...crypto.getRandomValues(new Uint8Array(size))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const profile=user=>({...pick(user,['id','username','fullName','department','role','isActive','isDemo']),mustChangePassword:false,accountGroup:accountGroup(user),workflowPermissions:workflowPermissions(user),accessLabel:user.assignedProcesses?.map(p=>p.name).join(' + ')||accessLabel(user),permissionScope:user.permissionScope??null,processIds:user.processIds||[],assignedProcesses:user.assignedProcesses||[],processPermissionKeys:user.processPermissionKeys||[]});
export function permissions(subject) {
 const user=typeof subject==='string'?{role:subject}:subject;
 if(user.role!=='Organizer')return ['candidate.overview.read','candidate.competitions.read'];
 const values=['organizer.overview.read','organizer.competitions.read'];
 const map={draft:['organizer.competitions.write','organizer.exams.write'],submit:['organizer.exams.submit'],approve:['organizer.exams.approve'],operate:['organizer.schedule.write','organizer.assignments.write','organizer.competitions.publish'],manageUsers:['organizer.users.read','organizer.users.write']};
 for(const [cap,keys] of Object.entries(map))if(hasAccess(user,cap))values.push(...keys);
 return values;
}
export function parseLocal(value) {
  const input=text(value,30,true);
  let iso=input;
  const match=input.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(match) iso=`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]||'00'}`;
  ensure(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso),'Ngày giờ phải theo dạng dd/MM/yyyy HH:mm:ss, giờ Việt Nam.');
  const timestamp=Date.parse(`${iso}+07:00`);
  ensure(Number.isFinite(timestamp),'Ngày giờ không hợp lệ.');
  const result=new Date(timestamp).toISOString();
  ensure(new Date(timestamp+7*3600000).toISOString().slice(0,19)===(iso.length===16?`${iso}:00`:iso),'Ngày giờ không hợp lệ.');
  return result;
}
export function local(value) { if(!value)return null; const s=new Date(Date.parse(value)+7*3600000).toISOString();return `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)} ${s.slice(11,19)}`; }
export function shuffle(values) {
  const result=[...values];
  for(let i=result.length-1;i>0;i--) { const range=i+1,limit=Math.floor(4294967296/range)*range;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);const j=n%range;[result[i],result[j]]=[result[j],result[i]]; }
  return result;
}
