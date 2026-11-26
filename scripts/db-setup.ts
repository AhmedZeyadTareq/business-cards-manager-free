// npm run db:setup — indexes + the Atlas Search index. Safe to re-run.
import { ensureHighManagement } from "@/modules/accounts/departments.repo";
import { currentDatabaseName, withDb } from "@/modules/db/mongo";
import { setupDatabase } from "@/modules/db/setup";

withDb(async () => {
  console.log(`Database: ${currentDatabaseName()}`);
  await setupDatabase(console.log);
  await ensureHighManagement();
  console.log("Done.");
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
