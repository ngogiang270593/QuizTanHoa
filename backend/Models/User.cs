using System.ComponentModel.DataAnnotations;

namespace Quiz_TanHoa.Api.Models;

public class User
{
    public int Id { get; set; }
    [MaxLength(100)]
    public string Username { get; set; } = "";
    [MaxLength(256)]
    public string Password { get; set; } = "";
    [MaxLength(200)]
    public string FullName { get; set; } = "";
    [MaxLength(200)]
    public string Department { get; set; } = "";
    [MaxLength(50)]
    public string Role { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public bool IsDemo { get; set; }
    public string? PermissionScopeJson { get; set; }
    public string? ProcessIdsJson { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string[]? ResolvedWorkflowPermissions { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string[] ProcessPermissionKeys { get; set; } = [];
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public AssignedProcess[] AssignedProcesses { get; set; } = [];
    public string? WorkflowPermissionsJson { get; set; }
    public bool MustChangePassword { get; set; }
}
