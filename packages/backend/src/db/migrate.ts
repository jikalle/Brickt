import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QueryTypes } from 'sequelize';
import { sequelize } from './index.js';
import '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await sequelize.query<{ name: string }>('SELECT name FROM schema_migrations;', {
    type: QueryTypes.SELECT,
  });
  return new Set(rows.map((row: { name: string }) => row.name));
}

async function runMigration(name: string, sql: string): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(sql, { transaction });
    await sequelize.query('INSERT INTO schema_migrations (name) VALUES (:name);', {
      replacements: { name },
      transaction,
    });
  });
}

async function migrate(): Promise<void> {
  await sequelize.authenticate();
  await ensureMigrationsTable();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = await getAppliedMigrations();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await runMigration(file, sql);
  }

  console.log('✅ Migrations complete');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
