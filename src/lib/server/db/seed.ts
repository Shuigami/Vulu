// Development seed: one user, one media of each type, a few library entries.
// Idempotent: does nothing if the demo user already exists.
import { eq } from 'drizzle-orm';
import { createDb } from '.';
import { libraryEntries, media, mediaExternalIds, mediaTitles, users } from './schema';

type Provider = (typeof mediaExternalIds.$inferInsert)['provider'];

const catalogue: {
	media: typeof media.$inferInsert;
	ids: [Provider, string][];
	titles: [string, string][];
}[] = [
	{
		media: {
			type: 'movie',
			title: 'Le Voyage de Chihiro',
			originalTitle: '千と千尋の神隠し',
			status: 'finished',
			startDate: '2001-07-20',
			runtimeMinutes: 125
		},
		ids: [['tmdb', '129']],
		titles: [
			['Le Voyage de Chihiro', 'fr'],
			['Spirited Away', 'en'],
			['Sen to Chihiro no Kamikakushi', 'ja-Latn']
		]
	},
	{
		media: {
			type: 'tv',
			title: 'Severance',
			status: 'releasing',
			startDate: '2022-02-18',
			totalUnits: 19,
			totalUnitsSecondary: 2
		},
		ids: [['tmdb', '95396']],
		titles: [['Severance', 'en']]
	},
	{
		media: {
			type: 'anime',
			title: 'Frieren',
			originalTitle: '葬送のフリーレン',
			status: 'finished',
			startDate: '2023-09-29',
			totalUnits: 28,
			runtimeMinutes: 24
		},
		ids: [
			['anilist', '154587'],
			['mal', '52991']
		],
		titles: [
			['Frieren', 'fr'],
			["Frieren: Beyond Journey's End", 'en'],
			['Sōsō no Furīren', 'ja-Latn'],
			['葬送のフリーレン', 'ja']
		]
	},
	{
		media: {
			type: 'manga',
			title: 'One Piece',
			originalTitle: 'ワンピース',
			status: 'releasing',
			startDate: '1997-07-22'
		},
		ids: [['anilist', '30013']],
		titles: [
			['One Piece', 'en'],
			['ワンピース', 'ja']
		]
	},
	{
		media: {
			type: 'book',
			title: 'Dune',
			status: 'finished',
			startDate: '1965-08-01',
			totalUnits: 896,
			extra: { authors: ['Frank Herbert'] }
		},
		ids: [['openlibrary', 'OL893415W']],
		titles: [['Dune', 'en']]
	}
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

try {
	const existing = await db.$count(users, eq(users.username, 'demo'));
	if (existing > 0) {
		console.log('Seed already applied, nothing to do.');
	} else {
		await db.transaction(async (tx) => {
			const [user] = await tx
				.insert(users)
				.values({ email: 'demo@vulu.local', username: 'demo', displayName: 'Démo' })
				.returning({ id: users.id });

			const mediaIds: number[] = [];
			for (const item of catalogue) {
				const [row] = await tx.insert(media).values(item.media).returning({ id: media.id });
				mediaIds.push(row.id);
				await tx.insert(mediaExternalIds).values(
					item.ids.map(([provider, externalId], i) => ({
						mediaId: row.id,
						provider,
						externalId,
						isPrimary: i === 0
					}))
				);
				await tx
					.insert(mediaTitles)
					.values(item.titles.map(([title, locale]) => ({ mediaId: row.id, title, locale })));
			}

			const [chihiro, severance, frieren, onePiece] = mediaIds;
			await tx.insert(libraryEntries).values([
				{
					userId: user.id,
					mediaId: chihiro,
					status: 'completed',
					score: 95,
					completedOn: '2024-12-25'
				},
				{
					userId: user.id,
					mediaId: severance,
					status: 'in_progress',
					progress: 12,
					progressSecondary: 2
				},
				{ userId: user.id, mediaId: frieren, status: 'completed', score: 90, progress: 28 },
				{
					userId: user.id,
					mediaId: onePiece,
					status: 'paused',
					progress: 1050,
					progressSecondary: 105
				}
			]);
		});
		console.log(`Seeded 1 user, ${catalogue.length} media, 4 library entries.`);
	}
} finally {
	await db.$client.end();
}
