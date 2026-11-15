import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowPermissions,requiredAccess,hasAccess,ACCESS_PRESETS} from '../../shared/access.mjs';
test('legacy organizer retains admin access while malformed explicit permissions fail closed',()=>{
 assert.equal(hasAccess({role:'Organizer'},'manageUsers'),true);
 for(const workflowPermissions of [null,'*',{},['*']])assert.deepEqual(workflowPermissionsFor({role:'Organizer',workflowPermissions}),[]);
 assert.deepEqual(workflowPermissionsFor({role:'Candidate',workflowPermissions:['manageUsers']}),[]);
});
const workflowPermissionsFor=workflowPermissions;
test('each preset is denied API operations outside its assigned work',()=>{
 const routes=[['POST','/api/organizer/competitions','draft'],['POST','/api/organizer/competitions/1/exams/1/submit-review','submit'],['POST','/api/organizer/competitions/1/exams/1/approve','approve'],['POST','/api/organizer/competitions/1/publish','operate'],['PUT','/api/organizer/users/2/access','manageUsers']];
 for(const [name,preset] of Object.entries(ACCESS_PRESETS))for(const [method,path,permission] of routes){const user={role:preset.role,workflowPermissions:preset.permissions};assert.equal(requiredAccess(path.split('/').filter(Boolean),method),permission);assert.equal(hasAccess(user,permission),preset.permissions.includes(permission),name+': '+path);}
});
test('read permissions protect answer keys and account lists from operations staff',()=>{
 assert.deepEqual(requiredAccess(['api','organizer','competitions','1','exams','1','questions'],'GET'),['draft','submit','approve']);
 assert.equal(requiredAccess(['api','organizer','users'],'GET'),'manageUsers');
 assert.equal(requiredAccess(['api','organizer','review-queue'],'GET'),'approve');
 assert.equal(requiredAccess(['api','organizer','competitions','1','assignment-options'],'GET'),'operate');
});
