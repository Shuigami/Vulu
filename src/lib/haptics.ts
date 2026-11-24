// Haptic feedback on phones, without a library. Android: the Vibration API. iOS Safari has no
// vibrate(), but toggling a `<input type="checkbox" switch>` plays the system tick. Since iOS 26.5
// only a real tap on the switch does (a scripted click no longer ticks), so every button carries
// an invisible switch over its whole box: the tap lands on it, ticks, and is passed on to the
// button. Can be turned off per device in /settings.

export type Haptic = 'tap' | 'success' | 'error';

const PATTERNS: Record<Haptic, number | number[]> = {
	// Shorter than ~15 ms is not felt on many Android motors
	tap: 15,
	success: [20, 60, 20],
	error: [40, 60, 40, 60, 40]
};
/** iOS ticks per kind, spaced like the vibration patterns. */
const TICKS: Record<Haptic, number> = { tap: 1, success: 2, error: 3 };

export const HAPTICS_KEY = 'vulu:haptics';
/** Fired on window when the setting changes, so the iOS switches follow it. */
const HAPTICS_EVENT = 'vulu:haptics';
const OVERLAY = 'data-haptic-overlay';

/** Clickable things that tick when pressed (the same set as the ripple, plus links styled as buttons). */
const TARGETS =
	"button, a.btn, a.chip, [role='button'], summary, label:has(> input:is([type='checkbox'], [type='radio']))";

export function hapticsEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return localStorage.getItem(HAPTICS_KEY) !== 'off';
	} catch {
		return true;
	}
}

export function setHapticsEnabled(on: boolean) {
	try {
		if (on) localStorage.removeItem(HAPTICS_KEY);
		else localStorage.setItem(HAPTICS_KEY, 'off');
	} catch {
		// Private mode: the choice lasts for this page only
	}
	window.dispatchEvent(new Event(HAPTICS_EVENT));
}

/** What this device can do: the Vibration API, the iOS 18 switch, or nothing. */
export function hapticSupport(win: Window = window): 'vibrate' | 'ios' | 'ios-old' | 'none' {
	if (typeof win.navigator.vibrate === 'function') return 'vibrate';
	const ua = win.navigator.userAgent;
	// iPadOS presents itself as a Mac: touch points tell them apart
	const ios =
		/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && win.navigator.maxTouchPoints > 1);
	if (!ios) return 'none';
	const major = Number(/OS (\d+)_/.exec(ua)?.[1] ?? /Version\/(\d+)/.exec(ua)?.[1] ?? 0);
	return major >= 18 ? 'ios' : 'ios-old';
}

/**
 * iOS up to 26.4: a fresh `<label><input type="checkbox" switch></label>`, clicked then removed,
 * ticks during a user gesture (the success / error patterns). A no-op since iOS 26.5.
 */
function iosTick(doc: Document) {
	const label = doc.createElement('label');
	label.dataset.haptic = '';
	label.ariaHidden = 'true';
	label.style.display = 'none';
	const input = doc.createElement('input');
	input.type = 'checkbox';
	input.setAttribute('switch', '');
	label.append(input);
	doc.head.append(label);
	try {
		label.click();
	} finally {
		label.remove();
	}
}

/** Plays a haptic, if the device has one and the user did not turn them off. */
export function haptic(kind: Haptic = 'tap', doc: Document = document) {
	if (!hapticsEnabled()) return;
	const nav = doc.defaultView?.navigator;
	if (nav && typeof nav.vibrate === 'function') {
		nav.vibrate(PATTERNS[kind]);
		return;
	}
	// iOS up to 26.4: only inside a user gesture, so the first tick is played now
	if (!doc.defaultView || hapticSupport(doc.defaultView) !== 'ios') return;
	iosTick(doc);
	for (let i = 1; i < TICKS[kind]; i++) setTimeout(() => iosTick(doc), i * 90);
}

/**
 * iOS: an invisible switch over the whole button. The real tap toggles it (the tick), then it
 * stops that click and clicks the button instead, so forms and handlers run once as usual.
 */
function attachSwitch(button: HTMLButtonElement) {
	// data-stretched: its ::after covers a whole card, which a relative position would shrink
	if (button.querySelector(`:scope > [${OVERLAY}]`) || button.matches('[data-stretched]')) return;
	const doc = button.ownerDocument;
	const sw = doc.createElement('input');
	sw.type = 'checkbox';
	sw.setAttribute('switch', '');
	sw.setAttribute(OVERLAY, '');
	sw.setAttribute('aria-hidden', 'true');
	sw.tabIndex = -1;
	sw.style.cssText =
		'position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:inherit;-webkit-appearance:none;appearance:none';
	sw.addEventListener('click', (e) => {
		e.stopPropagation();
		if (button.disabled) return;
		button.focus({ preventScroll: true });
		button.click();
	});
	if (getComputedStyle(button).position === 'static') button.style.position = 'relative';
	button.append(sw);
}

/** Haptics for every button: a document listener (Android), or switches on the buttons (iOS). */
export function installHaptics(doc: Document = document): () => void {
	const win = doc.defaultView;
	if (!win) return () => {};
	const ios = hapticSupport(win) === 'ios';
	let last: { el: Element; at: number } | null = null;
	const onClick = (e: MouseEvent) => {
		const target = e.target as Element | null;
		if (ios || !target || target.closest('[data-haptic]')) return;
		const el = target.closest<HTMLElement>(TARGETS);
		if (!el || el.matches(':disabled')) return;
		// A label sends a second click to its checkbox: one tick per tap
		if (last?.el === el && e.timeStamp - last.at < 100) return;
		last = { el, at: e.timeStamp };
		haptic('tap', doc);
	};
	doc.addEventListener('click', onClick, true);
	if (!ios) return () => doc.removeEventListener('click', onClick, true);

	const attachIn = (root: Element) => {
		if (root instanceof win.HTMLButtonElement) attachSwitch(root);
		for (const b of root.querySelectorAll('button')) attachSwitch(b);
	};
	const sync = () => {
		if (hapticsEnabled()) attachIn(doc.body);
		else for (const sw of doc.querySelectorAll(`[${OVERLAY}]`)) sw.remove();
	};
	const observer = new win.MutationObserver((records) => {
		if (!hapticsEnabled()) return;
		for (const r of records)
			for (const n of r.addedNodes)
				if (n instanceof win.Element && !n.hasAttribute(OVERLAY)) attachIn(n);
	});
	observer.observe(doc.body, { childList: true, subtree: true });
	win.addEventListener(HAPTICS_EVENT, sync);
	sync();
	return () => {
		doc.removeEventListener('click', onClick, true);
		observer.disconnect();
		win.removeEventListener(HAPTICS_EVENT, sync);
		for (const sw of doc.querySelectorAll(`[${OVERLAY}]`)) sw.remove();
	};
}
