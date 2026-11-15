import fs from 'node:fs';
import path from 'node:path';
import {FirestoreStore} from '../worker/firestore.mjs';
import {passwordHash} from '../worker/auth.mjs';
import {randomHex,now} from '../worker/common.mjs';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'.data','cloud');
const credentialPath=process.argv[2];
if(!credentialPath)throw new Error('Pass the Firebase service-account JSON path.');
fs.mkdirSync(directory,{recursive:true});
const secretsFile=path.join(directory,'pages-secrets.json');
const preview=process.argv.includes('--preview');
const account=JSON.parse(fs.readFileSync(credentialPath,'utf8').replace(/^\uFEFF/,''));
if(account.project_id!=='quiztanhoa')throw new Error('Expected project quiztanhoa.');
let secrets=fs.existsSync(secretsFile)?JSON.parse(fs.readFileSync(secretsFile,'utf8')):null;
const db=new FirestoreStore({FIREBASE_SERVICE_ACCOUNT:JSON.stringify(account),FIRESTORE_NAMESPACE:preview?'qt_verify':'qt'});await db.begin();
const existing=await db.all('users');
if(!secrets&&existing.length)throw new Error('Cloud users exist but the local pepper backup is missing. Restore the secret backup before continuing.');
if(!secrets){secrets={FIREBASE_SERVICE_ACCOUNT:JSON.stringify(account),PASSWORD_PEPPER:randomHex(48)};fs.writeFileSync(secretsFile,JSON.stringify(secrets),{mode:0o600,flag:'wx'});}
if(!existing.some(u=>u.role==='Organizer')){
  const password=`THa!${randomHex(16)}aA7`;
  db.put('users',{id:db.next('users'),username:'admin',fullName:'Quản trị hội thi Tân Hòa',department:'Ban Tổ chức',role:'Organizer',isActive:true,isDemo:false,mustChangePassword:false,password:await passwordHash(password,secrets.PASSWORD_PEPPER),createdAtUtc:now()});
  // Write the recoverable credential before committing; never print it to logs.
  fs.writeFileSync(path.join(directory,preview?'preview-admin-login.txt':'admin-login.txt'),`Website: https://quiztanhoa.pages.dev\nTài khoản: admin\nMật khẩu khởi tạo: ${password}\nCó thể đổi mật khẩu trong Thông tin tài khoản.\n`,{mode:0o600,flag:'wx'});
  console.log(`Prepared initial admin. Credential saved in .data/cloud/${preview?'preview-admin-login.txt':'admin-login.txt'} (not printed).`);
}
if(!(await db.all('units')).length){
  const units=[['PHONG_KINH_TE','Phòng Kinh tế'],['PHONG_VHXH','Phòng Văn hóa-Xã hội'],['VP_HDND_UBND','Văn phòng HĐND và UBND'],['TT_DV_HCC','Trung tâm Dịch Vụ Hành Chính Công'],['TT_CUNG_UNG_DVC','Trung tâm Cung Ứng Dịch Vụ Công'],['CONG_AN_XA','Công an xã'],['BAN_CHQS_XA','Ban CHQS xã'],['BAN_QUAN_LY_AP','Ban quản lý các ấp'],['TRAM_Y_TE_XA','Trạm y tế xã']];
  units.forEach(([code,name],i)=>db.put('units',{id:db.next('units'),code,name,sortOrder:i+1}));
}
await db.commit();
console.log('Firestore initialization complete. Existing accounts/data were preserved. Secret backup: .data/cloud/pages-secrets.json.');
