import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FirestoreStore} from '../worker/firestore.mjs';
import {normalizeUnit,unitNameKey,departmentMatches} from '../shared/organizationUnits.mjs';
const root=new URL('../',import.meta.url),file=p=>new URL(p,root);
let source,local;
const dbArg=process.argv.indexOf('--database');
if(dbArg>=0){
 const filename=process.argv[dbArg+1];assert.ok(filename&&fs.existsSync(filename),'Local SQLite database missing.');
 const sqlite=new DatabaseSync(filename,{readOnly:true});try{local=sqlite.prepare('SELECT Code AS code, Name AS name, SortOrder AS sortOrder FROM OrganizationUnits ORDER BY SortOrder, Id').all();}finally{sqlite.close();}source=filename;
}else{
 source='backend/Data/InitialOrganizationSeeder.cs';const text=fs.readFileSync(file(source),'utf8');
 const section=text.slice(text.indexOf('private static readonly UnitSeed[] Units'),text.indexOf('private static readonly QuestionSeed[] Questions'));
 local=[...section.matchAll(/new\("([A-Z0-9_]+)", "([^"]+)"\)/g)].map((m,i)=>({code:m[1],name:m[2],sortOrder:i+1}));assert.equal(local.length,9,'Expected exactly 9 canonical local departments.');
}
local=local.map(normalizeUnit);assert.ok(local.length>0);assert.equal(new Set(local.map(u=>u.code)).size,local.length);assert.equal(new Set(local.map(u=>unitNameKey(u.name))).size,local.length);
fs.mkdirSync(file('.data/imports/'),{recursive:true});fs.writeFileSync(file('.data/imports/organization-units-local.json'),JSON.stringify({source,units:local},null,2));
const env=JSON.parse(fs.readFileSync(file('.data/cloud/pages-secrets.json'),'utf8'));
const db=new FirestoreStore({...env,FIRESTORE_NAMESPACE:'qt'});await db.begin();
try{
 const current=await db.all('units'),users=await db.all('users');
 const plans=local.map(unit=>{
  const matches=current.filter(q=>q.code.toUpperCase()===unit.code||unitNameKey(q.name)===unitNameKey(unit.name));
  assert.ok(matches.length<=1,'Conflicting web codes/names; stopped before changing data.');
  const existing=matches[0];return {unit,existing,changed:!!existing&&(existing.code!==unit.code||existing.name!==unit.name||existing.sortOrder!==unit.sortOrder)};
 });
 assert.equal(new Set(plans.filter(p=>p.existing).map(p=>p.existing.id)).size,plans.filter(p=>p.existing).length,'Two local units map to one web unit.');
 const summary={source,localCount:local.length,created:plans.filter(p=>!p.existing).length,updated:plans.filter(p=>p.changed).length,reused:plans.filter(p=>p.existing&&!p.changed).length};
 if(!process.argv.includes('--write'))console.log(JSON.stringify({preflight:true,...summary}));
 else{
  const stamp=new Date().toISOString(),changed=plans.filter(p=>p.changed),affected=users.filter(u=>changed.some(p=>departmentMatches(u,p.existing.name)));
  fs.writeFileSync(file('.data/imports/organization-units-before-'+Date.now()+'.json'),JSON.stringify({savedAtUtc:stamp,units:current,users:affected},null,2));
  for(const plan of plans){
   if(!plan.existing){db.put('units',{...plan.unit,id:db.next('units'),createdAtUtc:stamp,updatedAtUtc:stamp});}
   else if(plan.changed){
    for(const user of users)if(departmentMatches(user,plan.existing.name)){user.department=plan.unit.name;db.put('users',user);}
    db.put('units',{...plan.existing,...plan.unit,updatedAtUtc:stamp});
   }
  }
  await db.commit();
  const read=new FirestoreStore({...env,FIRESTORE_NAMESPACE:'qt'});await read.begin();try{const persisted=await read.all('units');for(const unit of local){const matches=persisted.filter(q=>q.code===unit.code);assert.equal(matches.length,1);assert.equal(matches[0].name,unit.name);assert.equal(matches[0].sortOrder,unit.sortOrder);}}finally{await read.close();}
  const report={...summary,completedAtUtc:stamp,verified:local.length,updatedAccounts:affected.length};fs.writeFileSync(file('.data/imports/organization-units-sync-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}finally{await db.close();}
