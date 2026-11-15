using Microsoft.EntityFrameworkCore;
namespace Quiz_TanHoa.Api.Data;
public static class ProcessSchemaUpgrade
{
 public static async Task ApplyAsync(AppDbContext db, System.Data.Common.DbTransaction transaction)
 {
  var exists=false;
  await using(var command=db.Database.GetDbConnection().CreateCommand()){
   command.Transaction=transaction;command.CommandText="PRAGMA table_info(\"Users\")";
   await using var reader=await command.ExecuteReaderAsync();while(await reader.ReadAsync())exists|=reader.GetString(1)=="ProcessIdsJson";
  }
  if(!exists)await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Users\" ADD COLUMN \"ProcessIdsJson\" TEXT NULL");
  var hasScope=false;
  await using(var command=db.Database.GetDbConnection().CreateCommand()){command.Transaction=transaction;command.CommandText="PRAGMA table_info(\"Users\")";await using var reader=await command.ExecuteReaderAsync();while(await reader.ReadAsync())hasScope|=reader.GetString(1)=="PermissionScopeJson";}
  if(!hasScope)await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Users\" ADD COLUMN \"PermissionScopeJson\" TEXT NULL");
  await db.Database.ExecuteSqlRawAsync("""
   CREATE TABLE IF NOT EXISTS "AccessProcesses" (
    "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"Code" TEXT NOT NULL,
    "Name" TEXT NOT NULL,"NameKey" TEXT NOT NULL,"Role" TEXT NOT NULL,
    "StepsJson" TEXT NOT NULL,"Description" TEXT NOT NULL,
    "CreatedAtUtc" TEXT NOT NULL,"UpdatedAtUtc" TEXT NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS "IX_AccessProcesses_NameKey" ON "AccessProcesses"("NameKey");
   """);
 }
}
