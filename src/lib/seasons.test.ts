import { describe, expect, it } from 'vitest';
import { rangesOf, seasonAt, seasonLabel, seasonPosition } from './seasons';

const show = [
	{ season: 1, first: 1, last: 12 },
	{ season: 2, first: 13, last: 24 },
	{ season: 3, first: 25, last: 36 }
];

describe('season position', () => {
	it('places the absolute progress in its season', () => {
		expect(seasonPosition(show, 29)).toEqual({ season: 3, seen: 5, count: 12 });
		// End of a season: the next one, not started yet; the last season stays full
		expect(seasonPosition(show, 24)).toEqual({ season: 3, seen: 0, count: 12 });
		expect(seasonPosition(show, 36)).toEqual({ season: 3, seen: 12, count: 12 });
		expect(seasonPosition(show, 25)).toEqual({ season: 3, seen: 1, count: 12 });
		expect(seasonPosition(show, 0)).toEqual({ season: 1, seen: 0, count: 12 });
	});

	it('keeps the absolute count for one season or a progress past the known episodes', () => {
		expect(seasonPosition([show[0]], 5)).toBeNull();
		expect(seasonPosition([], 5)).toBeNull();
		expect(seasonPosition(show, 40)).toBeNull();
	});

	it('gives the season of a given episode, the progress clamped to it', () => {
		expect(seasonAt(show, 25, 24)).toEqual({ season: 3, first: 25, seen: 0, count: 12 });
		expect(seasonAt(show, 13, 30)).toEqual({ season: 2, first: 13, seen: 12, count: 12 });
		expect(seasonAt([show[0]], 3, 1)).toBeNull();
	});

	it('labels the position', () => {
		expect(seasonLabel({ season: 3, seen: 5, count: 12 })).toBe('S3 · Ép. 5/12');
		expect(seasonLabel({ season: 3, seen: 5, count: 12 }, false)).toBe('S3 · Ép. 5');
	});

	it('builds ranges from the media page seasons, without specials or the season-less group', () => {
		const episodes = (...n: (number | null)[]) => n.map((absolute) => ({ absolute }));
		expect(
			rangesOf([
				{ number: 2, episodes: episodes(4, 5) },
				{ number: 1, episodes: episodes(1, 2, 3) },
				{ number: 0, episodes: episodes(null, null) },
				{ number: null, episodes: episodes(1) },
				{ number: 3, episodes: episodes() }
			])
		).toEqual([
			{ season: 1, first: 1, last: 3 },
			{ season: 2, first: 4, last: 5 }
		]);
	});
});
