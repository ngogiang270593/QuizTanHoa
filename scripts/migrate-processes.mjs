import fs from 'node:fs';
import assert from 'node:assert/strict';
import {FirestoreStore} from '../worker/firestore.mjs';
import {ensureProcessCatalog} from '../worker/processes.mjs';
import {resolveProcessAccess} from '../shared/processes.mjs';
import {workflowPermissions} from '../shared/access.mjs';
const namespace=process.argv.includes('--preview')?'qt_verify':'qt';
const env={...JSON.parse(fs.readFileSync(new URL('../.data/cloud/pages-secrets.json',import.meta.url),'utf8')),FIRESTORE_NAMESPACE:namespace};
const db=new FirestoreStore(env);await db.begin();
try{
 const users=await db.all('users'),processes=await db.all('processes'),state=await db.get('processState','catalog');
 const rights=u=>workflowPermissions(Array.isArray(u.processIds)?resolveProcessAccess(u,processes):u).slice().sort();
 const before=new Map(users.map(u=>[u.id,rights(u)]));
 await ensureProcessCatalog(db);
 const after=await db.all('users'),catalog=await db.all('processes');
 for(const u of after)assert.deepEqual(workflowPermissions(resolveProcessAccess(u,catalog)).slice().sort(),before.get(u.id),'Migration changed existing access');
 for(const code of ['SYSTEM_ADMIN','ORGANIZER','CANDIDATE'])assert.equal(catalog.filter(p=>p.code===code).length,1);
 const directory=new URL('../.data/imports/',import.meta.url);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(new URL(`processes-${namespace}-before-${Date.now()}.json`,directory),JSON.stringify({users,processes,state},null,2));
 const summary={namespace,accounts:users.length,processes:catalog.length,preservedPermissions:true,writes:db.writes.size};
 if(process.argv.includes('--write')){
  const directory=new URL('../.data/imports/',import.meta.url);fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(new URL(`processes-${namespace}-before-${Date.now()}.json`,directory),JSON.stringify({users,processes,state},null,2));
  await db.commit();
  const verify=new FirestoreStore(env);await verify.begin();try{const persisted=await verify.all('processes');for(const u of await verify.all('users'))assert.deepEqual(workflowPermissions(resolveProcessAccess(u,persisted)).slice().sort(),before.get(u.id));assert.equal((await verify.get('processState','catalog')).version,3);}finally{await verify.close();}
  console.log(JSON.stringify({...summary,committed:true,verified:true}));
 }else console.log(JSON.stringify({...summary,dryRun:true}));
}finally{await db.close();}
