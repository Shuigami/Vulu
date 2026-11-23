import { createECDH, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createPushSender,
	encryptPayload,
	generateVapidKeys,
	parseSubscription,
	vapidAuthorization
} from './webpush';

const b = (text: string) => Buffer.from(text, 'base64url');

describe('encryptPayload', () => {
	it('matches the example of RFC 8291 (appendix A)', () => {
		const server = createECDH('prime256v1');
		server.setPrivateKey(b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
		const body = encryptPayload(
			{
				p256dh:
					'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
				auth: 'BTBZMqHH6r4Tts7J_aSIgg'
			},
			Buffer.from('When I grow up, I want to be a watermelon'),
			{ salt: b('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys: server }
		);
		expect(body.toString('base64url')).toBe(
			'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
		);
	});
});

describe('vapidAuthorization', () => {
	it('signs a JWT for the push service origin with the VAPID key', () => {
		const keys = { ...generateVapidKeys(), subject: 'mailto:admin@example.com' };
		const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 1_000_000);
		const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
		expect(k).toBe(keys.publicKey);
		const [head, claims, signature] = jwt.split('.');
		expect(JSON.parse(b(claims).toString())).toEqual({
			aud: 'https://fcm.googleapis.com',
			exp: 1000 + 12 * 3600,
			sub: 'mailto:admin@example.com'
		});
		const point = b(keys.publicKey);
		const key = createPublicKey({
			format: 'jwk',
			key: {
				kty: 'EC',
				crv: 'P-256',
				x: point.subarray(1, 33).toString('base64url'),
				y: point.subarray(33).toString('base64url')
			}
		});
		const ok = verify(
			'sha256',
			Buffer.from(`${head}.${claims}`),
			{ key, dsaEncoding: 'ieee-p1363' },
			b(signature)
		);
		expect(ok).toBe(true);
	});
});

describe('createPushSender', () => {
	const ua = createECDH('prime256v1');
	ua.generateKeys();
	const sub = {
		endpoint: 'https://push.example.com/abc',
		p256dh: ua.getPublicKey().toString('base64url'),
		auth: Buffer.alloc(16, 7).toString('base64url')
	};
	const keys = { ...generateVapidKeys(), subject: 'mailto:admin@example.com' };

	it('posts the encrypted payload and maps the answer', async () => {
		const calls: RequestInit[] = [];
		let status = 201;
		const send = createPushSender(keys, async (_url, init) => {
			calls.push(init!);
			return new Response(null, { status });
		});
		expect(await send(sub, { title: 'Hi' })).toBe('sent');
		const headers = calls[0].headers as Record<string, string>;
		expect(headers['Content-Encoding']).toBe('aes128gcm');
		expect(headers.Authorization).toMatch(/^vapid t=/);
		status = 410;
		expect(await send(sub, { title: 'Hi' })).toBe('gone');
		status = 500;
		expect(await send(sub, { title: 'Hi' })).toBe('error');
	});
});

describe('parseSubscription', () => {
	const valid = {
		endpoint: 'https://web.push.apple.com/abc',
		keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: 'BTBZMqHH6r4Tts7J_aSIgg' }
	};
	it('keeps a browser subscription', () => {
		expect(parseSubscription(valid)).toEqual({
			endpoint: valid.endpoint,
			p256dh: valid.keys.p256dh,
			auth: valid.keys.auth
		});
	});
	it('rejects anything else', () => {
		expect(parseSubscription(null)).toBeNull();
		expect(parseSubscription({ ...valid, endpoint: 'http://push.example.com' })).toBeNull();
		expect(parseSubscription({ ...valid, keys: { ...valid.keys, auth: 'short' } })).toBeNull();
		expect(parseSubscription({ endpoint: valid.endpoint })).toBeNull();
	});
});
