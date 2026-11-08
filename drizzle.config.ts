import { defineConfig } from 'drizzle-kit';

try {
	process.loadEnvFile();
} catch {
	// No .env file: rely on the process environment (CI, production).
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	casing: 'snake_case',
	dbCredentials: { url: process.env.DATABASE_URL },
	strict: true,
	verbose: true
});
