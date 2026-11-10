<script lang="ts">
	import './layout.css';
	import { installRipple } from '#lib/ripple.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	$effect(() => installRipple());
</script>

{@render children()}
