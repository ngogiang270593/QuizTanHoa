import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROCESS_DEFAULTS,processStages,normalizeProcess,resolveProcessAccess} from '../../shared/processes.mjs';
test('catalog starts with three account workflows and explicit review/publication stages',()=>{
 assert.equal(PROCESS_DEFAULTS.length,3);assert.deepEqual(PROCESS_DEFAULTS.map(p=>p.name),['Quản trị hệ thống','Biên tập – Duyệt','Thi']);
 assert.deepEqual(processStages('Organizer'),['Nháp','Chờ duyệt','Đã duyệt','Công khai']);assert.deepEqual(processStages('Candidate'),['Thi']);
});
test('process step order is preserved and incompatible or duplicate rights are rejected',()=>{
 assert.deepEqual(normalizeProcess({name:' Thử ',role:'Organizer',steps:['submit','draft']}).steps,['submit','draft']);
 assert.throws(()=>normalizeProcess({name:'Thử',role:'Organizer',steps:['draft','draft']}));assert.throws(()=>normalizeProcess({name:'Thử',role:'Candidate',steps:['manageUsers']}));
});
test('process-based permissions follow catalog changes while legacy restrictions remain intact',()=>{
 const catalog=[{id:1,name:'Ban tổ chức',role:'Organizer',steps:['draft','submit','manageUsers']},{id:2,name:'Người dùng',role:'Candidate',steps:['takeExam']}];
 assert.deepEqual(resolveProcessAccess({role:'Organizer',processIds:[1]},catalog).workflowPermissions,['draft','submit','manageUsers']);
 assert.deepEqual(resolveProcessAccess({role:'Organizer',processIds:[1],permissionScope:['draft']},catalog).workflowPermissions,['draft']);
 assert.deepEqual(resolveProcessAccess({role:'Organizer',processIds:[2]},catalog).workflowPermissions,[]);
 assert.deepEqual(resolveProcessAccess({role:'Candidate',processIds:[2]},catalog).processPermissionKeys,['takeExam']);
});
