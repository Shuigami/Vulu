// Applies the SQL migrations in drizzle/ (production: drizzle-kit is a dev dependency).
// Same bookkeeping table as `drizzle-kit migrate`, so both can be used on one database.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '.';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

try {
	await migrate(db, { migrationsFolder: 'drizzle' });
	console.log('[migrate] database up to date');
} finally {
	await db.$client.end();
}
