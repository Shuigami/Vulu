// Web push without a library: VAPID (RFC 8292) and payload encryption aes128gcm (RFC 8291).
// Only the worker sends; the app stores the browsers' subscriptions.
import {
	createCipheriv,
	createECDH,
	createPrivateKey,
	hkdfSync,
	randomBytes,
	sign,
	type ECDH
} from 'node:crypto';

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = {
	publicKey: string; // uncompressed P-256 point, base64url (given to the browser)
	privateKey: string; // 32 bytes, base64url
	subject: string; // mailto: or https: contact for the push services (Apple requires one)
};
/** `gone`: the subscription expired or was revoked, delete it. */
export type PushResult = 'sent' | 'gone' | 'error';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text: string) => Buffer.from(text, 'base64url');

/** A key pair for VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (`pnpm vapid:keys`). */
export function generateVapidKeys() {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** Header record size; payloads stay far below it, so the body is a single record. */
const RECORD_SIZE = 4096;

/**
 * Encrypts `plaintext` for one subscription (RFC 8291). `salt` and `serverKeys` are random,
 * given only by tests (the RFC's example).
 */
export function encryptPayload(
	sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
	plaintext: Uint8Array,
	options: { salt?: Uint8Array; serverKeys?: ECDH } = {}
): Buffer {
	const uaPublic = fromB64url(sub.p256dh);
	const authSecret = fromB64url(sub.auth);
	const salt = options.salt ?? randomBytes(16);
	let server = options.serverKeys;
	if (!server) {
		server = createECDH('prime256v1');
		server.generateKeys();
	}
	const asPublic = server.getPublicKey();
	const ecdhSecret = server.computeSecret(uaPublic);

	const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
	const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
	const cek = Buffer.from(
		hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
	);
	const nonce = Buffer.from(
		hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
	);

	const cipher = createCipheriv('aes-128-gcm', cek, nonce);
	// 0x02: padding delimiter of the last (and only) record
	const body = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([2]))]);
	const encrypted = Buffer.concat([body, cipher.final(), cipher.getAuthTag()]);

	const header = Buffer.alloc(21);
	Buffer.from(salt).copy(header, 0);
	header.writeUInt32BE(RECORD_SIZE, 16);
	header.writeUInt8(asPublic.length, 20);
	return Buffer.concat([header, asPublic, encrypted]);
}

/** `Authorization` header for the push service of `endpoint` (RFC 8292), valid 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()) {
	const publicKey = fromB64url(keys.publicKey);
	const key = createPrivateKey({
		format: 'jwk',
		key: {
			kty: 'EC',
			crv: 'P-256',
			d: keys.privateKey,
			x: b64url(publicKey.subarray(1, 33)),
			y: b64url(publicKey.subarray(33, 65))
		}
	});
	const part = (value: object) => b64url(Buffer.from(JSON.stringify(value)));
	const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
		aud: new URL(endpoint).origin,
		exp: Math.floor(now / 1000) + 12 * 3600,
		sub: keys.subject
	})}`;
	const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
	return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

export type SendPush = (sub: PushSubscriptionKeys, payload: object) => Promise<PushResult>;

/** Sends JSON payloads; `fetch` is replaced in tests. Kept a day by the push service if offline. */
export function createPushSender(keys: VapidKeys, fetchFn: typeof fetch = fetch): SendPush {
	return async (sub, payload) => {
		let res: Response;
		try {
			res = await fetchFn(sub.endpoint, {
				method: 'POST',
				headers: {
					Authorization: vapidAuthorization(sub.endpoint, keys),
					'Content-Encoding': 'aes128gcm',
					'Content-Type': 'application/octet-stream',
					TTL: String(24 * 3600),
					Urgency: 'normal'
				},
				body: new Uint8Array(encryptPayload(sub, Buffer.from(JSON.stringify(payload))))
			});
		} catch (err) {
			console.error('[push] request failed', err);
			return 'error';
		}
		if (res.ok) return 'sent';
		if (res.status === 404 || res.status === 410) return 'gone';
		console.error(`[push] ${new URL(sub.endpoint).host} answered ${res.status}`, await res.text());
		return 'error';
	};
}

/** Checks a PushSubscription's JSON from the browser; null when it is not one. */
export function parseSubscription(value: unknown): PushSubscriptionKeys | null {
	if (!value || typeof value !== 'object') return null;
	const { endpoint, keys } = value as { endpoint?: unknown; keys?: Record<string, unknown> };
	if (typeof endpoint !== 'string' || endpoint.length > 1000) return null;
	try {
		if (new URL(endpoint).protocol !== 'https:') return null;
	} catch {
		return null;
	}
	const { p256dh, auth } = keys ?? {};
	const b64 = /^[A-Za-z0-9_-]+={0,2}$/;
	if (typeof p256dh !== 'string' || !b64.test(p256dh) || fromB64url(p256dh).length !== 65)
		return null;
	if (typeof auth !== 'string' || !b64.test(auth) || fromB64url(auth).length !== 16) return null;
	return { endpoint, p256dh, auth };
}
