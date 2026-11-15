const fs=require('node:fs');const file='backend/Security/ProcessAccess.cs';let s=fs.readFileSync(file,'utf8');
s=s.replace('var p=await FindLegacyAsync(db,role,legacy);ids=[p.Id];scope=role==AppRoles.Organizer?legacy:null;',`if(!Valid(role,role==AppRoles.Candidate?new[]{"takeExam"}:legacy))throw new ArgumentException("Bộ quyền không hợp lệ.");var codes=role==AppRoles.Candidate?new[]{"CANDIDATE"}:new[]{legacy.Contains("manageUsers")?"SYSTEM_ADMIN":null,legacy.Any(p=>p!="manageUsers")?"ORGANIZER":null}.Where(c=>c is not null).ToArray();ids=await db.AccessProcesses.Where(p=>codes.Contains(p.Code)).Select(p=>p.Id).ToArrayAsync();scope=role==AppRoles.Organizer?legacy:null;`);
const start=s.indexOf(' public static async Task MigrateAsync');s=s.slice(0,start)+` public static async Task MigrateAsync(AppDbContext db)
 {
  await using var transaction=await db.Database.BeginTransactionAsync();
  var old=await db.AccessProcesses.AsNoTracking().ToListAsync();var users=await db.Users.ToListAsync();
  var migrate=!await db.AppSettings.AnyAsync(s=>s.Key=="ProcessCatalogV3");
  var targets=migrate?users:users.Where(u=>u.ProcessIdsJson is null).ToList();
  var rights=new Dictionary<int,string[]>();foreach(var u in targets){if(u.ProcessIdsJson is not null)Resolve(u,old);rights[u.Id]=WorkflowAccess.Permissions(u).ToArray();}
  if(migrate){
   (string Code,string Name,string Role,string[] Steps,string Description)[] defaults=[
    ("SYSTEM_ADMIN","Quản trị hệ thống","Organizer",["manageUsers"],"Tài khoản, phân quyền, danh mục và nhật ký hệ thống."),
    ("ORGANIZER","Biên tập – Duyệt","Organizer",["draft","submit","approve","operate"],"Nháp → Chờ duyệt → Đã duyệt → Công khai. Duyệt và trả lại có ghi chú."),
    ("CANDIDATE","Thi","Candidate",["takeExam"],"Vào cuộc thi được phân công, làm và nộp bài theo lịch.")];
   foreach(var item in defaults){var p=await db.AccessProcesses.SingleOrDefaultAsync(p=>p.Code==item.Code);if(p is null){p=new AccessProcess{Code=item.Code,CreatedAtUtc=DateTime.UtcNow};db.AccessProcesses.Add(p);}p.Name=item.Name;p.NameKey=Key(item.Name);p.Role=item.Role;p.StepsJson=JsonSerializer.Serialize(item.Steps);p.Description=item.Description;p.UpdatedAtUtc=DateTime.UtcNow;}
   await db.SaveChangesAsync();
   db.AccessProcesses.RemoveRange(await db.AccessProcesses.Where(p=>new[]{"EDITORIAL","REVIEW_OPERATE","REVIEW","OPERATE","USERS","ADMIN"}.Contains(p.Code)||p.Code.StartsWith("LEGACY_")).ToListAsync());
   db.AppSettings.Add(new AppSetting{Key="ProcessCatalogV3",Value="true"});
  }
  var catalog=await db.AccessProcesses.ToListAsync();
  foreach(var u in targets){var caps=rights[u.Id];var codes=u.Role==AppRoles.Candidate?new[]{"CANDIDATE"}:new[]{caps.Contains("manageUsers")?"SYSTEM_ADMIN":null,caps.Any(p=>p!="manageUsers")?"ORGANIZER":null}.Where(c=>c is not null).ToArray();u.ProcessIdsJson=JsonSerializer.Serialize(codes.Select(code=>catalog.Single(p=>p.Code==code).Id));u.PermissionScopeJson=u.Role==AppRoles.Organizer?JsonSerializer.Serialize(caps):null;}
  await db.SaveChangesAsync();await transaction.CommitAsync();
 }
}
`;fs.writeFileSync(file,s);
