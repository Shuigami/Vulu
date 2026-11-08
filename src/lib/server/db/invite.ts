// Usage: pnpm invite someone@example.com [other@example.com …]
import { createDb } from '.';
import { invites } from './schema';

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase());
if (emails.length === 0 || emails.some((e) => !/^[^@\s]+@[^@\s]+$/.test(e))) {
	console.error('Usage: pnpm invite <email> [email…]');
	process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

try {
	const added = await db
		.insert(invites)
		.values(emails.map((email) => ({ email })))
		.onConflictDoNothing()
		.returning({ email: invites.email });
	for (const email of emails) {
		console.log(
			`${email}: ${added.some((a) => a.email === email) ? 'invited' : 'already invited'}`
		);
	}
} finally {
	await db.$client.end();
}
