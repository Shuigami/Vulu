// French UI labels for enums, kept in one place to ease i18n later.
export const MEDIA_TYPES = ['movie', 'tv', 'anime', 'manga', 'book'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const ENTRY_STATUSES = ['planned', 'in_progress', 'completed', 'paused', 'dropped'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const typeLabel: Record<MediaType, string> = {
	movie: 'Film',
	tv: 'Série',
	anime: 'Anime',
	manga: 'Manga',
	book: 'Livre'
};

export const typePlural: Record<MediaType, string> = {
	movie: 'Films',
	tv: 'Séries',
	anime: 'Anime',
	manga: 'Mangas',
	book: 'Livres'
};

export const statusLabel: Record<EntryStatus, string> = {
	planned: 'À voir',
	in_progress: 'En cours',
	completed: 'Terminé',
	paused: 'En pause',
	dropped: 'Abandonné'
};

export const releaseStatusLabel: Record<string, string> = {
	announced: 'Annoncé',
	releasing: 'En cours de sortie',
	finished: 'Sortie terminée',
	cancelled: 'Annulé',
	hiatus: 'En pause'
};

/** Plural label of the progress unit, or null when the type has none (movies). */
export const unitLabel: Record<MediaType, string | null> = {
	movie: null,
	tv: 'épisodes',
	anime: 'épisodes',
	manga: 'chapitres',
	book: 'pages'
};

export const secondaryUnitLabel: Record<MediaType, string | null> = {
	movie: null,
	tv: 'saisons',
	anime: null,
	manga: 'volumes',
	book: null
};

export const isMediaType = (v: unknown): v is MediaType => MEDIA_TYPES.includes(v as MediaType);
export const isEntryStatus = (v: unknown): v is EntryStatus =>
	ENTRY_STATUSES.includes(v as EntryStatus);

export const RATING_SCALES = [5, 10, 100] as const;

/** Scores are stored out of 100 and shown in the user's scale (5, 10 or 100). */
export const toScale = (score: number, scale: number) => Math.round((score * scale) / 10) / 10;
export const fromScale = (value: number, scale: number) =>
	Math.min(100, Math.max(0, Math.round((value * 100) / scale)));

/** Feed verb for the events of one change: "a terminé", "a commencé", "a noté". */
export function activityVerb(kinds: string[], type: MediaType) {
	const read = type === 'manga' || type === 'book';
	if (kinds.includes('completed')) return read ? 'a lu' : 'a vu';
	if (kinds.includes('started')) return read ? 'a commencé à lire' : 'a commencé';
	return 'a noté';
}
