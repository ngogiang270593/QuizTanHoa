import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ACCESS_PRESETS} from '../../shared/access.mjs';
import {workflowSections,canOpenWorkflow,EDITORIAL_PATH,DELIVERY_PATH,OPERATIONS_PATH,RESULTS_PATH,APPROVED_PATH,operationStep,candidateInView} from '../../shared/workflowNavigation.mjs';
test('organizer processes and candidate navigation follow the existing assigned rights',()=>{
 const users=Object.fromEntries(Object.entries(ACCESS_PRESETS).map(([key,p])=>[key,{role:p.role,workflowPermissions:p.permissions}]));
 assert.deepEqual(workflowSections(users.Author),['editorial']);
 assert.deepEqual(workflowSections(users.Reviewer),['delivery']);
 assert.deepEqual(workflowSections(users.Operator),['delivery']);
 assert.deepEqual(workflowSections(users.Admin),['editorial','delivery','administration']);
 assert.deepEqual(workflowSections(users.Candidate),['candidate']);
 assert.equal(canOpenWorkflow(users.Author,DELIVERY_PATH),false);
 assert.equal(canOpenWorkflow(users.Reviewer,EDITORIAL_PATH),false);
 assert.equal(canOpenWorkflow(users.Reviewer,APPROVED_PATH),true);
 assert.equal(canOpenWorkflow(users.Operator,APPROVED_PATH),true);
 assert.equal(canOpenWorkflow(users.Operator,OPERATIONS_PATH),true);
 assert.equal(canOpenWorkflow(users.Reviewer,RESULTS_PATH),false);
 for(const path of [EDITORIAL_PATH,DELIVERY_PATH,OPERATIONS_PATH,RESULTS_PATH,APPROVED_PATH])assert.equal(canOpenWorkflow(users.Candidate,path),false);
});
test('next operational step respects approval, schedule, assignment, publication and closing time',()=>{
 const at='2030-01-01T03:00:00Z';
 const row={id:1,status:'Draft',approvedExamCount:0,scheduleComplete:false,assignmentCount:0};
 assert.equal(operationStep(row,at).key,'approval');assert.equal(operationStep(row,at).url,null);
 row.approvedExamCount=1;assert.equal(operationStep(row,at).key,'schedule');
 row.scheduleComplete=true;assert.equal(operationStep(row,at).key,'assign');
 row.assignmentCount=2;assert.equal(operationStep(row,at).key,'publish');
 row.status='Published';row.opensAtUtc='2030-01-01T04:00:00Z';row.closesAtUtc='2030-01-01T05:00:00Z';assert.equal(operationStep(row,at).key,'scheduled');
 assert.equal(operationStep(row,'2030-01-01T04:30:00Z').key,'running');
 assert.equal(operationStep(row,'2030-01-01T05:00:00Z').key,'closed');
 row.status='Ended';assert.equal(operationStep(row,at).key,'ended');
});
test('candidate schedule and history keep active attempts distinct from completed work',()=>{
 for(const attemptStatus of ['NotStarted','InProgress']){assert.equal(candidateInView({attemptStatus,status:'Published'},'schedule'),true);assert.equal(candidateInView({attemptStatus,status:'Published'},'results'),false);}
 for(const attemptStatus of ['Submitted','Expired']){assert.equal(candidateInView({attemptStatus,status:'Published'},'schedule'),false);assert.equal(candidateInView({attemptStatus,status:'Published'},'results'),true);}
 assert.equal(candidateInView({attemptStatus:'NotStarted',status:'Ended'},'results'),true);
});
