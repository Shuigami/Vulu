/** Short confirmations shown at the bottom of the screen (src/lib/components/Toaster.svelte). */
export type Toast = { id: number; message: string; undo?: () => unknown };

export const toasts = $state<Toast[]>([]);
let next = 0;

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}

/** Shows `message` for a few seconds; `undo` adds an "Annuler" button. */
export function toast(message: string, undo?: Toast['undo']) {
	const id = next++;
	toasts.push({ id, message, undo });
	if (toasts.length > 3) toasts.shift();
	setTimeout(() => dismiss(id), undo ? 6000 : 3500);
}

/** Posts `fields` to a form action of the current page, as `use:enhance` would (no redirect). */
export function postAction(action: string, fields: Record<string, string | number>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
	return fetch(action, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
}
