import 'dotenv/config';
import { db } from "../server/db";
import { defects } from "../shared/schema";
import { lt, and, ne } from "drizzle-orm";

async function main() {
  const now = new Date();

  const rows = await db
    .select()
    .from(defects)
    .where(
      and(
        ne(defects.status, "fixed"),
        lt(defects.dueDate, now)
      )
    )
    .limit(20);

  console.log("Overdue defects:", rows.map(r => ({
    id: r.humanId,
    due: r.dueDate,
    assignedTo: r.assignedTo,
    lastReminder: r.lastReminderAt
  })));
}

main().catch(err => {
  console.error("Overdue check FAILED:", err);
  process.exit(1);
});


