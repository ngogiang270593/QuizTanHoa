using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quiz_TanHoa.Api.Data;
using Quiz_TanHoa.Api.Security;
namespace Quiz_TanHoa.Api.Controllers;
[ApiController,Route("api/organizer"),Authorize(Policy=AppRoles.Organizer)]
public sealed class SystemAdminController(AppDbContext db):ControllerBase
{
 [HttpGet("system-summary")]
 public async Task<IActionResult> Summary(){
  var users=await db.Users.AsNoTracking().ToListAsync();var catalog=await db.AccessProcesses.AsNoTracking().ToListAsync();foreach(var u in users)ProcessAccess.Resolve(u,catalog);
  return Ok(new{serverTimeUtc=DateTime.UtcNow,userCount=users.Count,activeCount=users.Count(u=>u.IsActive),groups=new[]{"SystemAdmin","Editorial","Candidate"}.ToDictionary(group=>group,group=>users.Count(u=>WorkflowAccess.Group(u)==group)),processCount=catalog.Count,departmentCount=await db.OrganizationUnits.CountAsync(),topicCount=await db.QuestionTopics.CountAsync()});
 }
 [HttpGet("activity")]
 public async Task<IActionResult> Activity(){
  var events=await db.WorkflowEvents.AsNoTracking().OrderByDescending(e=>e.OccurredAtUtc).Take(200).ToListAsync();
  return Ok(events.Select(e=>new{id="workflow-"+e.Id,category=e.ExamId.HasValue?"Duyệt đề":e.Action.StartsWith("Process")?"Quy trình":"Tài khoản & phân quyền",e.Action,e.ActorName,occurredAtUtc=DateTime.SpecifyKind(e.OccurredAtUtc,DateTimeKind.Utc),target=e.ExamId.HasValue?"Đề #"+e.ExamId:e.UserId.HasValue?"Tài khoản #"+e.UserId:"Quy trình",note=e.ExamId.HasValue?e.Note:""}));
 }
}
