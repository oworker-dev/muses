import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run API migrations.");
  process.exit(1);
}

const migrationsUrl = new URL(
  "../../../packages/db/migrations/",
  import.meta.url,
);
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query(`
    create table if not exists app_schema_migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const names = (await readdir(migrationsUrl))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const name of names) {
    const applied = await pool.query(
      "select 1 from app_schema_migration where name = $1",
      [name],
    );
    if (applied.rowCount) continue;
    const migration = await readFile(new URL(name, migrationsUrl), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migration);
      await client.query(
        "insert into app_schema_migration (name) values ($1)",
        [name],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log("OWorker SaaS API migrations applied.");
} finally {
  await pool.end();
}
