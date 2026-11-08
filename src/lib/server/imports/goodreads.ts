// Goodreads library export (My Books > Import and export > Export library), a CSV file.
import type { EntryStatus } from '../../labels';
import type { ImportItem } from './types';

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field || row.length) rows.push([...row, field]);
	return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const SHELF: Record<string, EntryStatus> = {
	read: 'completed',
	'currently-reading': 'in_progress',
	'to-read': 'planned',
	'did-not-finish': 'dropped',
	dnf: 'dropped',
	abandoned: 'dropped',
	paused: 'paused',
	'on-hold': 'paused'
};

/** Goodreads wraps ISBNs as ="0441172717" so spreadsheets keep the leading zeros. */
const isbnOf = (v: string | undefined) => v?.replace(/[="\s-]/g, '') || undefined;
/** "2024/03/09" -> "2024-03-09" */
const dateOf = (v: string | undefined) => {
	const m = v?.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
/** Drops the series suffix: "Dune (Dune, #1)" -> "Dune" */
const cleanTitle = (t: string) => t.replace(/\s*\([^()]*#[\d.]+\)\s*$/, '').trim();

const REQUIRED = ['Title', 'Author', 'Exclusive Shelf'];

/** Turns a Goodreads export into import rows; throws a French message when the file is not one. */
export function parseGoodreads(text: string): ImportItem[] {
	const [header, ...rows] = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // strip a UTF-8 BOM
	if (!header || REQUIRED.some((h) => !header.includes(h))) {
		throw new Error('Ce fichier ne ressemble pas à un export Goodreads (colonnes manquantes).');
	}
	const col = (row: string[], name: string) => row[header.indexOf(name)]?.trim() ?? '';

	return rows.map((row) => {
		const title = col(row, 'Title');
		const author = col(row, 'Author');
		const status = SHELF[col(row, 'Exclusive Shelf')] ?? 'planned';
		const pages = Number(col(row, 'Number of Pages')) || 0;
		const rating = Number(col(row, 'My Rating')) || 0;
		const reads = Number(col(row, 'Read Count')) || 0;
		return {
			label: author ? `${title} — ${author}` : title,
			type: 'book',
			lookup: {
				isbn13: isbnOf(col(row, 'ISBN13')),
				isbn: isbnOf(col(row, 'ISBN')),
				title: cleanTitle(title),
				author: author || undefined
			},
			entry: {
				status,
				progress: status === 'completed' ? pages : 0,
				progressSecondary: 0,
				score: rating > 0 ? rating * 20 : null, // stars out of 5 -> out of 100
				startedOn: null,
				completedOn: status === 'completed' ? dateOf(col(row, 'Date Read')) : null,
				repeatCount: Math.max(0, reads - 1),
				review: col(row, 'My Review') || null,
				notes: col(row, 'Private Notes') || null
			}
		};
	});
}
