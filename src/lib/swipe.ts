// Horizontal swipe on a page (`use:swipe`), for moving to the previous / next work (#97). Only a
// clearly horizontal touch gesture counts: vertical scrolling stays native (`touch-action:
// pan-y`), and gestures starting on something that scrolls sideways (season tabs, shelves), a
// field, the stars (`data-no-swipe`) or near the screen edges (the system "back" gesture) are left
// alone. The page follows the finger, slides out, then the new one slides in from the other side.

export type SwipeOptions = {
	/** Whether there is a work in that direction (1: next, swiping left; -1: previous). */
	can: (dir: 1 | -1) => boolean;
	/** Opens it; false when it could not be, and the page comes back. */
	go: (dir: 1 | -1) => Promise<boolean>;
};

/** Gestures starting on these keep their own behaviour. */
const IGNORED = 'input, textarea, select, [contenteditable], [data-no-swipe]';
/** Room left to the system edge gestures (iOS back, Android back). */
const EDGE = 24;
/** Pixels before the gesture's direction is decided. */
const SLOP = 10;

// Direction of the swipe that opened the page being loaded: its page slides in from that side,
// even when it is a new element (the layout shows a skeleton while a slow page loads)
let entering: { dir: 1 | -1; at: number } | null = null;

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

// A page moved sideways must not widen the document: phones would zoom out to show it all
function clip(node: HTMLElement, on: boolean) {
	if (node.parentElement) node.parentElement.style.overflowX = on ? 'clip' : '';
}

/** Keeps the parent clipped until the animation ends. */
function clipping(node: HTMLElement, animation: Animation) {
	clip(node, true);
	animation.finished.then(
		() => clip(node, false),
		() => {}
	);
	return animation;
}

function slideIn(node: HTMLElement, dir: 1 | -1) {
	if (reduced()) return;
	clipping(
		node,
		node.animate(
			[
				{ translate: `${dir * 24}% 0`, opacity: 0 },
				{ translate: '0 0', opacity: 1 }
			],
			{ duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
		)
	);
}

export function swipe(node: HTMLElement, options: SwipeOptions) {
	let opts = options;
	let start: { x: number; y: number; t: number; id: number } | null = null;
	let horizontal = false;
	let busy = false;
	let dx = 0;
	let swallowUntil = -Infinity;

	node.style.touchAction = 'pan-y pinch-zoom';
	if (entering && performance.now() - entering.at < 5000) {
		slideIn(node, entering.dir);
		entering = null;
	}

	const move = (x: number, opacity = 1) => {
		node.style.translate = x ? `${x}px 0` : '';
		node.style.opacity = opacity < 1 ? String(opacity) : '';
	};

	function reset() {
		start = null;
		horizontal = false;
		dx = 0;
	}

	function back() {
		const from = dx;
		move(0);
		if (from && !reduced())
			clipping(
				node,
				node.animate([{ translate: `${from}px 0` }, { translate: '0 0' }], {
					duration: 200,
					easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
				})
			);
		else clip(node, false);
	}

	async function finish(dir: 1 | -1) {
		busy = true;
		const width = node.offsetWidth;
		if (!reduced()) {
			const out = node.animate(
				[
					{ translate: `${dx}px 0`, opacity: 1 },
					{ translate: `${-dir * width}px 0`, opacity: 0 }
				],
				{ duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
			);
			move(0);
			await out.finished.catch(() => {});
			entering = { dir, at: performance.now() };
			const ok = await opts.go(dir).catch(() => false);
			out.cancel();
			clip(node, false);
			if (!ok) {
				entering = null;
				slideIn(node, -dir as 1 | -1);
			} else if (node.isConnected && entering) {
				// Same element, new work: it slides in from the side the finger came from
				entering = null;
				slideIn(node, dir);
			}
		} else {
			move(0);
			await opts.go(dir).catch(() => false);
		}
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
			clip(node, true);
		}
		const dir = x < 0 ? 1 : -1;
		// Nothing that way: a short elastic pull, no wrap-around
		dx = opts.can(dir) ? x : Math.sign(x) * Math.min(40, Math.abs(x) / 4);
		if (!reduced()) move(dx, 1 - Math.min(0.4, Math.abs(dx) / node.offsetWidth));
	}

	function up(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		if (!horizontal) return reset();
		swallowUntil = e.timeStamp + 400;
		const x = e.clientX - start.x;
		const speed = Math.abs(x) / Math.max(1, e.timeStamp - start.t);
		const dir = x < 0 ? 1 : -1;
		const far = Math.abs(x) > node.offsetWidth * 0.25 || (speed > 0.5 && Math.abs(x) > 40);
		if (far && opts.can(dir)) void finish(dir);
		else back();
		reset();
	}

	function cancel(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		back();
		reset();
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
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', pointermove);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
		}
	};
}
