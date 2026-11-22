// Recap images: link preview (1200x630) and story (1080x1920), plus their teasers before the
// release, drawn without any data.
import { MEDIA_TYPES, typePlural } from '../../labels';
import type { YearRecap } from '../recap';
import { clip, poster, wordmark } from './cards';
import { C, h, OG, STORY, type El } from './render';

type Size = { width: number; height: number };

const big = (text: string | number, size: number, color = C.ink) =>
	h({ fontFamily: 'Display', fontSize: size, lineHeight: 0.95, color }, String(text));
const label = (text: string, size: number, color = C.muted) =>
	h({ fontSize: size, color, fontWeight: 600, letterSpacing: 2 }, text.toUpperCase());

function page(size: Size, footer: string, ...content: El[]) {
	const pad = size === STORY ? 80 : 56;
	return h(
		{
			...size,
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: pad,
			backgroundColor: C.bg,
			color: C.ink,
			fontFamily: 'Sans'
		},
		...content,
		h(
			{ justifyContent: 'space-between', alignItems: 'center' },
			wordmark(size === STORY ? 44 : 34),
			h({ fontSize: size === STORY ? 28 : 22, color: C.muted }, footer)
		)
	);
}

const mystery = (width: number, height: number) =>
	h(
		{
			width,
			height,
			borderRadius: 18,
			backgroundColor: C.surface2,
			alignItems: 'center',
			justifyContent: 'center'
		},
		big('?', width * 0.45, C.muted)
	);

/** Before the release: the date and question marks, nothing about anyone. */
export function recapTeaser(o: { year: number; release: string; footer: string; story: boolean }) {
	const size = o.story ? STORY : OG;
	const title = h(
		{ flexDirection: 'column', gap: o.story ? 28 : 16 },
		label('Bientôt sur Vulu', o.story ? 34 : 24, C.accent),
		big('Récap', o.story ? 200 : 120),
		big(o.year, o.story ? 200 : 120, C.accent),
		h({ fontSize: o.story ? 44 : 30, marginTop: 12 }, `Le ${o.release}`)
	);
	const cards = o.story
		? h(
				{ gap: 24, justifyContent: 'center' },
				mystery(280, 420),
				mystery(280, 420),
				mystery(280, 420)
			)
		: h({ gap: 16, alignItems: 'center' }, mystery(150, 225), mystery(150, 225), mystery(150, 225));
	return o.story
		? page(size, o.footer, title, cards)
		: page(
				size,
				o.footer,
				h({ flex: 1, justifyContent: 'space-between', alignItems: 'center' }, title, cards)
			);
}

type Posters = { title: string; poster: string | null }[];

const completedLine = (r: YearRecap, size: number) =>
	h(
		{ gap: size * 1.4, flexWrap: 'wrap' },
		...MEDIA_TYPES.filter((t) => r.completed[t])
			.slice(0, 4)
			.map((t) =>
				h(
					{ flexDirection: 'column' },
					big(r.completed[t], size * 1.8, C[t]),
					h({ fontSize: size * 0.75, color: C.muted }, typePlural[t].toLowerCase())
				)
			)
	);

const verdict = (r: YearRecap, size: number) =>
	r.personality &&
	h(
		{
			flexDirection: 'column',
			gap: size * 0.3,
			padding: size,
			borderRadius: size,
			backgroundColor: C.accent,
			color: C.onAccent
		},
		h({ fontSize: size * 0.55, fontWeight: 600, letterSpacing: 2 }, 'VERDICT'),
		big(r.personality.title, size * 1.6, C.onAccent),
		h({ fontSize: size * 0.7 }, r.personality.text)
	);

export function recapCard(o: { recap: YearRecap; name: string; footer: string; posters: Posters }) {
	const r = o.recap;
	return page(
		OG,
		o.footer,
		h(
			{ flex: 1, justifyContent: 'space-between', gap: 40 },
			h(
				{ flexDirection: 'column', gap: 18, width: 640 },
				label(`Récap ${r.year}`, 24, C.accent),
				big(clip(o.name, 22), 64),
				h(
					{ alignItems: 'baseline', gap: 14 },
					big(r.hours, 96, C.accent),
					h({ fontSize: 30, color: C.muted }, 'heures')
				),
				r.personality && h({ fontSize: 30, fontWeight: 600 }, `Verdict : ${r.personality.title}`)
			),
			h(
				{ gap: 14, alignItems: 'center' },
				...o.posters.slice(0, 3).map((p) => poster(p.poster, p.title, 150, 225))
			)
		)
	);
}

export function recapStory(o: {
	recap: YearRecap;
	name: string;
	footer: string;
	posters: Posters;
}) {
	const r = o.recap;
	return page(
		STORY,
		o.footer,
		h(
			{ flexDirection: 'column', gap: 26 },
			label(`Récap ${r.year}`, 34, C.accent),
			big(clip(o.name, 18), 110),
			h(
				{ alignItems: 'baseline', gap: 20, marginTop: 20 },
				big(r.hours, 200, C.accent),
				h({ fontSize: 48, color: C.muted }, 'heures')
			),
			completedLine(r, 34)
		),
		o.posters.length
			? h(
					{ flexDirection: 'column', gap: 24 },
					label(`Top ${o.posters.length}`, 30),
					h({ gap: 14 }, ...o.posters.slice(0, 5).map((p) => poster(p.poster, p.title, 176, 264)))
				)
			: h({}),
		verdict(r, 44) || h({})
	);
}
