// Long press on touch screens, right click with a mouse, the context menu key on a keyboard: one
// action (`use:longpress`) for opening a card's menu. A tap stays a tap, and scrolling never
// presses: the press is cancelled when the finger moves or anything scrolls.

export type PressPoint = {
	/** Viewport coordinates of the press (the element's corner for the keyboard). */
	x: number;
	y: number;
	via: 'touch' | 'mouse' | 'keyboard';
};

export type LongpressOptions = {
	onpress: (at: PressPoint) => void;
	/** Milliseconds the finger stays down. */
	delay?: number;
	/** Pixels the finger may move before the press becomes a scroll. */
	tolerance?: number;
};

/** Presses starting on these keep their own behaviour (the "+1" button, fields). */
const IGNORED = 'button, input, select, textarea, label, [data-no-longpress]';

export function longpress(node: HTMLElement, options: LongpressOptions) {
	let opts = options;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let start: { x: number; y: number; id: number } | null = null;
	let fired = false;
	let lastTouch = -Infinity;
	let swallowUntil = -Infinity;

	// While a finger is down, followed on window: once the menu opens the card is inert
	const listen = (on: boolean) => {
		const toggle = (on ? window.addEventListener : window.removeEventListener).bind(window);
		toggle('pointermove', onMove as EventListener, true);
		toggle('pointerup', onUp as EventListener, true);
		toggle('pointercancel', onUp as EventListener, true);
		// Capture: the row scrolling horizontally does not bubble to window
		toggle('scroll', cancel, true);
	};
	function cancel() {
		clearTimeout(timer);
		timer = undefined;
		start = null;
	}
	function fire() {
		const at = start;
		cancel();
		if (!at) return;
		fired = true;
		opts.onpress({ x: at.x, y: at.y, via: 'touch' });
	}
	function onMove(e: PointerEvent) {
		const tolerance = opts.tolerance ?? 8;
		if (
			start?.id === e.pointerId &&
			Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance
		)
			cancel();
	}
	function onUp(e: PointerEvent) {
		cancel();
		listen(false);
		// The click following the finger's release must not open the card's link
		if (fired) swallowUntil = e.timeStamp + 600;
		fired = false;
	}

	const onDown = (e: PointerEvent) => {
		if (e.pointerType === 'mouse') return;
		lastTouch = e.timeStamp;
		cancel();
		fired = false;
		if (!e.isPrimary || (e.target as Element | null)?.closest(IGNORED)) return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId };
		listen(true);
		timer = setTimeout(fire, opts.delay ?? 500);
	};
	const onClick = (e: MouseEvent) => {
		if (e.timeStamp > swallowUntil) return;
		swallowUntil = -Infinity;
		e.preventDefault();
		e.stopPropagation();
	};
	const onContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		// Android sends its own long press as a context menu: it opens ours if the finger is still down
		if (e.timeStamp - lastTouch < 1500) {
			if (timer) fire();
			return;
		}
		// The context menu key (or Shift+F10) has no pointer position
		if (e.clientX === 0 && e.clientY === 0) {
			const box = node.getBoundingClientRect();
			opts.onpress({ x: box.left + 16, y: box.top + 16, via: 'keyboard' });
		} else opts.onpress({ x: e.clientX, y: e.clientY, via: 'mouse' });
	};

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('click', onClick, true);
	node.addEventListener('contextmenu', onContextMenu);
	return {
		update(next: LongpressOptions) {
			opts = next;
		},
		destroy() {
			cancel();
			listen(false);
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('click', onClick, true);
			node.removeEventListener('contextmenu', onContextMenu);
		}
	};
}
