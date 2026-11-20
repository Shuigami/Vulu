<script lang="ts">
	import { typeLabel, type MediaType } from '#lib/labels.ts';

	let { type, label }: { type: MediaType; label?: string } = $props();
	const color: Record<MediaType, string> = {
		movie: 'text-movie',
		tv: 'text-tv',
		anime: 'text-anime',
		manga: 'text-manga',
		book: 'text-book'
	};
</script>

<span class="{color[type]} rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold"
	>{label ?? typeLabel[type]}</span
>
