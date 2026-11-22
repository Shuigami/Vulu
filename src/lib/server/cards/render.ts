// Share images (link previews, stories): a tree of boxes laid out by satori, rasterised by resvg.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

export type El = { type: string; props: Record<string, unknown> };
type Child = El | string | number | null | undefined | false;
type Style = Record<string, string | number>;

/** A box (div, or img when `src` is given); satori wants `display: flex` on every div. */
export function h(style: Style, ...children: (Child | Child[])[]): El {
	const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
	// border-box: satori otherwise adds the padding to a fixed size and the card overflows
	const base = { display: 'flex', boxSizing: 'border-box' };
	return { type: 'div', props: { style: { ...base, ...style }, children: kids } };
}
export const img = (src: string, style: Style): El => ({ type: 'img', props: { src, style } });

export const OG = { width: 1200, height: 630 };
export const STORY = { width: 1080, height: 1920 };

export const C = {
	bg: '#121114',
	surface: '#1b1a1f',
	surface2: '#25232a',
	line: '#2f2c35',
	ink: '#f2efe9',
	muted: '#a9a3b0',
	accent: '#f0b44c',
	onAccent: '#1a1407',
	movie: '#8db4ff',
	tv: '#7fd4b5',
	anime: '#f59ac0',
	manga: '#c9a7ff',
	book: '#e8a37a'
};

// Run from the repository root in dev and from /app in the image (src/lib is copied there)
const FONTS = join(process.cwd(), 'src/lib/server/cards/fonts');
let fonts: Promise<Parameters<typeof satori>[1]['fonts']> | null = null;
const loadFonts = () =>
	(fonts ??= Promise.all([
		readFile(join(FONTS, 'instrument-sans-latin-400-normal.woff')),
		readFile(join(FONTS, 'instrument-sans-latin-600-normal.woff')),
		readFile(join(FONTS, 'bricolage-grotesque-latin-800-normal.woff'))
	]).then(([regular, semi, display]) => [
		{ name: 'Sans', data: regular, weight: 400 as const, style: 'normal' as const },
		{ name: 'Sans', data: semi, weight: 600 as const, style: 'normal' as const },
		{ name: 'Display', data: display, weight: 800 as const, style: 'normal' as const }
	]));

export async function renderPng(root: El, size: { width: number; height: number }) {
	const svg = await satori(root as Parameters<typeof satori>[0], {
		...size,
		fonts: await loadFonts()
	});
	return new Resvg(svg, { fitTo: { mode: 'width', value: size.width } }).render().asPng();
}

const IMAGE_MAX = 3_000_000;

/**
 * A poster or avatar as a data URI, or null (missing, slow, not an image): a card is still
 * drawn without it. Relative URLs (uploaded avatars) are resolved against the app's origin.
 */
export async function loadImage(url: string | null | undefined, origin: string) {
	if (!url) return null;
	try {
		const res = await fetch(new URL(url, origin), { signal: AbortSignal.timeout(4000) });
		const type = res.headers.get('content-type') ?? '';
		// satori decodes neither WebP nor AVIF: those avatars fall back to an initial
		if (!res.ok || !/^image\/(jpeg|png|gif)/.test(type)) return null;
		const bytes = Buffer.from(await res.arrayBuffer());
		if (bytes.length > IMAGE_MAX) return null;
		return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
	} catch {
		return null;
	}
}

/** Response headers: crawlers and the proxy may keep a card for an hour. */
export const pngResponse = (png: Uint8Array) =>
	new Response(png as BodyInit, {
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }
	});
