// Link preview cards (1200x630) for profiles, lists and works. Data must already be filtered
// for a signed-out viewer: crawlers have no session.
import { typeLabel, typePlural, type MediaType } from '../../labels';
import { C, h, img, OG, type El } from './render';

const NBSP = String.fromCharCode(160);

export const clip = (s: string, n: number) =>
	s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

export function poster(src: string | null, title: string, width: number, height: number): El {
	const frame = { width, height, borderRadius: 14, flexShrink: 0 };
	if (src) return img(src, { ...frame, objectFit: 'cover' });
	return h(
		{ ...frame, backgroundColor: C.surface2, padding: 14, alignItems: 'flex-end', fontSize: 18 },
		clip(title, 40)
	);
}

export function avatar(src: string | null, name: string, size: number): El {
	const frame = { width: size, height: size, borderRadius: size };
	if (src) return img(src, { ...frame, objectFit: 'cover' });
	return h(
		{
			...frame,
			backgroundColor: C.accent,
			color: C.onAccent,
			alignItems: 'center',
			justifyContent: 'center',
			fontFamily: 'Display',
			fontSize: size * 0.45
		},
		(name[0] ?? '?').toUpperCase()
	);
}

/** The fonts have no ★: drawn as a shape */
export const star = (size: number, color = C.accent): El => ({
	type: 'svg',
	props: {
		width: size,
		height: size,
		viewBox: '0 0 24 24',
		children: {
			type: 'path',
			props: {
				fill: color,
				d: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'
			}
		}
	}
});

/** A score with its star, e.g. ★ 8/10 */
export const scoreLine = (score: string, size: number) =>
	h(
		{
			alignItems: 'center',
			gap: size * 0.25,
			fontFamily: 'Display',
			fontSize: size,
			color: C.accent
		},
		star(size * 0.8),
		score
	);

export const wordmark = (size = 34) =>
	h(
		{ alignItems: 'center', gap: size * 0.3, fontFamily: 'Display', fontSize: size, color: C.ink },
		h({ width: size * 0.5, height: size * 0.5, borderRadius: size, backgroundColor: C.accent }),
		'Vulu'
	);

/** The common frame: content on top, the wordmark and the site's host at the bottom. */
function frame(host: string, ...content: El[]) {
	return h(
		{
			...OG,
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: 56,
			backgroundColor: C.bg,
			color: C.ink,
			fontFamily: 'Sans'
		},
		h({ flex: 1, gap: 48 }, ...content),
		h(
			{ justifyContent: 'space-between', alignItems: 'center', marginTop: 32 },
			wordmark(),
			h({ fontSize: 22, color: C.muted }, host)
		)
	);
}

const stat = (value: number | string, label: string, color = C.ink) =>
	h(
		{ flexDirection: 'column' },
		h({ fontFamily: 'Display', fontSize: 44, color }, String(value)),
		h({ fontSize: 20, color: C.muted }, label)
	);

export function profileCard(p: {
	host: string;
	name: string;
	username: string;
	avatar: string | null;
	followers: number;
	completed: { type: MediaType; count: number }[];
	favorites: { title: string; poster: string | null }[];
}) {
	const counts = [...p.completed].sort((a, b) => b.count - a.count).slice(0, 3);
	return frame(
		p.host,
		h(
			{ flex: 1, flexDirection: 'column', gap: 28, justifyContent: 'center' },
			h(
				{ alignItems: 'center', gap: 28 },
				avatar(p.avatar, p.name, 128),
				h(
					{ flexDirection: 'column' },
					h({ fontFamily: 'Display', fontSize: 64, lineHeight: 1 }, clip(p.name, 22)),
					h({ fontSize: 26, color: C.muted, marginTop: 8 }, `@${p.username}`)
				)
			),
			h(
				{ gap: 40 },
				...counts.map((c) =>
					stat(
						c.count,
						`${typePlural[c.type].toLowerCase()} ${c.type === 'tv' ? 'terminées' : 'terminés'}`,
						C[c.type]
					)
				),
				stat(p.followers, p.followers > 1 ? 'abonnés' : 'abonné')
			)
		),
		...(p.favorites.length
			? [
					h(
						{ gap: 16, alignItems: 'center' },
						...p.favorites.slice(0, 3).map((f) => poster(f.poster, f.title, 150, 225))
					)
				]
			: [])
	);
}

export function listCard(l: {
	host: string;
	name: string;
	owner: string;
	count: number;
	posters: { title: string; poster: string | null }[];
}) {
	return frame(
		l.host,
		h(
			{ width: 720, flexDirection: 'column', justifyContent: 'center', gap: 16 },
			h({ fontSize: 24, color: C.accent, fontWeight: 600 }, 'LISTE'),
			h({ fontFamily: 'Display', fontSize: 64, lineHeight: 1.05 }, clip(l.name, 50)),
			h(
				{ fontSize: 26, color: C.muted },
				`par @${l.owner} · ${l.count} ${l.count > 1 ? 'œuvres' : 'œuvre'}`
			)
		),
		h(
			{ flexWrap: 'wrap', width: 3 * 104 + 2 * 10, gap: 10, alignContent: 'center' },
			...l.posters.slice(0, 9).map((p) => poster(p.poster, p.title, 104, 150))
		)
	);
}

export function mediaCard(m: {
	host: string;
	title: string;
	type: MediaType;
	year: number | null;
	poster: string | null;
	/** Someone's entry ("@x a terminé"), or the members' average. */
	by: { name: string; verb: string; score: string | null } | null;
	average: string | null;
	ratings: number;
}) {
	const rating = m.by
		? h(
				{ flexDirection: 'column', gap: 6 },
				h({ fontSize: 30, color: C.ink, fontWeight: 600 }, `${m.by.name} ${m.by.verb}`),
				m.by.score && scoreLine(m.by.score, 72)
			)
		: m.average &&
			h(
				{ alignItems: 'baseline', gap: 16 },
				scoreLine(m.average, 72),
				h(
					{ fontSize: 24, color: C.muted },
					`${m.ratings} ${m.ratings > 1 ? 'notes' : 'note'} sur Vulu`
				)
			);
	return frame(
		m.host,
		poster(m.poster, m.title, 300, 450),
		h(
			// Explicit width: without it a long title runs off the card instead of wrapping
			{ width: 740, flexDirection: 'column', justifyContent: 'center', gap: 20 },
			h(
				{ fontSize: 22, fontWeight: 600, color: C[m.type] },
				// Non-breaking spaces: satori drops plain ones around the dot
				`${typeLabel[m.type].toUpperCase()}${m.year ? `${NBSP}·${NBSP}${m.year}` : ''}`
			),
			h({ fontFamily: 'Display', fontSize: 60, lineHeight: 1.05 }, clip(m.title, 60)),
			rating
		)
	);
}

type Person = { name: string; avatar: string | null };

export function compatCard(c: {
	host: string;
	a: Person;
	b: Person;
	percent: number | null;
	verdict: string | null;
	shared: number;
	posters: { title: string; poster: string | null }[];
}) {
	return frame(
		c.host,
		h(
			{ width: 640, flexDirection: 'column', justifyContent: 'center', gap: 18 },
			h(
				{ alignItems: 'center' },
				avatar(c.a.avatar, c.a.name, 96),
				h(
					{ marginLeft: -24, borderRadius: 999, border: `6px solid ${C.bg}` },
					avatar(c.b.avatar, c.b.name, 96)
				)
			),
			h({ fontSize: 30, color: C.muted }, clip(`${c.a.name} & ${c.b.name}`, 40)),
			c.percent === null
				? h({ fontFamily: 'Display', fontSize: 56 }, 'Pas encore assez d’œuvres en commun')
				: h(
						{ alignItems: 'baseline', gap: 18 },
						h(
							{ fontFamily: 'Display', fontSize: 140, lineHeight: 0.9, color: C.accent },
							`${c.percent} %`
						),
						h({ fontSize: 30, color: C.muted }, 'compatibles')
					),
			c.verdict && h({ fontSize: 34, fontWeight: 600 }, c.verdict)
		),
		h(
			{ flexWrap: 'wrap', width: 2 * 130 + 14, gap: 14, alignContent: 'center' },
			...c.posters.slice(0, 4).map((p) => poster(p.poster, p.title, 130, 195))
		)
	);
}
