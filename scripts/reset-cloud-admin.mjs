import fs from 'node:fs';
import path from 'node:path';
import {FirestoreStore} from '../worker/firestore.mjs';
import {passwordHash} from '../worker/auth.mjs';
import {now,sha256} from '../worker/common.mjs';

const root=path.resolve(import.meta.dirname,'..');
let password='';
for await(const chunk of process.stdin)password+=chunk;
password=password.replace(/\r?\n$/,'');
if(!password||new TextEncoder().encode(password).length>72)throw new Error('A temporary password of 1–72 UTF-8 bytes is required on stdin.');
const secrets=JSON.parse(fs.readFileSync(path.join(root,'.data/cloud/pages-secrets.json'),'utf8'));
const db=new FirestoreStore({...secrets,FIRESTORE_NAMESPACE:'qt'});
try{
  await db.begin();
  const admin=(await db.all('users','username','admin'))[0];
  if(!admin||admin.role!=='Organizer')throw new Error('Expected existing Organizer account admin.');
  db.put('users',{...admin,password:await passwordHash(password,secrets.PASSWORD_PEPPER),mustChangePassword:false});
  let revoked=0;
  for(const session of await db.all('sessions','userId',admin.id))if(!session.revokedAtUtc){db.put('sessions',{...session,revokedAtUtc:now()});revoked++;}
  const limitId=await sha256('user:admin');
  if(await db.get('loginLimits',limitId))db.remove('loginLimits',limitId);
  await db.commit();
  fs.writeFileSync(path.join(root,'.data/cloud/admin-login.txt'),`Website: https://quiztanhoa.pages.dev\nTài khoản: admin\nMật khẩu khởi tạo: ${password}\nCó thể đổi mật khẩu trong Thông tin tài khoản.\n`,{mode:0o600});
  console.log(JSON.stringify({username:'admin',passwordReset:true,mustChangePassword:false,revokedSessions:revoked}));
}catch(error){await db.close();throw error;}
