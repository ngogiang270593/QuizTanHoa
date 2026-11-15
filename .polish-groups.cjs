const fs=require('node:fs');function edit(file,old,next){const s=fs.readFileSync(file,'utf8');if(!s.includes(old))throw Error(file+': '+old);fs.writeFileSync(file,s.split(old).join(next));}
edit('frontend/src/App.jsx',"{account.accessLabel || ROLE_NAMES[account.role] || 'Không xác định'}","{GROUP_LABELS[accountGroup(account)]}");
edit('frontend/src/App.jsx','trải nghiệm hai vai trò','trải nghiệm các nhóm tài khoản');
edit('frontend/src/App.jsx',"const ROLE_NAMES = { Organizer: 'Ban Tổ chức', Candidate: 'Thí sinh' };","const ROLE_NAMES = { Organizer: 'Biên tập – Duyệt', Candidate: 'Thi' };");
edit('worker/organizer.mjs','return json(profile(account))','return json(userProfile(account))');
edit('worker/organizer.mjs',"const {db,body,method,parts,user,env}=ctx;","const {db,body,method,parts,user,env}=ctx;\n  const auditAccount=(account,action)=>db.put('accessEvents',{id:db.next('accessEvents'),userId:account.id,actorUserId:user.id,actorName:user.fullName||user.username,action,occurredAtUtc:now()});");
edit('worker/organizer.mjs','db.put(\'users\',account);return json(userProfile(account),201);',"db.put('users',account);auditAccount(account,'AccountCreated');return json(userProfile(account),201);");
edit('worker/organizer.mjs',"isActive:body.isActive});db.put('users',account);return", "isActive:body.isActive});db.put('users',account);auditAccount(account,body.isActive?'AccountUpdated':'AccountDisabled');return");
edit('worker/organizer.mjs',"db.remove('users',id);for", "db.remove('users',id);auditAccount(account,'AccountDeleted');for");
edit('scripts/migrate-processes.mjs',"const summary={namespace", "const directory=new URL('../.data/imports/',import.meta.url);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(new URL(`processes-${namespace}-before-${Date.now()}.json`,directory),JSON.stringify({users,processes,state},null,2));\n const summary={namespace");
