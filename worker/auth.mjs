import {ensure,fail,profile,permissions,randomHex,sha256,now,json,text} from './common.mjs';
import {workflowPermissions,hasAccess,requiredAccess} from '../shared/access.mjs';
import {hydrateProcessAccess} from './processes.mjs';
const utf8=new TextEncoder();

export function strongPassword(password) {
  return typeof password==='string' && password.length>=12 && utf8.encode(password).length<=72 && /\p{Ll}/u.test(password) && /\p{Lu}/u.test(password) && /\d/.test(password) && /[^\p{L}\p{N}]/u.test(password);
}
export async function passwordHash(password,pepper,salt=randomHex(24)) {
  ensure(typeof password==='string'&&utf8.encode(password).length<=72,'Mật khẩu không được vượt quá 72 byte.');
  if(!pepper || pepper.length<32) throw new Error('PASSWORD_PEPPER missing');
  const hmac=await crypto.subtle.importKey('raw',utf8.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const secret=await crypto.subtle.sign('HMAC',hmac,utf8.encode(password));
  const key=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveBits']);
  const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:utf8.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return {scheme:'pbkdf2-sha256-peppered-v1',salt,hash:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
export async function verifyPassword(password,stored,pepper) {
  if(!stored || stored.scheme!=='pbkdf2-sha256-peppered-v1')return false;
  const actual=await passwordHash(password,pepper,stored.salt);
  let delta=actual.hash.length^stored.hash.length;for(let i=0;i<actual.hash.length;i++)delta|=actual.hash.charCodeAt(i)^(stored.hash.charCodeAt(i)||0);return delta===0;
}
export async function authenticate(ctx) {
  const token=ctx.request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if(!token)fail(401,'Vui lòng đăng nhập lại để tiếp tục.');
  const id=await sha256(token),session=await ctx.db.get('sessions',id);
  ensure(session&&!session.revokedAtUtc&&Date.parse(session.expiresAtUtc)>Date.now(),'Phiên đăng nhập không còn hiệu lực.',401);
  let user=await ctx.db.get('users',session.userId);
  ensure(user?.isActive&&['Organizer','Candidate'].includes(user.role),'Tài khoản không có quyền truy cập.',401);
  user=await hydrateProcessAccess(ctx.db,user);
  ctx.user=user;ctx.session=session;
  if(ctx.path.startsWith('/api/organizer'))ensure(user.role==='Organizer','Bạn không có quyền truy cập chức năng này.',403);
  if(ctx.path.startsWith('/api/organizer')) {
    const needed=requiredAccess(ctx.parts,ctx.method);
    ensure(!needed||(Array.isArray(needed)?needed.some(p=>hasAccess(user,p)):hasAccess(user,needed)),'Tài khoản chưa được cấp quyền thực hiện chức năng này.',403);
  }
  if(ctx.path.startsWith('/api/candidate'))ensure(user.role==='Candidate'&&user.processPermissionKeys?.includes('takeExam'),'Bạn chưa được gán quy trình dự thi.',403);
}
export async function authRoute(ctx) {
  const {db,env,body,path,method}=ctx;
  if(path==='/api/auth/login'&&method==='POST') {
    const username=text(body.username,100,true).toLowerCase();
    const password=body.password;
    ensure(typeof password==='string'&&password.length>0&&utf8.encode(password).length<=72,'Vui lòng nhập mật khẩu hợp lệ.');
    const ip=ctx.request.headers.get('CF-Connecting-IP')||'local';
    const keys=await Promise.all([sha256(`ip:${ip}`),sha256(`user:${username}`)]);
    const limits=await Promise.all(keys.map(id=>db.get('loginLimits',id)));
    if(limits.some(item=>item&&item.windowEnd>Date.now()&&item.count>=12))return json({message:'Đã thử đăng nhập quá nhiều lần. Vui lòng chờ 10 phút.'},429);
    let user=(await db.all('users','username',username))[0];
    const valid=await verifyPassword(password,user?.password,env.PASSWORD_PEPPER);
    if(!user||!valid||!user.isActive||!['Organizer','Candidate'].includes(user.role)) {
      limits.forEach((item,i)=>db.put('loginLimits',{id:keys[i],count:item?.windowEnd>Date.now()?item.count+1:1,windowEnd:item?.windowEnd>Date.now()?item.windowEnd:Date.now()+600000}));
      return json({message:'Tài khoản hoặc mật khẩu không đúng.'},401);
    }
    user=await hydrateProcessAccess(db,user);
    keys.forEach(id=>db.remove('loginLimits',id));
    const token=randomHex(),session={id:await sha256(token),userId:user.id,createdAtUtc:now(),expiresAtUtc:new Date(Date.now()+8*3600000).toISOString(),revokedAtUtc:null};
    db.put('sessions',session);
    return json({token,...profile(user),expiresAt:session.expiresAtUtc,permissions:permissions(user)});
  }
  if(path==='/api/auth/me'&&method==='GET')return json({...profile(ctx.user),expiresAt:ctx.session.expiresAtUtc,permissions:permissions(ctx.user)});
  if(path==='/api/auth/logout'&&method==='POST') { db.put('sessions',{...ctx.session,revokedAtUtc:now()});return json({message:'Đã đăng xuất và kết thúc phiên trên máy chủ.'}); }
  if(path==='/api/auth/change-password'&&method==='POST') {
    ensure(typeof body.currentPassword==='string'&&await verifyPassword(body.currentPassword,ctx.user.password,env.PASSWORD_PEPPER),'Mật khẩu hiện tại không đúng.');
    ensure(body.newPassword===body.confirmPassword,'Mật khẩu mới và phần xác nhận không khớp.');
    ensure(strongPassword(body.newPassword),'Mật khẩu mới phải có ít nhất 12 ký tự, gồm chữ thường, chữ hoa, chữ số và ký tự đặc biệt.');
    ensure(body.newPassword!==body.currentPassword,'Mật khẩu mới phải khác mật khẩu hiện tại.');
    const {assignedProcesses,processPermissionKeys,...storedUser}=ctx.user;
    db.put('users',{...storedUser,password:await passwordHash(body.newPassword,env.PASSWORD_PEPPER),mustChangePassword:false});
    for(const session of await db.all('sessions','userId',ctx.user.id))if(!session.revokedAtUtc)db.put('sessions',{...session,revokedAtUtc:now()});
    return json({message:'Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.'});
  }
}
