import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { episodes, libraryEntries, media, pushSubscriptions, users } from './db/schema';
import type { Mail } from './mail';
import {
	getNotificationSettings,
	releaseLine,
	releaseMail,
	releasePush,
	removePushSubscription,
	savePushSubscription,
	sendReleaseNotifications,
	setReleaseEmail,
	type Release
} from './notifications';
import type { PushSubscriptionKeys } from './webpush';

const onePiece: Release = {
	mediaId: 1,
	title: 'One Piece',
	episodes: [{ label: 'Ép. 1120', time: '17:30' }]
};
const bear: Release = {
	mediaId: 2,
	title: 'The Bear',
	episodes: [
		{ label: 'S3E1', time: null },
		{ label: 'S3E10', time: null }
	]
};

describe('release messages', () => {
	it('describes one work per line', () => {
		expect(releaseLine(onePiece)).toBe('One Piece, Ép. 1120, à 17:30');
		expect(releaseLine(bear)).toBe('The Bear, S3E1 à S3E10');
	});

	it('writes the e-mail digest', () => {
		const mail = releaseMail('a@b.c', 'Shui', [onePiece, bear], 'https://vulu.test');
		expect(mail.subject).toBe('Sorties du jour : One Piece et The Bear');
		expect(mail.text).toContain('- One Piece, Ép. 1120, à 17:30\n- The Bear, S3E1 à S3E10');
		expect(mail.text).toContain('https://vulu.test/calendar');
		const many = [1, 2, 3, 4].map((i) => ({ ...bear, mediaId: i, title: `T${i}` }));
		expect(releaseMail('a@b.c', 'Shui', many, '').subject).toBe(
			'Sorties du jour : T1, T2 et 2 autres'
		);
	});

	it('links one work to its page, several to the calendar', () => {
		expect(releasePush([onePiece], '2026-11-23')).toEqual({
			title: 'Sorties du jour',
			body: 'One Piece, Ép. 1120, à 17:30',
			url: 'media/1',
			tag: 'releases-2026-11-23'
		});
		const many = [1, 2, 3, 4, 5, 6].map((i) => ({ ...onePiece, mediaId: i }));
		const push = releasePush(many, '2026-11-23');
		expect(push.url).toBe('calendar');
		expect(push.body.split('\n')).toHaveLength(5);
		expect(push.body).toMatch(/et 2 autres$/);
	});
});

// Integration: needs a migrated database (pnpm db:up && pnpm db:migrate).
describe('release notifications in the database', () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	const db = createDb(url);
	const run = randomUUID().slice(0, 8);
	const userIds: string[] = [];
	const mediaIds: number[] = [];
	// A day no other test uses: 10 March 2031, 08:00 in Paris
	const now = new Date('2031-03-10T07:00:00Z');

	afterAll(async () => {
		await db.delete(users).where(inArray(users.id, userIds));
		await db.delete(media).where(inArray(media.id, mediaIds));
		await db.$client.end();
	});

	async function newUser(n: string) {
		const [{ id }] = await db
			.insert(users)
			.values({ email: `notif-${n}-${run}@test.vulu`, username: `notif_${n}_${run}` })
			.returning({ id: users.id });
		userIds.push(id);
		return id;
	}
	async function newShow(title: string, airDates: string[]) {
		const [{ id }] = await db
			.insert(media)
			.values({ type: 'anime', title: `${title} ${run}` })
			.returning({ id: media.id });
		mediaIds.push(id);
		await db
			.insert(episodes)
			.values(airDates.map((d, i) => ({ mediaId: id, number: i + 1, airDate: new Date(d) })));
		return id;
	}
	const sub = (n: string): PushSubscriptionKeys => ({
		endpoint: `https://push.example.com/${run}/${n}`,
		p256dh: 'p',
		auth: 'a'
	});

	it('stores the settings and the devices', async () => {
		const userId = await newUser('settings');
		expect(await getNotificationSettings(db, userId)).toEqual({ releaseEmail: false });
		await setReleaseEmail(db, userId, true);
		expect(await getNotificationSettings(db, userId)).toEqual({ releaseEmail: true });

		await savePushSubscription(db, userId, sub('settings'));
		await savePushSubscription(db, userId, { ...sub('settings'), auth: 'b' });
		const rows = await db
			.select()
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, userId));
		expect(rows).toMatchObject([{ auth: 'b' }]);
		await removePushSubscription(db, userId, sub('settings').endpoint);
		expect(
			await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
		).toEqual([]);
	});

	it('notifies today’s episodes of followed works, once a day', async () => {
		const mailer = await newUser('mail');
		const pusher = await newUser('push');
		const silent = await newUser('silent');
		const today = await newShow('Today', [
			'2031-03-09T22:30:00Z', // 23:30 in Paris on the 9th: yesterday
			'2031-03-10T00:00:00Z', // TMDB date: the 10th, no time
			'2031-03-10T16:00:00Z' // 17:00 in Paris
		]);
		const tomorrow = await newShow('Tomorrow', ['2031-03-10T23:30:00Z']);
		const dropped = await newShow('Dropped', ['2031-03-10T12:00:00Z']);
		for (const userId of [mailer, pusher, silent]) {
			await db.insert(libraryEntries).values([
				{ userId, mediaId: today, status: 'in_progress' },
				{ userId, mediaId: tomorrow, status: 'planned' },
				{ userId, mediaId: dropped, status: 'dropped' }
			]);
		}
		await setReleaseEmail(db, mailer, true);
		await savePushSubscription(db, pusher, sub('push-ok'));
		await savePushSubscription(db, pusher, sub('push-gone'));

		const mails: Mail[] = [];
		const pushes: { endpoint: string; payload: object }[] = [];
		const options = {
			now,
			origin: 'https://vulu.test',
			sendMail: async (m: Mail) => void mails.push(m),
			sendPush: async (s: PushSubscriptionKeys, payload: object) => {
				pushes.push({ endpoint: s.endpoint, payload });
				return s.endpoint.endsWith('gone') ? ('gone' as const) : ('sent' as const);
			}
		};
		await sendReleaseNotifications(db, options);

		const ours = (to: string) => to.includes(run);
		expect(mails.filter((m) => ours(m.to))).toHaveLength(1);
		expect(mails[0].to).toBe(`notif-mail-${run}@test.vulu`);
		expect(mails[0].text).toContain(`- Today ${run}, Ép. 2 à Ép. 3\n\n`);
		const ourPushes = pushes.filter((p) => p.endpoint.includes(run));
		expect(ourPushes.map((p) => p.endpoint.split('/').pop()).sort()).toEqual([
			'push-gone',
			'push-ok'
		]);
		expect(ourPushes[0].payload).toEqual({
			title: 'Sorties du jour',
			body: `Today ${run}, Ép. 2 à Ép. 3`,
			url: `media/${today}`,
			tag: 'releases-2031-03-10'
		});
		// The gone device is dropped
		const devices = await db
			.select({ endpoint: pushSubscriptions.endpoint })
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, pusher));
		expect(devices).toEqual([{ endpoint: sub('push-ok').endpoint }]);

		// A replay the same day sends nothing; the next day sends again
		mails.length = pushes.length = 0;
		await sendReleaseNotifications(db, options);
		expect(mails.filter((m) => ours(m.to))).toEqual([]);
		expect(pushes.filter((p) => p.endpoint.includes(run))).toEqual([]);
		await sendReleaseNotifications(db, { ...options, now: new Date('2031-03-11T07:00:00Z') });
		expect(mails.filter((m) => ours(m.to)).map((m) => m.subject)).toEqual([
			`Sorties du jour : Tomorrow ${run}`
		]);
	});
});
