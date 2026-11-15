export const unitNameKey=value=>String(value||'').trim().normalize('NFC').toLocaleLowerCase('vi');
export function normalizeUnit(input) {
 const code=typeof input.code==='string'?input.code.trim().toUpperCase():'';
 const name=typeof input.name==='string'?input.name.trim().normalize('NFC'):'';
 const sortOrder=input.sortOrder??0;
 if(!/^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(code))throw new Error('Mã phòng ban gồm 1–50 ký tự chữ Latin, số, dấu gạch dưới hoặc gạch ngang.');
 if(!name||name.length>200)throw new Error('Tên phòng ban phải có từ 1 đến 200 ký tự.');
 if(!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>10000)throw new Error('Thứ tự hiển thị phải là số nguyên từ 0 đến 10.000.');
 return {code,name,sortOrder};
}
export function findUnitConflict(units,input,exceptId=null) {
 return units.find(u=>u.id!==exceptId&&(u.code?.toUpperCase()===input.code||unitNameKey(u.name)===unitNameKey(input.name)));
}
export const departmentMatches=(user,name)=>unitNameKey(user.department)===unitNameKey(name);
