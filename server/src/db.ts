import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function checkDb(): Promise<boolean> {
  const res = await pool.query("select 1 as ok");
  return res.rows[0]?.ok === 1;
}
