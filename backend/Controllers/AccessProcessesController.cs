using System.Text.Json;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Models;
using Quiz_TanHoa.Api.Security;
namespace Quiz_TanHoa.Api.Controllers;
[ApiController,Route("api/organizer/processes"),Authorize(Policy=AppRoles.Organizer)]
public sealed class AccessProcessesController(AppDbContext db):ControllerBase
{
 [HttpGet] public async Task<IActionResult> List(){var users=await db.Users.AsNoTracking().ToListAsync();return Ok((await db.AccessProcesses.AsNoTracking().OrderBy(p=>p.Id).ToListAsync()).Select(p=>ProcessAccess.Profile(p,users)));}
 [HttpPost] public async Task<IActionResult> Create(ProcessRequest request){
  if(!Valid(request))return BadRequest(new{message="Tên, loại tài khoản hoặc các quyền không hợp lệ."});
  await using var tx=await db.Database.BeginTransactionAsync();var key=ProcessAccess.Key(request.Name);
  if(await db.AccessProcesses.AnyAsync(p=>p.NameKey==key))return Conflict(new{message="Tên quy trình đã tồn tại."});
  var p=new AccessProcess{Code="CUSTOM",Name=request.Name.Trim().Normalize(),NameKey=key,Description=request.Description?.Trim()??"",Role=request.Role,StepsJson=JsonSerializer.Serialize(request.Steps),CreatedAtUtc=DateTime.UtcNow,UpdatedAtUtc=DateTime.UtcNow};db.AccessProcesses.Add(p);await db.SaveChangesAsync();Audit(p,"ProcessCreated",JsonSerializer.Serialize(request));await db.SaveChangesAsync();await tx.CommitAsync();return StatusCode(201,ProcessAccess.Profile(p,await db.Users.ToListAsync()));
 }
 [HttpPut("{id:int}")] public async Task<IActionResult> Update(int id,ProcessRequest request){
  if(!Valid(request))return BadRequest(new{message="Tên, loại tài khoản hoặc các quyền không hợp lệ."});
  await using var tx=await db.Database.BeginTransactionAsync();var catalog=await db.AccessProcesses.ToListAsync();var process=catalog.SingleOrDefault(p=>p.Id==id);if(process is null)return NotFound(new{message="Không tìm thấy quy trình."});
  var key=ProcessAccess.Key(request.Name);if(catalog.Any(p=>p.Id!=id&&p.NameKey==key))return Conflict(new{message="Tên quy trình đã tồn tại."});
  var users=await db.Users.ToListAsync();var assigned=users.Where(u=>ProcessAccess.Ids(u).Contains(id)).ToList();if(assigned.Count>0&&process.Role!=request.Role)return Conflict(new{message="Quy trình đang được gán; không thể đổi loại tài khoản."});
  var before=JsonSerializer.Serialize(new{process.Name,process.Role,steps=ProcessAccess.Steps(process),process.Description});
  var changed=!ProcessAccess.Steps(process).SequenceEqual(request.Steps);
  process.Name=request.Name.Trim().Normalize();process.NameKey=key;process.Description=request.Description?.Trim()??"";process.Role=request.Role;process.StepsJson=JsonSerializer.Serialize(request.Steps);process.UpdatedAtUtc=DateTime.UtcNow;
  foreach(var u in users)ProcessAccess.Resolve(u,catalog);
  if(!users.Any(u=>u.IsActive&&WorkflowAccess.Has(u,"manageUsers")))return Conflict(new{message="Phải giữ ít nhất một tài khoản quản lý người dùng."});
  var actor=CurrentAccount.User(HttpContext);var proposedActor=users.Single(u=>u.Id==actor.Id);if(WorkflowAccess.Has(actor,"manageUsers")&&!WorkflowAccess.Has(proposedActor,"manageUsers"))return Conflict(new{message="Không được bỏ quyền quản lý của chính bạn qua sửa quy trình."});
  if(changed){var ids=assigned.Select(u=>u.Id).ToList();foreach(var s in await db.AuthSessions.Where(s=>ids.Contains(s.UserId)&&s.RevokedAtUtc==null).ToListAsync())s.RevokedAtUtc=DateTime.UtcNow;}
  Audit(process,"ProcessUpdated",before+" → "+JsonSerializer.Serialize(request));await db.SaveChangesAsync();await tx.CommitAsync();return Ok(ProcessAccess.Profile(process,users));
 }
 [HttpDelete("{id:int}")] public async Task<IActionResult> Delete(int id){
  await using var tx=await db.Database.BeginTransactionAsync();var process=await db.AccessProcesses.SingleOrDefaultAsync(p=>p.Id==id);if(process is null)return NotFound(new{message="Không tìm thấy quy trình."});
  if((await db.Users.ToListAsync()).Any(u=>ProcessAccess.Ids(u).Contains(id)))return Conflict(new{message="Quy trình đang được gán cho tài khoản. Hãy bỏ gán hoặc đổi quy trình trước khi xóa."});
  Audit(process,"ProcessDeleted",process.Name);db.AccessProcesses.Remove(process);await db.SaveChangesAsync();await tx.CommitAsync();return NoContent();
 }
 private static bool Valid(ProcessRequest r)=>!string.IsNullOrWhiteSpace(r.Name)&&r.Steps is not null&&ProcessAccess.Valid(r.Role,r.Steps);
 private void Audit(AccessProcess p,string action,string note){var u=CurrentAccount.User(HttpContext);db.WorkflowEvents.Add(new WorkflowEvent{ActorUserId=u.Id,ActorName=u.FullName,Action=action,Note=$"Quy trình {p.Id}: {note}",OccurredAtUtc=DateTime.UtcNow});}
}
public sealed class ProcessRequest{[Required,MaxLength(200)]public string Name{get;set;}="";[MaxLength(2000)]public string? Description{get;set;}public string Role{get;set;}="Organizer";public string[] Steps{get;set;}=[];}
