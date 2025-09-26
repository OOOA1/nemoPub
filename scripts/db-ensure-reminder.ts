import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('▶ Ensuring defects.last_reminder_at ...');

  // колонка + индекс для due_date
  await db.execute(sql`
    ALTER TABLE defects
    ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_defects_due_status
      ON defects (status, due_date);
  `);

  console.log('✅ last_reminder_at ensured');
}

main().catch((err) => {
  console.error('❌ Ensure reminder FAILED:', err);
  process.exit(1);
});


