// server/bootstrapAdmins.ts
const parseIds = (s?: string) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const ADMINS   = new Set<string>(parseIds(process.env.ADMIN_TG_IDS));
export const MANAGERS = new Set<string>(parseIds(process.env.MANAGER_TG_IDS));

export function isAdminTgId(tgId: number | string): boolean {
  return ADMINS.has(String(tgId));
}
export function isManagerOrAdminTgId(tgId: number | string): boolean {
  const s = String(tgId);
  return ADMINS.has(s) || MANAGERS.has(s);
}

// ничего не делаем — оставлено для совместимости вызова
export async function ensureBootstrapAdmins(): Promise<void> {
  return;
}
