// Haptic feedback on phones, without a library. Android: the Vibration API. iOS Safari has no
// vibrate(), but since iOS 18 toggling a `<input type="checkbox" switch>` plays the system tick:
// a hidden one is clicked through its label. Off with reduced motion, or from /settings.

export type Haptic = 'tap' | 'success' | 'error';

const PATTERNS: Record<Haptic, number | number[]> = {
	tap: 8,
	success: [12, 60, 12],
	error: [30, 60, 30, 60, 30]
};
/** iOS ticks per kind, spaced like the vibration patterns. */
const TICKS: Record<Haptic, number> = { tap: 1, success: 2, error: 3 };

export const HAPTICS_KEY = 'vulu:haptics';

/** Clickable things that tick when pressed (the same set as the ripple, plus links styled as buttons). */
const TARGETS =
	"button, a.btn, a.chip, [role='button'], summary, label:has(> input:is([type='checkbox'], [type='radio']))";

export function hapticsEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
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

let iosSwitch: HTMLLabelElement | null = null;

/** The hidden switch iOS ticks on, created once. */
function iosLabel(doc: Document) {
	if (iosSwitch?.isConnected) return iosSwitch;
	const label = doc.createElement('label');
	label.dataset.haptic = '';
	label.ariaHidden = 'true';
	// Not display:none: iOS plays no tick for a switch that is not rendered
	label.style.cssText =
		'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
	const input = doc.createElement('input');
	input.type = 'checkbox';
	input.setAttribute('switch', '');
	input.tabIndex = -1;
	label.append(input);
	doc.body.append(label);
	return (iosSwitch = label);
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
	if (!doc.defaultView?.matchMedia?.('(pointer: coarse)').matches) return;
	const label = iosLabel(doc);
	label.click();
	for (let i = 1; i < TICKS[kind]; i++) setTimeout(() => label.click(), i * 90);
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
