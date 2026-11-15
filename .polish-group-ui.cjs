const fs=require('node:fs');function edit(file,old,next){let s=fs.readFileSync(file,'utf8');if(!s.includes(old))throw Error(file+': '+old);fs.writeFileSync(file,s.split(old).join(next));}
edit('frontend/src/SystemAdminWorkspace.jsx','className="workflow-stats"','className="wh-metrics"');
edit('frontend/src/SystemAdminWorkspace.jsx','<article key={group}>','<article className="wh-metric" key={group}>');
edit('frontend/src/TopicCatalog.jsx','className="button button-secondary" onClick={()=>navigate','className="button button-secondary" disabled={!can(\'draft\')&&!can(\'submit\')&&!can(\'approve\')} onClick={()=>navigate');
edit('frontend/src/ProcessCatalog.jsx',"{row.role==='Organizer'?<p className=\"competition-field-help\">Chờ duyệt:","{row.steps.every(s=>s==='manageUsers')?<p className=\"competition-field-help\">Quản lý tài khoản, phân quyền, danh mục và nhật ký. Cấp thêm quy trình nghiệp vụ khi cần.</p>:row.role==='Organizer'?<p className=\"competition-field-help\">Chờ duyệt:");
