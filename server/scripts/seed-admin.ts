// Временный скрипт для создания первого администратора, пока в админке
// (этап 3) ещё нет экрана управления сотрудниками.
// Использование: npm run seed:admin -- "Имя Фамилия" admin@example.com
import "dotenv/config";
import { pool } from "../src/db.js";

const [fullName, email] = process.argv.slice(2);
if (!fullName || !email) {
  console.error('Использование: npm run seed:admin -- "Имя Фамилия" admin@example.com');
  process.exit(1);
}

const res = await pool.query(
  `insert into users (full_name, email, role, is_active)
   values ($1, $2, 'admin', true)
   returning id`,
  [fullName, email]
);

console.log("Создан администратор:", res.rows[0].id);
await pool.end();
