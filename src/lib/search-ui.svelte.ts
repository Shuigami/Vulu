import { flushSync } from 'svelte';

/** Phones show the header search only once opened (magnifier button, "Chercher une œuvre"). */
export const searchUi = $state({ open: false });

/** Opens the header search and focuses it, in the same tap so phones show the keyboard. */
export function openSearch() {
	flushSync(() => (searchUi.open = true));
	document.querySelector<HTMLInputElement>('header input[name="q"]')?.focus();
}
