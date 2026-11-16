import {hasAccess} from './access.mjs';
export const GROUP_LABELS={SystemAdmin:'Quản trị hệ thống',Editorial:'Biên tập – Duyệt',Candidate:'Thi'};
export const businessAccess=user=>['draft','submit','approve','operate'].some(p=>hasAccess(user,p));
export const accountGroup=user=>user?.role==='Candidate'?'Candidate':hasAccess(user,'manageUsers')?'SystemAdmin':'Editorial';
export const accountHome=user=>accountGroup(user)==='SystemAdmin'?'/quan-tri':user?.role==='Organizer'?'/ban-to-chuc':'/thi-sinh';
export function accountMenu(user){
 const rows=[{path:accountHome(user),label:accountGroup(user)==='SystemAdmin'?'Tổng quan hệ thống':user.role==='Candidate'?'Cuộc thi của tôi':'Tổng quan nghiệp vụ',icon:'grid'}];
 if(hasAccess(user,'manageUsers'))rows.push({path:'/ban-to-chuc/tai-khoan',label:'Tài khoản & phân quyền',icon:'users'},{path:'/ban-to-chuc/danh-muc',label:'Danh mục',icon:'book'},{path:'/quan-tri/nhat-ky',label:'Nhật ký hoạt động',icon:'clock'},{path:'/quan-tri/xoa-cuoc-thi',label:'Xóa cuộc thi',icon:'trash'});
 if(user.role==='Organizer'){
  if(['draft','submit'].some(p=>hasAccess(user,p)))rows.push({path:'/ban-to-chuc/bien-tap',label:'Bàn biên tập',icon:'edit'});
  if(['draft','submit','approve'].some(p=>hasAccess(user,p)))rows.push({path:'/ban-to-chuc/ngan-hang-cau-hoi',label:'Ngân hàng câu hỏi',icon:'book'});
  if(businessAccess(user))rows.push({path:'/ban-to-chuc/cuoc-thi',label:'Cuộc thi',icon:'calendar'});
  if(hasAccess(user,'approve'))rows.push({path:'/ban-to-chuc/cho-duyet',label:'Chờ duyệt',icon:'check'});
  if(['approve','operate'].some(p=>hasAccess(user,p)))rows.push({path:'/ban-to-chuc/de-da-duyet',label:'Đề đã duyệt',icon:'shield'});
  if(hasAccess(user,'operate'))rows.push({path:'/ban-to-chuc/to-chuc-thi',label:'Tổ chức thi',icon:'calendar'});
  if(['approve','operate'].some(p=>hasAccess(user,p)))rows.push({path:'/ban-to-chuc/ket-qua',label:'Kết quả cuộc thi',icon:'grid'});
  if(!hasAccess(user,'manageUsers')&&['draft','submit','approve'].some(p=>hasAccess(user,p)))rows.push({path:'/ban-to-chuc/danh-muc',label:'Chủ đề',icon:'book'});
 }else rows.push({path:'/thi-sinh/lich-thi',label:'Lịch thi',icon:'calendar'},{path:'/thi-sinh/ket-qua',label:'Lịch sử thi & kết quả',icon:'check'});
 rows.push({path:'/tai-khoan',label:'Tài khoản cá nhân',icon:'user'});return rows;
}
export function canOpenAccountPath(user,path){
 if(path==='/tai-khoan'||path===accountHome(user))return true;
 if(path.startsWith('/quan-tri'))return hasAccess(user,'manageUsers')&&['/quan-tri','/quan-tri/nhat-ky','/quan-tri/xoa-cuoc-thi'].includes(path);
 if(path.startsWith('/thi-sinh'))return user.role==='Candidate';
 if(!path.startsWith('/ban-to-chuc')||user.role!=='Organizer')return false;
 if(path==='/ban-to-chuc')return businessAccess(user);
 if(path.startsWith('/ban-to-chuc/cuoc-thi')){
  if(/\/(tao|chinh-sua)$/.test(path))return hasAccess(user,'draft');
  if(/\/(lich-thi|phan-cong)$/.test(path))return hasAccess(user,'operate');
  if(/\/(xet-giai|ket-qua)$/.test(path))return hasAccess(user,'operate')||hasAccess(user,'approve');
  return businessAccess(user);
 }
 if(path==='/ban-to-chuc/duyet-thi')return ['approve','operate'].some(p=>hasAccess(user,p));
 return accountMenu(user).some(row=>row.path===path);
}
