using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
namespace Quiz_TanHoa.Api.Security;
public static class ProcessAccess
{
 public static string Key(string name)=>name.Trim().Normalize().ToUpperInvariant();
 public static int[] Ids(User user){try{return user.ProcessIdsJson is null?[]:JsonSerializer.Deserialize<int[]>(user.ProcessIdsJson)??[];}catch{return [];}}
 public static string[] Steps(AccessProcess process){try{return JsonSerializer.Deserialize<string[]>(process.StepsJson)??[];}catch{return [];}}
 private static string Signature(string role,IEnumerable<string> steps)=>role+":"+string.Join(",",steps.Distinct().Order());
 public static void Resolve(User user,IReadOnlyList<AccessProcess> catalog)
 {
  user.AssignedProcesses=Ids(user).Select(id=>catalog.SingleOrDefault(p=>p.Id==id)).Where(p=>p is not null&&p.Role==user.Role).Select(p=>new AssignedProcess(p!.Id,p.Name,p.Role,Steps(p))).ToArray();
  user.ProcessPermissionKeys=user.AssignedProcesses.SelectMany(p=>p.Steps).Distinct().ToArray();
  if(user.Role==AppRoles.Organizer&&user.PermissionScopeJson is not null){string[] scope;try{scope=JsonSerializer.Deserialize<string[]>(user.PermissionScopeJson)??[];}catch{scope=[];}user.ProcessPermissionKeys=user.ProcessPermissionKeys.Where(scope.Contains).ToArray();}
  user.ResolvedWorkflowPermissions=user.Role==AppRoles.Organizer?user.ProcessPermissionKeys.Where(WorkflowAccess.All.Contains).ToArray():[];
 }
 public static async Task HydrateAsync(AppDbContext db,User user)=>Resolve(user,await db.AccessProcesses.AsNoTracking().ToListAsync());
 public static object Profile(AccessProcess p,List<User> users)=>new {p.Id,p.Code,p.Name,p.Role,p.Description,steps=Steps(p),userCount=users.Count(u=>Ids(u).Contains(p.Id)),createdAtUtc=DateTime.SpecifyKind(p.CreatedAtUtc,DateTimeKind.Utc),updatedAtUtc=DateTime.SpecifyKind(p.UpdatedAtUtc,DateTimeKind.Utc)};
 public static bool Valid(string role,string[] steps)=>steps.Length>0&&steps.Length<=5&&steps.Length==steps.Distinct().Count()&&(role==AppRoles.Candidate?steps.Length==1&&steps[0]=="takeExam":role==AppRoles.Organizer&&steps.All(WorkflowAccess.All.Contains));
 public static async Task<AccessProcess> FindLegacyAsync(AppDbContext db,string role,string[] permissions)
 {
  var steps=role==AppRoles.Candidate?new[]{"takeExam"}:permissions;if(!Valid(role,steps))throw new ArgumentException("Bộ quyền không hợp lệ.");
  return await db.AccessProcesses.SingleOrDefaultAsync(p=>p.Code==(role==AppRoles.Candidate?"CANDIDATE":"ORGANIZER"))??throw new WorkflowConflictException("Hãy tạo hoặc chọn quy trình phù hợp.");
 }
 public static async Task<(int[] Ids,string[] Permissions,string[]? Scope)> RequestAsync(AppDbContext db,string role,int[]? ids,string[] legacy)
 {
  if(role is not (AppRoles.Organizer or AppRoles.Candidate))throw new ArgumentException("Loại tài khoản không hợp lệ.");
  string[]? scope=null;
  if(ids is null){if(role==AppRoles.Candidate&&legacy.Length>0)throw new ArgumentException("Thí sinh chỉ dùng quy trình dự thi.");if(!Valid(role,role==AppRoles.Candidate?new[]{"takeExam"}:legacy))throw new ArgumentException("Bộ quyền không hợp lệ.");var codes=role==AppRoles.Candidate?new[]{"CANDIDATE"}:new[]{legacy.Contains("manageUsers")?"SYSTEM_ADMIN":null,legacy.Any(p=>p!="manageUsers")?"ORGANIZER":null}.Where(c=>c is not null).ToArray();ids=await db.AccessProcesses.Where(p=>codes.Contains(p.Code)).Select(p=>p.Id).ToArrayAsync();scope=role==AppRoles.Organizer?legacy:null;}
  if(ids.Length is <1 or >20||ids.Distinct().Count()!=ids.Length||ids.Any(id=>id<=0))throw new ArgumentException("Chọn từ 1 đến 20 quy trình khác nhau.");
  var catalog=await db.AccessProcesses.ToListAsync();var selected=ids.Select(id=>catalog.SingleOrDefault(p=>p.Id==id)).ToList();
  if(selected.Any(p=>p is null))throw new WorkflowConflictException("Một quy trình không còn tồn tại. Hãy tải lại danh mục.");
  if(selected.Any(p=>p!.Role!=role))throw new ArgumentException("Không gán chung quy trình tổ chức và thí sinh.");
  return(ids,role==AppRoles.Organizer?selected.SelectMany(p=>Steps(p!)).Where(p=>scope is null||scope.Contains(p)).Distinct().ToArray():[],scope);
 }
 public static async Task MigrateAsync(AppDbContext db)
 {
  await using var transaction=await db.Database.BeginTransactionAsync();
  var old=await db.AccessProcesses.AsNoTracking().ToListAsync();var users=await db.Users.ToListAsync();
  var migrate=!await db.AppSettings.AnyAsync(s=>s.Key=="ProcessCatalogV3");
  var targets=migrate?users:users.Where(u=>u.ProcessIdsJson is null).ToList();
  var rights=new Dictionary<int,string[]>();foreach(var u in targets){if(u.ProcessIdsJson is not null)Resolve(u,old);rights[u.Id]=WorkflowAccess.Permissions(u).ToArray();}
  if(migrate){
   (string Code,string Name,string Role,string[] Steps,string Description)[] defaults=[
    ("SYSTEM_ADMIN","Quản trị hệ thống","Organizer",["manageUsers"],"Tài khoản, phân quyền, danh mục và nhật ký hệ thống."),
    ("ORGANIZER","Biên tập và tổ chức thi","Organizer",["draft","submit","operate"],"Biên tập đề, gửi duyệt, tổ chức thi và xem kết quả cuộc thi."),
    ("REVIEWER","Duyệt đề","Organizer",["approve"],"Duyệt hoặc trả lại đề; xem kết quả cuộc thi ở chế độ chỉ đọc."),
    ("CANDIDATE","Thi","Candidate",["takeExam"],"Vào cuộc thi được phân công, làm và nộp bài theo lịch.")];
   foreach(var item in defaults){var p=await db.AccessProcesses.SingleOrDefaultAsync(p=>p.Code==item.Code);if(p is null){p=new AccessProcess{Code=item.Code,CreatedAtUtc=DateTime.UtcNow};db.AccessProcesses.Add(p);}p.Name=item.Name;p.NameKey=Key(item.Name);p.Role=item.Role;p.StepsJson=JsonSerializer.Serialize(item.Steps);p.Description=item.Description;p.UpdatedAtUtc=DateTime.UtcNow;}
   await db.SaveChangesAsync();
   db.AccessProcesses.RemoveRange(await db.AccessProcesses.Where(p=>new[]{"EDITORIAL","REVIEW_OPERATE","REVIEW","OPERATE","USERS","ADMIN"}.Contains(p.Code)||p.Code.StartsWith("LEGACY_")).ToListAsync());
   db.AppSettings.Add(new AppSetting{Key="ProcessCatalogV3",Value="true"});
  }
  var catalog=await db.AccessProcesses.ToListAsync();
  foreach(var u in targets){var caps=rights[u.Id];var codes=u.Role==AppRoles.Candidate?new[]{"CANDIDATE"}:new[]{caps.Contains("manageUsers")?"SYSTEM_ADMIN":null,caps.Any(p=>new[]{"draft","submit","operate"}.Contains(p))?"ORGANIZER":null,caps.Contains("approve")?"REVIEWER":null}.Where(c=>c is not null).ToArray();u.ProcessIdsJson=JsonSerializer.Serialize(codes.Select(code=>catalog.Single(p=>p.Code==code).Id));u.PermissionScopeJson=u.Role==AppRoles.Organizer?JsonSerializer.Serialize(caps):null;}
  await db.SaveChangesAsync();await transaction.CommitAsync();
   if(!await db.AppSettings.AnyAsync(s=>s.Key=="ProcessCatalogV4"))
  {
   await using var tx=await db.Database.BeginTransactionAsync();
    var v4Catalog=await db.AccessProcesses.ToListAsync();var v4Users=await db.Users.ToListAsync();var v4Rights=new Dictionary<int,string[]>();
    foreach(var u in v4Users){if(u.ProcessIdsJson is not null)Resolve(u,v4Catalog);v4Rights[u.Id]=WorkflowAccess.Permissions(u);}
    var editorial=v4Catalog.SingleOrDefault(p=>p.Code=="ORGANIZER");if(editorial is not null){editorial.Name="Biên tập và tổ chức thi";editorial.NameKey=Key(editorial.Name);editorial.StepsJson=JsonSerializer.Serialize(new[]{"draft","submit","operate"});editorial.Description="Biên tập đề, gửi duyệt, tổ chức thi và xem kết quả cuộc thi.";editorial.UpdatedAtUtc=DateTime.UtcNow;}
    var reviewer=v4Catalog.SingleOrDefault(p=>p.Code=="REVIEWER");if(reviewer is null){reviewer=new AccessProcess{Code="REVIEWER",CreatedAtUtc=DateTime.UtcNow};db.AccessProcesses.Add(reviewer);}
   reviewer.Name="Duyệt đề";reviewer.NameKey=Key(reviewer.Name);reviewer.Role=AppRoles.Organizer;reviewer.StepsJson=JsonSerializer.Serialize(new[]{"approve"});reviewer.Description="Duyệt hoặc trả lại đề; xem kết quả cuộc thi ở chế độ chỉ đọc.";reviewer.UpdatedAtUtc=DateTime.UtcNow;
   await db.SaveChangesAsync();
    foreach(var u in v4Users){if(u.Role!=AppRoles.Organizer||!v4Rights[u.Id].Contains("approve"))continue;var ids=Ids(u).ToList();if(!ids.Contains(reviewer.Id)){ids.Add(reviewer.Id);u.ProcessIdsJson=JsonSerializer.Serialize(ids);}}
   db.AppSettings.Add(new AppSetting{Key="ProcessCatalogV4",Value="true"});await db.SaveChangesAsync();await tx.CommitAsync();
   }
  }
}
