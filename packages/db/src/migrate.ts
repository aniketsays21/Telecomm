import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrationClient } from './client';
import { drizzle } from 'drizzle-orm/postgres-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = drizzle(migrationClient);
await migrate(db, {
  migrationsFolder: path.join(__dirname, '../migrations'),
});
console.log('Migrations applied');
await migrationClient.end();
