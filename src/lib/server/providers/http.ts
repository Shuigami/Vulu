// HTTP plumbing shared by the provider clients: rate limiting, timeouts, retries.
// Provider calls only happen in the worker (a single process), so in-memory limiting is enough.

export const USER_AGENT = 'Vulu (https://github.com/Shuigami/Vulu)';

export type Fetch = typeof fetch;

/** Spaces request starts so that at most `perMinute` requests start per minute. */
export function createRateLimiter(perMinute: number) {
	const interval = 60_000 / perMinute;
	let next = 0;
	return async function wait(): Promise<void> {
		const now = Date.now();
		const at = Math.max(now, next);
		next = at + interval;
		if (at > now) await new Promise((r) => setTimeout(r, at - now));
	};
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;

export class ProviderError extends Error {
	constructor(
		readonly provider: string,
		readonly status: number,
		message: string
	) {
		super(`${provider}: ${message}`);
	}
}

const RETRIES = 3;

/**
 * Fetches JSON through the limiter. Retries on 429 (honouring Retry-After) and 5xx;
 * returns null on 404 so callers can tell "not found" from a failure.
 */
export async function fetchJson<T>(
	provider: string,
	url: string,
	init: RequestInit & { fetch: Fetch; limiter: RateLimiter }
): Promise<T | null> {
	const { fetch: doFetch, limiter, ...request } = init;
	for (let attempt = 0; ; attempt++) {
		await limiter();
		const res = await doFetch(url, {
			...request,
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...request.headers },
			signal: AbortSignal.timeout(10_000)
		});
		if (res.ok) return (await res.json()) as T;
		if (res.status === 404) return null;
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt >= RETRIES) {
			throw new ProviderError(provider, res.status, `HTTP ${res.status} for ${redact(url)}`);
		}
		const retryAfter = Number(res.headers.get('Retry-After'));
		const delay = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
		await new Promise((r) => setTimeout(r, Math.min(delay, 60_000)));
	}
}

/** Keeps API keys out of error messages and logs. */
const redact = (url: string) => url.replace(/(api_key=)[^&]+/, '$1***');
