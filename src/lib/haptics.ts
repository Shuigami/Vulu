// Haptic feedback on phones, without a library. Android: the Vibration API. iOS Safari has no
// vibrate(), but since iOS 18 toggling a `<input type="checkbox" switch>` plays the system tick:
// a hidden one is clicked through its label. Can be turned off per device in /settings.

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
 * iOS: a fresh `<label><input type="checkbox" switch></label>`, clicked then removed. Toggling a
 * switch plays the system tick, even unrendered (display: none), but only during a user gesture.
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
	// iOS: only works inside a user gesture, so the first tick is played now
	if (!doc.defaultView || hapticSupport(doc.defaultView) !== 'ios') return;
	iosTick(doc);
	for (let i = 1; i < TICKS[kind]; i++) setTimeout(() => iosTick(doc), i * 90);
}

/** One listener on the document: every button ticks when tapped. */
export function installHaptics(doc: Document = document): () => void {
	let last: { el: Element; at: number } | null = null;
	const onClick = (e: MouseEvent) => {
		const target = e.target as Element | null;
		if (!target || target.closest('[data-haptic]')) return;
		const el = target.closest<HTMLElement>(TARGETS);
		if (!el || el.matches(':disabled')) return;
		// A label sends a second click to its checkbox: one tick per tap
		if (last?.el === el && e.timeStamp - last.at < 100) return;
		last = { el, at: e.timeStamp };
		haptic('tap', doc);
	};
	doc.addEventListener('click', onClick, true);
	return () => doc.removeEventListener('click', onClick, true);
}
