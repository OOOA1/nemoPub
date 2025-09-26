// server/middlewares/ensureUser.ts
import { db } from "../db";
import { users } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { Context, MiddlewareFn } from "telegraf";

export const ensureUser: MiddlewareFn<Context> = async (ctx, next) => {
  const tg = ctx.from;
  if (!tg) return next();

  const tgId = String(tg.id); // telegramId в БД — string

  const [u] = await db.select().from(users).where(eq(users.telegramId, tgId)).limit(1);

  if (!u) {
    await db.insert(users).values({
      telegramId: tgId,
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
    } as any);
  } else {
    const newUsername = tg.username ?? null;
    if (u.username !== newUsername) {
      await db.update(users).set({ username: newUsername } as any).where(eq(users.id, u.id));
    }
  }

  return next();
};
