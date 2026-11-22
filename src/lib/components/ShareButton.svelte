<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '#lib/toast.svelte.ts';

	// The system share sheet on phones, otherwise the link is copied
	let {
		title,
		text = '',
		path = page.url.pathname,
		class: cls = 'btn-ghost'
	}: { title: string; text?: string; path?: string; class?: string } = $props();

	async function share() {
		const url = new URL(path, page.url.origin).href;
		if (navigator.share) {
			try {
				await navigator.share({ title, text, url });
			} catch {
				// Closed by the user
			}
			return;
		}
		await navigator.clipboard.writeText(url);
		toast('Lien copié');
	}
</script>

<button type="button" class={cls} onclick={share}>Partager</button>
