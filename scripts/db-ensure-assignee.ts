import 'dotenv/config';
import { db } from '../server/db';
import { sql, desc } from 'drizzle-orm';
import { defects, defectPhotos, defectActions } from '../shared/schema';

// ВСТАВЬ СЮДА ТО ЖЕ, ЧТО ВВЕРХУ db-check.ts (загрузка окружения)
import "../cross-env"; // ← пример, замени на свой импорт

async function main() {
  console.log("▶ Ensuring defects.assigned_to / due_date ...");
  await db.execute(sql`
    ALTER TABLE public.defects
      ADD COLUMN IF NOT EXISTS assigned_to varchar,
      ADD COLUMN IF NOT EXISTS due_date timestamptz;
  `);
  console.log("✅ Columns ensured");
}

main().then(() => process.exit(0)).catch(err => {
  console.error("DB ensure FAILED:", err);
  process.exit(1);
});
