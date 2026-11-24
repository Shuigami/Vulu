// Swiping between works (#97): a media page opened from a row of works (library, home shelves,
// a list, search results) can move to the previous / next work of that row, in its order.
// Tapping a card stores the row here (and in sessionStorage, so a reload keeps it); the media
// page looks its work up in it. Opened any other way, the work is not in the row: no swipe.

import { browser } from '$app/env';
import { goto, preloadData } from '$app/navigation';
import { deserialize } from '$app/forms';
import { resolve } from '$app/paths';
import { opening } from './opening.svelte.ts';

/** A work of the row: in the catalogue (`mediaId`), or a provider result imported when reached. */
export type BrowseItem = {
	mediaId: number | null;
	title: string;
	type: string;
	posterUrl?: string | null;
	provider?: string | null;
	externalId?: string | null;
};

/**
 * What the page beside the current one shows while swiping (`MediaSkeleton`): the card's title
 * and poster, then the work's backdrop and facts once its data is preloaded.
 */
export type Peek = {
	title: string;
	type: string;
	posterUrl: string | null;
	/** Undefined while not known (a backdrop is assumed), null when the work has none. */
	backdropUrl?: string | null;
	line?: string;
};

type Row = { items: BrowseItem[]; index: number };

const KEY = 'vulu:browse';

function load(): Row | null {
	try {
		const row = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Row | null;
		return row && Array.isArray(row.items) && typeof row.index === 'number' ? row : null;
	} catch {
		return null;
	}
}

function save() {
	try {
		if (state.row) sessionStorage.setItem(KEY, JSON.stringify(state.row));
		else sessionStorage.removeItem(KEY);
	} catch {
		// Private mode or full storage: the row only lives until a reload
	}
}

const state = $state<{ row: Row | null }>({ row: browser ? load() : null });
// Works preloaded for the swipe, by media id (not persisted: preloaded again after a reload)
const peeks = $state<Record<number, Peek>>({});
/** True while a swipe opens the next work: the page beside stands in, no skeleton. */
export const sliding = $state({ active: false });
// Set by a card tap, read by the next navigation: only a tapped card starts a row
let armed = false;

/** Called when a card of a row is tapped, before the media page opens. */
export function startBrowse(items: BrowseItem[], index: number) {
	// Only what moving along needs: the row is kept in sessionStorage
	state.row = {
		items: items.map(({ mediaId, title, type, posterUrl, provider, externalId }) => ({
			mediaId,
			title,
			type,
			posterUrl: posterUrl ?? null,
			...(mediaId === null && { provider, externalId })
		})),
		index
	};
	armed = true;
	save();
}

export function clearBrowse() {
	armed = false;
	if (!state.row) return;
	state.row = null;
	save();
}

const MEDIA_ROUTES = ['/(app)/media/[id]', '/(app)/media/[id]/episodes/[episodeId]'];

/**
 * Keeps the row while the user stays on media pages reached from it, drops it otherwise.
 * Called from the app layout's `afterNavigate`.
 */
export function followNavigation(nav: {
	type: string;
	from: { route: { id: string | null } } | null;
	to: { route: { id: string | null }; params: Record<string, string> | null } | null;
}) {
	const tapped = armed;
	armed = false;
	if (!state.row) return;
	if (nav.type === 'enter') {
		// A reload (or back/forward to a reloaded page) keeps the row; a link opened from
		// elsewhere (shared link, notification) does not belong to it. The route is not known
		// yet here: the media page does not find its work in a row kept on another page.
		const entry = performance.getEntriesByType('navigation')[0] as
			PerformanceNavigationTiming | undefined;
		if (entry?.type !== 'reload' && entry?.type !== 'back_forward') clearBrowse();
		return;
	}
	const to = nav.to?.route.id ?? null;
	if (!to || !MEDIA_ROUTES.includes(to)) return clearBrowse();
	const from = nav.from?.route.id ?? null;
	// Coming to a media page from another page without tapping a card of the row
	if (!tapped && !(from && MEDIA_ROUTES.includes(from))) return clearBrowse();
	// A provider result opened from the row: it now has its catalogue id
	const current = state.row.items[state.row.index];
	if (tapped && current && current.mediaId === null && nav.to?.params?.id) {
		current.mediaId = Number(nav.to.params.id);
		save();
	}
}

/** Position of the work in the row, -1 when it is not part of it. */
function indexOf(mediaId: number) {
	const row = state.row;
	if (!row) return -1;
	if (row.items[row.index]?.mediaId === mediaId) return row.index;
	return row.items.findIndex((i) => i.mediaId === mediaId);
}

/** The previous and next works of the row around this one (null at the ends, or no row). */
export function neighbours(mediaId: number) {
	const at = indexOf(mediaId);
	if (at < 0) return { prev: null, next: null };
	const items = state.row!.items;
	return { prev: items[at - 1] ?? null, next: items[at + 1] ?? null };
}

const mediaHref = (id: number) => resolve('/(app)/media/[id]', { id: String(id) });

/** What to show of a neighbour while swiping towards it. */
export function peekOf(item: BrowseItem): Peek {
	return (
		(item.mediaId !== null && peeks[item.mediaId]) || {
			title: item.title,
			type: item.type,
			posterUrl: item.posterUrl ?? null
		}
	);
}

type Preloaded = {
	media?: {
		title: string;
		type: string;
		posterUrl: string | null;
		backdropUrl: string | null;
		startDate: string | null;
		runtimeMinutes: number | null;
	};
};

/**
 * Warms the neighbours' data so a swipe lands at once (provider results cannot be), and keeps
 * what the page beside needs to look like the work, images included.
 */
export function preloadNeighbours(mediaId: number) {
	const { prev, next } = neighbours(mediaId);
	for (const item of [next, prev]) {
		const id = item?.mediaId;
		if (id == null) continue;
		preloadData(mediaHref(id))
			.then((result) => {
				const media = result.type === 'loaded' ? (result.data as Preloaded).media : undefined;
				if (!media) return;
				peeks[id] = {
					title: media.title,
					type: media.type,
					posterUrl: media.posterUrl,
					backdropUrl: media.backdropUrl,
					line: [
						media.startDate?.slice(0, 4),
						media.runtimeMinutes && `${media.runtimeMinutes} min`
					]
						.filter(Boolean)
						.join(' · ')
				};
				for (const src of [media.posterUrl, media.backdropUrl])
					if (src) Object.assign(new Image(), { referrerPolicy: 'no-referrer', src });
			})
			.catch(() => {});
	}
}

/** Imports a provider result like a tap on it does (`search?/open`): the page to open. */
async function importItem(item: BrowseItem): Promise<string | null> {
	const body = new FormData();
	body.set('type', item.type);
	body.set('provider', item.provider ?? '');
	body.set('externalId', item.externalId ?? '');
	const res = await fetch(`${resolve('search')}?/open`, {
		method: 'POST',
		body,
		headers: { 'x-sveltekit-action': 'true' }
	}).catch(() => null);
	if (!res) return null;
	const result = deserialize(await res.text());
	return result.type === 'redirect' ? result.location : null;
}

/**
 * Opens the previous (-1) or next (1) work of the row. The history entry is replaced, so Back
 * returns to the page of the row. False when there is no such work or it could not be opened.
 * `swiped`: the page beside stands in while loading (no skeleton), and the scroll position is
 * left to the swipe.
 */
export async function step(mediaId: number, dir: 1 | -1, swiped = false): Promise<boolean> {
	const at = indexOf(mediaId);
	const item = at < 0 ? undefined : state.row!.items[at + dir];
	if (!item) return false;
	if (swiped) sliding.active = true;
	try {
		return await open(item, at + dir, swiped);
	} finally {
		sliding.active = false;
	}
}

async function open(item: BrowseItem, index: number, swiped: boolean) {
	let href: string | null;
	if (item.mediaId === null) {
		if (!swiped) opening.active = true;
		href = await importItem(item);
		opening.active = false;
		const id = href?.match(/\/media\/(\d+)/)?.[1];
		if (!href || !id) return false;
		item.mediaId = Number(id);
	} else href = mediaHref(item.mediaId);
	state.row!.index = index;
	save();
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above, or the action's redirect
	await goto(href, { replace: true, reset: !swiped });
	return true;
}
