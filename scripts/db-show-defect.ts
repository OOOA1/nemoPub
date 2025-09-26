import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const humanId = process.argv[2];
if (!humanId) {
  console.error('Usage: npm run db:show D-000001');
  process.exit(1);
}

function rowsOf(res: any) {
  return Array.isArray(res) ? res : res?.rows ?? [];
}

async function main() {
  const defRes = await db.execute(sql`
    select * from defects where human_id = ${humanId} limit 1
  `);
  const defect = rowsOf(defRes)[0];
  if (!defect) {
    console.log('❌ Not found');
    return;
  }
  console.log('Defect:', defect);

  const photosRes = await db.execute(sql`
    select type, telegram_file_id, created_at
    from defect_photos
    where defect_id = ${defect.id}
    order by created_at
  `);
  console.log('Photos:', rowsOf(photosRes));

  const actionsRes = await db.execute(sql`
    select action, payload, created_at
    from defect_actions
    where defect_id = ${defect.id}
    order by created_at
  `);
  console.log('Actions:', rowsOf(actionsRes));
}
main().catch(e => { console.error(e); process.exit(1); });
