import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountGroup,accountHome,accountMenu,canOpenAccountPath} from '../../shared/accountGroups.mjs';
const admin={role:'Organizer',workflowPermissions:['manageUsers']},editor={role:'Organizer',workflowPermissions:['draft','submit','approve','operate']},candidate={role:'Candidate',workflowPermissions:[]};
test('three groups get separate homes and menus without administration leakage',()=>{
 for(const [user,group,home]of [[admin,'SystemAdmin','/quan-tri'],[editor,'Editorial','/ban-to-chuc'],[candidate,'Candidate','/thi-sinh']]){assert.equal(accountGroup(user),group);assert.equal(accountHome(user),home);for(const row of accountMenu(user))assert.equal(canOpenAccountPath(user,row.path),true,row.path);}
 assert.deepEqual(accountMenu(admin).map(r=>r.path),['/quan-tri','/ban-to-chuc/tai-khoan','/ban-to-chuc/danh-muc','/quan-tri/nhat-ky','/tai-khoan']);
 for(const user of [editor,candidate])assert.ok(!accountMenu(user).some(r=>r.path.includes('nhat-ky')||r.path==='/ban-to-chuc/tai-khoan'));
});
test('direct links respect account and task permissions and explicit extra admin duties',()=>{
 for(const path of ['/ban-to-chuc/cuoc-thi','/ban-to-chuc/cho-duyet','/ban-to-chuc/ngan-hang-cau-hoi','/thi-sinh/lich-thi'])assert.equal(canOpenAccountPath(admin,path),false,path);
 for(const path of ['/quan-tri','/quan-tri/nhat-ky','/ban-to-chuc/tai-khoan','/thi-sinh/lich-thi'])assert.equal(canOpenAccountPath(editor,path),false,path);
 assert.equal(canOpenAccountPath({role:'Organizer',workflowPermissions:['approve']},'/ban-to-chuc/cuoc-thi/1/tao'),false);
 assert.equal(canOpenAccountPath({role:'Organizer',workflowPermissions:['draft']},'/ban-to-chuc/cuoc-thi/1/phan-cong'),false);
 assert.equal(canOpenAccountPath({...admin,workflowPermissions:['manageUsers','draft']},'/ban-to-chuc/cuoc-thi'),true);
});
