import { db } from "../db";
import { defects, defectActions } from "@shared/schema";
import { and, ne, lt, sql } from "drizzle-orm";
import { bot } from "../telegramBot";

export async function overdueNotifier() {
  const now = new Date();

  const rows = await db
    .select()
    .from(defects)
    .where(
      and(
        ne(defects.status, "fixed"),
        lt(defects.dueDate, now),
        sql`(defects.last_reminder_at IS NULL OR defects.last_reminder_at < now() - interval '1 day')`
      )
    )
    .limit(50);

  for (const d of rows) {
    const humanId = d.humanId;
    const dueStr = d.dueDate ? new Date(d.dueDate).toLocaleDateString("ru-RU") : "—";
    const msg =
      `⏰ Дефект #${humanId} просрочен.\n` +
      `Объект: ${d.object}\n` +
      `Срок: ${dueStr}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Устранено", callback_data: `def_set_fixed:${humanId}` },
          { text: "+1 день",     callback_data: `def_due_p1:${humanId}` },
          { text: "+3 дня",      callback_data: `def_due_p3:${humanId}` },
        ],
        [
          { text: "🗓 Своя дата", callback_data: `def_due_custom:${humanId}` },
          { text: "🧹 Снять с контроля", callback_data: `def_ctl_cancel:${humanId}` },
        ],
      ],
    } as const;

    if (d.assignedTo && /^\d+$/.test(d.assignedTo)) {
      try { await bot.telegram.sendMessage(Number(d.assignedTo), msg, { reply_markup: keyboard }); } catch {}
    }

    if (d.createdByUserId && d.createdByUserId !== d.assignedTo) {
      try { await bot.telegram.sendMessage(Number(d.createdByUserId), msg, { reply_markup: keyboard }); } catch {}
    }

    await db.update(defects)
      .set({ lastReminderAt: new Date() })
      .where(sql`id = ${d.id}`);

    await db.insert(defectActions).values({
      defectId: d.id,
      actorUserId: "system",
      action: "notify_overdue",
      payload: { to: [d.assignedTo, d.createdByUserId].filter(Boolean), due: d.dueDate },
    });
  }
}


