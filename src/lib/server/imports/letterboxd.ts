// Letterboxd data export (Settings > Import & Export > Export your data): a ZIP of CSV files.
// Films carry no TMDB id (their URIs are boxd.it short links): the worker matches title and year.
import { inflateRawSync } from 'node:zlib';
import { parseCsv } from './goodreads';
import type { ImportItem } from './types';

const FILES = ['watchlist.csv', 'watched.csv', 'diary.csv', 'ratings.csv'] as const;
type LetterboxdFiles = Partial<Record<(typeof FILES)[number], string>>;

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/**
 * Reads the top-level files named in `wanted` from a ZIP archive (stored or deflated).
 * shortcut: no ZIP64 nor CRC check; fine for Letterboxd exports, use a library if other
 * sources need ZIP files.
 */
export function unzip(zip: Buffer, wanted: readonly string[]): Map<string, Buffer> {
	const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocd < 0) throw new Error('Archive ZIP illisible.');
	const count = zip.readUInt16LE(eocd + 10);
	let at = zip.readUInt32LE(eocd + 16);
	const files = new Map<string, Buffer>();
	for (let i = 0; i < count; i++) {
		if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('Archive ZIP illisible.');
		const method = zip.readUInt16LE(at + 10);
		const size = zip.readUInt32LE(at + 20);
		const nameLength = zip.readUInt16LE(at + 28);
		const local = zip.readUInt32LE(at + 42);
		const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
		at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
		if (!wanted.includes(name)) continue;
		// Sizes come from the central directory: local headers may defer them to a data descriptor
		const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const data = zip.subarray(start, start + size);
		if (method === 0) files.set(name, data);
		else if (method === 8) {
			try {
				files.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
			} catch {
				throw new Error('Fichier trop volumineux une fois décompressé (20 Mo max).');
			}
		} else throw new Error('Archive ZIP illisible.');
	}
	return files;
}

/** Accepts the export ZIP as downloaded, or its CSV files (some browsers unzip downloads). */
export async function readLetterboxdFiles(uploads: File[]): Promise<LetterboxdFiles> {
	const out: LetterboxdFiles = {};
	for (const file of uploads) {
		const bytes = Buffer.from(await file.arrayBuffer());
		if (bytes.readUInt32LE(0) === 0x04034b50) {
			for (const [name, data] of unzip(bytes, FILES))
				out[name as keyof LetterboxdFiles] = String(data);
		} else {
			const name = FILES.find((f) => file.name.toLowerCase() === f);
			if (name) out[name] = bytes.toString('utf8');
		}
	}
	return out;
}

/** Turns the export's CSV files into import rows; throws a French message when none is found. */
export function parseLetterboxd(files: LetterboxdFiles): ImportItem[] {
	if (!FILES.some((f) => files[f])) {
		throw new Error(
			'Aucun fichier Letterboxd reconnu (watched.csv, diary.csv, ratings.csv ou watchlist.csv).'
		);
	}
	const items = new Map<string, ImportItem>();
	/** One row per film, keyed by name and year (diary URIs point to the log, not the film). */
	const film = (row: Record<string, string>) => {
		const title = row.Name?.trim();
		if (!title) return null;
		const year = Number(row.Year) || null;
		const key = `${title.toLowerCase()}|${year}`;
		let item = items.get(key);
		if (!item) {
			item = {
				label: year ? `${title} (${year})` : title,
				type: 'movie',
				search: { title, year },
				entry: {
					status: 'planned',
					progress: 0,
					progressSecondary: 0,
					score: null,
					startedOn: null,
					completedOn: null,
					repeatCount: 0,
					review: null,
					notes: null
				}
			};
			items.set(key, item);
		}
		return item.entry;
	};
	const rows = (name: keyof LetterboxdFiles) => {
		const text = files[name];
		if (!text) return [];
		const [header, ...data] = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
		return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
	};
	const day = (v: string | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v! : null);
	const seen = (row: Record<string, string>, date: string | null) => {
		const e = film(row);
		if (!e) return null;
		e.status = 'completed';
		if (date && (!e.completedOn || date > e.completedOn)) e.completedOn = date;
		return e;
	};

	for (const r of rows('watchlist.csv')) film(r);
	for (const r of rows('watched.csv')) seen(r, null); // its Date is when it was logged
	const logs = new Map<ImportItem['entry'], number>();
	for (const r of rows('diary.csv')) {
		const e = seen(r, day(r['Watched Date']) ?? day(r.Date));
		if (e) logs.set(e, (logs.get(e) ?? 0) + 1);
	}
	for (const [e, n] of logs) e.repeatCount = n - 1;
	for (const r of rows('ratings.csv')) {
		const e = seen(r, null); // rated means seen
		const stars = Number(r.Rating);
		if (e && stars > 0) e.score = Math.round(stars * 20); // 0.5 to 5 stars -> out of 100
	}
	return [...items.values()];
}
