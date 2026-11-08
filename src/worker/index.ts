// Worker entry point: runs pg-boss jobs with the same code as the SvelteKit app.
import { PgBoss } from 'pg-boss';
import { createDb } from '../lib/server/db';
import { media } from '../lib/server/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const db = createDb(url);
const boss = new PgBoss(url);
boss.on('error', (err) => console.error('[worker] pg-boss error', err));

await boss.start();

// Placeholder job that proves the chain app code -> pg-boss -> database works.
const PING = 'ping';
await boss.createQueue(PING);
await boss.work(PING, async ([job]) => {
	console.log(`[worker] ping ${job.id}: ${await db.$count(media)} media in catalogue`);
});
await boss.send(PING, {});
console.log('[worker] started');

async function shutdown(signal: string) {
	console.log(`[worker] ${signal} received, stopping`);
	await boss.stop({ graceful: true });
	await db.$client.end();
	process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
