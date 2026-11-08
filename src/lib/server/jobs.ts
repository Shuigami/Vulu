// pg-boss queues shared by the app (senders) and the worker (handlers).
import type { PgBoss } from 'pg-boss';
import type { MediaType, Provider, SearchResult } from './providers/types';

export const QUEUES = {
	search: 'provider-search',
	importMedia: 'media-import',
	syncEpisodes: 'media-episodes',
	refreshAiring: 'airing-refresh',
	purgeCache: 'cache-purge'
} as const;

export type SearchJob = { type: MediaType; query: string };
export type SearchOutput = { results: SearchResult[] };
/** `refresh` bypasses the provider cache (daily refresh). */
export type ImportJob = {
	type: MediaType;
	provider: Provider;
	externalId: string;
	refresh?: boolean;
};
export type EpisodesJob = { mediaId: number };
export type ImportOutput = { mediaId: number | null };

/**
 * Sends a job and waits for the worker's result: lets the app use provider APIs
 * while only the worker calls them. Throws if the job fails or takes too long.
 */
export async function requestJob<O extends object>(
	boss: PgBoss,
	name: string,
	data: object,
	timeoutMs = 8000
): Promise<O> {
	const id = await boss.send(name, data, {
		retryLimit: 0,
		expireInSeconds: Math.ceil(timeoutMs / 1000)
	});
	if (!id) throw new Error(`Job ${name} was not created`);

	const deadline = Date.now() + timeoutMs;
	for (let delay = 50; Date.now() < deadline; delay = Math.min(delay * 2, 400)) {
		await new Promise((r) => setTimeout(r, delay));
		const [job] = await boss.findJobs<object>(name, { id });
		if (job?.state === 'completed') return job.output as O;
		if (job?.state === 'failed' || job?.state === 'cancelled') {
			const message = (job.output as { message?: string } | null)?.message ?? job.state;
			throw new Error(`Job ${name} ${job.state}: ${message}`);
		}
	}
	throw new Error(`Job ${name} timed out after ${timeoutMs} ms`);
}
