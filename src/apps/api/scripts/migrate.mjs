import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run API migrations.");
  process.exit(1);
}

const migrationUrl = new URL("../../../packages/db/migrations/0001_initial.sql", import.meta.url);
const migration = await readFile(migrationUrl, "utf8");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query(migration);
  console.log("OWorker SaaS API migrations applied.");
} finally {
  await pool.end();
}
