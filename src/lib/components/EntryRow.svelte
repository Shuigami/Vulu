<script lang="ts">
	import { resolve } from '$app/paths';
	import Poster from '#lib/components/Poster.svelte';
	import {
		statusLabel,
		toScale,
		typeLabel,
		unitLabel,
		type EntryStatus,
		type MediaType
	} from '#lib/labels.ts';

	type Entry = {
		mediaId: number;
		type: MediaType;
		title: string;
		posterUrl: string | null;
		year: number | null;
		status: EntryStatus;
		progress: number;
		totalUnits: number | null;
		score: number | null;
	};
	let { entry: e, scale }: { entry: Entry; scale: number } = $props();
	const unit = $derived(unitLabel[e.type]);
</script>

<div class="flex items-center gap-3 py-2">
	<Poster src={e.posterUrl} title={e.title} />
	<div class="min-w-0 flex-1">
		<a
			href={resolve('/(app)/media/[id]', { id: String(e.mediaId) })}
			class="font-medium hover:underline">{e.title}</a
		>
		<p class="text-sm text-gray-500">
			{typeLabel[e.type]}{e.year ? ` · ${e.year}` : ''} · {statusLabel[e.status]}{unit &&
			(e.progress || e.totalUnits)
				? ` · ${e.progress}${e.totalUnits ? `/${e.totalUnits}` : ''} ${unit}`
				: ''}{e.score !== null ? ` · ${toScale(e.score, scale)}/${scale}` : ''}
		</p>
	</div>
</div>
