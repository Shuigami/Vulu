// Jellyfin webhook (plugin "Webhook", destination "Generic"): parses what the template below sends.
// Episodes carry no series-level provider ids, so series are matched by name (see scrobble.ts).

/**
 * Template to paste in the plugin. Every value is a quoted string so the JSON stays valid
 * whatever the plugin renders (numbers, "True"/"False", empty values); free text uses triple
 * braces (no HTML escaping), quotes in titles are escaped by the plugin.
 */
export const JELLYFIN_TEMPLATE = `{
  "event": "{{NotificationType}}",
  "user": "{{{NotificationUsername}}}",
  "itemId": "{{ItemId}}",
  "itemType": "{{ItemType}}",
  "name": "{{{Name}}}",
  "seriesName": "{{{SeriesName}}}",
  "season": "{{SeasonNumber}}",
  "episode": "{{EpisodeNumber}}",
  "episodeEnd": "{{EpisodeNumberEnd}}",
  "year": "{{Year}}",
  "tmdb": "{{Provider_tmdb}}",
  "imdb": "{{Provider_imdb}}",
  "playedToCompletion": "{{PlayedToCompletion}}",
  "played": "{{Played}}",
  "positionTicks": "{{PlaybackPositionTicks}}",
  "runTimeTicks": "{{RunTimeTicks}}"
}`;

export type JellyfinEvent = {
	event: string;
	user: string;
	itemId: string;
	kind: 'movie' | 'episode';
	name: string;
	seriesName: string | null;
	season: number | null;
	episode: number | null;
	episodeEnd: number | null;
	year: number | null;
	tmdb: string | null;
	imdb: string | null;
	watched: boolean;
};

const str = (v: unknown) =>
	typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
const int = (v: unknown) => {
	const n = Number(str(v));
	return str(v) !== '' && Number.isInteger(n) && n >= 0 ? n : null;
};
const bool = (v: unknown) => /^true$/i.test(str(v));

/** A play counts as watched past this share of the runtime (Jellyfin's own default is 90 %). */
const WATCHED_RATIO = 0.9;

/**
 * Validates a webhook body. Returns null for anything that is not a movie or an episode;
 * `watched` says whether it should count (finished playback, or marked as played).
 */
export function parseJellyfinPayload(body: unknown): JellyfinEvent | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const itemType = str(b.itemType);
	const kind = itemType === 'Movie' ? 'movie' : itemType === 'Episode' ? 'episode' : null;
	const itemId = str(b.itemId);
	if (!kind || !/^[\w-]{1,64}$/.test(itemId)) return null;

	const event = str(b.event);
	const position = Number(str(b.positionTicks)) || 0;
	const runtime = Number(str(b.runTimeTicks)) || 0;
	const watched =
		(event === 'PlaybackStop' &&
			(bool(b.playedToCompletion) || (runtime > 0 && position / runtime >= WATCHED_RATIO))) ||
		(event === 'UserDataSaved' && bool(b.played));

	return {
		event,
		user: str(b.user).slice(0, 100),
		itemId,
		kind,
		name: str(b.name).slice(0, 300),
		seriesName: str(b.seriesName).slice(0, 300) || null,
		season: int(b.season),
		episode: int(b.episode),
		episodeEnd: int(b.episodeEnd),
		year: int(b.year),
		tmdb: /^\d{1,10}$/.test(str(b.tmdb)) ? str(b.tmdb) : null,
		imdb: /^tt\d{1,10}$/.test(str(b.imdb)) ? str(b.imdb) : null,
		watched
	};
}
