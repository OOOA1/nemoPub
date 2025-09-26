// server/roleHandlers.ts
import type { Context } from "telegraf";
import { ADMINS, MANAGERS, isAdminTgId } from "./bootstrapAdmins";

function setToBulleted(set: Set<string>): string {
  const arr: string[] = [];
  set.forEach((v) => arr.push(`• ${v}`));
  return arr.length ? arr.join("\n") : "—";
}

export function registerRoleCommands(bot: any) {
  bot.command("role", async (ctx: Context) => {
    const me = String(ctx.from?.id ?? "");
    const role = isAdminTgId(me) ? "admin" : (MANAGERS.has(me) ? "manager" : "user");
    return ctx.reply(`Ваша роль: ${role}`);
  });

  bot.command("admins", async (ctx: Context) => {
    if (!isAdminTgId(String(ctx.from?.id ?? ""))) {
      return ctx.reply("⛔ Только для админов.");
    }
    const a = setToBulleted(ADMINS);
    const m = setToBulleted(MANAGERS);
    return ctx.reply(`👑 Admins:\n${a}\n\n👔 Managers:\n${m}`);
  });

  // глушим старые команды, чтобы не путали
  bot.command(["promote", "demote"], (ctx: Context) =>
    ctx.reply("В этой сборке роли задаются через ENV: ADMIN_TG_IDS, MANAGER_TG_IDS."),
  );
}
