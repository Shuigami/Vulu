// Press ripple: a circle spreads from the pointer inside anything clickable, like a drop on water.
// One listener on the document, so every button gets it without touching each component.
const TARGETS = "button, .btn, .chip, label:has(> input:is([type='checkbox'], [type='radio']))";

export function installRipple(doc: Document = document): () => void {
	const reduced = doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
	const onDown = (e: PointerEvent) => {
		if (reduced?.matches || e.button !== 0) return;
		const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
		if (!el || el.matches(':disabled')) return;
		if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
		const box = el.getBoundingClientRect();
		const x = e.clientX - box.left;
		const y = e.clientY - box.top;
		// Big enough to reach the farthest corner
		const r = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
		const host = doc.createElement('span');
		host.className = 'ripple-host';
		const drop = doc.createElement('span');
		drop.className = 'ripple';
		drop.style.cssText = `left:${x - r}px;top:${y - r}px;width:${2 * r}px;height:${2 * r}px`;
		host.append(drop);
		el.append(host);
		drop.addEventListener('animationend', () => host.remove(), { once: true });
	};
	doc.addEventListener('pointerdown', onDown);
	return () => doc.removeEventListener('pointerdown', onDown);
}
