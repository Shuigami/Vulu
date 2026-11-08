// MyAnimeList export (Profile > Export, then the .xml.gz file): one file for anime, one for manga.
import type { EntryStatus } from '../../labels';
import type { AniListClient } from '../providers/anilist';
import type { ImportItem } from './types';

export type MalItem = ImportItem & { type: 'anime' | 'manga'; malId: number };

const STATUS: Record<string, EntryStatus> = {
	Watching: 'in_progress',
	Reading: 'in_progress',
	Completed: 'completed',
	'On-Hold': 'paused',
	Dropped: 'dropped',
	'Plan to Watch': 'planned',
	'Plan to Read': 'planned'
};

// shortcut: regex reading of MAL's flat, machine-written XML (no nesting, CDATA for text);
// switch to a real XML parser if MAL changes the format.
const blocks = (xml: string, tag: string) =>
	[...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const value = (block: string, tag: string) => {
	const m = block.match(
		new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`)
	);
	return (m?.[1] ?? m?.[2] ?? '').trim();
};
const num = (v: string) => Number(v) || 0;
/** MAL writes "0000-00-00" for no date, and "2020-05-00" when the day is unknown. */
const dateOf = (v: string) => {
	const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m || m[1] === '0000') return null;
	return `${m[1]}-${m[2] === '00' ? '01' : m[2]}-${m[3] === '00' ? '01' : m[3]}`;
};

/** Reads a MAL export; throws a French message when the file is not one. */
export function parseMal(xml: string): MalItem[] {
	if (!xml.includes('<myanimelist>')) {
		throw new Error('Ce fichier ne ressemble pas à un export MyAnimeList.');
	}
	const anime = blocks(xml, 'anime').map((b): MalItem => {
		const title = value(b, 'series_title');
		return {
			label: title,
			type: 'anime',
			malId: num(value(b, 'series_animedb_id')),
			entry: {
				status: STATUS[value(b, 'my_status')] ?? 'planned',
				progress: num(value(b, 'my_watched_episodes')),
				progressSecondary: 0,
				score: num(value(b, 'my_score')) * 10 || null, // MAL scores are out of 10, 0 = none
				startedOn: dateOf(value(b, 'my_start_date')),
				completedOn: dateOf(value(b, 'my_finish_date')),
				repeatCount: num(value(b, 'my_times_watched')),
				review: null,
				notes: value(b, 'my_comments') || null
			}
		};
	});
	const manga = blocks(xml, 'manga').map((b): MalItem => {
		const title = value(b, 'manga_title');
		return {
			label: title,
			type: 'manga',
			malId: num(value(b, 'manga_mangadb_id')),
			entry: {
				status: STATUS[value(b, 'my_status')] ?? 'planned',
				progress: num(value(b, 'my_read_chapters')),
				progressSecondary: num(value(b, 'my_read_volumes')),
				score: num(value(b, 'my_score')) * 10 || null,
				startedOn: dateOf(value(b, 'my_start_date')),
				completedOn: dateOf(value(b, 'my_finish_date')),
				repeatCount: num(value(b, 'my_times_read')),
				review: null,
				notes: value(b, 'my_comments') || null
			}
		};
	});
	return [...anime, ...manga].filter((i) => i.malId > 0);
}

/** Attaches the AniList media to each row (AniList is the source of truth for anime and manga). */
export async function resolveMal(anilist: AniListClient, items: MalItem[]): Promise<ImportItem[]> {
	for (const type of ['anime', 'manga'] as const) {
		const ofType = items.filter((i) => i.type === type);
		if (!ofType.length) continue;
		const found = await anilist.byMalIds(
			ofType.map((i) => i.malId),
			type
		);
		for (const item of ofType) item.media = found.get(item.malId);
	}
	return items;
}

const MAX_XML_BYTES = 50 * 1024 * 1024;

/**
 * Accepts the export as downloaded (.xml.gz) or unzipped (.xml). Stops past 50 MB of XML,
 * so a small compressed upload cannot exhaust the server's memory.
 */
export async function readMalFile(file: Blob): Promise<string> {
	const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
	const gzipped = head[0] === 0x1f && head[1] === 0x8b;
	const stream = gzipped
		? file.stream().pipeThrough(new DecompressionStream('gzip'))
		: file.stream();
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_XML_BYTES) {
			await reader.cancel();
			throw new Error('Fichier trop volumineux une fois décompressé (50 Mo max).');
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
