// Release notifications: each morning, the episodes of followed shows and anime airing today,
// by e-mail (opt-in) and web push (every subscribed device). Sent by the worker.
import { and, asc, eq, exists, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { describeAirDate, episodeLabel, FOLLOWED, startOfToday } from './calendar';
import type { Db } from './db';
import {
	episodes,
	libraryEntries,
	media,
	notificationSettings,
	pushSubscriptions,
	seasons,
	users
} from './db/schema';
import type { Mail, SendMail } from './mail';
import type { PushSubscriptionKeys, SendPush } from './webpush';

export async function getNotificationSettings(db: Db, userId: string) {
	const [settings] = await db
		.select({ releaseEmail: notificationSettings.releaseEmail })
		.from(notificationSettings)
		.where(eq(notificationSettings.userId, userId));
	return { releaseEmail: settings?.releaseEmail ?? false };
}

export async function setReleaseEmail(db: Db, userId: string, releaseEmail: boolean) {
	await db
		.insert(notificationSettings)
		.values({ userId, releaseEmail })
		.onConflictDoUpdate({ target: notificationSettings.userId, set: { releaseEmail } });
}

/** Saves a device; a browser signed in to another account now notifies this one. */
export async function savePushSubscription(db: Db, userId: string, sub: PushSubscriptionKeys) {
	await db
		.insert(pushSubscriptions)
		.values({ userId, ...sub })
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: { userId, p256dh: sub.p256dh, auth: sub.auth }
		});
}

export async function removePushSubscription(db: Db, userId: string, endpoint: string) {
	await db
		.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** One work airing today, its episodes in airing order. */
export type Release = {
	mediaId: number;
	title: string;
	episodes: { label: string; time: string | null }[];
};
type Recipient = { userId: string; email: string; name: string; releaseEmail: boolean };

/** Today's episodes of followed works, for users with e-mail on or a push device. */
export async function releasesOfDay(db: Db, from: Date, to: Date) {
	const hasDevice = exists(
		db
			.select({ id: pushSubscriptions.id })
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, users.id))
	);
	const rows = await db
		.select({
			userId: users.id,
			email: users.email,
			username: users.username,
			displayName: users.displayName,
			releaseEmail: notificationSettings.releaseEmail,
			mediaId: media.id,
			title: media.title,
			airDate: episodes.airDate,
			number: episodes.number,
			seasonNumber: seasons.number
		})
		.from(episodes)
		.innerJoin(media, eq(media.id, episodes.mediaId))
		.innerJoin(
			libraryEntries,
			and(eq(libraryEntries.mediaId, media.id), inArray(libraryEntries.status, [...FOLLOWED]))
		)
		.innerJoin(users, eq(users.id, libraryEntries.userId))
		.leftJoin(notificationSettings, eq(notificationSettings.userId, users.id))
		.leftJoin(seasons, eq(seasons.id, episodes.seasonId))
		.where(
			and(
				gte(episodes.airDate, from),
				lt(episodes.airDate, to),
				or(eq(notificationSettings.releaseEmail, true), hasDevice)
			)
		)
		.orderBy(asc(users.id), asc(episodes.airDate), asc(media.title), asc(episodes.number));

	const byUser = new Map<string, { recipient: Recipient; releases: Release[] }>();
	for (const r of rows) {
		let user = byUser.get(r.userId);
		if (!user) {
			const recipient = {
				userId: r.userId,
				email: r.email,
				name: r.displayName ?? r.username,
				releaseEmail: r.releaseEmail ?? false
			};
			user = { recipient, releases: [] };
			byUser.set(r.userId, user);
		}
		let release = user.releases.find((m) => m.mediaId === r.mediaId);
		if (!release) {
			release = { mediaId: r.mediaId, title: r.title, episodes: [] };
			user.releases.push(release);
		}
		release.episodes.push({ label: episodeLabel(r), time: describeAirDate(r.airDate!).time });
	}
	return [...byUser.values()];
}

/** "One Piece, Ép. 1120, à 17:30", "The Bear, S3E1 à S3E10". */
export function releaseLine(r: Release) {
	const first = r.episodes[0];
	const last = r.episodes[r.episodes.length - 1];
	const episodes = r.episodes.length === 1 ? first.label : `${first.label} à ${last.label}`;
	return `${r.title}, ${episodes}${first.time ? `, à ${first.time}` : ''}`;
}

/** "One Piece", "One Piece et The Bear", "One Piece, The Bear et 2 autres". */
function titles(releases: Release[]) {
	const names = releases.map((r) => r.title);
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} et ${names[1]}`;
	const more = names.length - 2;
	return `${names[0]}, ${names[1]} et ${more} ${more === 1 ? 'autre' : 'autres'}`;
}

export function releaseMail(to: string, name: string, releases: Release[], origin: string): Mail {
	return {
		to,
		subject: `Sorties du jour : ${titles(releases)}`,
		text: [
			`Bonjour ${name},`,
			'',
			'Aujourd’hui sortent :',
			...releases.map((r) => `- ${releaseLine(r)}`),
			'',
			`Ton calendrier : ${origin}/calendar`,
			'',
			`Pour ne plus recevoir ces e-mails : ${origin}/settings`
		].join('\n')
	};
}

/** Push payload, read by the service worker; `url` is relative to the app's root. */
export type PushMessage = { title: string; body: string; url: string; tag: string };

const PUSH_LINES = 4;

export function releasePush(releases: Release[], day: string): PushMessage {
	const lines = releases.slice(0, PUSH_LINES).map(releaseLine);
	const more = releases.length - lines.length;
	if (more > 0) lines.push(`et ${more} ${more === 1 ? 'autre' : 'autres'}`);
	return {
		title: 'Sorties du jour',
		body: lines.join('\n'),
		url: releases.length === 1 ? `media/${releases[0].mediaId}` : 'calendar',
		// One notification a day: a replay replaces it instead of stacking
		tag: `releases-${day}`
	};
}

/** Marks `day` as notified for the user; false when it already was (job replayed). */
async function claimDay(db: Db, userId: string, day: string) {
	const claimed = await db
		.insert(notificationSettings)
		.values({ userId, lastReleaseDay: day })
		.onConflictDoUpdate({
			target: notificationSettings.userId,
			set: { lastReleaseDay: day },
			setWhere: or(
				isNull(notificationSettings.lastReleaseDay),
				lt(notificationSettings.lastReleaseDay, day)
			)
		})
		.returning({ userId: notificationSettings.userId });
	return claimed.length > 0;
}

/** Sends to every device of the user, dropping the ones the push service says are gone. */
export async function pushToUser(db: Db, userId: string, message: PushMessage, sendPush: SendPush) {
	const subs = await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId));
	let sent = 0;
	for (const sub of subs) {
		const result = await sendPush(sub, message);
		if (result === 'sent') sent++;
		if (result === 'gone')
			await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
	}
	return sent;
}

export type NotifyOptions = {
	sendMail: SendMail;
	/** Null when VAPID keys are not configured: e-mail only. */
	sendPush: SendPush | null;
	/** Public URL of the app, for the links in e-mails. */
	origin: string;
	now?: Date;
};

/** The daily job: today's (Paris) releases to each user, once a day. */
export async function sendReleaseNotifications(db: Db, options: NotifyOptions) {
	const from = startOfToday(options.now);
	const to = startOfToday(new Date(from.getTime() + 36 * 3600_000)); // next local midnight
	const day = describeAirDate(from).dayKey;
	const stats = { users: 0, mails: 0, pushes: 0 };
	for (const { recipient, releases } of await releasesOfDay(db, from, to)) {
		if (!(await claimDay(db, recipient.userId, day))) continue;
		stats.users++;
		try {
			if (recipient.releaseEmail) {
				await options.sendMail(
					releaseMail(recipient.email, recipient.name, releases, options.origin)
				);
				stats.mails++;
			}
			if (options.sendPush)
				stats.pushes += await pushToUser(
					db,
					recipient.userId,
					releasePush(releases, day),
					options.sendPush
				);
		} catch (err) {
			// The day stays claimed: better one missed notification than the same one twice
			console.error(`[notifications] user ${recipient.userId}`, err);
		}
	}
	return stats;
}
