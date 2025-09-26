// scripts/db-fix-humanid.ts
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('▶ Ensuring sequence + default for defects.human_id...');
  await db.execute(sql`
    DO $$ BEGIN
      CREATE SEQUENCE IF NOT EXISTS defects_human_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    ALTER TABLE defects
      ALTER COLUMN human_id SET DEFAULT ('D-' || lpad(nextval('defects_human_id_seq')::text, 6, '0'));

    -- если вдруг были строки с NULL (у тебя их нет, но на будущее):
    UPDATE defects
      SET human_id = 'D-' || lpad(nextval('defects_human_id_seq')::text, 6, '0')
      WHERE human_id IS NULL;
  `);

  console.log('✅ human_id default is set');
}

main().catch((e) => {
  console.error('db-fix-humanid failed:', e);
  process.exit(1);
});
