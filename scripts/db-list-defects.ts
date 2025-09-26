import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

function rowsOf(res: any) {
  return Array.isArray(res) ? res : res?.rows ?? [];
}

async function main() {
  const res = await db.execute(sql`
    select d.human_id, d.object, d.status, d.created_at,
           coalesce(p.cnt,0) as photos
    from defects d
    left join (
      select defect_id, count(*) as cnt
      from defect_photos
      group by defect_id
    ) p on p.defect_id = d.id
    order by d.created_at desc
    limit 10
  `);
  console.table(rowsOf(res));
}
main().catch(e => { console.error(e); process.exit(1); });
