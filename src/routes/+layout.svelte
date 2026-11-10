<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { installRipple } from '#lib/ripple.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	$effect(() => installRipple());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
