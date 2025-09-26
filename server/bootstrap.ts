import "dotenv/config";
import { ensureBootstrapAdmins } from "./bootstrapAdmins";

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("[BOOT] DATABASE_URL не найден. cwd=", process.cwd());
    process.exit(1);
  }

  await ensureBootstrapAdmins(); // сейчас пустышка — ок

  await import("./index");
})();
