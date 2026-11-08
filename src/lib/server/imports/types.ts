import type { EntryStatus } from '../../labels';
import type { MediaType, Provider, ProviderMedia } from '../providers/types';

export const IMPORT_SOURCES = ['anilist', 'goodreads', 'mal', 'trakt'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** Library state carried over from the source service. */
export type ImportedEntry = {
	status: EntryStatus;
	progress: number;
	progressSecondary: number;
	score: number | null; // out of 100
	startedOn: string | null;
	completedOn: string | null;
	repeatCount: number;
	review: string | null;
	notes: string | null;
};

/**
 * One row of an import, with one way to find its media: the media itself (AniList lists embed
 * it), a provider id (Trakt gives TMDB ids) or a book lookup (Goodreads).
 */
export type ImportItem = {
	label: string; // shown when the row cannot be matched
	type: MediaType;
	media?: ProviderMedia;
	ref?: { provider: Provider; externalId: string };
	lookup?: BookLookup;
	entry: ImportedEntry;
};

export type BookLookup = { isbn13?: string; isbn?: string; title: string; author?: string };

export type Unmatched = { label: string; type: MediaType; reason: string };
