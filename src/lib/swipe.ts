// Horizontal swipe on a page (`use:swipe`), for moving to the previous / next work (#97). Only a
// clearly horizontal touch gesture counts: vertical scrolling stays native (`touch-action:
// pan-y`), and gestures starting on something that scrolls sideways (season tabs, shelves), a
// field, the stars (`data-no-swipe`) or near the screen edges (the system "back" gesture) are left
// alone.
//
// The two pages sit side by side like a carousel: while the finger moves, the node gets
// `data-swiping` and the page shows the neighbour's placeholder right beside it (positioned with
// `--peek-gap`, the page gutters, and `--peek-top`, the top of the visible part). On release the
// row slides until the neighbour is in place, then the real page replaces the placeholder where
// it stands.

export type SwipeOptions = {
	/** Whether there is a work in that direction (1: next, swiping left; -1: previous). */
	can: (dir: 1 | -1) => boolean;
	/** Opens it (`slid`: the placeholder stands in meanwhile); false when it could not be. */
	go: (dir: 1 | -1, slid: boolean) => Promise<boolean>;
};

/** Gestures starting on these keep their own behaviour. */
const IGNORED = 'input, textarea, select, [contenteditable], [data-no-swipe]';
/** Room left to the system edge gestures (iOS back, Android back). */
const EDGE = 24;
/** Pixels before the gesture's direction is decided. */
const SLOP = 10;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whether the element, or a parent, scrolls sideways or handles its own gestures. */
function blocked(target: EventTarget | null, root: HTMLElement) {
	for (
		let el = target instanceof Element ? target : null;
		el && el !== root;
		el = el.parentElement
	) {
		if (el.matches(IGNORED)) return true;
		if (el.scrollWidth > el.clientWidth + 1) {
			const overflow = getComputedStyle(el).overflowX;
			if (overflow === 'auto' || overflow === 'scroll') return true;
		}
	}
	return false;
}

export function swipe(node: HTMLElement, options: SwipeOptions) {
	let opts = options;
	let start: { x: number; y: number; t: number; id: number } | null = null;
	let horizontal = false;
	let busy = false;
	let dx = 0;
	// Distance between the two pages' content, and the page's top in the document
	let gap = 0;
	let top = 0;
	let swallowUntil = -Infinity;

	node.style.touchAction = 'pan-y pinch-zoom';

	const move = (x: number) => (node.style.translate = x ? `${x}px 0` : '');

	// The pages side by side must not widen the document: phones would zoom out to show it all
	function show(on: boolean) {
		node.toggleAttribute('data-swiping', on);
		if (node.parentElement) node.parentElement.style.overflowX = on ? 'clip' : '';
	}

	function setUp() {
		const parent = node.parentElement;
		const pad = parent ? getComputedStyle(parent) : null;
		gap = pad ? parseFloat(pad.paddingLeft) + parseFloat(pad.paddingRight) : 32;
		top = node.getBoundingClientRect().top + scrollY;
		node.style.setProperty('--peek-gap', `${gap}px`);
		// The neighbour shows from the top of what is on screen, not above it
		node.style.setProperty('--peek-top', `${Math.max(0, scrollY - top)}px`);
		show(true);
	}

	function reset() {
		start = null;
		horizontal = false;
		dx = 0;
	}

	async function slide(from: number, to: number, duration: number) {
		move(to);
		if (from !== to)
			await node
				.animate([{ translate: `${from}px 0` }, { translate: `${to}px 0` }], {
					duration,
					easing: EASE_OUT
				})
				.finished.catch(() => {});
	}

	async function back(from: number) {
		busy = true;
		await slide(from, 0, 220);
		show(false);
		busy = false;
	}

	async function finish(dir: 1 | -1, from: number) {
		busy = true;
		const target = -dir * (node.offsetWidth + gap);
		// Quicker when the finger already went most of the way
		await slide(from, target, Math.max(140, 300 * (1 - Math.abs(from / target))));
		const scrolled = scrollY;
		const ok = await opts.go(dir, true).catch(() => false);
		if (ok) {
			// The new page takes the placeholder's place: the page top, or the top of the screen
			show(false);
			move(0);
			scrollTo(0, Math.min(scrolled, top));
		} else await back(target);
		busy = false;
	}

	function down(e: PointerEvent) {
		if (e.pointerType !== 'touch' || !e.isPrimary || busy) return;
		if (e.clientX < EDGE || e.clientX > innerWidth - EDGE) return;
		if (blocked(e.target, node)) return;
		start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
	}

	function pointermove(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		const x = e.clientX - start.x;
		const y = e.clientY - start.y;
		if (!horizontal) {
			if (Math.hypot(x, y) < SLOP) return;
			// Mostly vertical: the browser scrolls (and sends pointercancel)
			if (Math.abs(x) < Math.abs(y) * 1.5) return reset();
			horizontal = true;
			node.setPointerCapture(e.pointerId);
			if (!reduced()) setUp();
		}
		const dir = x < 0 ? 1 : -1;
		// Nothing that way: a short elastic pull, no wrap-around
		dx = opts.can(dir) ? x : Math.sign(x) * Math.min(40, Math.abs(x) / 4);
		if (!reduced()) move(dx);
	}

	function up(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		if (!horizontal) return reset();
		swallowUntil = e.timeStamp + 400;
		const x = e.clientX - start.x;
		const speed = Math.abs(x) / Math.max(1, e.timeStamp - start.t);
		const dir = x < 0 ? 1 : -1;
		const far = Math.abs(x) > node.offsetWidth * 0.25 || (speed > 0.5 && Math.abs(x) > 40);
		const from = dx;
		reset();
		if (reduced()) {
			if (far && opts.can(dir)) void opts.go(dir, false);
		} else if (far && opts.can(dir)) void finish(dir, from);
		else void back(from);
	}

	function cancel(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		const from = dx;
		const was = horizontal;
		reset();
		if (was && !reduced()) void back(from);
	}

	// The click following a swipe that ended on a link or a button does nothing
	function click(e: MouseEvent) {
		if (e.timeStamp < swallowUntil) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', pointermove);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);
	return {
		update: (next: SwipeOptions) => (opts = next),
		destroy() {
			if (node.parentElement) node.parentElement.style.overflowX = '';
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', pointermove);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
		}
	};
}
