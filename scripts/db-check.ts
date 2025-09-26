// scripts/db-check.ts
import 'dotenv/config';
import { db } from '../server/db';
import { sql, desc } from 'drizzle-orm';
import { defects, defectPhotos, defectActions } from '../shared/schema';

function firstRow<T = any>(res: any): T | undefined {
  return Array.isArray(res) ? res[0] : res?.rows?.[0];
}
function mapRows(res: any) {
  return Array.isArray(res) ? res : res?.rows ?? [];
}

async function main() {
  console.log('▶ Checking DB connectivity...');
  const rNow = await db.execute(sql`select now() as now`);
  const now = firstRow(rNow)?.now;
  console.log('DB time:', now);

  console.log('▶ Checking tables existence...');
  const rTables = await db.execute(sql`
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('defects','defect_photos','defect_actions')
    order by tablename
  `);
  console.log('Tables:', mapRows(rTables).map((r: any) => r.tablename));
  

  console.log('▶ Quick counts...');
  const rD = await db.execute(sql`select count(*)::int as c from defects`);
  const rP = await db.execute(sql`select count(*)::int as c from defect_photos`);
  const rA = await db.execute(sql`select count(*)::int as c from defect_actions`);
  const dCount = firstRow(rD)?.c ?? 0;
  const pCount = firstRow(rP)?.c ?? 0;
  const aCount = firstRow(rA)?.c ?? 0;
  console.log({ defects: dCount, photos: pCount, actions: aCount });

  // Последние 3 дефекта (для наглядности)
  const last = await db
    .select({
      humanId: defects.humanId,
      object: defects.object,
      status: defects.status,
      createdAt: defects.createdAt,
    })
    .from(defects)
    .orderBy(desc(defects.createdAt))
    .limit(3);
  console.log('Last defects:', last);

  console.log('✅ DB check OK');
}

main().catch((err) => {
  console.error('DB check FAILED:', err);
  process.exit(1);
});
