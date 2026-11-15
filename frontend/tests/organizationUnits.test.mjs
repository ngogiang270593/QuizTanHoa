import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUnit,findUnitConflict,unitNameKey,departmentMatches} from '../../shared/organizationUnits.mjs';
import {requiredAccess} from '../../shared/access.mjs';
test('department names and codes normalize without losing Vietnamese accents',()=>{
 const unit=normalizeUnit({code:' phong_kinh_te ',name:' Phòng Kinh tế '.normalize('NFD'),sortOrder:3});
 assert.deepEqual(unit,{code:'PHONG_KINH_TE',name:'Phòng Kinh tế',sortOrder:3});
 assert.equal(unitNameKey(' PHÒNG KINH TẾ '),unitNameKey(unit.name));
 assert.equal(departmentMatches({department:' phòng kinh tế '},unit.name),true);
});
test('department duplicate checks protect both identifiers and names while permitting self edits',()=>{
 const units=[{id:1,code:'PHONG_A',name:'Phòng A',sortOrder:1}];
 assert.equal(findUnitConflict(units,normalizeUnit({code:'phong_a',name:'Khác'}))?.id,1);
 assert.equal(findUnitConflict(units,normalizeUnit({code:'PHONG_B',name:'phòng a'}))?.id,1);
 assert.equal(findUnitConflict(units,normalizeUnit({code:'phong_a',name:'Phòng A'}),1),undefined);
});
test('invalid department fields and unauthorized mutation paths are rejected',()=>{
 for(const body of [{code:'BAD CODE',name:'Tên'},{code:'A',name:' '},{code:'A',name:'Tên',sortOrder:-1},{code:'A',name:'Tên',sortOrder:1.5},{code:'A',name:'Tên',sortOrder:10001}])assert.throws(()=>normalizeUnit(body));
 assert.equal(requiredAccess(['api','organizer','organization-units'],'GET'),null);
 for(const method of ['POST','PUT','DELETE'])assert.equal(requiredAccess(['api','organizer','organization-units','1'],method),'manageUsers');
});
