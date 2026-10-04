// Временный скрипт: выпустить ссылку-приглашение для существующего
// пользователя. В этапе 3 это станет кнопкой в админке («Сотрудники»).
// Использование: npm run invite -- <user_id>
import "dotenv/config";
import { pool } from "../src/db.js";
import { createInvitation } from "../src/auth/service.js";

const [userId] = process.argv.slice(2);
if (!userId) {
  console.error("Использование: npm run invite -- <user_id>");
  process.exit(1);
}

const { token, expiresAt } = await createInvitation(userId, null);

console.log("Токен приглашения (отдать сотруднику одноразово):", token);
console.log("Действует до:", expiresAt.toISOString());
console.log(`Ссылка: /invite/${token}`);

await pool.end();
